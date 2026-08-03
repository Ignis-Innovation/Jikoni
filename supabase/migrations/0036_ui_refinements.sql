-- ============================================================
-- Jikoni Tool — UI refinement round (Inventory, HR, Staff Portal)
-- Backend changes for the frontend tidy-up:
--   * stock_items.supplier         — capture the supplier on a new item
--   * assets.quantity              — physical assets are tracked by count now,
--                                    not depreciation (cost/life become optional)
--   * asset_assignments            — who holds which asset (laptop, car, …)
--   * create_stock_item + p_supplier
--   * register_asset simplified    — name / category / quantity / date received
--   * assign_asset                 — hand an asset to an employee
--   * add_employee + p_contract_end — store the end date for non-permanent staff
-- Idempotent: safe to re-run. Assignments + asset quantity are folded into the
-- client read model in loadFromDb (like dispatch receipts), so bootstrap() is
-- untouched.
-- ============================================================

-- ---------- new columns ----------
alter table public.stock_items add column if not exists supplier text;
alter table public.assets add column if not exists quantity int not null default 1;

-- Physical-asset register no longer requires a positive cost (depreciation is
-- optional now) — relax the cost check and default it to zero.
alter table public.assets drop constraint if exists assets_cost_check;
alter table public.assets alter column cost set default 0;

-- ---------- asset assignments (who holds what) ----------
create table if not exists public.asset_assignments (
  id          uuid primary key default gen_random_uuid(),
  ref         text not null unique,
  entity_id   uuid references public.entities(id),
  asset_id    uuid not null references public.assets(id),
  asset_ref   text not null,
  employee    text not null,
  qty         int not null default 1 check (qty > 0),
  assigned_at date not null default current_date,
  state       text not null default 'assigned' check (state in ('assigned','returned')),
  actor       uuid,
  created_at  timestamptz not null default now()
);

insert into public.ref_counters(kind, prefix, n) values ('ASN', 'ASN-', 100)
on conflict (kind) do nothing;

-- ---------- create a stock item (now captures supplier) ----------
drop function if exists public.create_stock_item(text,text,text,text,numeric,numeric,numeric,text);
create or replace function public.create_stock_item(
  p_sku text default null, p_name text default null, p_category text default null, p_unit text default 'unit',
  p_unit_cost numeric default 0, p_reorder_level numeric default 0,
  p_reorder_qty numeric default 0, p_budget_code text default null, p_supplier text default null
) returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_entity uuid := (select id from public.entities where code = 'KE');
  v_code text := nullif(trim(coalesce(p_budget_code, '')), '');
  v_sku  text := nullif(trim(coalesce(p_sku, '')), '');
  v_sup  text := nullif(trim(coalesce(p_supplier, '')), '');
begin
  perform public.assert_access('inventory', 2);
  if nullif(trim(coalesce(p_name,'')),'') is null then raise exception 'A stock item needs a name'; end if;
  if v_sku is null then v_sku := public.next_ref('SKU'); end if;   -- auto-generate a code
  if exists (select 1 from public.stock_items where sku = v_sku) then
    raise exception 'A stock item with SKU % already exists', v_sku;
  end if;
  if v_code is not null and not exists (select 1 from public.budget_lines where code = v_code) then
    raise exception 'Unknown budget code: %', v_code;
  end if;
  insert into public.stock_items(entity_id, sku, name, category, unit, unit_cost, reorder_level, reorder_qty, budget_code, supplier)
  values (v_entity, v_sku, p_name, nullif(trim(coalesce(p_category,'')),''), coalesce(nullif(trim(p_unit),''),'unit'),
          coalesce(p_unit_cost,0), coalesce(p_reorder_level,0), coalesce(p_reorder_qty,0), v_code, v_sup);
  perform public.audit_write('inventory.item_created', 'stock_item', v_sku,
    jsonb_build_object('name', p_name, 'category', p_category, 'unitCost', p_unit_cost,
                       'reorderLevel', p_reorder_level, 'budgetCode', v_code, 'supplier', v_sup));
  return jsonb_build_object('sku', v_sku, 'name', p_name, 'category', p_category, 'unit', p_unit,
    'unitCost', coalesce(p_unit_cost,0), 'reorderLevel', coalesce(p_reorder_level,0), 'onHand', 0, 'autoReq', null);
end $$;

-- ---------- register a physical asset (name / category / quantity / date) ----------
drop function if exists public.register_asset(text,text,numeric,int,date,numeric);
create or replace function public.register_asset(
  p_name text, p_category text default null, p_quantity int default 1, p_acquired date default current_date
) returns jsonb language plpgsql security definer set search_path = public as $$
declare v_ref text;
  v_entity uuid := (select id from public.entities where code = 'KE');
  v_qty int := greatest(coalesce(p_quantity, 1), 1);
begin
  perform public.assert_access('inventory', 2);
  if nullif(trim(coalesce(p_name,'')),'') is null then raise exception 'An asset needs a name'; end if;
  v_ref := public.next_ref('AST');
  -- cost/life default to 0/1: this is a physical-count register, not depreciation
  insert into public.assets(ref, entity_id, name, category, cost, salvage, life_months, acquired_on, quantity)
  values (v_ref, v_entity, trim(p_name), nullif(trim(coalesce(p_category,'')),''), 0, 0, 1,
          coalesce(p_acquired, current_date), v_qty);
  perform public.audit_write('asset.registered','asset', v_ref,
    jsonb_build_object('name', p_name, 'quantity', v_qty, 'acquired', p_acquired));
  return jsonb_build_object('id', v_ref, 'name', p_name, 'quantity', v_qty);
