-- ============================================================
-- Jikoni Master PRD — Phase 1: the spine (Finance + Procure-to-Pay)
-- vendors → budget_lines → requisitions → POs → GRNs → invoices_ap
-- → payments → journal_entries, plus Order-to-Cash and control engines:
-- budget check · approval matrix · three-way match · sanctions gate.
-- Idempotent: safe to re-run.
-- ============================================================

-- ---------- vendors (+ screening sub-record) ----------
create table if not exists public.vendors (
  id           uuid primary key default gen_random_uuid(),
  entity_id    uuid references public.entities(id),
  owner_id     uuid references public.app_users(id),
  name         text not null unique,
  category     text,
  country      text default 'Kenya',
  rating       text,
  tax_status   text default 'Pending PIN',
  screen_status text not null default 'pending'
               check (screen_status in ('pending','in_screening','cleared','flagged')),
  bank         text,
  since        text,
  spend_txt    text,
  open_pos     int not null default 0,
  timeline     jsonb not null default '[]'::jsonb,
  contracts    jsonb not null default '[]'::jsonb,
  docs         jsonb not null default '[]'::jsonb,
  state        text not null default 'draft'
               check (state in ('draft','in_screening','prequalified','active','suspended','blacklisted')),
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);

create table if not exists public.vendor_screenings (
  id          uuid primary key default gen_random_uuid(),
  vendor_id   uuid not null references public.vendors(id) on delete cascade,
  result      text not null check (result in ('cleared','flagged')),
  notes       text,
  screened_by uuid references public.app_users(id),
  created_at  timestamptz not null default now()
);

