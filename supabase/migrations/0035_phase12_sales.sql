-- ============================================================================
-- 0035_phase12_sales.sql — PHASE 12 — Sales CRM (retail/distribution).
-- Brings the "Ignis Sales CRM" capability natively onto the jikoni spine:
-- a Products catalogue + Inventory (with stock decrement), product-based order
-- lines, Sales Targets, and M-Pesa transactions — while REUSING the existing
-- Revenue spine for accounts (parties + customer_profiles), AR invoices
-- (receivable_invoices) and payments (customer_receipts).
--
-- Genuinely new here = products / inventory / inventory_movements /
-- sales_order_lines / sales_targets / mpesa_transactions, plus a few columns on
-- existing tables and one atomic place_sales_order() RPC.
-- Idempotent: safe to re-run. Follows the 0014 module-helper pattern.
-- ============================================================================

-- ---- New tables (module key 'sales') --------------------------------------

-- Products catalogue. `code` doubles as the SKU (auto-filled SKU-00001 if blank).
create table if not exists public.products (
  id uuid primary key default gen_random_uuid(),
  code text unique,
  name text not null,
  category_id uuid references public.categories(id),
  uom_code text references public.units_of_measure(code),
  cost_minor bigint not null default 0,
  price_minor bigint not null default 0,
  currency_code text not null default 'KES',
  image_url text,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid references public.users(id),
  updated_by uuid references public.users(id),
  deleted_at timestamptz
);

-- Stock-on-hand per product (one row per product).
create table if not exists public.inventory (
  product_id uuid primary key references public.products(id) on delete cascade,
  qty_on_hand numeric(14,3) not null default 0,
  reorder_level numeric(14,3) not null default 0,
  last_restock_date date,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid references public.users(id),
  updated_by uuid references public.users(id),
  deleted_at timestamptz
);

-- Append-only ledger of stock changes (sale = negative, restock/adjust = positive).
create table if not exists public.inventory_movements (
  id uuid primary key default gen_random_uuid(),
  product_id uuid not null references public.products(id) on delete cascade,
  delta numeric(14,3) not null,
  reason text not null default 'adjustment' check (reason in ('order','restock','adjustment')),
  ref_table text,
  ref_id uuid,
  note text,
  created_at timestamptz not null default now(),
  created_by uuid references public.users(id)
);
create index if not exists inventory_movements_product_idx on public.inventory_movements(product_id);

-- Product-based order lines (sales_orders has only so_milestones today).
create table if not exists public.sales_order_lines (
  id uuid primary key default gen_random_uuid(),
  so_id uuid not null references public.sales_orders(id) on delete cascade,
  product_id uuid references public.products(id),
  qty numeric(14,3) not null default 1,
  unit_price_minor bigint not null default 0,
  tax_code text references public.tax_codes(code)
);
create index if not exists sales_order_lines_so_idx on public.sales_order_lines(so_id);

-- Monthly/quarterly revenue targets per sales rep.
create table if not exists public.sales_targets (
  id uuid primary key default gen_random_uuid(),
  rep_user_id uuid not null references public.users(id),
  period_type text not null default 'monthly' check (period_type in ('monthly','quarterly')),
  period_start date not null,
  period_end date not null,
  target_minor bigint not null default 0,
  currency_code text not null default 'KES',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid references public.users(id),
  updated_by uuid references public.users(id),
  deleted_at timestamptz
);
create index if not exists sales_targets_rep_idx on public.sales_targets(rep_user_id);