end $$;

-- ---------- assign an asset to an employee ----------
create or replace function public.assign_asset(p_asset_ref text, p_employee text, p_qty int default 1)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_ref text; a record;
  v_entity uuid := (select id from public.entities where code = 'KE');
  v_qty int := greatest(coalesce(p_qty, 1), 1);
begin
  perform public.assert_access('inventory', 2);
  select * into a from public.assets where ref = p_asset_ref;
  if not found then raise exception 'Unknown asset: %', p_asset_ref; end if;
  if nullif(trim(coalesce(p_employee,'')),'') is null then raise exception 'Assign the asset to an employee'; end if;
  v_ref := public.next_ref('ASN');
  insert into public.asset_assignments(ref, entity_id, asset_id, asset_ref, employee, qty, assigned_at)
  values (v_ref, v_entity, a.id, a.ref, trim(p_employee), v_qty, current_date);
  perform public.audit_write('asset.assigned','asset', p_asset_ref,
    jsonb_build_object('employee', trim(p_employee), 'qty', v_qty, 'assignment', v_ref));
  return jsonb_build_object('id', v_ref, 'asset', p_asset_ref, 'employee', trim(p_employee), 'qty', v_qty);
end $$;

-- ---------- add employee (now stores the contract end date) ----------
drop function if exists public.add_employee(text,text,text,text,date,numeric,text,text,text,text);
create or replace function public.add_employee(
  p_name text, p_email text, p_role_title text default null,
  p_contract_type text default 'permanent', p_start_date date default current_date,
  p_gross_salary numeric default 0, p_kra text default null, p_nssf text default null,
  p_shif text default null, p_bank text default null, p_contract_end date default null
) returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_entity uuid := (select id from public.entities where code = 'KE');
  v_email text := lower(nullif(trim(coalesce(p_email, '')), ''));
  v_user uuid; v_staff text;
  v_year int := extract(year from coalesce(p_start_date, current_date))::int;
begin
  perform public.assert_access('hr', 3);
  if nullif(trim(coalesce(p_name, '')), '') is null then raise exception 'An employee needs a name'; end if;
  if v_email is null then raise exception 'An employee needs an email'; end if;
  if p_contract_type not in ('permanent','fixed_term','casual','consultant') then
    raise exception 'Unknown contract type: %', p_contract_type;
  end if;
  if p_contract_type <> 'permanent' and p_contract_end is null then
    raise exception 'A non-permanent contract needs an end date';
  end if;
  if exists (select 1 from public.app_users where email = v_email) then
    raise exception 'A user with email % already exists', v_email;
  end if;
  insert into public.app_users(entity_id, name, email, role_title, role_key)
  values (v_entity, trim(p_name), v_email, nullif(trim(coalesce(p_role_title,'')),''), 'std')
  returning id into v_user;
  v_staff := public.next_ref('STF');
  insert into public.staff_files(entity_id, app_user_id, staff_no, kra_pin, nssf_no, shif_no,
    contract_type, start_date, contract_end, gross_salary, bank, docs)
  values (v_entity, v_user, v_staff,
    nullif(trim(coalesce(p_kra,'')),''), nullif(trim(coalesce(p_nssf,'')),''), nullif(trim(coalesce(p_shif,'')),''),
    p_contract_type, p_start_date, p_contract_end, coalesce(p_gross_salary,0), nullif(trim(coalesce(p_bank,'')),''),
    jsonb_build_array(jsonb_build_object('name','Employment contract','version',1,'uploaded',to_char(coalesce(p_start_date,current_date),'YYYY-MM-DD'))));
  insert into public.leave_balances(app_user_id, kind, year, entitled, used)
  select v_user, kind, v_year, days_per_year, 0 from public.leave_policies
  on conflict (app_user_id, kind, year) do nothing;
  perform public.audit_write('hr.employee_added','staff', v_staff,
    jsonb_build_object('name', p_name, 'email', v_email, 'contract', p_contract_type, 'gross', p_gross_salary, 'contractEnd', p_contract_end));
  return jsonb_build_object('staffNo', v_staff, 'name', p_name, 'email', v_email);
end $$;

-- ---------- RLS + grants ----------
alter table public.asset_assignments enable row level security;
drop policy if exists "read for authenticated" on public.asset_assignments;
create policy "read for authenticated" on public.asset_assignments for select to authenticated using (true);

do $$
declare fn text;
begin
  foreach fn in array array[
    'create_stock_item(text,text,text,text,numeric,numeric,numeric,text,text)',
    'register_asset(text,text,int,date)',
    'assign_asset(text,text,int)',
    'add_employee(text,text,text,text,date,numeric,text,text,text,text,date)']
  loop
    execute format('revoke execute on function public.%s from public, anon', fn);
    execute format('grant execute on function public.%s to authenticated', fn);
  end loop;
end $$;