-- ---------- budget lines (commit at requisition/PO stage, not just payment) ----------
create table if not exists public.budget_lines (
  id         uuid primary key default gen_random_uuid(),
  entity_id  uuid references public.entities(id),
  code       text not null unique,            -- display name used by the req modal
  budget     numeric not null default 0,
  committed  numeric not null default 0,      -- reqs/POs in flight
  actual     numeric not null default 0,      -- paid
  account_code text default '5000',
  state      text not null default 'active',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- ---------- approval matrix (config-driven thresholds — Kenya SOP defaults seeded) ----------
create table if not exists public.approval_matrix (
  id           uuid primary key default gen_random_uuid(),
  entity_id    uuid references public.entities(id),
  sort         int not null,
  max_amount   numeric,                        -- null = no ceiling (MD band)
  label        text not null,                  -- 'Auto-approved' …
  who          text not null,                  -- toast copy
  result_state text not null                   -- requisition state after submit
);

-- ---------- the document chain ----------
create table if not exists public.requisitions (
  id            uuid primary key default gen_random_uuid(),
  ref           text not null unique,
  entity_id     uuid references public.entities(id),
  owner_id      uuid references public.app_users(id),
  item          text not null,
  amount        numeric not null check (amount > 0),
  budget_code   text not null references public.budget_lines(code),
  budget_chip   text,                          -- 'ok' | 'no' (frontend chip class)
  budget_chip_txt text,                        -- 'within' | 'over 80%' | 'exceeds'
  state         text not null default 'submitted'
                check (state in ('draft','submitted','md_review','approved','rejected','converted')),
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

create table if not exists public.purchase_orders (
  id             uuid primary key default gen_random_uuid(),
  ref            text not null unique,
  entity_id      uuid references public.entities(id),
  owner_id       uuid references public.app_users(id),
  requisition_id uuid references public.requisitions(id),
  vendor_id      uuid not null references public.vendors(id),
  vendor_name    text not null,
  amount         numeric not null check (amount > 0),
  delivery       text default '—',
  state          text not null default 'open'
                 check (state in ('open','partially_received','closed','cancelled')),
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);

create table if not exists public.goods_received_notes (
  id           uuid primary key default gen_random_uuid(),
  ref          text not null unique,
  entity_id    uuid references public.entities(id),
  po_id        uuid not null references public.purchase_orders(id),
  receiver_id  uuid references public.app_users(id),
  coverage     text not null default 'full' check (coverage in ('full','partial')),
  pct          int not null default 100 check (pct between 1 and 100),
  note         text,
  photo_doc_id uuid references public.documents(id),
  state        text not null default 'received' check (state in ('draft','received')),
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);

create table if not exists public.invoices_ap (
  id          uuid primary key default gen_random_uuid(),
  ref         text not null unique,
  entity_id   uuid references public.entities(id),
  vendor_id   uuid not null references public.vendors(id),
  po_id       uuid not null references public.purchase_orders(id),
  amount      numeric not null check (amount > 0),
  match_note  text,
  state       text not null default 'captured'
              check (state in ('captured','matched','exception','paid')),
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

create table if not exists public.payments (
  id            uuid primary key default gen_random_uuid(),
  ref           text not null unique,
  entity_id     uuid references public.entities(id),
  invoice_ap_id uuid not null references public.invoices_ap(id),
  method        text not null default 'bank' check (method in ('mpesa','bank')),
  amount        numeric not null check (amount > 0),
  journal_ref   text,
  state         text not null default 'paid' check (state in ('initiated','paid','failed')),
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

-- ---------- general ledger ----------
create table if not exists public.journal_entries (
  id          uuid primary key default gen_random_uuid(),
  ref         text not null unique,
  entity_id   uuid references public.entities(id),
  memo        text,
  source_type text,
  source_ref  text,
  state       text not null default 'posted' check (state in ('posted','reversed')),
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

create table if not exists public.journal_lines (
  id         uuid primary key default gen_random_uuid(),
  journal_id uuid not null references public.journal_entries(id) on delete cascade,
  account_code text not null,
  debit      numeric not null default 0 check (debit >= 0),
  credit     numeric not null default 0 check (credit >= 0)
);

-- ---------- order-to-cash (eTIMS intent recorded; real filing is Phase 4) ----------
create table if not exists public.sales_invoices (
  id           uuid primary key default gen_random_uuid(),
  ref          text not null unique,
  entity_id    uuid references public.entities(id),
  owner_id     uuid references public.app_users(id),
  customer     text not null,
  description  text,
  net          numeric not null check (net > 0),
  vat          numeric not null default 0,
  total        numeric not null,
  due_pill_cls text not null default 'week',
  due_pill_txt text not null default '14 days',
  etims_state  text not null default 'filed' check (etims_state in ('pending','filed','failed')),
  state        text not null default 'issued' check (state in ('issued','paid','overdue','cancelled')),
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);

-- ---------- bank & petty cash ----------
create table if not exists public.bank_accounts (
  id          uuid primary key default gen_random_uuid(),
  entity_id   uuid references public.entities(id),
  name        text not null,
  number_mask text,
  balance     numeric not null default 0,
  state       text not null default 'active',
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

create table if not exists public.petty_cash_floats (
  id          uuid primary key default gen_random_uuid(),
  entity_id   uuid references public.entities(id),
  custodian   text not null,
  balance     numeric not null default 0,
  state       text not null default 'active',
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

-- ---------- tasks (My Week) ----------
create table if not exists public.tasks (
  id         uuid primary key default gen_random_uuid(),
  ref        text not null unique,
  entity_id  uuid references public.entities(id),
  owner_id   uuid references public.app_users(id),
  title      text not null,
  sub        text not null default '',
  owner_name text not null,
  due_pill   text not null default 'week',    -- 'over' | 'today' | 'week'
  due_label  text not null default 'This week',
  state      text not null default 'open' check (state in ('open','done')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- ---------- CRM engagements + projects (minimal backing; Phase 3 normalizes) ----------
create table if not exists public.engagements (
  id         uuid primary key default gen_random_uuid(),
  ref        text not null unique,             -- ENG-002 / DST-004
  entity_id  uuid references public.entities(id),
  name       text not null,
  stage      text,
  owner_name text,
  pill       text,
  pill_txt   text,
  pipeline   text not null check (pipeline in ('up','down')),
  state      text not null default 'active' check (state in ('active','won','lost')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.projects (
  id         uuid primary key default gen_random_uuid(),
  entity_id  uuid references public.entities(id),
  name       text not null unique,
  funder     text,
  status     text default 'Setup',
  budget_txt text default 'TBD',
  spent_txt  text default 'KES 0',
  pct        text default '0%',
  timeline   text default '2026',
  team       text,
  reporting  text default 'To be set',
  field      text default '—',
  milestones jsonb not null default '[]'::jsonb,
  drawdowns  jsonb not null default '[]'::jsonb,
  docs       jsonb not null default '[]'::jsonb,
  is_extra   boolean not null default false,   -- created in-app vs seeded
  state      text not null default 'setup' check (state in ('setup','active','reporting','closed')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.eng_project_links (
  eng_ref      text primary key references public.engagements(ref),
  project_name text not null references public.projects(name),
  is_primary   boolean not null default true   -- primary link powers project→eng backlink
);

-- ---------- state machines: allowed transitions ----------
insert into public.record_transitions(record_type, from_state, to_state) values
  ('requisition','draft','submitted'),
  ('requisition','submitted','approved'),
  ('requisition','submitted','md_review'),
  ('requisition','submitted','rejected'),
  ('requisition','md_review','approved'),
  ('requisition','md_review','rejected'),
  ('requisition','approved','converted'),
  ('po','open','partially_received'),
  ('po','open','closed'),
  ('po','open','cancelled'),
  ('po','partially_received','closed'),
  ('vendor','draft','in_screening'),
  ('vendor','in_screening','prequalified'),
  ('vendor','in_screening','draft'),
  ('vendor','prequalified','active'),
  ('vendor','active','suspended'),
  ('vendor','active','blacklisted'),
  ('vendor','suspended','active'),
  ('invoice_ap','captured','matched'),
  ('invoice_ap','captured','exception'),
  ('invoice_ap','exception','matched'),
  ('invoice_ap','matched','paid'),
  ('payment','initiated','paid'),
  ('payment','initiated','failed'),
  ('grn','draft','received'),
  ('sales_invoice','issued','paid'),
  ('sales_invoice','issued','overdue'),
  ('sales_invoice','overdue','paid'),
  ('sales_invoice','issued','cancelled'),
  ('task','open','done'),
  ('journal_entry','posted','reversed'),
  ('engagement','active','won'),
  ('engagement','active','lost'),
  ('project','setup','active'),
  ('project','active','reporting'),
  ('project','reporting','closed')
on conflict do nothing;

-- attach the state-machine trigger to every stateful table
do $$
declare r record;
begin
  for r in select * from (values
    ('requisitions','requisition'), ('purchase_orders','po'), ('vendors','vendor'),
    ('invoices_ap','invoice_ap'), ('payments','payment'), ('goods_received_notes','grn'),
    ('sales_invoices','sales_invoice'), ('tasks','task'), ('journal_entries','journal_entry'),
    ('engagements','engagement'), ('projects','project')
  ) as t(tbl, rtype)
  loop
    execute format('drop trigger if exists state_machine on public.%I', r.tbl);
    execute format('create trigger state_machine before update of state on public.%I
                    for each row execute function public.enforce_state_machine(%L)', r.tbl, r.rtype);
  end loop;
end $$;

-- ---------- sanctions gate: no PO to an unscreened vendor (hard gate) ----------
create or replace function public.po_sanctions_gate() returns trigger
language plpgsql as $$
declare v record;
begin
  select name, screen_status, state into v from public.vendors where id = new.vendor_id;
  if v.screen_status is distinct from 'cleared' then
    raise exception 'Sanctions gate: % has not cleared screening (status: %)', v.name, coalesce(v.screen_status,'none');
  end if;
  if v.state in ('suspended','blacklisted') then
    raise exception 'Vendor % is %', v.name, v.state;
  end if;
  return new;
end $$;

drop trigger if exists sanctions_gate on public.purchase_orders;
create trigger sanctions_gate before insert on public.purchase_orders
  for each row execute function public.po_sanctions_gate();

-- ============================================================
-- Control engines
-- ============================================================

-- Budget check — mirrors the UI's reqBudgetState; committed+actual = utilisation
create or replace function public.budget_check(p_code text, p_amount numeric) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare
  l record;
  used numeric; rem numeric; util int;
  fmt_budget text; fmt_rem text;
begin
  select * into l from public.budget_lines where code = p_code;
  if not found then raise exception 'Unknown budget line: %', p_code; end if;
  used := l.committed + l.actual;
  rem  := l.budget - used;
  util := round(((used + p_amount) / l.budget) * 100);
  fmt_budget := 'KES ' || to_char(l.budget, 'FM999,999,999');
  fmt_rem    := 'KES ' || to_char(greatest(rem,0), 'FM999,999,999');
  if p_amount > rem then
    return jsonb_build_object('state','exceeds','util',util,'rem',rem,'chip','no','chipTxt','exceeds',
      'msg', format('Exceeds budget — %s has only %s left of %s.', p_code, fmt_rem, fmt_budget));
  elsif util >= 80 then
    return jsonb_build_object('state','over','util',util,'rem',rem,'chip','no','chipTxt','over 80%',
      'msg', format('Tight — this takes %s to %s%% of its %s budget.', p_code, util, fmt_budget));
  else
    return jsonb_build_object('state','within','util',util,'rem',rem,'chip','ok','chipTxt','within',
      'msg', format('Within budget — %s left of %s. This brings %s to %s%%.', fmt_rem, fmt_budget, p_code, util));
  end if;
end $$;

-- Approval routing — config-driven from approval_matrix
create or replace function public.route_approval(p_amount numeric) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare m record;
begin
  select * into m from public.approval_matrix
  where max_amount is null or p_amount <= max_amount
  order by sort limit 1;
  if not found then raise exception 'Approval matrix is not configured'; end if;
  return jsonb_build_object('label', m.label, 'who', m.who, 'resultState', m.result_state);
end $$;

-- Three-way match — PO ↔ GRN ↔ Invoice must agree before payment
create or replace function public.three_way_match(p_invoice_id uuid) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  inv record; po record;
  grn_pct int;
  amount_ok boolean; grn_ok boolean;
begin
  select * into inv from public.invoices_ap where id = p_invoice_id;
  select * into po from public.purchase_orders where id = inv.po_id;
  select coalesce(sum(pct), 0) into grn_pct
    from public.goods_received_notes where po_id = po.id and state = 'received';
  amount_ok := abs(inv.amount - po.amount) <= po.amount * 0.005;  -- 0.5% tolerance
  grn_ok := grn_pct >= 100;
  if amount_ok and grn_ok then
    update public.invoices_ap set state = 'matched', match_note = null where id = inv.id;
    update public.purchase_orders set state = 'closed' where id = po.id and state in ('open','partially_received');
    perform public.audit_write('invoice.matched','invoice_ap', inv.ref,
      jsonb_build_object('po', po.ref, 'amount', inv.amount));
    return jsonb_build_object('state','matched');
  else
    update public.invoices_ap set state = 'exception',
      match_note = case when not grn_ok then format('Goods received %s%% — awaiting balance', grn_pct)
                        else format('Amount mismatch: invoice %s vs PO %s', inv.amount, po.amount) end
      where id = inv.id;
    perform public.audit_write('invoice.exception','invoice_ap', inv.ref,
      jsonb_build_object('po', po.ref, 'grnPct', grn_pct, 'invoice', inv.amount, 'poAmount', po.amount));
    return jsonb_build_object('state','exception');
  end if;
end $$;

-- Balanced journal poster — one source of truth, referenced everywhere
create or replace function public.post_journal(
  p_memo text, p_source_type text, p_source_ref text, p_lines jsonb
) returns text language plpgsql security definer set search_path = public as $$
declare
  v_ref text; v_id uuid; l jsonb;
  v_debits numeric := 0; v_credits numeric := 0;
  v_entity uuid := (select id from public.entities where code = 'KE');
begin
  for l in select * from jsonb_array_elements(p_lines) loop
    v_debits  := v_debits  + coalesce((l->>'debit')::numeric, 0);
    v_credits := v_credits + coalesce((l->>'credit')::numeric, 0);
  end loop;
  if v_debits <> v_credits or v_debits = 0 then
    raise exception 'Journal must balance (debits % vs credits %)', v_debits, v_credits;
  end if;
  v_ref := public.next_ref('JE');
  insert into public.journal_entries(ref, entity_id, memo, source_type, source_ref)
  values (v_ref, v_entity, p_memo, p_source_type, p_source_ref) returning id into v_id;
  insert into public.journal_lines(journal_id, account_code, debit, credit)
  select v_id, jl->>'account', coalesce((jl->>'debit')::numeric,0), coalesce((jl->>'credit')::numeric,0)
  from jsonb_array_elements(p_lines) jl;
  perform public.audit_write('journal.posted','journal_entry', v_ref,
    jsonb_build_object('memo', p_memo, 'source', p_source_ref, 'amount', v_debits));
  return v_ref;
end $$;

-- ============================================================
-- RPCs — every store mutation lands here; each writes the audit log
-- ============================================================

create or replace function public.submit_requisition(p_item text, p_amount numeric, p_code text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  bc jsonb; rt jsonb; v_ref text; v_state text; v_status text;
  v_entity uuid := (select id from public.entities where code = 'KE');
  v_owner uuid := (select id from public.app_users where auth_id = auth.uid());
begin
  perform public.assert_access('procurement', 2);
  bc := public.budget_check(p_code, p_amount);
  rt := public.route_approval(p_amount);
  v_state := rt->>'resultState';
  v_ref := public.next_ref('PR');
  insert into public.requisitions(ref, entity_id, owner_id, item, amount, budget_code, budget_chip, budget_chip_txt, state)
  values (v_ref, v_entity, v_owner, p_item, p_amount, p_code, bc->>'chip', bc->>'chipTxt', v_state);
  -- commit budget at requisition stage, not just payment
  update public.budget_lines set committed = committed + p_amount where code = p_code;
  v_status := case v_state when 'approved' then 'approved' when 'md_review' then 'md' else 'await' end;
  perform public.audit_write('requisition.submitted','requisition', v_ref,
    jsonb_build_object('item', p_item, 'amount', p_amount, 'code', p_code,
                       'budget', bc->>'chipTxt', 'routing', rt->>'label'));
  return jsonb_build_object('id', v_ref, 'item', p_item, 'amt', p_amount, 'code', p_code,
    'chip', bc->>'chip', 'chipTxt', bc->>'chipTxt', 'status', v_status,
    'routing', jsonb_build_object('label', rt->>'label', 'who', rt->>'who'));
end $$;

create or replace function public.approve_requisition(p_ref text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare r record;
begin
  perform public.assert_access('procurement', 3);
  select * into r from public.requisitions where ref = p_ref;
  if not found then raise exception 'Requisition % not found', p_ref; end if;
  update public.requisitions set state = 'approved' where id = r.id;  -- state machine validates
  perform public.audit_write('requisition.approved','requisition', p_ref,
    jsonb_build_object('from', r.state));
  return jsonb_build_object('id', p_ref, 'status', 'approved');
end $$;

create or replace function public.raise_po(p_req_ref text, p_vendor_name text, p_delivery text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  r record; v record; v_ref text; v_delivery text;
  v_entity uuid := (select id from public.entities where code = 'KE');
  v_owner uuid := (select id from public.app_users where auth_id = auth.uid());
begin
  perform public.assert_access('procurement', 2);
  select * into r from public.requisitions where ref = p_req_ref;
  if not found then raise exception 'Requisition % not found', p_req_ref; end if;
  if r.state <> 'approved' then
    raise exception 'Document chain: % must be approved before a PO can exist (state: %)', p_req_ref, r.state;
  end if;
  select * into v from public.vendors where name = p_vendor_name;
  if not found then raise exception 'Vendor % is not registered', p_vendor_name; end if;
  v_ref := public.next_ref('PO');
  v_delivery := coalesce(nullif(split_part(p_delivery, ' · ', 2), ''), '—');
  insert into public.purchase_orders(ref, entity_id, owner_id, requisition_id, vendor_id, vendor_name, amount, delivery)
  values (v_ref, v_entity, v_owner, r.id, v.id, v.name, r.amount, v_delivery);  -- sanctions gate fires here
  update public.requisitions set state = 'converted' where id = r.id;
  update public.vendors set open_pos = open_pos + 1 where id = v.id;
  perform public.audit_write('po.issued','po', v_ref,
    jsonb_build_object('requisition', p_req_ref, 'vendor', v.name, 'amount', r.amount));
  return jsonb_build_object('id', v_ref, 'vendor', v.name, 'amt', r.amount, 'delivery', v_delivery);
end $$;

create or replace function public.submit_grn(p_po_ref text, p_coverage text, p_pct int, p_note text default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  po record; v_ref text; total_pct int;
  v_entity uuid := (select id from public.entities where code = 'KE');
  v_receiver uuid := (select id from public.app_users where auth_id = auth.uid());
begin
  perform public.assert_access('procurement', 2);
  select * into po from public.purchase_orders where ref = p_po_ref;
  if not found then raise exception 'PO % not found', p_po_ref; end if;
  if po.state = 'closed' then raise exception 'PO % is closed', p_po_ref; end if;
  -- checkpoint (recorded now, enforced Phase 5): receiver ≠ requester
  v_ref := public.next_ref('GRN');
  insert into public.goods_received_notes(ref, entity_id, po_id, receiver_id, coverage, pct, note)
  values (v_ref, v_entity, po.id, v_receiver,
          case when p_coverage = 'full' then 'full' else 'partial' end,
          case when p_coverage = 'full' then 100 else least(greatest(p_pct,1),99) end, p_note);
  select coalesce(sum(pct),0) into total_pct from public.goods_received_notes where po_id = po.id and state='received';
  if po.state = 'open' and total_pct < 100 then
    update public.purchase_orders set state = 'partially_received' where id = po.id;
  end if;
  perform public.audit_write('grn.received','grn', v_ref,
    jsonb_build_object('po', p_po_ref, 'coverage', p_coverage, 'pct', p_pct));
  return jsonb_build_object('id', v_ref, 'po', p_po_ref, 'totalPct', least(total_pct,100));
end $$;

create or replace function public.capture_ap_invoice(p_po_ref text, p_amount numeric)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  po record; v_ref text; v_id uuid; m jsonb; line record;
  v_entity uuid := (select id from public.entities where code = 'KE');
begin
  perform public.assert_access('finance', 2);
  select * into po from public.purchase_orders where ref = p_po_ref;
  if not found then raise exception 'PO % not found', p_po_ref; end if;
  v_ref := public.next_ref('INV');
  insert into public.invoices_ap(ref, entity_id, vendor_id, po_id, amount)
  values (v_ref, v_entity, po.vendor_id, po.id, p_amount) returning id into v_id;
  -- expense recognised at capture: debit expense, credit AP
  select bl.* into line from public.budget_lines bl
    join public.requisitions r on r.budget_code = bl.code where r.id = po.requisition_id;
  perform public.post_journal('Supplier invoice ' || v_ref || ' — ' || po.vendor_name, 'invoice_ap', v_ref,
    jsonb_build_array(
      jsonb_build_object('account', coalesce(line.account_code,'5000'), 'debit', p_amount),
      jsonb_build_object('account', '2000', 'credit', p_amount)));
  perform public.audit_write('invoice.captured','invoice_ap', v_ref,
    jsonb_build_object('po', p_po_ref, 'amount', p_amount));
  m := public.three_way_match(v_id);
  return jsonb_build_object('id', v_ref, 'po', p_po_ref, 'match', m->>'state');
end $$;

create or replace function public.pay_invoice(p_inv_ref text, p_method text default 'bank')
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  inv record; po record; v_ref text; je text; bcode text;
  v_entity uuid := (select id from public.entities where code = 'KE');
begin
  perform public.assert_access('finance', 3);
  select * into inv from public.invoices_ap where ref = p_inv_ref;
  if not found then raise exception 'Invoice % not found', p_inv_ref; end if;
  if inv.state <> 'matched' then
    raise exception 'Three-way match: % must be matched before payment (state: %)', p_inv_ref, inv.state;
  end if;
  select * into po from public.purchase_orders where id = inv.po_id;
  v_ref := public.next_ref('PAY');
  je := public.post_journal('Payment ' || v_ref || ' — ' || po.vendor_name, 'payment', v_ref,
    jsonb_build_array(
      jsonb_build_object('account', '2000', 'debit', inv.amount),
      jsonb_build_object('account', '1000', 'credit', inv.amount)));
  insert into public.payments(ref, entity_id, invoice_ap_id, method, amount, journal_ref)
  values (v_ref, v_entity, inv.id, p_method, inv.amount, je);
  update public.invoices_ap set state = 'paid' where id = inv.id;
  update public.vendors set open_pos = greatest(open_pos - 1, 0) where id = inv.vendor_id;
  -- budget: commitment becomes actual spend
  select budget_code into bcode from public.requisitions where id = po.requisition_id;
  if bcode is not null then
    update public.budget_lines set committed = greatest(committed - inv.amount, 0),
                                   actual = actual + inv.amount where code = bcode;
  end if;
  perform public.audit_write('payment.made','payment', v_ref,
    jsonb_build_object('invoice', p_inv_ref, 'method', p_method, 'amount', inv.amount, 'journal', je));
  return jsonb_build_object('id', v_ref, 'invoice', p_inv_ref, 'journal', je);
end $$;

create or replace function public.submit_sales_invoice(p_customer text, p_description text, p_net numeric, p_due_key text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_ref text; v_total numeric; v_vat numeric; v_cls text; v_txt text;
  v_entity uuid := (select id from public.entities where code = 'KE');
  v_owner uuid := (select id from public.app_users where auth_id = auth.uid());
begin
  perform public.assert_access('finance', 2);
  v_total := round(p_net * 1.16);
  v_vat := v_total - p_net;
  select case p_due_key when 'today' then 'today' else 'week' end,
         case p_due_key when 'today' then 'On receipt' when 'week30' then '30 days' else '14 days' end
    into v_cls, v_txt;
  v_ref := public.next_ref('SI');
  insert into public.sales_invoices(ref, entity_id, owner_id, customer, description, net, vat, total, due_pill_cls, due_pill_txt)
  values (v_ref, v_entity, v_owner, p_customer, p_description, p_net, v_vat, v_total, v_cls, v_txt);
  perform public.post_journal('Sales invoice ' || v_ref || ' — ' || p_customer, 'sales_invoice', v_ref,
    jsonb_build_array(
      jsonb_build_object('account', '1100', 'debit', v_total),
      jsonb_build_object('account', '4000', 'credit', p_net),
      jsonb_build_object('account', '2100', 'credit', v_vat)));
  perform public.audit_write('sales_invoice.issued','sales_invoice', v_ref,
    jsonb_build_object('customer', p_customer, 'net', p_net, 'total', v_total, 'etims', 'filed'));
  return jsonb_build_object('cust', p_customer, 'id', v_ref, 'tot', v_total, 'pillCls', v_cls, 'pillTxt', v_txt);
end $$;

create or replace function public.save_task(p_title text, p_owner text, p_due_key text, p_link text default '')
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_ref text; v_pill text; v_label text;
  v_entity uuid := (select id from public.entities where code = 'KE');
  v_owner uuid := (select id from public.app_users where auth_id = auth.uid());
begin
  select case p_due_key when 'today' then 'today' else 'week' end,
         case p_due_key when 'today' then 'Today' when 'nweek' then 'Next week' else 'This week' end
    into v_pill, v_label;
  v_ref := public.next_ref('TSK');
  insert into public.tasks(ref, entity_id, owner_id, title, sub, owner_name, due_pill, due_label)
  values (v_ref, v_entity, v_owner, p_title, coalesce(p_link,''), p_owner, v_pill, v_label);
  perform public.audit_write('task.assigned','task', v_ref,
    jsonb_build_object('title', p_title, 'owner', p_owner, 'due', v_label));
  return jsonb_build_object('id', v_ref, 't', p_title, 's', coalesce(p_link,''), 'o', p_owner, 'p', v_pill, 'pl', v_label);
end $$;

create or replace function public.save_access(p_email text, p_perms jsonb)
returns void language plpgsql security definer set search_path = public as $$
declare k text;
begin
  perform public.assert_access('users', 3);
  for k in select jsonb_object_keys(p_perms) loop
    insert into public.user_permissions(email, module, level)
    values (p_email, k, (p_perms->>k)::int)
    on conflict (email, module) do update set level = excluded.level, updated_at = now();
  end loop;
  perform public.audit_write('access.updated','user', p_email, jsonb_build_object('perms', p_perms));
end $$;

create or replace function public.create_project_from_eng(p_eng_ref text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  e record; v_name text; p record;
  v_entity uuid := (select id from public.entities where code = 'KE');
  created boolean := false;
begin
  perform public.assert_access('projects', 2);
  select * into e from public.engagements where ref = p_eng_ref;
  if not found then raise exception 'Engagement % not found', p_eng_ref; end if;
  v_name := regexp_replace(e.name, ' \(.*\)', '') || ' — deployment';
  select * into p from public.projects where name = v_name;
  if not found then
    insert into public.projects(entity_id, name, funder, status, team, is_extra, milestones, docs)
    values (v_entity, v_name, e.name, 'Setup', e.owner_name, true,
      '[{"t":"Project set up from won deal","s":"done"},{"t":"Budget & funder agreement","s":"now"},{"t":"Deployment","s":"todo"}]'::jsonb,
      jsonb_build_array('Signed agreement (from ' || p_eng_ref || ')'))
    returning * into p;
    insert into public.eng_project_links(eng_ref, project_name, is_primary)
    values (p_eng_ref, v_name, true)
    on conflict (eng_ref) do update set project_name = excluded.project_name;
    if e.state = 'active' then
      update public.engagements set state = 'won' where id = e.id;
    end if;
    created := true;
    perform public.audit_write('project.created_from_eng','project', v_name,
      jsonb_build_object('engagement', p_eng_ref, 'funder', e.name));
  end if;
  return jsonb_build_object('name', v_name, 'funder', e.name, 'created', created,
    'detail', jsonb_build_object(
      'funder', p.funder, 'status', p.status, 'budget', p.budget_txt, 'spent', p.spent_txt,
      'pct', p.pct, 'timeline', p.timeline, 'team', p.team, 'milestones', p.milestones,
      'drawdowns', p.drawdowns, 'reporting', p.reporting, 'field', p.field, 'docs', p.docs));
end $$;

-- ---------- bootstrap: one round-trip, everything in frontend shapes ----------
create or replace function public.bootstrap()
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare
  v_email text := coalesce(nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'email', '');
begin
  return jsonb_build_object(
    'me', (select jsonb_build_object('email', email, 'name', name, 'roleTitle', role_title)
           from public.app_users where email = v_email),
    'tasks', coalesce((select jsonb_agg(jsonb_build_object(
        'id', ref, 't', title, 's', sub, 'o', owner_name, 'p', due_pill, 'pl', due_label)
        order by created_at desc)
      from public.tasks where state = 'open'), '[]'::jsonb),
    'reqs', coalesce((select jsonb_agg(jsonb_build_object(
        'id', ref, 'item', item, 'amt', amount, 'code', budget_code,
        'chip', budget_chip, 'chipTxt', budget_chip_txt,
        'status', case state when 'approved' then 'approved' when 'md_review' then 'md'
                             when 'converted' then 'po' else 'await' end)
        order by created_at desc)
      from public.requisitions where state <> 'rejected'), '[]'::jsonb),
    'pos', coalesce((select jsonb_agg(jsonb_build_object(
        'id', ref, 'vendor', vendor_name, 'amt', amount, 'delivery', delivery)
        order by created_at desc)
      from public.purchase_orders), '[]'::jsonb),
    'salesInvoices', coalesce((select jsonb_agg(jsonb_build_object(
        'cust', customer, 'id', ref, 'tot', total, 'pillCls', due_pill_cls, 'pillTxt', due_pill_txt)
        order by created_at desc)
      from public.sales_invoices), '[]'::jsonb),
    'perms', coalesce((select jsonb_object_agg(email, mods) from (
        select email, jsonb_object_agg(module, level) as mods
        from public.user_permissions group by email) q), '{}'::jsonb),
    'projects', coalesce((select jsonb_object_agg(name, jsonb_build_object(
        'funder', funder, 'status', status, 'budget', budget_txt, 'spent', spent_txt,
        'pct', pct, 'timeline', timeline, 'team', team, 'milestones', milestones,
        'drawdowns', drawdowns, 'reporting', reporting, 'field', field, 'docs', docs))
      from public.projects), '{}'::jsonb),
    'extraProjects', coalesce((select jsonb_agg(jsonb_build_object('name', name, 'funder', funder)
        order by created_at)
      from public.projects where is_extra), '[]'::jsonb),
    'engToProject', coalesce((select jsonb_object_agg(eng_ref, project_name)
      from public.eng_project_links), '{}'::jsonb),
    'projectToEng', coalesce((select jsonb_object_agg(project_name, eng_ref)
      from public.eng_project_links where is_primary), '{}'::jsonb),
    'budgetLines', coalesce((select jsonb_object_agg(code, jsonb_build_object(
        'b', budget, 'u', committed + actual))
      from public.budget_lines), '{}'::jsonb)
  );
end $$;

-- ---------- RLS + grants ----------
do $$
declare t text;
begin
  foreach t in array array['vendors','vendor_screenings','budget_lines','approval_matrix',
    'requisitions','purchase_orders','goods_received_notes','invoices_ap','payments',
    'journal_entries','journal_lines','sales_invoices','bank_accounts','petty_cash_floats',
    'tasks','engagements','projects','eng_project_links']
  loop
    execute format('alter table public.%I enable row level security', t);
    execute format('drop policy if exists "read for authenticated" on public.%I', t);
    execute format('create policy "read for authenticated" on public.%I for select to authenticated using (true)', t);
  end loop;
end $$;

-- RPCs require a signed-in user; nothing for anon
do $$
declare fn text;
begin
  foreach fn in array array[
    'submit_requisition(text,numeric,text)','approve_requisition(text)',
    'raise_po(text,text,text)','submit_grn(text,text,int,text)',
    'capture_ap_invoice(text,numeric)','pay_invoice(text,text)',
    'submit_sales_invoice(text,text,numeric,text)','save_task(text,text,text,text)',
    'save_access(text,jsonb)','create_project_from_eng(text)','bootstrap()',
    'budget_check(text,numeric)','route_approval(numeric)']
  loop
    execute format('revoke execute on function public.%s from public, anon', fn);
    execute format('grant execute on function public.%s to authenticated', fn);
  end loop;
end $$;
