-- ============================================================================
-- 0015_phase2_procure_to_pay.sql — PHASE 2 (PRD §2A-2H)
-- Closed loop: Vendor -> Requisition -> PO -> GRN -> Invoice -> Payment.
-- All reference spine entities (parties, accounts, cost centers) by ID.
-- ============================================================================

-- 2A Vendor Registry (extends spine parties type=vendor)
create table public.vendor_profiles (
  party_id              uuid primary key references public.parties(id) on delete cascade,
  kra_pin               text,
  tax_compliance_status text default 'unknown',
  tax_cert_expiry       date,
  category_id           uuid references public.categories(id),
  rating_avg            numeric(3,2) default 0,
  onboarding_status     text not null default 'draft',
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
  created_by uuid references public.users(id), updated_by uuid references public.users(id), deleted_at timestamptz
);
create table public.vendor_ratings (
  id uuid primary key default gen_random_uuid(),
  party_id uuid not null references public.parties(id) on delete cascade,
  po_id    uuid,
  score    int not null check (score between 1 and 5),
  comment  text,
  rated_by uuid references public.users(id),
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
  created_by uuid references public.users(id), updated_by uuid references public.users(id), deleted_at timestamptz
);

-- 2B Petty Cash
create table public.petty_cash_floats (
  id uuid primary key default gen_random_uuid(),
  custodian_user_id uuid references public.users(id),
  location_id uuid references public.locations(id),
  opening_amount_minor bigint not null default 0,
  balance_minor bigint not null default 0,
  currency_code text not null default 'KES',
  status text not null default 'active',
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
  created_by uuid references public.users(id), updated_by uuid references public.users(id), deleted_at timestamptz
);
create table public.petty_cash_vouchers (
  id uuid primary key default gen_random_uuid(),
  float_id uuid not null references public.petty_cash_floats(id),
  payee_party_id uuid references public.parties(id),
  amount_minor bigint not null,
  account_id uuid references public.accounts(id),
  category_id uuid references public.categories(id),
  receipt_document_id uuid references public.documents(id),
  description text,
  status text not null default 'posted',
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
  created_by uuid references public.users(id), updated_by uuid references public.users(id), deleted_at timestamptz
);
create table public.petty_cash_replenishments (
  id uuid primary key default gen_random_uuid(),
  float_id uuid not null references public.petty_cash_floats(id),
  amount_minor bigint not null,
  approval_request_id uuid references public.approval_requests(id),
  status text not null default 'pending',
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
  created_by uuid references public.users(id), updated_by uuid references public.users(id), deleted_at timestamptz
);

-- 2C Receipts & Expense Capture (OCR via Claude API at the app layer)
create table public.expense_receipts (
  id uuid primary key default gen_random_uuid(),
  document_id uuid references public.documents(id),
  vendor_party_id uuid references public.parties(id),
  receipt_date date,
  amount_minor bigint,
  tax_minor bigint default 0,
  currency_code text not null default 'KES',
  category_id uuid references public.categories(id),
  account_id uuid references public.accounts(id),
  ocr_confidence numeric(4,3),
  status text not null default 'draft',
  linked_voucher_id uuid references public.petty_cash_vouchers(id),
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
  created_by uuid references public.users(id), updated_by uuid references public.users(id), deleted_at timestamptz
);

-- 2D Purchase Requisitions
create table public.requisitions (
  id uuid primary key default gen_random_uuid(),
  code text unique,
  requested_by uuid references public.users(id),
  department_id uuid references public.departments(id),
  project_id uuid references public.projects(id),
  cost_center_id uuid references public.cost_centers(id),
  need_by_date date,
  status text not null default 'draft',  -- draft|pending_approval|approved|rejected|converted
  approval_request_id uuid references public.approval_requests(id),
  total_minor bigint not null default 0,
  currency_code text not null default 'KES',
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
  created_by uuid references public.users(id), updated_by uuid references public.users(id), deleted_at timestamptz
);
create table public.requisition_lines (
  id uuid primary key default gen_random_uuid(),
  req_id uuid not null references public.requisitions(id) on delete cascade,
  item_desc text not null,
  qty numeric(14,3) not null default 1,
  uom_code text references public.units_of_measure(code),
  est_unit_price_minor bigint not null default 0,
  account_id uuid references public.accounts(id),
  category_id uuid references public.categories(id)
);