-- M-Pesa STK Push transactions (Daraja). Populated by the Vercel /api functions.
create table if not exists public.mpesa_transactions (
  id uuid primary key default gen_random_uuid(),
  invoice_id uuid references public.receivable_invoices(id),
  receipt_id uuid references public.customer_receipts(id),
  checkout_request_id text,
  merchant_request_id text,
  phone text,
  amount_minor bigint not null default 0,
  status text not null default 'pending' check (status in ('pending','success','failed')),
  mpesa_receipt text,
  result_code int,
  result_desc text,
  raw jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists mpesa_tx_checkout_idx on public.mpesa_transactions(checkout_request_id);
create index if not exists mpesa_tx_invoice_idx on public.mpesa_transactions(invoice_id);

-- ---- Alters on existing tables --------------------------------------------

-- Accounts (= customer parties) carry a sales approval state: a rep creates a
-- pending account; an admin/lead approves before orders can be placed.
alter table public.customer_profiles
  add column if not exists approval_status text not null default 'pending'
    check (approval_status in ('pending','approved','rejected')),
  add column if not exists approved_at timestamptz,
  add column if not exists approved_by uuid references public.users(id);

-- Link invoice lines back to the catalogue (nullable: free-text invoices still work).
alter table public.receivable_invoice_lines
  add column if not exists product_id uuid references public.products(id);

-- Order carries its payment method and a simple fulfillment state.
alter table public.sales_orders
  add column if not exists payment_method text check (payment_method in ('cash','mpesa','credit')),
  add column if not exists fulfillment_status text not null default 'pending'
    check (fulfillment_status in ('pending','delivered'));

-- ---- Seed inventory row whenever a product is created ----------------------
create or replace function public.seed_inventory_for_product()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into public.inventory(product_id, qty_on_hand)
  values (new.id, 0)
  on conflict (product_id) do nothing;
  return new;
end;
$$;
drop trigger if exists trg_seed_inventory on public.products;
create trigger trg_seed_inventory after insert on public.products
  for each row execute function public.seed_inventory_for_product();

-- ---- Invoice → order sync: paid invoice marks its order delivered ----------
create or replace function public.sync_order_on_invoice_paid()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.status = 'paid' and coalesce(old.status,'') <> 'paid' and new.so_id is not null then
    update public.sales_orders
       set fulfillment_status = 'delivered'
     where id = new.so_id and fulfillment_status <> 'delivered';
  end if;
  return new;
end;
$$;
drop trigger if exists trg_sync_order_on_invoice_paid on public.receivable_invoices;
create trigger trg_sync_order_on_invoice_paid after update of status on public.receivable_invoices
  for each row execute function public.sync_order_on_invoice_paid();

-- ---- Atomic Place-Order RPC -----------------------------------------------
-- One call from the Place-Order wizard's "Confirm". Validates approval + stock,
-- then writes order + lines + invoice + lines, decrements stock (with a ledger
-- entry), and settles cash immediately. Returns the new invoice id.
-- security definer so it bypasses RLS for the multi-table write; we gate on the
-- caller's sales.create permission ourselves. auth.uid() still resolves to the
-- caller, so audit fields (created_by) record the real rep.
create or replace function public.place_sales_order(
  p_customer_party_id uuid,
  p_payment_method text,
  p_lines jsonb,
  p_due_date date default null,
  p_currency text default 'KES'
) returns uuid
language plpgsql security definer set search_path = public as $$
declare
  v_so_id uuid;
  v_invoice_id uuid;
  v_total bigint := 0;
  v_invoice_status text;
  v_fulfillment text := 'pending';
  v_line jsonb;
  v_product_id uuid;
  v_qty numeric(14,3);
  v_price bigint;
  v_on_hand numeric(14,3);
  v_name text;
begin
  if not public.has_permission('sales.create') then
    raise exception 'Not authorised to place orders';
  end if;
  if p_payment_method not in ('cash','mpesa','credit') then
    raise exception 'Invalid payment method: %', p_payment_method;
  end if;
  if jsonb_typeof(p_lines) <> 'array' or jsonb_array_length(p_lines) = 0 then
    raise exception 'Order must have at least one line';
  end if;

  -- Account must be an approved customer.
  if not exists (
    select 1 from public.customer_profiles
    where party_id = p_customer_party_id and approval_status = 'approved'
  ) then
    raise exception 'Account is not approved for ordering';
  end if;

  -- Validate stock for every line up front (all-or-nothing).
  for v_line in select * from jsonb_array_elements(p_lines) loop
    v_product_id := (v_line->>'product_id')::uuid;
    v_qty := coalesce((v_line->>'qty')::numeric, 0);
    if v_qty <= 0 then raise exception 'Quantity must be positive'; end if;
    select i.qty_on_hand, p.name into v_on_hand, v_name
      from public.inventory i join public.products p on p.id = i.product_id
     where i.product_id = v_product_id;
    if v_on_hand is null then raise exception 'Unknown product in order'; end if;
    if v_qty > v_on_hand then
      raise exception 'Insufficient stock for %: have %, need %', v_name, v_on_hand, v_qty;
    end if;
    v_total := v_total + round(v_qty * coalesce((v_line->>'unit_price_minor')::bigint, 0));
  end loop;

  -- Cash settles on the spot; the order is delivered immediately.
  if p_payment_method = 'cash' then
    v_invoice_status := 'paid';
    v_fulfillment := 'delivered';
  elsif p_payment_method = 'credit' then
    v_invoice_status := 'unpaid';
  else
    v_invoice_status := 'pending';  -- m-pesa: completed by the callback
  end if;

  insert into public.sales_orders(customer_party_id, status, total_minor, currency_code,
                                  payment_method, fulfillment_status)
  values (p_customer_party_id,
          case when p_payment_method = 'cash' then 'confirmed' else 'pending' end,
          v_total, p_currency, p_payment_method, v_fulfillment)
  returning id into v_so_id;

  insert into public.receivable_invoices(customer_party_id, so_id, invoice_date, due_date,
                                         amount_minor, currency_code, status)
  values (p_customer_party_id, v_so_id, current_date,
          case when p_payment_method = 'credit' then p_due_date else null end,
          v_total, p_currency, v_invoice_status)
  returning id into v_invoice_id;

  -- Lines + stock decrement + ledger.
  for v_line in select * from jsonb_array_elements(p_lines) loop
    v_product_id := (v_line->>'product_id')::uuid;
    v_qty := (v_line->>'qty')::numeric;
    v_price := coalesce((v_line->>'unit_price_minor')::bigint, 0);

    insert into public.sales_order_lines(so_id, product_id, qty, unit_price_minor)
    values (v_so_id, v_product_id, v_qty, v_price);

    insert into public.receivable_invoice_lines(invoice_id, product_id, description, qty, unit_price_minor)
    values (v_invoice_id, v_product_id,
            (select name from public.products where id = v_product_id), v_qty, v_price);

    update public.inventory set qty_on_hand = qty_on_hand - v_qty
     where product_id = v_product_id;

    insert into public.inventory_movements(product_id, delta, reason, ref_table, ref_id, note)
    values (v_product_id, -v_qty, 'order', 'sales_orders', v_so_id, 'Order ' || v_so_id);
  end loop;

  -- Cash: record the receipt now (credit/mpesa receipts come later).
  if p_payment_method = 'cash' then
    insert into public.customer_receipts(customer_party_id, invoice_id, amount_minor,
                                         method, received_date)
    values (p_customer_party_id, v_invoice_id, v_total, 'cash', current_date);
  end if;

  return v_invoice_id;
end;
$$;

grant execute on function public.place_sales_order(uuid, text, jsonb, date, text) to authenticated;

-- ---- Permissions, triggers, RLS, codes ------------------------------------
do $$
declare t text;
declare tbls text[] := array[
  'products','inventory','inventory_movements','sales_order_lines','mpesa_transactions'
];
begin
  perform public.seed_module_permissions('sales','Sales');
  foreach t in array tbls loop
    perform public.apply_standard_triggers(t);
    perform public.apply_module_rls(t,'sales');
  end loop;
  perform public.apply_standard_triggers('sales_targets');
  perform public.apply_code_default('products','SKU');
end $$;

-- sales_targets: reps read their own; leads/admin (sales.edit) manage all.
alter table public.sales_targets enable row level security;
drop policy if exists sales_targets_sel on public.sales_targets;
drop policy if exists sales_targets_ins on public.sales_targets;
drop policy if exists sales_targets_upd on public.sales_targets;
drop policy if exists sales_targets_del on public.sales_targets;
create policy sales_targets_sel on public.sales_targets for select to authenticated
  using (rep_user_id = auth.uid() or public.has_permission('sales.edit'));
create policy sales_targets_ins on public.sales_targets for insert to authenticated
  with check (public.has_permission('sales.edit'));
create policy sales_targets_upd on public.sales_targets for update to authenticated
  using (public.has_permission('sales.edit')) with check (public.has_permission('sales.edit'));
create policy sales_targets_del on public.sales_targets for delete to authenticated
  using (public.has_permission('sales.delete'));
