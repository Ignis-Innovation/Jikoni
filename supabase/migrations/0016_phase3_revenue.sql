-- ============================================================================
-- 0016_phase3_revenue.sql — PHASE 3 (PRD §3A-3F) — money coming in.
-- ============================================================================

create table public.customer_profiles (
  party_id uuid primary key references public.parties(id) on delete cascade,
  billing_terms text,
  credit_limit_minor bigint default 0,
  kra_pin text,
  tier text,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
  created_by uuid references public.users(id), updated_by uuid references public.users(id), deleted_at timestamptz
);

create table public.quotations (
  id uuid primary key default gen_random_uuid(),
  code text unique,
  customer_party_id uuid references public.parties(id),
  version int not null default 1,
  valid_until date,
  status text not null default 'draft',
  total_minor bigint not null default 0,
  currency_code text not null default 'KES',
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
  created_by uuid references public.users(id), updated_by uuid references public.users(id), deleted_at timestamptz
);
create table public.quotation_lines (
  id uuid primary key default gen_random_uuid(),
  quotation_id uuid not null references public.quotations(id) on delete cascade,
  description text, qty numeric(14,3) default 1, unit_price_minor bigint default 0,
  tax_code text references public.tax_codes(code)
);

create table public.sales_orders (
  id uuid primary key default gen_random_uuid(),
  code text unique,
  customer_party_id uuid references public.parties(id),
  quotation_id uuid references public.quotations(id),
  project_id uuid references public.projects(id),
  status text not null default 'draft',
  total_minor bigint not null default 0,
  currency_code text not null default 'KES',
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
  created_by uuid references public.users(id), updated_by uuid references public.users(id), deleted_at timestamptz
);
create table public.so_milestones (
  id uuid primary key default gen_random_uuid(),
  so_id uuid not null references public.sales_orders(id) on delete cascade,
  name text not null, due_date date, amount_minor bigint default 0,
  billing_status text not null default 'pending'
);

create table public.receivable_invoices (
  id uuid primary key default gen_random_uuid(),
  code text unique,
  customer_party_id uuid references public.parties(id),
  so_id uuid references public.sales_orders(id),
  invoice_date date, due_date date,
  amount_minor bigint not null default 0, tax_minor bigint not null default 0,
  currency_code text not null default 'KES',
  etims_status text not null default 'pending', etims_ref text,
  status text not null default 'draft',
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
  created_by uuid references public.users(id), updated_by uuid references public.users(id), deleted_at timestamptz
);
create table public.receivable_invoice_lines (
  id uuid primary key default gen_random_uuid(),
  invoice_id uuid not null references public.receivable_invoices(id) on delete cascade,
  description text, qty numeric(14,3) default 1, unit_price_minor bigint default 0,
  tax_code text references public.tax_codes(code)
);

create table public.customer_receipts (
  id uuid primary key default gen_random_uuid(),
  code text unique,
  customer_party_id uuid references public.parties(id),
  invoice_id uuid references public.receivable_invoices(id),
  amount_minor bigint not null default 0,
  method text, external_ref text, received_date date default now(),
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
  created_by uuid references public.users(id), updated_by uuid references public.users(id), deleted_at timestamptz
);
create table public.dunning_log (
  id uuid primary key default gen_random_uuid(),
  invoice_id uuid references public.receivable_invoices(id),
  channel text, sent_at timestamptz default now(), note text
);

create table public.credit_notes (
  id uuid primary key default gen_random_uuid(),
  code text unique,
  customer_party_id uuid references public.parties(id),
  invoice_id uuid references public.receivable_invoices(id),
  reason text, amount_minor bigint not null default 0,
  status text not null default 'draft',
  approval_request_id uuid references public.approval_requests(id),
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
  created_by uuid references public.users(id), updated_by uuid references public.users(id), deleted_at timestamptz
);

do $$
declare t text;
declare tbls text[] := array['customer_profiles','quotations','quotation_lines','sales_orders','so_milestones','receivable_invoices','receivable_invoice_lines','customer_receipts','dunning_log','credit_notes'];
begin
  perform public.seed_module_permissions('revenue','Revenue');
  foreach t in array tbls loop
    perform public.apply_standard_triggers(t);
    perform public.apply_module_rls(t,'revenue');
  end loop;
  perform public.apply_code_default('quotations','QT');
  perform public.apply_code_default('sales_orders','SO');
  perform public.apply_code_default('receivable_invoices','AR');
  perform public.apply_code_default('customer_receipts','RCT');
  perform public.apply_code_default('credit_notes','CN');
end $$;