-- 2E Purchase Orders
create table public.purchase_orders (
  id uuid primary key default gen_random_uuid(),
  code text unique,
  vendor_party_id uuid references public.parties(id),
  requisition_id uuid references public.requisitions(id),
  status text not null default 'draft',  -- draft|issued|partially_received|received|closed
  total_minor bigint not null default 0,
  currency_code text not null default 'KES',
  expected_date date,
  project_id uuid references public.projects(id),
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
  created_by uuid references public.users(id), updated_by uuid references public.users(id), deleted_at timestamptz
);
create table public.po_lines (
  id uuid primary key default gen_random_uuid(),
  po_id uuid not null references public.purchase_orders(id) on delete cascade,
  item_desc text not null,
  qty_ordered numeric(14,3) not null default 1,
  qty_received numeric(14,3) not null default 0,
  unit_price_minor bigint not null default 0,
  account_id uuid references public.accounts(id),
  tax_code text references public.tax_codes(code)
);

-- 2F Goods Received Notes
create table public.grns (
  id uuid primary key default gen_random_uuid(),
  code text unique,
  po_id uuid not null references public.purchase_orders(id),
  received_by uuid references public.users(id),
  received_date date default now(),
  status text not null default 'received',
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
  created_by uuid references public.users(id), updated_by uuid references public.users(id), deleted_at timestamptz
);
create table public.grn_lines (
  id uuid primary key default gen_random_uuid(),
  grn_id uuid not null references public.grns(id) on delete cascade,
  po_line_id uuid references public.po_lines(id),
  qty_received numeric(14,3) not null default 0,
  condition text,
  photo_document_id uuid references public.documents(id)
);

-- 2G Payables (vendor invoices, three-way match)
create table public.payable_invoices (
  id uuid primary key default gen_random_uuid(),
  code text unique,
  vendor_party_id uuid references public.parties(id),
  po_id uuid references public.purchase_orders(id),
  invoice_no text,
  invoice_date date,
  due_date date,
  amount_minor bigint not null default 0,
  tax_minor bigint not null default 0,
  currency_code text not null default 'KES',
  status text not null default 'draft',       -- draft|matched|approved|scheduled|paid
  match_status text not null default 'unmatched',
  approval_request_id uuid references public.approval_requests(id),
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
  created_by uuid references public.users(id), updated_by uuid references public.users(id), deleted_at timestamptz
);
create table public.payable_invoice_lines (
  id uuid primary key default gen_random_uuid(),
  invoice_id uuid not null references public.payable_invoices(id) on delete cascade,
  description text,
  qty numeric(14,3) default 1,
  unit_price_minor bigint default 0,
  account_id uuid references public.accounts(id),
  tax_code text references public.tax_codes(code)
);

-- 2H Payments
create table public.payment_runs (
  id uuid primary key default gen_random_uuid(),
  code text unique,
  run_date date default now(),
  status text not null default 'draft',
  total_minor bigint not null default 0,
  approval_request_id uuid references public.approval_requests(id),
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
  created_by uuid references public.users(id), updated_by uuid references public.users(id), deleted_at timestamptz
);
create table public.payments (
  id uuid primary key default gen_random_uuid(),
  run_id uuid references public.payment_runs(id),
  payable_invoice_id uuid references public.payable_invoices(id),
  vendor_party_id uuid references public.parties(id),
  method text check (method in ('mpesa','bank')),
  amount_minor bigint not null default 0,
  status text not null default 'pending',
  external_ref text,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
  created_by uuid references public.users(id), updated_by uuid references public.users(id), deleted_at timestamptz
);

-- ---- Wire spine guarantees ----
do $$
declare
  procurement_tbls text[] := array['vendor_profiles','vendor_ratings','requisitions','requisition_lines','purchase_orders','po_lines','grns','grn_lines'];
  finance_tbls text[] := array['petty_cash_floats','petty_cash_vouchers','petty_cash_replenishments','expense_receipts','payable_invoices','payable_invoice_lines','payment_runs','payments'];
  t text;
begin
  perform public.seed_module_permissions('procurement','Procurement');
  perform public.seed_module_permissions('finance','Finance');
  foreach t in array procurement_tbls loop
    perform public.apply_standard_triggers(t);
    perform public.apply_module_rls(t,'procurement');
  end loop;
  foreach t in array finance_tbls loop
    perform public.apply_standard_triggers(t);
    perform public.apply_module_rls(t,'finance');
  end loop;
  perform public.apply_code_default('requisitions','PR');
  perform public.apply_code_default('purchase_orders','PO');
  perform public.apply_code_default('grns','GRN');
  perform public.apply_code_default('payable_invoices','AP');
  perform public.apply_code_default('payment_runs','PAY');
end $$;
