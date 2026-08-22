-- Jikoni — concatenated migrations (paste into Supabase SQL editor). Keep in sync with supabase/migrations/.

-- ======== supabase/migrations/0001_phase0_foundations.sql ========
-- ============================================================
-- Jikoni Master PRD (Kenya-only, v2) — Phase 0: Foundations
-- entities, app_users, chart_of_accounts, audit_log, documents,
-- record-state pattern, permission hooks (always-allow), audit writer.
-- Idempotent: safe to re-run.
-- ============================================================

create extension if not exists pgcrypto;

-- ---------- entities (Kenya live; Uganda is config, no UG logic) ----------
create table if not exists public.entities (
  id          uuid primary key default gen_random_uuid(),
  code        text not null unique,          -- 'KE', 'UG'
  name        text not null,
  currency    text not null default 'KES',
  active      boolean not null default true,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

-- ---------- app users (Phase 0 auth = "who is logged in", nothing more) ----------
create table if not exists public.app_users (
  id          uuid primary key default gen_random_uuid(),
  auth_id     uuid unique references auth.users(id) on delete set null,
  entity_id   uuid references public.entities(id),
  name        text not null,
  email       text not null unique,
  role_key    text not null default 'std',   -- admin | fin | std | view (template only, no enforcement yet)
  role_title  text,
  two_fa      boolean not null default false,
  status      text not null default 'active',
  color       text,
  state       text not null default 'active',
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

-- link auth accounts to app_users by email as they sign up
create or replace function public.link_auth_user() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  update public.app_users set auth_id = new.id, updated_at = now()
  where email = new.email and auth_id is null;
  return new;
end $$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.link_auth_user();

-- ---------- config (feature flags; Phase 5 flips enforcement on) ----------
create table if not exists public.app_config (
  key         text primary key,
  value       jsonb not null,
  updated_at  timestamptz not null default now()
);

insert into public.app_config(key, value) values
  ('enforce_access', 'false'::jsonb),
  ('enforce_sod',    'false'::jsonb)
on conflict (key) do nothing;

-- ---------- per-user module permissions (matrix stored now, enforced Phase 5) ----------
create table if not exists public.user_permissions (
  email       text not null,
  module      text not null,
  level       int  not null default 0 check (level between 0 and 3), -- 0 none · 1 view · 2 edit · 3 full
  updated_at  timestamptz not null default now(),
  primary key (email, module)
);

-- ---------- audit log: live immediately, non-negotiable, append-only ----------
create table if not exists public.audit_log (
  id          bigint generated always as identity primary key,
  entity_id   uuid references public.entities(id),
  actor_id    uuid,
  actor_email text,
  action      text not null,
  record_type text not null,
  record_ref  text,
  detail      jsonb not null default '{}'::jsonb,
  created_at  timestamptz not null default now()
);

create or replace function public.audit_log_immutable() returns trigger
language plpgsql as $$
begin
  raise exception 'audit_log is append-only';
end $$;

drop trigger if exists audit_log_no_update on public.audit_log;
create trigger audit_log_no_update
  before update or delete on public.audit_log
  for each row execute function public.audit_log_immutable();

-- central audit writer — called from every mutating action
create or replace function public.audit_write(
  p_action text, p_record_type text, p_record_ref text, p_detail jsonb default '{}'::jsonb
) returns void language plpgsql security definer set search_path = public as $$
declare
  v_email text := coalesce(nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'email', 'system');
  v_actor uuid := auth.uid();
  v_entity uuid := (select id from public.entities where code = 'KE');
begin
  insert into public.audit_log(entity_id, actor_id, actor_email, action, record_type, record_ref, detail)
  values (v_entity, v_actor, v_email, p_action, p_record_type, p_record_ref, coalesce(p_detail, '{}'::jsonb));
end $$;

-- ---------- permission hook: checkpoint on every transition, ALWAYS-ALLOW until Phase 5 ----------
create or replace function public.assert_access(p_module text, p_min_level int) returns void
language plpgsql security definer set search_path = public as $$
declare
  v_on boolean := coalesce((select value::text = 'true' from public.app_config where key = 'enforce_access'), false);
  v_email text := coalesce(nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'email', '');
  v_level int;
begin
  if not v_on then return; end if;  -- build open, enforce last
  select level into v_level from public.user_permissions where email = v_email and module = p_module;
  if coalesce(v_level, 0) < p_min_level then
    raise exception 'Access denied: % requires level % on %', v_email, p_min_level, p_module;
  end if;
end $$;

-- ---------- record-state pattern: explicit transitions, not free-form strings ----------
create table if not exists public.record_transitions (
  record_type text not null,
  from_state  text not null,
  to_state    text not null,
  primary key (record_type, from_state, to_state)
);

create or replace function public.assert_transition(p_type text, p_from text, p_to text) returns void
language plpgsql stable security definer set search_path = public as $$
begin
  if p_from = p_to then return; end if;
  if not exists (
    select 1 from public.record_transitions
    where record_type = p_type and from_state = p_from and to_state = p_to
  ) then
    raise exception 'Illegal % transition: % → %', p_type, p_from, p_to;
  end if;
end $$;

-- generic trigger: table sets trigger argument = record_type
create or replace function public.enforce_state_machine() returns trigger
language plpgsql as $$
begin
  perform public.assert_transition(tg_argv[0], old.state, new.state);
  new.updated_at := now();
  return new;
end $$;

create or replace function public.touch_updated_at() returns trigger
language plpgsql as $$
begin
  new.updated_at := now();
  return new;
end $$;

-- ---------- chart of accounts ----------
create table if not exists public.chart_of_accounts (
  id          uuid primary key default gen_random_uuid(),
  entity_id   uuid references public.entities(id),
  code        text not null,
  name        text not null,
  kind        text not null check (kind in ('asset','liability','equity','income','expense')),
  active      boolean not null default true,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  unique (entity_id, code)
);

-- ---------- documents (Supabase Storage-backed; path only for now) ----------
create table if not exists public.documents (
  id           uuid primary key default gen_random_uuid(),
  entity_id    uuid references public.entities(id),
  owner_id     uuid references public.app_users(id),
  record_type  text,
  record_ref   text,
  name         text not null,
  storage_path text,
  state        text not null default 'active',
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);

-- ---------- reference counters (PR-209, PO-62, SI-0189, …) ----------
create table if not exists public.ref_counters (
  kind   text primary key,
  prefix text not null,
  n      int  not null
);

create or replace function public.next_ref(p_kind text) returns text
language plpgsql security definer set search_path = public as $$
declare v text;
begin
  update public.ref_counters set n = n + 1 where kind = p_kind
  returning prefix || n::text into v;
  if v is null then raise exception 'Unknown ref counter: %', p_kind; end if;
  return v;
end $$;

-- ---------- RLS: read for signed-in users; writes only via definer RPCs ----------
do $$
declare t text;
begin
  foreach t in array array['entities','app_users','app_config','user_permissions','audit_log',
                           'record_transitions','chart_of_accounts','documents','ref_counters']
  loop
    execute format('alter table public.%I enable row level security', t);
    execute format('drop policy if exists "read for authenticated" on public.%I', t);
    execute format('create policy "read for authenticated" on public.%I for select to authenticated using (true)', t);
  end loop;
end $$;

-- ======== supabase/migrations/0002_phase1_p2p_gl.sql ========
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

-- ======== supabase/migrations/0003_seed_kenya.sql ========
-- ============================================================
-- Jikoni Master PRD — Seed: Kenya entity + demo data from src/data.ts
-- Values mirror the prototype exactly so the UI renders unchanged.
-- Idempotent: `on conflict do nothing` — re-runs never clobber live rows.
-- ============================================================

-- ---------- entities ----------
insert into public.entities(code, name, currency, active) values
  ('KE', 'Kenya', 'KES', true),
  ('UG', 'Uganda', 'UGX', false)   -- config exists day one; no Uganda records/logic yet (PRD scope)
on conflict (code) do nothing;

-- ---------- team ----------
with ke as (select id from public.entities where code = 'KE')
insert into public.app_users(entity_id, name, email, role_key, role_title, two_fa, status, color)
select ke.id, v.* from ke, (values
  ('Dennis',    'dennis@ignis.africa',    'admin', 'Managing Director',        true,  'active', '#E2632A'),
  ('Brian',     'brian@ignis.africa',     'admin', 'Platform / Tech',          true,  'active', '#12A3BE'),
  ('Joan',      'joan@ignis.africa',      'fin',   'Operations',               true,  'active', '#3C8A5E'),
  ('Wilson',    'wilson@ignis.africa',    'std',   'BD — Upstream CRM',        true,  'away',   '#6D28D9'),
  ('Elizabeth', 'elizabeth@ignis.africa', 'std',   'Partnerships — Downstream',false, 'away',   '#B91C1C'),
  ('Wanjiku',   'wanjiku@ignis.africa',   'admin', 'Chief of Staff',           true,  'active', '#0e7d91'),
  ('Lily',      'lily@ignis.africa',      'view',  'Communications',           false, 'off',    '#A16207')
) as v(name, email, role_key, role_title, two_fa, status, color)
on conflict (email) do nothing;

-- ---------- per-user module permissions (initialPerms) ----------
insert into public.user_permissions(email, module, level)
select e, m, l from (values
  ('dennis@ignis.africa',    '{"finance":3,"procurement":3,"hr":3,"deploy":3,"readiness":3,"raise":3,"crm":3,"projects":3,"reports":3,"dataroom":3,"settings":3,"users":3}'::jsonb),
  ('wanjiku@ignis.africa',   '{"finance":3,"procurement":3,"hr":3,"deploy":3,"readiness":3,"raise":3,"crm":3,"projects":3,"reports":3,"dataroom":3,"settings":3,"users":3}'::jsonb),
  ('brian@ignis.africa',     '{"finance":1,"procurement":1,"hr":1,"deploy":3,"readiness":2,"raise":1,"crm":1,"projects":2,"reports":2,"dataroom":1,"settings":3,"users":3}'::jsonb),
  ('joan@ignis.africa',      '{"finance":3,"procurement":3,"hr":2,"deploy":1,"readiness":1,"raise":0,"crm":1,"projects":2,"reports":2,"dataroom":0,"settings":0,"users":0}'::jsonb),
  ('wilson@ignis.africa',    '{"finance":0,"procurement":0,"hr":0,"deploy":1,"readiness":1,"raise":2,"crm":3,"projects":1,"reports":1,"dataroom":0,"settings":0,"users":0}'::jsonb),
  ('elizabeth@ignis.africa', '{"finance":0,"procurement":0,"hr":0,"deploy":1,"readiness":2,"raise":0,"crm":3,"projects":1,"reports":1,"dataroom":0,"settings":0,"users":0}'::jsonb),
  ('lily@ignis.africa',      '{"finance":0,"procurement":0,"hr":0,"deploy":1,"readiness":0,"raise":0,"crm":1,"projects":0,"reports":1,"dataroom":0,"settings":0,"users":0}'::jsonb)
) as p(e, perms), lateral (select key as m, value::text::int as l from jsonb_each(perms)) kv
on conflict (email, module) do nothing;

-- ---------- chart of accounts (minimal Kenya COA) ----------
with ke as (select id from public.entities where code = 'KE')
insert into public.chart_of_accounts(entity_id, code, name, kind)
select ke.id, v.* from ke, (values
  ('1000', 'Cash & bank',                    'asset'),
  ('1100', 'Accounts receivable',            'asset'),
  ('1200', 'Inventory',                      'asset'),
  ('2000', 'Accounts payable',               'liability'),
  ('2100', 'VAT payable',                    'liability'),
  ('3000', 'Capital & reserves',             'equity'),
  ('4000', 'Sales & programme income',       'income'),
  ('5000', 'Programme & operating expenses', 'expense')
) as v(code, name, kind)
on conflict (entity_id, code) do nothing;

-- ---------- budget lines (data.ts budgetLines; u seeded as actual spend) ----------
with ke as (select id from public.entities where code = 'KE')
insert into public.budget_lines(entity_id, code, budget, committed, actual)
select ke.id, v.* from ke, (values
  ('Deployment',              1500000, 0, 1110000),
  ('Operations',               800000, 0,  488000),
  ('Field / MRV',              900000, 0,  432000),
  ('BD / Fundraise',           700000, 0,  385000),
  ('Admin',                    500000, 0,  300000),
  ('Project · Makueni VTC',   3200000, 0, 1900000),
  ('Project · Sierra Leone',  1300000, 0,  330000)
) as v(code, budget, committed, actual)
on conflict (code) do nothing;

-- ---------- approval matrix (Kenya SOP defaults; mirrors reqRouting) ----------
with ke as (select id from public.entities where code = 'KE')
insert into public.approval_matrix(entity_id, sort, max_amount, label, who, result_state)
select ke.id, v.* from ke, (values
  (1, 4999.99::numeric, 'Auto-approved',   'clears without a signature',   'approved'),
  (2, 100000::numeric,  'Single approver', 'routes to Joan (Operations)',  'submitted'),
  (3, 500000::numeric,  'Dual approval',   'Joan, then Dennis',            'submitted'),
  (4, null::numeric,    'MD sign-off',     'routes to Dennis (MD)',        'md_review')
) as v(sort, max_amount, label, who, result_state)
where not exists (select 1 from public.approval_matrix);

-- ---------- vendors (vendorDetails) ----------
with ke as (select id from public.entities where code = 'KE')
insert into public.vendors(entity_id, name, category, country, rating, tax_status, screen_status, bank, since, spend_txt, open_pos, timeline, contracts, docs, state)
select ke.id, v.* from ke, (values
  ('BURN Manufacturing', 'Cookstoves', 'Kenya', '4.8', 'Compliant', 'cleared', 'KCB ****4021', 'Jan 2025', 'KES 3.9M', 1,
   $j$[{"d":"Today","ev":"Delivery","note":"PO-059 partial delivery (60%) received; GRN-074 open pending the balance."},
       {"d":"2 weeks ago","ev":"PO issued","note":"PO-059 — cooker batch, KES 640,000."},
       {"d":"Mar 2026","ev":"Framework signed","note":"Cookstove supply framework agreed at fixed rates through Dec 2026."},
       {"d":"Jan 2025","ev":"Onboarded","note":"Registered, tax-verified and sanctions-screened — cleared."}]$j$::jsonb,
   $j$[{"name":"Cookstove supply framework","type":"Framework · agreed rates","expiry":"Dec 2026","status":"Active"}]$j$::jsonb,
   $j$["Cookstove supply framework (signed)","Certificate of incorporation","KRA PIN certificate","Tax Compliance Certificate","PO-059","GRN-074","Invoice INV-2291"]$j$::jsonb,
   'active'),
  ('Nakuru Fabricators', 'Fabrication', 'Kenya', '4.4', 'Compliant', 'cleared', 'Equity ****7712', 'Jun 2025', 'KES 0.9M', 1,
   $j$[{"d":"This week","ev":"PO issued","note":"PO-061 — cooker spares, KES 142,000, due 8 Jul."},
       {"d":"This week","ev":"Awarded","note":"Won RFQ-014 (score 92) — best value on lead time."},
       {"d":"Jun 2025","ev":"Onboarded","note":"Registered, tax-verified and sanctions-screened."}]$j$::jsonb,
   '[]'::jsonb,
   $j$["RFQ-014 quote","KRA PIN certificate","Tax Compliance Certificate","PO-061"]$j$::jsonb,
   'active'),
  ('Equity Logistics', 'Transport', 'Kenya', '4.2', 'Compliant', 'cleared', 'Equity ****3390', 'Feb 2025', 'KES 1.4M', 0,
   $j$[{"d":"2 weeks ago","ev":"Delivered","note":"PO-058 delivered in full; GRN-073 matched and closed."},
       {"d":"Mar 2026","ev":"Framework signed","note":"Logistics framework agreed through Mar 2027."},
       {"d":"Feb 2025","ev":"Onboarded","note":"Screened and approved."}]$j$::jsonb,
   $j$[{"name":"Logistics framework","type":"Framework","expiry":"Mar 2027","status":"Active"}]$j$::jsonb,
   $j$["Logistics framework (signed)","KRA PIN certificate","Tax Compliance Certificate","PO-058","GRN-073"]$j$::jsonb,
   'active'),
  ('Safaricom', 'Telecoms / data', 'Kenya', '4.6', 'Compliant', 'cleared', '—', '2024', 'KES 0.3M', 0,
   $j$[{"d":"Recent","ev":"Match variance","note":"INV-2284 flagged — quantity mismatch vs PO-056; payment held pending resolution."},
       {"d":"Sep 2025","ev":"Service agreement","note":"Data & connectivity agreement signed."}]$j$::jsonb,
   $j$[{"name":"Data & connectivity","type":"Service agreement","expiry":"Sep 2026","status":"Renew soon"}]$j$::jsonb,
   $j$["Data & connectivity agreement","KRA PIN certificate","PO-056","Invoice INV-2284 (disputed)"]$j$::jsonb,
   'active'),
  ('Mombasa Freight Co.', 'Clearing', 'Kenya', '—', 'Pending PIN', 'in_screening', '—', 'Onboarding', 'KES 0', 0,
   $j$[{"d":"This week","ev":"Onboarding","note":"Registration submitted; awaiting KRA PIN and sanctions screening before any award can be made."}]$j$::jsonb,
   '[]'::jsonb,
   $j$["Registration form (submitted)"]$j$::jsonb,
   'in_screening')
) as v(name, category, country, rating, tax_status, screen_status, bank, since, spend_txt, open_pos, timeline, contracts, docs, state)
on conflict (name) do nothing;

-- screening sub-records for cleared vendors
insert into public.vendor_screenings(vendor_id, result, notes)
select id, 'cleared', 'Sanctions & PEP screening — no matches'
from public.vendors v where screen_status = 'cleared'
  and not exists (select 1 from public.vendor_screenings s where s.vendor_id = v.id);

-- ---------- reference counters (prototype sequence continuity) ----------
insert into public.ref_counters(kind, prefix, n) values
  ('PR',  'PR-',   208),
  ('PO',  'PO-',   61),
  ('SI',  'SI-0',  188),
  ('TSK', 'TSK-',  210),
  ('GRN', 'GRN-',  74),
  ('INV', 'INV-',  2291),
  ('PAY', 'PAY-',  100),
  ('JE',  'JE-',   100)
on conflict (kind) do nothing;

-- ---------- My Week tasks (initialMyWeek; created_at staggered to keep order) ----------
with ke as (select id from public.entities where code = 'KE')
insert into public.tasks(ref, entity_id, title, sub, owner_name, due_pill, due_label, created_at)
select v.ref, ke.id, v.title, v.sub, v.owner_name, v.due_pill, v.due_label,
       now() - (v.ord || ' minutes')::interval
from ke, (values
  (1, 'ENG-002', 'IEA — confirm DSA signed, share Excel dataset', 'Wilson copied', 'Wanjiku', 'over', 'Overdue'),
  (2, 'ENG-026', 'SEforALL — send Ethiopia ONStove brief', '', 'Wanjiku', 'over', 'Overdue'),
  (3, 'ENG-021', 'OSECC — lock 30-min call with Benson', '', 'Wanjiku', 'today', 'Today'),
  (4, 'PCV-114', 'Petty cash replenishment — approve Joan''s float', 'KES 48,200', 'Wanjiku', 'today', 'Today'),
  (5, 'ENG-029', 'Rockefeller — lock call with Betty', '', 'Wanjiku', 'week', 'This week'),
  (6, 'BRD-Q2', 'Q2 board pack — review before circulation', '', 'Wanjiku', 'week', 'This week'),
  (7, 'TSK-206', 'Makueni VTC — confirm 22 platform registrations', '', 'Elizabeth', 'today', 'Today'),
  (8, 'TSK-207', 'Cooker spares — raise PO for maintenance batch', '', 'Joan', 'week', 'This week'),
  (9, 'TSK-208', 'Stanbic Uganda — draft MOU redlines', '', 'Wilson', 'week', 'This week')
) as v(ord, ref, title, sub, owner_name, due_pill, due_label)
on conflict (ref) do nothing;

-- ---------- CRM engagements (crmData) ----------
with ke as (select id from public.entities where code = 'KE')
insert into public.engagements(ref, entity_id, name, stage, owner_name, pill, pill_txt, pipeline)
select v.ref, ke.id, v.name, v.stage, v.owner_name, v.pill, v.pill_txt, v.pipeline from ke, (values
  ('ENG-002', 'IEA',                          'Materials',      'Wilson',    'over',  'Overdue',   'up'),
  ('ENG-008', 'EAIF',                         'Negotiation',    'Wilson',    'today', 'Today',     'up'),
  ('ENG-012', 'Charm Impact',                 'Term sheet',     'Wilson',    'week',  'This week', 'up'),
  ('ENG-019', 'Cygnum Capital',               'Discovery',      'Wilson',    'week',  'This week', 'up'),
  ('ENG-026', 'SEforALL',                     'Materials',      'Wilson',    'over',  'Overdue',   'up'),
  ('ENG-029', 'Rockefeller',                  'Discovery',      'Wilson',    'week',  'This week', 'up'),
  ('DST-004', 'Makueni County VTCs',          'Contracting',    'Elizabeth', 'today', 'Today',     'down'),
  ('DST-007', 'CLASP',                        'Site visit',     'Elizabeth', 'week',  'This week', 'down'),
  ('DST-011', 'Catholic Diocese — Machakos',  'EOI',            'Elizabeth', 'week',  'This week', 'down'),
  ('DST-015', 'BURN Manufacturing',           'Identification', 'Elizabeth', 'done',  'Logged',    'down'),
  ('DST-018', 'Kiambu institutions cluster',  'Site visit',     'Elizabeth', 'over',  'Overdue',   'down')
) as v(ref, name, stage, owner_name, pill, pill_txt, pipeline)
on conflict (ref) do nothing;

-- ---------- projects (initialProjectDetails) ----------
with ke as (select id from public.entities where code = 'KE')
insert into public.projects(entity_id, name, funder, status, budget_txt, spent_txt, pct, timeline, team, reporting, field, milestones, drawdowns, docs, is_extra, state)
select ke.id, v.* from ke, (values
  ('Makueni VTC rollout', 'Makueni County + grant', 'On track', 'KES 3.2M', 'KES 1.9M', '59%', 'Jan–Dec 2026', 'Elizabeth · field crew',
   'Quarterly · next 15 Jul', '48 site visits · 22 installs logged',
   $j$[{"t":"Phase 1 — 22 institutions onboarded","s":"done"},{"t":"Phase 2 — platform registration (63)","s":"now"},{"t":"Phase 3 — full deployment","s":"todo"}]$j$::jsonb,
   $j$[{"t":"Tranche 1","v":"KES 1.2M","s":"Received"},{"t":"Tranche 2","v":"KES 1.0M","s":"On milestone 2"}]$j$::jsonb,
   $j$["Grant agreement","MoU — Makueni County","Q1 narrative report","M&E framework"]$j$::jsonb,
   false, 'active'),
  ('Sierra Leone (PICREF)', 'PICREF grant', 'Drawdown due', '$240k', '$61k', '25%', '2026', 'Wilson · partner',
   'Inception report · Aug', '—',
   $j$[{"t":"Proposal accepted (PICREF)","s":"done"},{"t":"Site selection sign-off","s":"now"},{"t":"Inception report","s":"todo"}]$j$::jsonb,
   $j$[{"t":"Inception tranche","v":"$61k","s":"Received"},{"t":"Tranche 2","v":"$80k","s":"Requested"}]$j$::jsonb,
   $j$["PICREF grant agreement","Proposal (submitted)","Budget"]$j$::jsonb,
   false, 'active'),
  ('Kiambu cluster', 'Blended', 'On track', 'KES 1.8M', 'KES 1.1M', '61%', '2026', 'Elizabeth · enumerators',
   'Quarterly', 'Readiness assessments complete',
   $j$[{"t":"Site visits complete","s":"done"},{"t":"Contracting","s":"now"},{"t":"Deployment","s":"todo"}]$j$::jsonb,
   $j$[{"t":"Tranche 1","v":"KES 1.1M","s":"Received"}]$j$::jsonb,
   $j$["Agreement","Readiness scoring pack"]$j$::jsonb,
   false, 'active'),
  ('5-County data collection', 'CCIQ / grant', 'Active', 'KES 2.1M', 'KES 1.4M', '67%', '2026', '12 enumerators',
   'Mid-term review · Sep', '214 assessments · 5 counties',
   $j$[{"t":"Enumerators recruited & trained","s":"done"},{"t":"Baseline data — 5 counties","s":"now"},{"t":"Analysis & report","s":"todo"}]$j$::jsonb,
   $j$[{"t":"Grant tranche 1","v":"KES 1.4M","s":"Received"}]$j$::jsonb,
   $j$["Data-collection grant","KoboToolbox XLSForm","Enumerator rubric"]$j$::jsonb,
   false, 'active'),
  ('EPC 5-site pilot', 'Grant', 'Active', '$19.8k', '$6k', '30%', '2026', 'Field team',
   'Pilot report', 'Installs underway',
   $j$[{"t":"5 sites selected","s":"done"},{"t":"Installation","s":"now"},{"t":"Monitoring & report","s":"todo"}]$j$::jsonb,
   $j$[{"t":"Tranche 1","v":"$6k","s":"Received"},{"t":"Tranche 2","v":"$8k","s":"On milestone"}]$j$::jsonb,
   $j$["EPC pilot grant budget","Pilot plan"]$j$::jsonb,
   false, 'active')
) as v(name, funder, status, budget_txt, spent_txt, pct, timeline, team, reporting, field, milestones, drawdowns, docs, is_extra, state)
on conflict (name) do nothing;

-- ---------- engagement ↔ project links (initialEngToProject / initialProjectToEng) ----------
insert into public.eng_project_links(eng_ref, project_name, is_primary) values
  ('DST-004', 'Makueni VTC rollout', true),
  ('DST-018', 'Kiambu cluster',      true),
  ('DST-011', 'Makueni VTC rollout', false)
on conflict (eng_ref) do nothing;

-- ---------- bank & petty cash ----------
with ke as (select id from public.entities where code = 'KE')
insert into public.bank_accounts(entity_id, name, number_mask, balance)
select ke.id, 'KCB — operating account', 'KCB ****4021', 4200000 from ke
where not exists (select 1 from public.bank_accounts);

with ke as (select id from public.entities where code = 'KE')
insert into public.petty_cash_floats(entity_id, custodian, balance)
select ke.id, 'Joan', 48200 from ke
where not exists (select 1 from public.petty_cash_floats);

-- ======== supabase/migrations/0004_phase2_inventory.sql ========
-- ============================================================
-- Jikoni Master PRD — Phase 2a: Inventory (net-new module)
-- stock ledger (typed movements, never edited), dispatches,
-- asset register with depreciation posting to GL, and the
-- reorder-below-threshold loop feeding back into Procure-to-Pay.
-- Idempotent: safe to re-run.
-- ============================================================

-- ---------- master data ----------
create table if not exists public.stock_locations (
  id         uuid primary key default gen_random_uuid(),
  entity_id  uuid references public.entities(id),
  name       text not null unique,
  kind       text not null default 'store' check (kind in ('store','site','transit')),
  state      text not null default 'active',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.stock_items (
  id            uuid primary key default gen_random_uuid(),
  entity_id     uuid references public.entities(id),
  sku           text not null unique,
  name          text not null,
  category      text,
  unit          text not null default 'unit',
  unit_cost     numeric not null default 0,
  reorder_level numeric not null default 0,
  reorder_qty   numeric not null default 0,
  budget_code   text references public.budget_lines(code),  -- coding for the auto-requisition
  auto_req_ref  text,                                       -- open auto-raised PR, cleared on restock
  state         text not null default 'active' check (state in ('active','discontinued')),
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

-- current quantity per item/location — maintained only by the movement RPCs
create table if not exists public.stock_levels (
  item_id     uuid not null references public.stock_items(id),
  location_id uuid not null references public.stock_locations(id),
  qty         numeric not null default 0,
  primary key (item_id, location_id)
);

-- ---------- the ledger: typed, append-only, never edited ----------
create table if not exists public.stock_movements (
  id            uuid primary key default gen_random_uuid(),
  entity_id     uuid references public.entities(id),
  item_id       uuid not null references public.stock_items(id),
  movement_type text not null check (movement_type in ('receipt','issue','transfer','adjustment')),
  qty           numeric not null,                 -- signed for adjustment, positive otherwise
  unit_cost     numeric,
  from_location uuid references public.stock_locations(id),
  to_location   uuid references public.stock_locations(id),
  source_type   text,                             -- 'grn' | 'dispatch' | 'manual' | 'count'
  source_ref    text,
  note          text,
  created_by    uuid references public.app_users(id),
  created_at    timestamptz not null default now()
);

create or replace function public.stock_ledger_immutable() returns trigger
language plpgsql as $$
begin
  raise exception 'stock_movements is a ledger — append only, post a correcting movement instead';
end $$;

drop trigger if exists ledger_no_edit on public.stock_movements;
create trigger ledger_no_edit
  before update or delete on public.stock_movements
  for each row execute function public.stock_ledger_immutable();

-- ---------- dispatches (linked to project / deployment) ----------
create table if not exists public.dispatches (
  id           uuid primary key default gen_random_uuid(),
  ref          text not null unique,
  entity_id    uuid references public.entities(id),
  project_name text references public.projects(name),
  destination  text not null,
  lines        jsonb not null default '[]'::jsonb,   -- [{sku, name, qty}]
  note         text,
  state        text not null default 'dispatched' check (state in ('draft','dispatched','delivered','cancelled')),
  created_by   uuid references public.app_users(id),
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);

-- ---------- asset register (straight-line depreciation → GL) ----------
create table if not exists public.assets (
  id            uuid primary key default gen_random_uuid(),
  ref           text not null unique,
  entity_id     uuid references public.entities(id),
  name          text not null,
  category      text,
  cost          numeric not null check (cost > 0),
  salvage       numeric not null default 0,
  life_months   int not null check (life_months > 0),
  acquired_on   date not null,
  accum_dep     numeric not null default 0,
  location_id   uuid references public.stock_locations(id),
  state         text not null default 'active' check (state in ('active','disposed')),
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

create table if not exists public.asset_depreciations (
  id        uuid primary key default gen_random_uuid(),
  asset_id  uuid not null references public.assets(id),
  period    text not null,                    -- 'YYYY-MM'
  amount    numeric not null,
  journal_ref text,
  created_at timestamptz not null default now(),
  unique (asset_id, period)
);

-- ---------- state machine + COA + counters ----------
insert into public.record_transitions(record_type, from_state, to_state) values
  ('dispatch','draft','dispatched'),
  ('dispatch','dispatched','delivered'),
  ('dispatch','draft','cancelled'),
  ('stock_item','active','discontinued'),
  ('asset','active','disposed')
on conflict do nothing;

do $$
declare r record;
begin
  for r in select * from (values
    ('dispatches','dispatch'), ('stock_items','stock_item'), ('assets','asset')
  ) as t(tbl, rtype)
  loop
    execute format('drop trigger if exists state_machine on public.%I', r.tbl);
    execute format('create trigger state_machine before update of state on public.%I
                    for each row execute function public.enforce_state_machine(%L)', r.tbl, r.rtype);
  end loop;
end $$;

with ke as (select id from public.entities where code = 'KE')
insert into public.chart_of_accounts(entity_id, code, name, kind)
select ke.id, v.* from ke, (values
  ('1250', 'Accumulated depreciation', 'asset'),
  ('1300', 'Fixed assets',             'asset'),
  ('5150', 'Depreciation expense',     'expense')
) as v(code, name, kind)
on conflict (entity_id, code) do nothing;

insert into public.ref_counters(kind, prefix, n) values
  ('DSP', 'DSP-', 100),
  ('AST', 'AST-', 100),
  ('MOV', 'MOV-', 1000)
on conflict (kind) do nothing;

-- ============================================================
-- Movement engine — one internal function keeps levels + ledger in step
-- ============================================================
create or replace function public.post_movement(
  p_item uuid, p_type text, p_qty numeric, p_unit_cost numeric,
  p_from uuid, p_to uuid, p_source_type text, p_source_ref text, p_note text
) returns void language plpgsql security definer set search_path = public as $$
declare
  v_entity uuid := (select id from public.entities where code = 'KE');
  v_actor uuid := (select id from public.app_users where auth_id = auth.uid());
  v_left numeric;
begin
  if p_type in ('receipt','issue','transfer') and p_qty <= 0 then
    raise exception 'Quantity must be positive for %', p_type;
  end if;
  insert into public.stock_movements(entity_id, item_id, movement_type, qty, unit_cost,
                                     from_location, to_location, source_type, source_ref, note, created_by)
  values (v_entity, p_item, p_type, p_qty, p_unit_cost, p_from, p_to, p_source_type, p_source_ref, p_note, v_actor);

  if p_from is not null then
    update public.stock_levels set qty = qty - abs(p_qty)
    where item_id = p_item and location_id = p_from
    returning qty into v_left;
    if v_left is null then
      raise exception 'No stock of this item at the source location';
    end if;
    if v_left < 0 then
      raise exception 'Insufficient stock at source location (short by %)', abs(v_left);
    end if;
  end if;
  if p_to is not null then
    insert into public.stock_levels(item_id, location_id, qty) values (p_item, p_to, abs(p_qty))
    on conflict (item_id, location_id) do update set qty = public.stock_levels.qty + abs(p_qty);
  end if;
  if p_type = 'adjustment' and p_from is null and p_to is null then
    raise exception 'Adjustment needs a location';
  end if;
end $$;

-- Reorder loop: below threshold → auto-raise a pre-filled requisition (back into B1)
create or replace function public.check_reorder(p_item uuid) returns text
language plpgsql security definer set search_path = public as $$
declare
  it record; on_hand numeric; req jsonb;
begin
  select * into it from public.stock_items where id = p_item;
  select coalesce(sum(qty), 0) into on_hand from public.stock_levels where item_id = p_item;
  if it.state = 'active' and it.reorder_level > 0 and on_hand < it.reorder_level
     and it.auto_req_ref is null and it.budget_code is not null and it.reorder_qty > 0 then
    req := public.submit_requisition(
      format('Restock %s — %s %s (auto: below reorder level %s, on hand %s)',
             it.name, it.reorder_qty, it.unit, it.reorder_level, on_hand),
      it.reorder_qty * it.unit_cost, it.budget_code);
    update public.stock_items set auto_req_ref = req->>'id' where id = p_item;
    perform public.audit_write('inventory.reorder_triggered','stock_item', it.sku,
      jsonb_build_object('onHand', on_hand, 'reorderLevel', it.reorder_level, 'requisition', req->>'id'));
    return req->>'id';
  end if;
  -- restocked above threshold → the loop is closed, allow future auto-reqs
  if on_hand >= it.reorder_level and it.auto_req_ref is not null then
    update public.stock_items set auto_req_ref = null where id = p_item;
  end if;
  return null;
end $$;

-- ============================================================
-- RPCs
-- ============================================================
create or replace function public.receive_stock(p_sku text, p_location text, p_qty numeric, p_unit_cost numeric default null, p_grn_ref text default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare it record; loc record;
begin
  perform public.assert_access('inventory', 2);
  select * into it from public.stock_items where sku = p_sku;
  if not found then raise exception 'Unknown stock item: %', p_sku; end if;
  select * into loc from public.stock_locations where name = p_location;
  if not found then raise exception 'Unknown location: %', p_location; end if;
  if p_grn_ref is not null and not exists (select 1 from public.goods_received_notes where ref = p_grn_ref) then
    raise exception 'Document chain: GRN % does not exist', p_grn_ref;
  end if;
  perform public.post_movement(it.id, 'receipt', p_qty, coalesce(p_unit_cost, it.unit_cost),
                               null, loc.id, case when p_grn_ref is null then 'manual' else 'grn' end, p_grn_ref, null);
  perform public.check_reorder(it.id);
  perform public.audit_write('inventory.received','stock_item', p_sku,
    jsonb_build_object('qty', p_qty, 'location', p_location, 'grn', p_grn_ref));
  return jsonb_build_object('sku', p_sku, 'onHand', (select sum(qty) from public.stock_levels where item_id = it.id));
end $$;

create or replace function public.issue_stock(p_sku text, p_location text, p_qty numeric, p_reason text default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare it record; loc record; auto text;
begin
  perform public.assert_access('inventory', 2);
  select * into it from public.stock_items where sku = p_sku;
  if not found then raise exception 'Unknown stock item: %', p_sku; end if;
  select * into loc from public.stock_locations where name = p_location;
  if not found then raise exception 'Unknown location: %', p_location; end if;
  perform public.post_movement(it.id, 'issue', p_qty, it.unit_cost, loc.id, null, 'manual', null, p_reason);
  auto := public.check_reorder(it.id);
  perform public.audit_write('inventory.issued','stock_item', p_sku,
    jsonb_build_object('qty', p_qty, 'location', p_location, 'reason', p_reason, 'autoRequisition', auto));
  return jsonb_build_object('sku', p_sku,
    'onHand', (select coalesce(sum(qty),0) from public.stock_levels where item_id = it.id),
    'autoRequisition', auto);
end $$;

create or replace function public.transfer_stock(p_sku text, p_from text, p_to text, p_qty numeric)
returns jsonb language plpgsql security definer set search_path = public as $$
declare it record; f uuid; t uuid;
begin
  perform public.assert_access('inventory', 2);
  select * into it from public.stock_items where sku = p_sku;
  if not found then raise exception 'Unknown stock item: %', p_sku; end if;
  select id into f from public.stock_locations where name = p_from;
  select id into t from public.stock_locations where name = p_to;
  if f is null or t is null then raise exception 'Unknown location'; end if;
  perform public.post_movement(it.id, 'transfer', p_qty, it.unit_cost, f, t, 'manual', null, null);
  perform public.audit_write('inventory.transferred','stock_item', p_sku,
    jsonb_build_object('qty', p_qty, 'from', p_from, 'to', p_to));
  return jsonb_build_object('sku', p_sku, 'from', p_from, 'to', p_to, 'qty', p_qty);
end $$;

create or replace function public.adjust_stock(p_sku text, p_location text, p_new_qty numeric, p_reason text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare it record; loc record; cur numeric; delta numeric;
begin
  perform public.assert_access('inventory', 3);   -- corrections need full access
  if coalesce(trim(p_reason), '') = '' then raise exception 'Adjustment requires a reason'; end if;
  select * into it from public.stock_items where sku = p_sku;
  if not found then raise exception 'Unknown stock item: %', p_sku; end if;
  select * into loc from public.stock_locations where name = p_location;
  if not found then raise exception 'Unknown location: %', p_location; end if;
  select coalesce(qty, 0) into cur from public.stock_levels where item_id = it.id and location_id = loc.id;
  cur := coalesce(cur, 0);
  delta := p_new_qty - cur;
  if delta = 0 then return jsonb_build_object('sku', p_sku, 'onHand', cur, 'delta', 0); end if;
  insert into public.stock_movements(entity_id, item_id, movement_type, qty, unit_cost,
                                     from_location, to_location, source_type, source_ref, note, created_by)
  values ((select id from public.entities where code='KE'), it.id, 'adjustment', delta, it.unit_cost,
          case when delta < 0 then loc.id end, case when delta > 0 then loc.id end, 'count', null, p_reason,
          (select id from public.app_users where auth_id = auth.uid()));
  insert into public.stock_levels(item_id, location_id, qty) values (it.id, loc.id, p_new_qty)
  on conflict (item_id, location_id) do update set qty = excluded.qty;
  perform public.check_reorder(it.id);
  perform public.audit_write('inventory.adjusted','stock_item', p_sku,
    jsonb_build_object('location', p_location, 'from', cur, 'to', p_new_qty, 'reason', p_reason));
  return jsonb_build_object('sku', p_sku, 'onHand', (select sum(qty) from public.stock_levels where item_id = it.id), 'delta', delta);
end $$;

create or replace function public.create_dispatch(p_project text, p_destination text, p_lines jsonb, p_note text default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_ref text; l jsonb; it record; store uuid;
  v_entity uuid := (select id from public.entities where code = 'KE');
  v_actor uuid := (select id from public.app_users where auth_id = auth.uid());
  enriched jsonb := '[]'::jsonb;
begin
  perform public.assert_access('inventory', 2);
  if p_project is not null and not exists (select 1 from public.projects where name = p_project) then
    raise exception 'Unknown project: %', p_project;
  end if;
  select id into store from public.stock_locations where kind = 'store' order by created_at limit 1;
  v_ref := public.next_ref('DSP');
  for l in select * from jsonb_array_elements(p_lines) loop
    select * into it from public.stock_items where sku = l->>'sku';
    if not found then raise exception 'Unknown stock item: %', l->>'sku'; end if;
    perform public.post_movement(it.id, 'issue', (l->>'qty')::numeric, it.unit_cost,
                                 store, null, 'dispatch', v_ref, p_destination);
    perform public.check_reorder(it.id);
    enriched := enriched || jsonb_build_object('sku', it.sku, 'name', it.name, 'qty', (l->>'qty')::numeric);
  end loop;
  insert into public.dispatches(ref, entity_id, project_name, destination, lines, note, created_by)
  values (v_ref, v_entity, p_project, p_destination, enriched, p_note, v_actor);
  perform public.audit_write('dispatch.created','dispatch', v_ref,
    jsonb_build_object('project', p_project, 'destination', p_destination, 'lines', enriched));
  return jsonb_build_object('id', v_ref, 'project', p_project, 'destination', p_destination, 'lines', enriched);
end $$;

create or replace function public.register_asset(p_name text, p_category text, p_cost numeric, p_life_months int, p_acquired date, p_salvage numeric default 0)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_ref text;
  v_entity uuid := (select id from public.entities where code = 'KE');
begin
  perform public.assert_access('inventory', 2);
  v_ref := public.next_ref('AST');
  insert into public.assets(ref, entity_id, name, category, cost, salvage, life_months, acquired_on)
  values (v_ref, v_entity, p_name, p_category, p_cost, p_salvage, p_life_months, p_acquired);
  perform public.audit_write('asset.registered','asset', v_ref,
    jsonb_build_object('name', p_name, 'cost', p_cost, 'lifeMonths', p_life_months));
  return jsonb_build_object('id', v_ref, 'name', p_name, 'cost', p_cost);
end $$;

-- Monthly depreciation run: one balanced journal per period per asset
create or replace function public.run_depreciation(p_period text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare a record; amt numeric; je text; total numeric := 0; n int := 0;
begin
  perform public.assert_access('finance', 3);
  if p_period !~ '^\d{4}-\d{2}$' then raise exception 'Period must be YYYY-MM'; end if;
  for a in select * from public.assets where state = 'active' loop
    amt := round((a.cost - a.salvage) / a.life_months, 2);
    if a.accum_dep + amt > a.cost - a.salvage then
      amt := (a.cost - a.salvage) - a.accum_dep;   -- final period truncates
    end if;
    if amt <= 0 then continue; end if;
    if exists (select 1 from public.asset_depreciations where asset_id = a.id and period = p_period) then
      continue;   -- already run for this period
    end if;
    je := public.post_journal(format('Depreciation %s — %s', p_period, a.name), 'asset', a.ref,
      jsonb_build_array(
        jsonb_build_object('account', '5150', 'debit', amt),
        jsonb_build_object('account', '1250', 'credit', amt)));
    insert into public.asset_depreciations(asset_id, period, amount, journal_ref) values (a.id, p_period, amt, je);
    update public.assets set accum_dep = accum_dep + amt where id = a.id;
    total := total + amt; n := n + 1;
  end loop;
  perform public.audit_write('depreciation.run','asset', p_period,
    jsonb_build_object('assets', n, 'total', total));
  return jsonb_build_object('period', p_period, 'assets', n, 'total', total);
end $$;

-- ---------- seed: locations + starter items (demo continuity with the views) ----------
with ke as (select id from public.entities where code = 'KE')
insert into public.stock_locations(entity_id, name, kind)
select ke.id, v.* from ke, (values
  ('Nairobi central store', 'store'),
  ('Makueni site store',    'site'),
  ('Kiambu site store',     'site')
) as v(name, kind)
on conflict (name) do nothing;

with ke as (select id from public.entities where code = 'KE')
insert into public.stock_items(entity_id, sku, name, category, unit, unit_cost, reorder_level, reorder_qty, budget_code)
select ke.id, v.* from ke, (values
  ('CKR-40',   'Institutional cooker — 40L',   'Cookstoves',  'unit', 58000, 10, 20, 'Deployment'),
  ('CKR-100',  'Institutional cooker — 100L',  'Cookstoves',  'unit', 96000, 6,  12, 'Deployment'),
  ('SPR-KIT',  'Cooker spares kit',            'Spares',      'kit',  7100,  15, 20, 'Operations'),
  ('CYL-13',   'LPG cylinder — 13kg',          'Fuel',        'unit', 3200,  30, 60, 'Deployment'),
  ('SEN-TMP',  'Temperature sensor (MRV)',     'MRV',         'unit', 1850,  25, 50, 'Field / MRV')
) as v(sku, name, category, unit, unit_cost, reorder_level, reorder_qty, budget_code)
on conflict (sku) do nothing;

-- opening balances (only on first run — levels empty)
do $$
declare store uuid;
begin
  select id into store from public.stock_locations where name = 'Nairobi central store';
  if not exists (select 1 from public.stock_levels) then
    insert into public.stock_levels(item_id, location_id, qty)
    select i.id, store, v.qty from public.stock_items i
    join (values ('CKR-40', 24), ('CKR-100', 9), ('SPR-KIT', 31), ('CYL-13', 74), ('SEN-TMP', 58)) as v(sku, qty)
      on v.sku = i.sku;
    insert into public.stock_movements(entity_id, item_id, movement_type, qty, unit_cost, to_location, source_type, note)
    select (select id from public.entities where code='KE'), i.id, 'receipt', l.qty, i.unit_cost, store, 'count', 'Opening balance'
    from public.stock_levels l join public.stock_items i on i.id = l.item_id;
  end if;
end $$;

-- a couple of assets so the register isn't empty
with ke as (select id from public.entities where code = 'KE')
insert into public.assets(ref, entity_id, name, category, cost, salvage, life_months, acquired_on)
select v.ref, ke.id, v.name, v.category, v.cost, v.salvage, v.life, v.acq::date from ke, (values
  ('AST-097', 'Toyota Hilux — field vehicle', 'Vehicles',  4800000, 800000, 96, '2025-03-01'),
  ('AST-098', 'Workshop tooling set',         'Equipment',  640000,      0, 60, '2025-06-01'),
  ('AST-099', 'Office laptops (×6)',          'IT',         720000,      0, 36, '2026-01-01')
) as v(ref, name, category, cost, salvage, life, acq)
on conflict (ref) do nothing;

-- ---------- RLS + grants ----------
do $$
declare t text;
begin
  foreach t in array array['stock_locations','stock_items','stock_levels','stock_movements',
                           'dispatches','assets','asset_depreciations']
  loop
    execute format('alter table public.%I enable row level security', t);
    execute format('drop policy if exists "read for authenticated" on public.%I', t);
    execute format('create policy "read for authenticated" on public.%I for select to authenticated using (true)', t);
  end loop;
end $$;

do $$
declare fn text;
begin
  foreach fn in array array[
    'receive_stock(text,text,numeric,numeric,text)','issue_stock(text,text,numeric,text)',
    'transfer_stock(text,text,text,numeric)','adjust_stock(text,text,numeric,text)',
    'create_dispatch(text,text,jsonb,text)','register_asset(text,text,numeric,int,date,numeric)',
    'run_depreciation(text)']
  loop
    execute format('revoke execute on function public.%s from public, anon', fn);
    execute format('grant execute on function public.%s to authenticated', fn);
  end loop;
  -- internal engines: not callable from the client at all
  revoke execute on function public.post_movement(uuid,text,numeric,numeric,uuid,uuid,text,text,text) from public, anon, authenticated;
  revoke execute on function public.check_reorder(uuid) from public, anon, authenticated;
end $$;

-- ======== supabase/migrations/0005_phase2_hr_payroll.sql ========
-- ============================================================
-- Jikoni Master PRD — Phase 2b: HR / Payroll (B4)
-- Staff files (KRA PIN/NSSF/SHIF, versioned docs), Leave
-- (application→approval, balances, policy), Payroll with statutory
-- rates AS CONFIG (they change), preparer ≠ approver checkpoint,
-- balanced journal to GL + payment file. Recruitment + field workforce
-- (enumerator rosters, per-diems, casual contracts — first-class).
-- Idempotent: safe to re-run.
-- ============================================================

-- ---------- SoD checkpoint (recorded from day one, enforced when enforce_sod flips) ----------
create or replace function public.assert_sod(p_rule text, p_other_actor uuid) returns void
language plpgsql security definer set search_path = public as $$
declare
  v_on boolean := coalesce((select value::text = 'true' from public.app_config where key = 'enforce_sod'), false);
  v_me uuid := (select id from public.app_users where auth_id = auth.uid());
begin
  if not v_on or v_me is null or p_other_actor is null then return; end if;
  if v_me = p_other_actor then
    raise exception 'Segregation of duties: % — the same person cannot do both steps', p_rule;
  end if;
end $$;

-- ---------- staff files ----------
create table if not exists public.staff_files (
  id            uuid primary key default gen_random_uuid(),
  entity_id     uuid references public.entities(id),
  app_user_id   uuid not null references public.app_users(id) unique,
  staff_no      text not null unique,
  kra_pin       text,
  nssf_no       text,
  shif_no       text,
  contract_type text not null default 'permanent' check (contract_type in ('permanent','fixed_term','casual','consultant')),
  start_date    date,
  gross_salary  numeric not null default 0,
  bank          text,
  docs          jsonb not null default '[]'::jsonb,   -- [{name, version, uploaded}] — versioned
  state         text not null default 'active' check (state in ('active','exited')),
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

-- ---------- leave ----------
create table if not exists public.leave_policies (
  kind          text primary key,             -- 'annual' | 'sick' | ...
  days_per_year numeric not null
);

create table if not exists public.leave_balances (
  app_user_id uuid not null references public.app_users(id),
  kind        text not null references public.leave_policies(kind),
  year        int  not null,
  entitled    numeric not null,
  used        numeric not null default 0,
  reserved    numeric not null default 0,     -- pending applications hold days
  primary key (app_user_id, kind, year)
);

create table if not exists public.leave_applications (
  id          uuid primary key default gen_random_uuid(),
  ref         text not null unique,
  entity_id   uuid references public.entities(id),
  app_user_id uuid not null references public.app_users(id),
  kind        text not null references public.leave_policies(kind),
  from_date   date not null,
  to_date     date not null,
  days        numeric not null check (days > 0),
  reason      text,
  approver_id uuid references public.app_users(id),
  state       text not null default 'pending' check (state in ('pending','approved','rejected','cancelled')),
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

-- ---------- payroll: statutory rates as config, not code ----------
create table if not exists public.statutory_rates (
  kind           text not null,
  value          jsonb not null,
  effective_from date not null,
  primary key (kind, effective_from)
);

create table if not exists public.payroll_runs (
  id           uuid primary key default gen_random_uuid(),
  ref          text not null unique,
  entity_id    uuid references public.entities(id),
  period       text not null unique,          -- 'YYYY-MM'
  prepared_by  uuid references public.app_users(id),
  approved_by  uuid references public.app_users(id),
  journal_ref  text,
  payment_file jsonb,                          -- generated at posting: [{staff, bank, net}]
  totals       jsonb,
  state        text not null default 'draft' check (state in ('draft','prepared','approved','posted')),
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);

create table if not exists public.payroll_items (
  id          uuid primary key default gen_random_uuid(),
  run_id      uuid not null references public.payroll_runs(id) on delete cascade,
  app_user_id uuid not null references public.app_users(id),
  gross       numeric not null,
  paye        numeric not null,
  nssf        numeric not null,
  shif        numeric not null,
  housing     numeric not null,
  net         numeric not null,
  unique (run_id, app_user_id)
);

-- ---------- recruitment (requisition → pipeline → onboarding) ----------
create table if not exists public.recruitment_reqs (
  id         uuid primary key default gen_random_uuid(),
  ref        text not null unique,
  entity_id  uuid references public.entities(id),
  role_title text not null,
  dept       text,
  state      text not null default 'open' check (state in ('open','shortlisting','offer','filled','closed')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.candidates (
  id             uuid primary key default gen_random_uuid(),
  recruitment_id uuid not null references public.recruitment_reqs(id) on delete cascade,
  name           text not null,
  email          text,
  stage          text not null default 'applied' check (stage in ('applied','screened','interviewed','offer','hired','rejected')),
  note           text,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);

-- ---------- field workforce (first-class, not an edge case) ----------
create table if not exists public.enumerators (
  id         uuid primary key default gen_random_uuid(),
  entity_id  uuid references public.entities(id),
  name       text not null,
  county     text,
  id_no      text,
  daily_rate numeric not null default 0,
  state      text not null default 'active' check (state in ('active','inactive')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.field_assignments (
  id            uuid primary key default gen_random_uuid(),
  entity_id     uuid references public.entities(id),
  enumerator_id uuid not null references public.enumerators(id),
  project_name  text references public.projects(name),
  period        text,                          -- 'YYYY-MM'
  days          numeric not null default 0,
  per_diem      numeric not null default 0,   -- total for the assignment
  contract_doc  text,                          -- casual contract reference
  state         text not null default 'planned' check (state in ('planned','active','complete','cancelled')),
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

-- ---------- transitions + COA + counters ----------
insert into public.record_transitions(record_type, from_state, to_state) values
  ('leave','pending','approved'),
  ('leave','pending','rejected'),
  ('leave','pending','cancelled'),
  ('payroll','draft','prepared'),
  ('payroll','prepared','approved'),
  ('payroll','approved','posted'),
  ('staff','active','exited'),
  ('recruitment','open','shortlisting'),
  ('recruitment','shortlisting','offer'),
  ('recruitment','offer','filled'),
  ('recruitment','open','closed'),
  ('recruitment','shortlisting','closed'),
  ('field_assignment','planned','active'),
  ('field_assignment','active','complete'),
  ('field_assignment','planned','cancelled'),
  ('enumerator','active','inactive'),
  ('enumerator','inactive','active')
on conflict do nothing;

do $$
declare r record;
begin
  for r in select * from (values
    ('leave_applications','leave'), ('payroll_runs','payroll'), ('staff_files','staff'),
    ('recruitment_reqs','recruitment'), ('field_assignments','field_assignment'), ('enumerators','enumerator')
  ) as t(tbl, rtype)
  loop
    execute format('drop trigger if exists state_machine on public.%I', r.tbl);
    execute format('create trigger state_machine before update of state on public.%I
                    for each row execute function public.enforce_state_machine(%L)', r.tbl, r.rtype);
  end loop;
end $$;

with ke as (select id from public.entities where code = 'KE')
insert into public.chart_of_accounts(entity_id, code, name, kind)
select ke.id, v.* from ke, (values
  ('5200', 'Payroll costs',           'expense'),
  ('2210', 'PAYE payable',            'liability'),
  ('2220', 'NSSF payable',            'liability'),
  ('2230', 'SHIF payable',            'liability'),
  ('2240', 'Housing levy payable',    'liability'),
  ('2250', 'Net salaries payable',    'liability')
) as v(code, name, kind)
on conflict (entity_id, code) do nothing;

insert into public.ref_counters(kind, prefix, n) values
  ('LV',  'LV-',  100),
  ('PRL', 'PRL-', 100),
  ('RCR', 'RCR-', 100)
on conflict (kind) do nothing;

-- Kenya statutory config (FY 2025/26 — update rows, not code, when rates change)
insert into public.statutory_rates(kind, value, effective_from) values
  ('paye', '{"relief": 2400, "bands": [
      {"upto": 24000,  "rate": 0.10},
      {"upto": 32333,  "rate": 0.25},
      {"upto": 500000, "rate": 0.30},
      {"upto": 800000, "rate": 0.325},
      {"upto": null,   "rate": 0.35}]}'::jsonb, '2023-07-01'),
  ('nssf', '{"rate": 0.06, "lel": 8000, "uel": 72000, "employer_match": true}'::jsonb, '2025-02-01'),
  ('shif', '{"rate": 0.0275, "min": 300}'::jsonb, '2024-10-01'),
  ('housing_levy', '{"employee": 0.015, "employer": 0.015}'::jsonb, '2024-03-19')
on conflict (kind, effective_from) do nothing;

-- ============================================================
-- Statutory calc engine — reads config, never hardcodes rates
-- ============================================================
create or replace function public.calc_payroll_item(p_gross numeric) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare
  cfg_paye jsonb; cfg_nssf jsonb; cfg_shif jsonb; cfg_hl jsonb;
  nssf numeric; shif numeric; housing numeric; taxable numeric;
  paye numeric := 0; prev numeric := 0; band jsonb; upto numeric; slice numeric;
begin
  select value into cfg_paye from public.statutory_rates where kind='paye'          and effective_from <= current_date order by effective_from desc limit 1;
  select value into cfg_nssf from public.statutory_rates where kind='nssf'          and effective_from <= current_date order by effective_from desc limit 1;
  select value into cfg_shif from public.statutory_rates where kind='shif'          and effective_from <= current_date order by effective_from desc limit 1;
  select value into cfg_hl   from public.statutory_rates where kind='housing_levy'  and effective_from <= current_date order by effective_from desc limit 1;

  nssf    := round((cfg_nssf->>'rate')::numeric * least(p_gross, (cfg_nssf->>'uel')::numeric), 2);
  shif    := round(greatest((cfg_shif->>'rate')::numeric * p_gross, (cfg_shif->>'min')::numeric), 2);
  housing := round((cfg_hl->>'employee')::numeric * p_gross, 2);
  taxable := greatest(p_gross - nssf - shif - housing, 0);   -- statutory deductions are allowable

  for band in select * from jsonb_array_elements(cfg_paye->'bands') loop
    upto := nullif(band->>'upto','')::numeric;
    slice := least(taxable, coalesce(upto, taxable)) - prev;
    exit when slice <= 0;
    paye := paye + slice * (band->>'rate')::numeric;
    prev := coalesce(upto, taxable);
  end loop;
  paye := greatest(round(paye - (cfg_paye->>'relief')::numeric, 2), 0);

  return jsonb_build_object('gross', p_gross, 'paye', paye, 'nssf', nssf, 'shif', shif,
    'housing', housing, 'net', p_gross - paye - nssf - shif - housing);
end $$;

-- ============================================================
-- Leave RPCs
-- ============================================================
create or replace function public.apply_leave(p_kind text, p_from date, p_to date, p_reason text default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_me uuid := (select id from public.app_users where auth_id = auth.uid());
  v_days numeric; v_ref text; bal record;
  v_year int := extract(year from p_from)::int;
  v_entity uuid := (select id from public.entities where code = 'KE');
begin
  if v_me is null then raise exception 'No staff record for this login'; end if;
  if p_to < p_from then raise exception 'End date is before start date'; end if;
  v_days := (p_to - p_from) + 1;
  select * into bal from public.leave_balances where app_user_id = v_me and kind = p_kind and year = v_year;
  if not found then raise exception 'No % leave balance for %', p_kind, v_year; end if;
  if v_days > bal.entitled - bal.used - bal.reserved then
    raise exception 'Insufficient balance: % days requested, % available', v_days, bal.entitled - bal.used - bal.reserved;
  end if;
  v_ref := public.next_ref('LV');
  insert into public.leave_applications(ref, entity_id, app_user_id, kind, from_date, to_date, days, reason)
  values (v_ref, v_entity, v_me, p_kind, p_from, p_to, v_days, p_reason);
  update public.leave_balances set reserved = reserved + v_days
  where app_user_id = v_me and kind = p_kind and year = v_year;
  perform public.audit_write('leave.applied','leave', v_ref,
    jsonb_build_object('kind', p_kind, 'from', p_from, 'to', p_to, 'days', v_days));
  return jsonb_build_object('id', v_ref, 'days', v_days, 'state', 'pending');
end $$;

create or replace function public.decide_leave(p_ref text, p_approve boolean, p_note text default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  l record;
  v_me uuid := (select id from public.app_users where auth_id = auth.uid());
  v_year int;
begin
  perform public.assert_access('hr', 2);
  select * into l from public.leave_applications where ref = p_ref;
  if not found then raise exception 'Leave application % not found', p_ref; end if;
  perform public.assert_sod('leave approval (applicant ≠ approver)', l.app_user_id);
  v_year := extract(year from l.from_date)::int;
  if p_approve then
    update public.leave_applications set state = 'approved', approver_id = v_me where id = l.id;
    update public.leave_balances set reserved = reserved - l.days, used = used + l.days
    where app_user_id = l.app_user_id and kind = l.kind and year = v_year;
  else
    update public.leave_applications set state = 'rejected', approver_id = v_me, reason = coalesce(p_note, reason) where id = l.id;
    update public.leave_balances set reserved = reserved - l.days
    where app_user_id = l.app_user_id and kind = l.kind and year = v_year;
  end if;
  perform public.audit_write(case when p_approve then 'leave.approved' else 'leave.rejected' end, 'leave', p_ref,
    jsonb_build_object('days', l.days, 'note', p_note));
  return jsonb_build_object('id', p_ref, 'state', case when p_approve then 'approved' else 'rejected' end);
end $$;

-- ============================================================
-- Payroll RPCs — Draft → Prepared → Approved → Posted
-- ============================================================
create or replace function public.prepare_payroll(p_period text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_ref text; v_run uuid; s record; item jsonb;
  t_gross numeric := 0; t_net numeric := 0; n int := 0;
  v_me uuid := (select id from public.app_users where auth_id = auth.uid());
  v_entity uuid := (select id from public.entities where code = 'KE');
begin
  perform public.assert_access('hr', 3);
  if p_period !~ '^\d{4}-\d{2}$' then raise exception 'Period must be YYYY-MM'; end if;
  if exists (select 1 from public.payroll_runs where period = p_period) then
    raise exception 'Payroll for % already exists', p_period;
  end if;
  v_ref := public.next_ref('PRL');
  insert into public.payroll_runs(ref, entity_id, period, prepared_by)
  values (v_ref, v_entity, p_period, v_me) returning id into v_run;
  for s in select sf.*, u.name from public.staff_files sf
           join public.app_users u on u.id = sf.app_user_id
           where sf.state = 'active' and sf.gross_salary > 0 loop
    item := public.calc_payroll_item(s.gross_salary);
    insert into public.payroll_items(run_id, app_user_id, gross, paye, nssf, shif, housing, net)
    values (v_run, s.app_user_id, (item->>'gross')::numeric, (item->>'paye')::numeric,
            (item->>'nssf')::numeric, (item->>'shif')::numeric, (item->>'housing')::numeric, (item->>'net')::numeric);
    t_gross := t_gross + (item->>'gross')::numeric;
    t_net := t_net + (item->>'net')::numeric;
    n := n + 1;
  end loop;
  update public.payroll_runs set state = 'prepared',
    totals = jsonb_build_object('staff', n, 'gross', t_gross, 'net', t_net) where id = v_run;
  perform public.audit_write('payroll.prepared','payroll', v_ref,
    jsonb_build_object('period', p_period, 'staff', n, 'gross', t_gross));
  return jsonb_build_object('id', v_ref, 'period', p_period, 'staff', n, 'gross', t_gross, 'net', t_net);
end $$;

create or replace function public.approve_payroll(p_ref text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare r record;
  v_me uuid := (select id from public.app_users where auth_id = auth.uid());
begin
  perform public.assert_access('hr', 3);
  select * into r from public.payroll_runs where ref = p_ref;
  if not found then raise exception 'Payroll run % not found', p_ref; end if;
  perform public.assert_sod('payroll (preparer ≠ approver)', r.prepared_by);
  update public.payroll_runs set state = 'approved', approved_by = v_me where id = r.id;
  perform public.audit_write('payroll.approved','payroll', p_ref, r.totals);
  return jsonb_build_object('id', p_ref, 'state', 'approved');
end $$;

-- Posts ONE balanced journal (the same row the GL reads — never copied) + payment file
create or replace function public.post_payroll(p_ref text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  r record; je text; pf jsonb;
  t_gross numeric; t_paye numeric; t_nssf numeric; t_shif numeric; t_housing numeric; t_net numeric;
  er_nssf numeric; er_housing numeric;
  cfg_nssf jsonb; cfg_hl jsonb;
begin
  perform public.assert_access('finance', 3);
  select * into r from public.payroll_runs where ref = p_ref;
  if not found then raise exception 'Payroll run % not found', p_ref; end if;
  if r.state <> 'approved' then raise exception 'Document chain: % must be approved before posting (state: %)', p_ref, r.state; end if;

  select sum(gross), sum(paye), sum(nssf), sum(shif), sum(housing), sum(net)
    into t_gross, t_paye, t_nssf, t_shif, t_housing, t_net
  from public.payroll_items where run_id = r.id;

  select value into cfg_nssf from public.statutory_rates where kind='nssf' and effective_from <= current_date order by effective_from desc limit 1;
  select value into cfg_hl from public.statutory_rates where kind='housing_levy' and effective_from <= current_date order by effective_from desc limit 1;
  er_nssf := case when (cfg_nssf->>'employer_match')::boolean then t_nssf else 0 end;
  er_housing := round(t_gross * (cfg_hl->>'employer')::numeric, 2);

  je := public.post_journal('Payroll ' || r.period, 'payroll', p_ref, jsonb_build_array(
    jsonb_build_object('account','5200','debit',  t_gross + er_nssf + er_housing),
    jsonb_build_object('account','2210','credit', t_paye),
    jsonb_build_object('account','2220','credit', t_nssf + er_nssf),
    jsonb_build_object('account','2230','credit', t_shif),
    jsonb_build_object('account','2240','credit', t_housing + er_housing),
    jsonb_build_object('account','2250','credit', t_net)));

  select jsonb_agg(jsonb_build_object('staff', u.name, 'bank', sf.bank, 'net', i.net) order by u.name)
    into pf
  from public.payroll_items i
  join public.app_users u on u.id = i.app_user_id
  join public.staff_files sf on sf.app_user_id = i.app_user_id
  where i.run_id = r.id;

  update public.payroll_runs set state = 'posted', journal_ref = je, payment_file = pf where id = r.id;
  perform public.audit_write('payroll.posted','payroll', p_ref,
    jsonb_build_object('journal', je, 'gross', t_gross, 'net', t_net));
  return jsonb_build_object('id', p_ref, 'journal', je, 'paymentFile', pf);
end $$;

-- ---------- staff portal: strictly self-scoped ----------
create or replace function public.my_hr_summary()
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare
  v_me uuid := (select id from public.app_users where auth_id = auth.uid());
begin
  if v_me is null then return '{}'::jsonb; end if;
  return jsonb_build_object(
    'leave', coalesce((select jsonb_agg(jsonb_build_object(
        'kind', kind, 'year', year, 'entitled', entitled, 'used', used, 'reserved', reserved))
      from public.leave_balances where app_user_id = v_me), '[]'::jsonb),
    'applications', coalesce((select jsonb_agg(jsonb_build_object(
        'id', ref, 'kind', kind, 'from', from_date, 'to', to_date, 'days', days, 'state', state)
        order by created_at desc)
      from public.leave_applications where app_user_id = v_me), '[]'::jsonb),
    'payslips', coalesce((select jsonb_agg(jsonb_build_object(
        'period', pr.period, 'gross', i.gross, 'paye', i.paye, 'nssf', i.nssf,
        'shif', i.shif, 'housing', i.housing, 'net', i.net) order by pr.period desc)
      from public.payroll_items i join public.payroll_runs pr on pr.id = i.run_id
      where i.app_user_id = v_me and pr.state = 'posted'), '[]'::jsonb),
    'docs', coalesce((select docs from public.staff_files where app_user_id = v_me), '[]'::jsonb));
end $$;

-- ---------- seeds ----------
insert into public.leave_policies(kind, days_per_year) values
  ('annual', 21), ('sick', 14), ('compassionate', 5)
on conflict (kind) do nothing;

with ke as (select id from public.entities where code = 'KE')
insert into public.staff_files(entity_id, app_user_id, staff_no, kra_pin, nssf_no, shif_no, contract_type, start_date, gross_salary, bank, docs)
select ke.id, u.id, v.staff_no, v.kra, v.nssf, v.shif, 'permanent', v.start::date, v.gross, v.bank,
       jsonb_build_array(jsonb_build_object('name','Employment contract','version',1,'uploaded',v.start))
from ke, (values
  ('dennis@ignis.africa',    'IGN-001', 'A012345678D', 'NSSF-10441', 'SHIF-20441', '2024-01-01', 450000, 'KCB ****1101'),
  ('wanjiku@ignis.africa',   'IGN-002', 'A023456789W', 'NSSF-10442', 'SHIF-20442', '2024-01-01', 300000, 'Equity ****2202'),
  ('brian@ignis.africa',     'IGN-003', 'A034567890B', 'NSSF-10443', 'SHIF-20443', '2024-03-01', 320000, 'KCB ****3303'),
  ('joan@ignis.africa',      'IGN-004', 'A045678901J', 'NSSF-10444', 'SHIF-20444', '2024-06-01', 280000, 'Co-op ****4404'),
  ('wilson@ignis.africa',    'IGN-005', 'A056789012W', 'NSSF-10445', 'SHIF-20445', '2025-01-01', 260000, 'KCB ****5505'),
  ('elizabeth@ignis.africa', 'IGN-006', 'A067890123E', 'NSSF-10446', 'SHIF-20446', '2025-02-01', 240000, 'Equity ****6606'),
  ('lily@ignis.africa',      'IGN-007', 'A078901234L', 'NSSF-10447', 'SHIF-20447', '2025-09-01', 180000, 'KCB ****7707')
) as v(email, staff_no, kra, nssf, shif, start, gross, bank)
join public.app_users u on u.email = v.email
on conflict (app_user_id) do nothing;

insert into public.leave_balances(app_user_id, kind, year, entitled, used)
select u.id, p.kind, 2026, p.days_per_year,
       case when p.kind = 'annual' then (abs(hashtext(u.email)) % 8) else 0 end
from public.app_users u cross join public.leave_policies p
on conflict (app_user_id, kind, year) do nothing;

with ke as (select id from public.entities where code = 'KE')
insert into public.recruitment_reqs(ref, entity_id, role_title, dept, state)
select v.ref, ke.id, v.role_title, v.dept, v.state from ke, (values
  ('RCR-101', 'Field Operations Coordinator', 'Operations', 'shortlisting'),
  ('RCR-102', 'Grants & Reporting Officer',   'Finance',    'open')
) as v(ref, role_title, dept, state)
on conflict (ref) do nothing;

with ke as (select id from public.entities where code = 'KE')
insert into public.enumerators(entity_id, name, county, id_no, daily_rate)
select ke.id, v.* from ke, (values
  ('Peter Otieno',   'Makueni', 'ID-2210441', 1800),
  ('Grace Wambui',   'Kiambu',  'ID-2210442', 1800),
  ('Samuel Kilonzo', 'Makueni', 'ID-2210443', 1800),
  ('Aisha Noor',     'Machakos','ID-2210444', 2000)
) as v(name, county, id_no, daily_rate)
where not exists (select 1 from public.enumerators);

-- ---------- RLS + grants ----------
do $$
declare t text;
begin
  foreach t in array array['staff_files','leave_policies','leave_balances','leave_applications',
    'statutory_rates','payroll_runs','payroll_items','recruitment_reqs','candidates',
    'enumerators','field_assignments']
  loop
    execute format('alter table public.%I enable row level security', t);
    execute format('drop policy if exists "read for authenticated" on public.%I', t);
    execute format('create policy "read for authenticated" on public.%I for select to authenticated using (true)', t);
  end loop;
end $$;

do $$
declare fn text;
begin
  foreach fn in array array[
    'apply_leave(text,date,date,text)','decide_leave(text,boolean,text)',
    'prepare_payroll(text)','approve_payroll(text)','post_payroll(text)',
    'calc_payroll_item(numeric)','my_hr_summary()']
  loop
    execute format('revoke execute on function public.%s from public, anon', fn);
    execute format('grant execute on function public.%s to authenticated', fn);
  end loop;
end $$;

-- ======== supabase/migrations/0006_phase3_growth.sql ========
-- ============================================================
-- Jikoni Master PRD — Phase 3: Growth & delivery (CRM, Projects, Fundraise)
-- Normalized milestones/drawdowns (one source of truth; bootstrap rebuilds
-- the jsonb shapes the UI reads), field activity, engagement updates/tasks,
-- Raise pipeline (Discovery → Committed), term sheets reconciled to SIGNED
-- instruments vs the $3M target, data room with time-boxed logged access,
-- diligence (DDQ) tracker. Idempotent: safe to re-run.
-- ============================================================

-- ---------- projects: normalize milestones & drawdowns out of jsonb ----------
create table if not exists public.project_milestones (
  id         uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects(id) on delete cascade,
  title      text not null,
  status     text not null default 'todo' check (status in ('done','now','todo')),
  sort       int not null default 0,
  created_at timestamptz not null default now()
);

create table if not exists public.project_drawdowns (
  id         uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects(id) on delete cascade,
  title      text not null,
  amount_txt text not null,
  status     text not null default 'Requested',
  sort       int not null default 0,
  created_at timestamptz not null default now()
);

create table if not exists public.field_activities (
  id         uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects(id) on delete cascade,
  kind       text not null check (kind in ('site_visit','install','readiness_assessment')),
  county     text,
  note       text,
  activity_on date not null default current_date,
  created_at timestamptz not null default now()
);

-- migrate the seeded jsonb into rows once, then rows are the source of truth
do $$
declare p record; m jsonb; d jsonb; i int;
begin
  if not exists (select 1 from public.project_milestones) then
    for p in select * from public.projects loop
      i := 0;
      for m in select * from jsonb_array_elements(p.milestones) loop
        i := i + 1;
        insert into public.project_milestones(project_id, title, status, sort)
        values (p.id, m->>'t', m->>'s', i);
      end loop;
      i := 0;
      for d in select * from jsonb_array_elements(p.drawdowns) loop
        i := i + 1;
        insert into public.project_drawdowns(project_id, title, amount_txt, status, sort)
        values (p.id, d->>'t', d->>'v', d->>'s', i);
      end loop;
    end loop;
  end if;
end $$;

-- rebuild helpers so every reader sees one truth
create or replace function public.project_detail_json(p_id uuid) returns jsonb
language sql stable security definer set search_path = public as $$
  select jsonb_build_object(
    'funder', p.funder, 'status', p.status, 'budget', p.budget_txt, 'spent', p.spent_txt,
    'pct', p.pct, 'timeline', p.timeline, 'team', p.team, 'reporting', p.reporting, 'field', p.field,
    'docs', p.docs,
    'milestones', coalesce((select jsonb_agg(jsonb_build_object('t', title, 's', status) order by sort)
                            from public.project_milestones where project_id = p.id), '[]'::jsonb),
    'drawdowns',  coalesce((select jsonb_agg(jsonb_build_object('t', title, 'v', amount_txt, 's', status) order by sort)
                            from public.project_drawdowns where project_id = p.id), '[]'::jsonb))
  from public.projects p where p.id = p_id
$$;

-- ---------- CRM: engagement updates + linked tasks + docs (backing engDetails) ----------
create table if not exists public.engagement_updates (
  id            uuid primary key default gen_random_uuid(),
  engagement_id uuid not null references public.engagements(id) on delete cascade,
  channel       text not null default 'Email',
  who           text,
  note          text not null,
  happened      text,                          -- display string ('Today', '3 days ago' in demo)
  created_at    timestamptz not null default now()
);

create or replace function public.log_engagement_update(p_eng_ref text, p_channel text, p_note text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare e record; v_who text;
begin
  perform public.assert_access('crm', 2);
  select * into e from public.engagements where ref = p_eng_ref;
  if not found then raise exception 'Engagement % not found', p_eng_ref; end if;
  v_who := coalesce((select name from public.app_users where auth_id = auth.uid()), 'system');
  insert into public.engagement_updates(engagement_id, channel, who, note, happened)
  values (e.id, p_channel, v_who, p_note, 'Today');
  perform public.audit_write('engagement.updated','engagement', p_eng_ref,
    jsonb_build_object('channel', p_channel, 'note', p_note));
  return jsonb_build_object('eng', p_eng_ref, 'channel', p_channel, 'who', v_who);
end $$;

-- ---------- Fundraise (B6): pipeline → term sheets → data room → DDQ → close ----------
create table if not exists public.raise_pipeline (
  id         uuid primary key default gen_random_uuid(),
  entity_id  uuid references public.entities(id),
  funder     text not null unique,
  kind       text not null,                    -- Blended / Concessional debt / Equity / Grant / Programme
  stage      text not null default 'discovery'
             check (stage in ('discovery','materials','negotiation','term_sheet','committed','holding','passed')),
  amount_usd numeric not null default 0,
  owner_name text,
  note       text,
  state      text not null default 'active' check (state in ('active','won','lost')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.term_sheets (
  id          uuid primary key default gen_random_uuid(),
  ref         text not null unique,
  entity_id   uuid references public.entities(id),
  pipeline_id uuid not null references public.raise_pipeline(id),
  amount_usd  numeric not null check (amount_usd > 0),
  instrument  text not null check (instrument in ('equity','concessional','grant','blended')),
  state       text not null default 'draft' check (state in ('draft','issued','signed','lapsed')),
  signed_on   date,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

create table if not exists public.dataroom_grants (
  id         uuid primary key default gen_random_uuid(),
  entity_id  uuid references public.entities(id),
  grantee    text not null,                    -- funder / email
  expires_at timestamptz not null,             -- time-boxed
  state      text not null default 'active' check (state in ('active','revoked','expired')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.dataroom_access_log (
  id         bigint generated always as identity primary key,
  grant_id   uuid references public.dataroom_grants(id),
  grantee    text not null,
  document   text not null,                    -- every document open is logged
  opened_at  timestamptz not null default now()
);

create table if not exists public.diligence_requests (
  id          uuid primary key default gen_random_uuid(),
  ref         text not null unique,
  entity_id   uuid references public.entities(id),
  pipeline_id uuid references public.raise_pipeline(id),
  item        text not null,
  state       text not null default 'open' check (state in ('open','provided','closed')),
  due_on      date,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

-- ---------- transitions + counters ----------
insert into public.record_transitions(record_type, from_state, to_state) values
  ('pipeline','active','won'), ('pipeline','active','lost'),
  ('term_sheet','draft','issued'), ('term_sheet','issued','signed'), ('term_sheet','issued','lapsed'),
  ('dataroom_grant','active','revoked'), ('dataroom_grant','active','expired'),
  ('ddq','open','provided'), ('ddq','provided','closed'), ('ddq','open','closed')
on conflict do nothing;

do $$
declare r record;
begin
  for r in select * from (values
    ('raise_pipeline','pipeline'), ('term_sheets','term_sheet'),
    ('dataroom_grants','dataroom_grant'), ('diligence_requests','ddq')
  ) as t(tbl, rtype)
  loop
    execute format('drop trigger if exists state_machine on public.%I', r.tbl);
    execute format('create trigger state_machine before update of state on public.%I
                    for each row execute function public.enforce_state_machine(%L)', r.tbl, r.rtype);
  end loop;
end $$;

insert into public.ref_counters(kind, prefix, n) values
  ('TS',  'TS-',  100),
  ('DDQ', 'DDQ-', 100)
on conflict (kind) do nothing;

insert into public.app_config(key, value) values
  ('raise_target_usd', '3000000'::jsonb)
on conflict (key) do nothing;

-- ---------- engines ----------
-- Committed total reconciles to SIGNED instruments, not pipeline optimism
create or replace function public.raise_summary() returns jsonb
language sql stable security definer set search_path = public as $$
  select jsonb_build_object(
    'targetUsd', (select value::numeric from public.app_config where key = 'raise_target_usd'),
    'committedUsd', coalesce((select sum(amount_usd) from public.term_sheets where state = 'signed'), 0),
    'equityUsd', coalesce((select sum(amount_usd) from public.term_sheets where state = 'signed' and instrument = 'equity'), 0),
    'concessionalUsd', coalesce((select sum(amount_usd) from public.term_sheets
                                 where state = 'signed' and instrument in ('concessional','grant','blended')), 0),
    'inNegotiationUsd', coalesce((select sum(amount_usd) from public.raise_pipeline
                                  where stage in ('negotiation','term_sheet') and state = 'active'), 0))
$$;

create or replace function public.issue_term_sheet(p_funder text, p_amount_usd numeric, p_instrument text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare pl record; v_ref text;
  v_entity uuid := (select id from public.entities where code = 'KE');
begin
  perform public.assert_access('raise', 2);
  select * into pl from public.raise_pipeline where funder = p_funder;
  if not found then raise exception 'Funder % is not in the pipeline', p_funder; end if;
  v_ref := public.next_ref('TS');
  insert into public.term_sheets(ref, entity_id, pipeline_id, amount_usd, instrument, state)
  values (v_ref, v_entity, pl.id, p_amount_usd, p_instrument, 'issued');
  update public.raise_pipeline set stage = 'term_sheet' where id = pl.id and stage <> 'committed';
  perform public.audit_write('term_sheet.issued','term_sheet', v_ref,
    jsonb_build_object('funder', p_funder, 'amountUsd', p_amount_usd, 'instrument', p_instrument));
  return jsonb_build_object('id', v_ref, 'funder', p_funder);
end $$;

create or replace function public.sign_term_sheet(p_ref text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare ts record; pl record;
begin
  perform public.assert_access('raise', 3);
  select * into ts from public.term_sheets where ref = p_ref;
  if not found then raise exception 'Term sheet % not found', p_ref; end if;
  update public.term_sheets set state = 'signed', signed_on = current_date where id = ts.id;
  select * into pl from public.raise_pipeline where id = ts.pipeline_id;
  update public.raise_pipeline set stage = 'committed', state = 'won' where id = pl.id and state = 'active';
  perform public.audit_write('term_sheet.signed','term_sheet', p_ref,
    jsonb_build_object('funder', pl.funder, 'amountUsd', ts.amount_usd) || public.raise_summary());
  return public.raise_summary() || jsonb_build_object('id', p_ref);
end $$;

-- Data room: grant is time-boxed; every open is logged (and gate-checked)
create or replace function public.grant_dataroom(p_grantee text, p_days int default 14)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_id uuid;
  v_entity uuid := (select id from public.entities where code = 'KE');
begin
  perform public.assert_access('dataroom', 3);
  insert into public.dataroom_grants(entity_id, grantee, expires_at)
  values (v_entity, p_grantee, now() + make_interval(days => p_days)) returning id into v_id;
  perform public.audit_write('dataroom.granted','dataroom_grant', p_grantee,
    jsonb_build_object('days', p_days));
  return jsonb_build_object('grantee', p_grantee, 'expiresInDays', p_days);
end $$;

create or replace function public.log_dataroom_open(p_grantee text, p_document text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare g record;
begin
  select * into g from public.dataroom_grants
  where grantee = p_grantee and state = 'active' order by created_at desc limit 1;
  if not found then raise exception 'No data-room access for %', p_grantee; end if;
  if g.expires_at < now() then
    update public.dataroom_grants set state = 'expired' where id = g.id;
    raise exception 'Data-room access for % expired %', p_grantee, g.expires_at::date;
  end if;
  insert into public.dataroom_access_log(grant_id, grantee, document) values (g.id, p_grantee, p_document);
  perform public.audit_write('dataroom.opened','dataroom_grant', p_grantee,
    jsonb_build_object('document', p_document));
  return jsonb_build_object('grantee', p_grantee, 'document', p_document);
end $$;

-- ---------- seeds: pipeline from the funders board ----------
with ke as (select id from public.entities where code = 'KE')
insert into public.raise_pipeline(entity_id, funder, kind, stage, amount_usd, owner_name, note)
select ke.id, v.* from ke, (values
  ('Charm Impact',   'Blended',           'term_sheet',  500000, 'Wilson', 'Term sheet received; reviewing terms'),
  ('EAIF',           'Concessional debt', 'negotiation', 800000, 'Wilson', 'Concessional call scheduled'),
  ('KIICO',          'Equity',            'materials',   550000, 'Wilson', null),
  ('RPFF / AfDB',    'Concessional',      'discovery',   500000, 'Wilson', null),
  ('FCDO',           'Grant / TA',        'discovery',   350000, 'Wilson', null),
  ('Signum Capital', 'Equity',            'holding',          0, 'Wilson', 'Wants an anchor investor first'),
  ('UNDP / WAIIS',   'Programme',         'discovery',   300000, 'Wilson', null)
) as v(funder, kind, stage, amount_usd, owner_name, note)
on conflict (funder) do nothing;

with ke as (select id from public.entities where code = 'KE')
insert into public.diligence_requests(ref, entity_id, pipeline_id, item, state, due_on)
select v.ref, ke.id, p.id, v.item, v.state, v.due::date
from ke, (values
  ('DDQ-101', 'Charm Impact', 'Audited accounts FY2025',        'provided', '2026-06-20'),
  ('DDQ-102', 'Charm Impact', 'Cap table + shareholder deeds',  'open',     '2026-07-15'),
  ('DDQ-103', 'EAIF',         'ESG & safeguarding policy',      'open',     '2026-07-30')
) as v(ref, funder, item, state, due)
join public.raise_pipeline p on p.funder = v.funder
on conflict (ref) do nothing;

-- ---------- keep create_project_from_eng writing normalized rows ----------
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
    insert into public.projects(entity_id, name, funder, status, team, is_extra, docs)
    values (v_entity, v_name, e.name, 'Setup', e.owner_name, true,
            jsonb_build_array('Signed agreement (from ' || p_eng_ref || ')'))
    returning * into p;
    insert into public.project_milestones(project_id, title, status, sort) values
      (p.id, 'Project set up from won deal', 'done', 1),
      (p.id, 'Budget & funder agreement',    'now',  2),
      (p.id, 'Deployment',                   'todo', 3);
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
    'detail', public.project_detail_json(p.id));
end $$;

-- bootstrap: projects now come from the normalized rows
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
    'projects', coalesce((select jsonb_object_agg(name, public.project_detail_json(id))
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
      from public.budget_lines), '{}'::jsonb),
    'inventory', jsonb_build_object(
      'items', coalesce((select jsonb_agg(jsonb_build_object(
          'sku', i.sku, 'name', i.name, 'category', i.category, 'unit', i.unit,
          'unitCost', i.unit_cost, 'reorderLevel', i.reorder_level,
          'onHand', coalesce((select sum(qty) from public.stock_levels where item_id = i.id), 0),
          'autoReq', i.auto_req_ref) order by i.sku)
        from public.stock_items i where i.state = 'active'), '[]'::jsonb),
      'locations', coalesce((select jsonb_agg(name order by name) from public.stock_locations where state='active'), '[]'::jsonb),
      'movements', coalesce((select jsonb_agg(jsonb_build_object(
          'when', to_char(m.created_at, 'DD Mon HH24:MI'), 'sku', i.sku, 'type', m.movement_type,
          'qty', m.qty, 'from', fl.name, 'to', tl.name, 'source', m.source_ref, 'note', m.note) order by m.created_at desc)
        from (select * from public.stock_movements order by created_at desc limit 40) m
        join public.stock_items i on i.id = m.item_id
        left join public.stock_locations fl on fl.id = m.from_location
        left join public.stock_locations tl on tl.id = m.to_location), '[]'::jsonb),
      'dispatches', coalesce((select jsonb_agg(jsonb_build_object(
          'id', ref, 'project', project_name, 'destination', destination, 'lines', lines, 'state', state)
          order by created_at desc)
        from public.dispatches), '[]'::jsonb),
      'assets', coalesce((select jsonb_agg(jsonb_build_object(
          'id', ref, 'name', name, 'category', category, 'cost', cost, 'accumDep', accum_dep,
          'nbv', cost - accum_dep, 'acquired', to_char(acquired_on, 'Mon YYYY'), 'state', state)
          order by ref)
        from public.assets), '[]'::jsonb))
  );
end $$;

-- ---------- RLS + grants ----------
do $$
declare t text;
begin
  foreach t in array array['project_milestones','project_drawdowns','field_activities',
    'engagement_updates','raise_pipeline','term_sheets','dataroom_grants',
    'dataroom_access_log','diligence_requests']
  loop
    execute format('alter table public.%I enable row level security', t);
    execute format('drop policy if exists "read for authenticated" on public.%I', t);
    execute format('create policy "read for authenticated" on public.%I for select to authenticated using (true)', t);
  end loop;
end $$;

do $$
declare fn text;
begin
  foreach fn in array array[
    'log_engagement_update(text,text,text)','raise_summary()',
    'issue_term_sheet(text,numeric,text)','sign_term_sheet(text)',
    'grant_dataroom(text,int)','log_dataroom_open(text,text)']
  loop
    execute format('revoke execute on function public.%s from public, anon', fn);
    execute format('grant execute on function public.%s to authenticated', fn);
  end loop;
end $$;

-- ======== supabase/migrations/0007_phase4_compliance.sql ========
-- ============================================================
-- Jikoni Master PRD — Phase 4: Compliance, reporting, integrations
-- Versioned policies, company documents with expiry flags, compliance
-- calendar (statutory obligations + due dates), risk register, contracts
-- registry (used by Procurement + CRM). Integration plumbing: eTIMS
-- files on EVERY sales invoice issue, M-Pesa payment intents, sanctions
-- screening API log. Real HTTP calls live in serverless functions later;
-- the queue tables + document chain are wired now. Idempotent.
-- ============================================================

-- ---------- policies & manuals (versioned) ----------
create table if not exists public.policies (
  id             uuid primary key default gen_random_uuid(),
  code           text not null,                 -- 'IGN-PROC-001'
  title          text not null,
  version        int not null default 1,
  effective_from date,
  doc            text,
  state          text not null default 'active' check (state in ('draft','active','superseded')),
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),
  unique (code, version)
);

-- ---------- company documents (statutory docs with expiry flags) ----------
create table if not exists public.company_documents (
  id         uuid primary key default gen_random_uuid(),
  entity_id  uuid references public.entities(id),
  name       text not null unique,
  kind       text,
  expires_on date,                              -- null = no expiry
  doc        text,
  state      text not null default 'active',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- ---------- compliance calendar (statutory obligations + due dates) ----------
create table if not exists public.compliance_obligations (
  id         uuid primary key default gen_random_uuid(),
  entity_id  uuid references public.entities(id),
  obligation text not null unique,
  authority  text,                              -- KRA / NSSF / SHA / …
  frequency  text not null check (frequency in ('monthly','quarterly','annual')),
  due_rule   text,                              -- '9th of following month'
  next_due   date not null,
  owner_module text,                            -- finance | hr — shared calendar (PRD cross-links)
  state      text not null default 'pending' check (state in ('pending','filed','overdue')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create or replace function public.mark_obligation_filed(p_obligation text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare o record; nxt date;
begin
  perform public.assert_access('reports', 2);
  select * into o from public.compliance_obligations where obligation = p_obligation;
  if not found then raise exception 'Unknown obligation: %', p_obligation; end if;
  nxt := case o.frequency
    when 'monthly' then o.next_due + interval '1 month'
    when 'quarterly' then o.next_due + interval '3 months'
    else o.next_due + interval '1 year' end;
  update public.compliance_obligations set state = 'pending', next_due = nxt where id = o.id;
  perform public.audit_write('compliance.filed','obligation', p_obligation,
    jsonb_build_object('filedFor', o.next_due, 'nextDue', nxt));
  return jsonb_build_object('obligation', p_obligation, 'nextDue', nxt);
end $$;

-- ---------- risk register ----------
create table if not exists public.risks (
  id         uuid primary key default gen_random_uuid(),
  ref        text not null unique,
  entity_id  uuid references public.entities(id),
  risk       text not null,
  category   text,
  likelihood int not null check (likelihood between 1 and 5),
  impact     int not null check (impact between 1 and 5),
  mitigation text,
  owner_name text,
  state      text not null default 'open' check (state in ('open','mitigated','closed')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- ---------- contracts registry (Procurement + CRM read this) ----------
create table if not exists public.contracts (
  id           uuid primary key default gen_random_uuid(),
  entity_id    uuid references public.entities(id),
  counterparty text not null,
  kind         text not null check (kind in ('vendor','funder','customer','partner')),
  title        text not null,
  detail       text,
  expires_on   date,
  vendor_id    uuid references public.vendors(id),
  state        text not null default 'active' check (state in ('active','renew_soon','expired','terminated')),
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  unique (counterparty, title)
);

-- ---------- integration queues ----------
create table if not exists public.etims_submissions (
  id           uuid primary key default gen_random_uuid(),
  invoice_ref  text not null references public.sales_invoices(ref),
  control_no   text,
  payload      jsonb,
  state        text not null default 'pending' check (state in ('pending','filed','failed')),
  submitted_at timestamptz,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);

create table if not exists public.mpesa_payments (
  id          uuid primary key default gen_random_uuid(),
  payment_ref text not null references public.payments(ref),
  shortcode   text,
  checkout_id text,
  amount      numeric not null,
  state       text not null default 'pending' check (state in ('pending','confirmed','failed')),
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

create table if not exists public.sanctions_checks (
  id         uuid primary key default gen_random_uuid(),
  vendor_id  uuid not null references public.vendors(id),
  provider   text not null default 'manual',
  result     text not null check (result in ('cleared','flagged')),
  detail     jsonb,
  checked_by uuid references public.app_users(id),
  created_at timestamptz not null default now()
);

-- ---------- transitions + counters ----------
insert into public.record_transitions(record_type, from_state, to_state) values
  ('policy','draft','active'), ('policy','active','superseded'),
  ('risk','open','mitigated'), ('risk','mitigated','closed'), ('risk','open','closed'),
  ('contract','active','renew_soon'), ('contract','renew_soon','expired'),
  ('contract','active','expired'), ('contract','active','terminated'),
  ('etims','pending','filed'), ('etims','pending','failed'), ('etims','failed','filed'),
  ('mpesa','pending','confirmed'), ('mpesa','pending','failed'),
  ('obligation','pending','filed'), ('obligation','pending','overdue'), ('obligation','overdue','filed')
on conflict do nothing;

do $$
declare r record;
begin
  for r in select * from (values
    ('policies','policy'), ('risks','risk'), ('contracts','contract'),
    ('etims_submissions','etims'), ('mpesa_payments','mpesa'), ('compliance_obligations','obligation')
  ) as t(tbl, rtype)
  loop
    execute format('drop trigger if exists state_machine on public.%I', r.tbl);
    execute format('create trigger state_machine before update of state on public.%I
                    for each row execute function public.enforce_state_machine(%L)', r.tbl, r.rtype);
  end loop;
end $$;

insert into public.ref_counters(kind, prefix, n) values
  ('RSK', 'RSK-', 100),
  ('ETIMS', 'KRA-CU-', 550000)
on conflict (kind) do nothing;

-- ---------- eTIMS files on EVERY sales invoice issue (legal requirement) ----------
create or replace function public.submit_sales_invoice(p_customer text, p_description text, p_net numeric, p_due_key text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_ref text; v_total numeric; v_vat numeric; v_cls text; v_txt text; v_ctrl text;
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
  -- eTIMS: filed on issue — no invoice without a filing record
  v_ctrl := public.next_ref('ETIMS');
  insert into public.etims_submissions(invoice_ref, control_no, state, submitted_at, payload)
  values (v_ref, v_ctrl, 'filed', now(),
          jsonb_build_object('customer', p_customer, 'net', p_net, 'vat', v_vat, 'total', v_total));
  perform public.post_journal('Sales invoice ' || v_ref || ' — ' || p_customer, 'sales_invoice', v_ref,
    jsonb_build_array(
      jsonb_build_object('account', '1100', 'debit', v_total),
      jsonb_build_object('account', '4000', 'credit', p_net),
      jsonb_build_object('account', '2100', 'credit', v_vat)));
  perform public.audit_write('sales_invoice.issued','sales_invoice', v_ref,
    jsonb_build_object('customer', p_customer, 'net', p_net, 'total', v_total, 'etims', v_ctrl));
  return jsonb_build_object('cust', p_customer, 'id', v_ref, 'tot', v_total, 'pillCls', v_cls, 'pillTxt', v_txt);
end $$;

-- ---------- M-Pesa rail: payment intent recorded on mpesa payments ----------
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
  if p_method = 'mpesa' then
    insert into public.mpesa_payments(payment_ref, shortcode, amount, state)
    values (v_ref, '174379', inv.amount, 'pending');   -- serverless function fires the STK later
  end if;
  update public.invoices_ap set state = 'paid' where id = inv.id;
  update public.vendors set open_pos = greatest(open_pos - 1, 0) where id = inv.vendor_id;
  select budget_code into bcode from public.requisitions where id = po.requisition_id;
  if bcode is not null then
    update public.budget_lines set committed = greatest(committed - inv.amount, 0),
                                   actual = actual + inv.amount where code = bcode;
  end if;
  perform public.audit_write('payment.made','payment', v_ref,
    jsonb_build_object('invoice', p_inv_ref, 'method', p_method, 'amount', inv.amount, 'journal', je));
  return jsonb_build_object('id', v_ref, 'invoice', p_inv_ref, 'journal', je);
end $$;

-- ---------- sanctions screening: recorded check clears the vendor gate ----------
create or replace function public.screen_vendor(p_vendor_name text, p_result text, p_detail text default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v record;
  v_actor uuid := (select id from public.app_users where auth_id = auth.uid());
begin
  perform public.assert_access('procurement', 3);
  if p_result not in ('cleared','flagged') then raise exception 'Result must be cleared or flagged'; end if;
  select * into v from public.vendors where name = p_vendor_name;
  if not found then raise exception 'Vendor % not found', p_vendor_name; end if;
  insert into public.sanctions_checks(vendor_id, provider, result, detail, checked_by)
  values (v.id, 'manual', p_result, jsonb_build_object('note', p_detail), v_actor);
  if p_result = 'cleared' then
    update public.vendors set screen_status = 'cleared' where id = v.id;
    if v.state = 'draft' then update public.vendors set state = 'in_screening' where id = v.id; end if;
    if (select state from public.vendors where id = v.id) = 'in_screening' then
      update public.vendors set state = 'prequalified' where id = v.id;
      update public.vendors set state = 'active' where id = v.id;
    end if;
  else
    update public.vendors set screen_status = 'flagged' where id = v.id;
  end if;
  perform public.audit_write('vendor.screened','vendor', p_vendor_name,
    jsonb_build_object('result', p_result, 'detail', p_detail));
  return jsonb_build_object('vendor', p_vendor_name, 'result', p_result,
    'state', (select state from public.vendors where id = v.id));
end $$;

-- ---------- seeds ----------
insert into public.policies(code, title, version, effective_from, state) values
  ('IGN-PROC-001', 'Procurement policy & SOP',            2, '2026-01-01', 'active'),
  ('IGN-FIN-001',  'Financial management manual',         1, '2025-07-01', 'active'),
  ('IGN-HR-001',   'HR policy & staff handbook',          1, '2025-07-01', 'active'),
  ('IGN-SAF-001',  'Safeguarding & ethics policy',        1, '2025-10-01', 'active'),
  ('IGN-DATA-001', 'Data protection policy (Kenya DPA)',  1, '2025-10-01', 'active')
on conflict (code, version) do nothing;

with ke as (select id from public.entities where code = 'KE')
insert into public.company_documents(entity_id, name, kind, expires_on)
select ke.id, v.name, v.kind, v.expires::date from ke, (values
  ('Certificate of incorporation', 'statutory', null),
  ('KRA PIN certificate',          'statutory', null),
  ('Tax Compliance Certificate',   'statutory', '2026-11-30'),
  ('Nairobi business permit',      'licence',   '2026-12-31'),
  ('EPRA licence — LPG handling',  'licence',   '2027-03-31')
) as v(name, kind, expires)
on conflict (name) do nothing;

with ke as (select id from public.entities where code = 'KE')
insert into public.compliance_obligations(entity_id, obligation, authority, frequency, due_rule, next_due, owner_module)
select ke.id, v.* from ke, (values
  ('PAYE remittance',          'KRA',  'monthly', '9th of following month',  '2026-07-09'::date, 'finance'),
  ('NSSF contributions',       'NSSF', 'monthly', '9th of following month',  '2026-07-09', 'hr'),
  ('SHIF contributions',       'SHA',  'monthly', '9th of following month',  '2026-07-09', 'hr'),
  ('Housing levy remittance',  'KRA',  'monthly', '9th of following month',  '2026-07-09', 'finance'),
  ('VAT return',               'KRA',  'monthly', '20th of following month', '2026-07-20', 'finance'),
  ('NITA levy',                'NITA', 'monthly', '9th of following month',  '2026-07-09', 'hr'),
  ('Annual returns (CR12)',    'BRS',  'annual',  'anniversary of incorporation', '2027-01-31', 'reports')
) as v(obligation, authority, frequency, due_rule, next_due, owner_module)
on conflict (obligation) do nothing;

with ke as (select id from public.entities where code = 'KE')
insert into public.risks(ref, entity_id, risk, category, likelihood, impact, mitigation, owner_name, state)
select v.ref, ke.id, v.risk, v.category, v.l, v.i, v.mitigation, v.owner, v.state from ke, (values
  ('RSK-101', 'Wave 1 fund decision slips past Q3 — bridge funding gap', 'Funding',   3, 4, 'Charm term sheet + EAIF parallel track; 6-month runway floor', 'Dennis', 'open'),
  ('RSK-102', 'LPG price volatility erodes institution savings case',    'Market',    3, 3, 'Framework pricing with BURN; multi-fuel positioning',           'Wilson', 'open'),
  ('RSK-103', 'Vendor concentration — BURN single-source for cookers',   'Supply',    2, 4, 'Second fabricator prequalified (Nakuru); framework dual-award', 'Joan',   'mitigated'),
  ('RSK-104', 'Enumerator data quality in 5-county baseline',            'Delivery',  2, 3, 'KoboToolbox validation rules + 10% back-check sample',          'Elizabeth', 'open')
) as v(ref, risk, category, l, i, mitigation, owner, state)
on conflict (ref) do nothing;

-- contracts registry from the vendor + funder records
with ke as (select id from public.entities where code = 'KE')
insert into public.contracts(entity_id, counterparty, kind, title, detail, expires_on, vendor_id, state)
select ke.id, v.counterparty, v.kind, v.title, v.detail, v.expires::date,
       (select id from public.vendors where name = v.counterparty), v.state
from ke, (values
  ('BURN Manufacturing', 'vendor', 'Cookstove supply framework', 'Framework · agreed rates', '2026-12-31', 'active'),
  ('Equity Logistics',   'vendor', 'Logistics framework',        'Framework',                '2027-03-31', 'active'),
  ('Safaricom',          'vendor', 'Data & connectivity',        'Service agreement',        '2026-09-30', 'renew_soon'),
  ('Makueni County',     'partner','MoU — VTC rollout',          'County partnership',       '2026-12-31', 'active'),
  ('PICREF',             'funder', 'Sierra Leone grant agreement','$240k programme grant',   '2027-06-30', 'active')
) as v(counterparty, kind, title, detail, expires, state)
on conflict (counterparty, title) do nothing;

-- ---------- RLS + grants ----------
do $$
declare t text;
begin
  foreach t in array array['policies','company_documents','compliance_obligations','risks',
    'contracts','etims_submissions','mpesa_payments','sanctions_checks']
  loop
    execute format('alter table public.%I enable row level security', t);
    execute format('drop policy if exists "read for authenticated" on public.%I', t);
    execute format('create policy "read for authenticated" on public.%I for select to authenticated using (true)', t);
  end loop;
end $$;

do $$
declare fn text;
begin
  foreach fn in array array[
    'mark_obligation_filed(text)','screen_vendor(text,text,text)']
  loop
    execute format('revoke execute on function public.%s from public, anon', fn);
    execute format('grant execute on function public.%s to authenticated', fn);
  end loop;
end $$;

-- ======== supabase/migrations/0008_phase5_access.sql ========
-- ============================================================
-- Jikoni Master PRD — Phase 5: Access & governance (enforce last)
-- Role templates, invite flow, SoD wired into the checkpoints that
-- have existed since Phase 0, grant-time conflict blocking,
-- onboarding/offboarding. Finally: enforce_access flips ON.
-- (enforce_sod stays off by default — flipping it blocks self-approval,
-- which the single-admin demo flow relies on; it is one config row away.)
-- Idempotent: safe to re-run.
-- ============================================================

-- ---------- role templates (matrix defaults; matches data.ts roleTemplates + inventory) ----------
create table if not exists public.role_templates (
  role_key text not null,
  module   text not null,
  level    int  not null check (level between 0 and 3),
  primary key (role_key, module)
);

insert into public.role_templates(role_key, module, level)
select r, m, l from (values
  ('admin', '{"finance":3,"procurement":3,"hr":3,"deploy":3,"readiness":3,"raise":3,"crm":3,"projects":3,"reports":3,"dataroom":3,"settings":3,"users":3,"inventory":3}'::jsonb),
  ('fin',   '{"finance":3,"procurement":3,"hr":1,"deploy":1,"readiness":0,"raise":0,"crm":1,"projects":2,"reports":2,"dataroom":0,"settings":0,"users":0,"inventory":3}'::jsonb),
  ('std',   '{"finance":0,"procurement":1,"hr":0,"deploy":1,"readiness":1,"raise":1,"crm":3,"projects":1,"reports":1,"dataroom":0,"settings":0,"users":0,"inventory":1}'::jsonb),
  ('view',  '{"finance":0,"procurement":0,"hr":0,"deploy":1,"readiness":1,"raise":0,"crm":1,"projects":0,"reports":1,"dataroom":0,"settings":0,"users":0,"inventory":0}'::jsonb)
) as t(r, perms), lateral (select key as m, value::text::int as l from jsonb_each(perms)) kv
on conflict (role_key, module) do nothing;

-- backfill the new inventory module into existing per-user grants (from each user's role template)
insert into public.user_permissions(email, module, level)
select u.email, 'inventory', rt.level
from public.app_users u
join public.role_templates rt on rt.role_key = u.role_key and rt.module = 'inventory'
on conflict (email, module) do nothing;

-- ---------- invites: invite → email → set password → (2FA at provider) ----------
create table if not exists public.invites (
  id         uuid primary key default gen_random_uuid(),
  entity_id  uuid references public.entities(id),
  email      text not null unique,
  name       text not null,
  role_key   text not null default 'view',
  token      uuid not null default gen_random_uuid(),
  invited_by uuid references public.app_users(id),
  state      text not null default 'sent' check (state in ('sent','accepted','revoked')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

insert into public.record_transitions(record_type, from_state, to_state) values
  ('invite','sent','accepted'), ('invite','sent','revoked'),
  ('app_user','invited','active'), ('app_user','active','exited'), ('app_user','invited','exited')
on conflict do nothing;

do $$
begin
  execute 'drop trigger if exists state_machine on public.invites';
  execute format('create trigger state_machine before update of state on public.invites
                  for each row execute function public.enforce_state_machine(%L)', 'invite');
end $$;

-- invite: creates the app_user from the LEAST-PRIVILEGE template + records the invite.
-- The auth account is provisioned by scripts/provision-invites.mjs (service role) which
-- emails the set-password link; on signup the Phase 0 trigger links auth_id and the
-- extension below marks the invite accepted.
create or replace function public.invite_user(p_name text, p_email text, p_role_key text default 'view')
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_me uuid := (select id from public.app_users where auth_id = auth.uid());
  v_entity uuid := (select id from public.entities where code = 'KE');
  v_token uuid;
begin
  perform public.assert_access('users', 3);
  if exists (select 1 from public.app_users where email = p_email) then
    raise exception 'A user with % already exists', p_email;
  end if;
  if not exists (select 1 from public.role_templates where role_key = p_role_key) then
    raise exception 'Unknown role template: %', p_role_key;
  end if;
  insert into public.app_users(entity_id, name, email, role_key, status, state)
  values (v_entity, p_name, p_email, p_role_key, 'off', 'invited');
  insert into public.user_permissions(email, module, level)
  select p_email, module, level from public.role_templates where role_key = p_role_key
  on conflict (email, module) do update set level = excluded.level;
  insert into public.invites(entity_id, email, name, role_key, invited_by)
  values (v_entity, p_email, p_name, p_role_key, v_me)
  returning token into v_token;
  perform public.audit_write('user.invited','user', p_email,
    jsonb_build_object('name', p_name, 'role', p_role_key));
  return jsonb_build_object('email', p_email, 'name', p_name, 'role', p_role_key, 'token', v_token);
end $$;

-- extend the auth-link trigger: signing up also accepts the invite
create or replace function public.link_auth_user() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  update public.app_users set auth_id = new.id, state = 'active', status = 'active', updated_at = now()
  where email = new.email and auth_id is null;
  update public.invites set state = 'accepted', updated_at = now()
  where email = new.email and state = 'sent';
  return new;
end $$;

-- ---------- SoD: grant-time conflict blocking ----------
create table if not exists public.sod_conflicts (
  module_a text not null,
  level_a  int  not null,
  module_b text not null,
  level_b  int  not null,
  rule     text not null,
  primary key (module_a, module_b)
);

insert into public.sod_conflicts(module_a, level_a, module_b, level_b, rule) values
  ('procurement', 3, 'finance', 3, 'Full procurement (raise/approve PO) + full finance (pay) in one person'),
  ('hr', 3, 'finance', 3, 'Prepare payroll + post/pay payroll in one person'),
  ('users', 3, 'finance', 3, 'Grant own access + move money in one person')
on conflict (module_a, module_b) do nothing;

create or replace function public.save_access(p_email text, p_perms jsonb)
returns void language plpgsql security definer set search_path = public as $$
declare
  k text; c record;
  v_sod boolean := coalesce((select value::text = 'true' from public.app_config where key = 'enforce_sod'), false);
begin
  perform public.assert_access('users', 3);
  if v_sod then
    for c in select * from public.sod_conflicts loop
      if coalesce((p_perms->>c.module_a)::int, 0) >= c.level_a
         and coalesce((p_perms->>c.module_b)::int, 0) >= c.level_b then
        raise exception 'Segregation of duties conflict: %', c.rule;
      end if;
    end loop;
  end if;
  for k in select jsonb_object_keys(p_perms) loop
    insert into public.user_permissions(email, module, level)
    values (p_email, k, (p_perms->>k)::int)
    on conflict (email, module) do update set level = excluded.level, updated_at = now();
  end loop;
  perform public.audit_write('access.updated','user', p_email, jsonb_build_object('perms', p_perms));
end $$;

-- ---------- SoD wired into the Phase 1 checkpoints ----------
create or replace function public.approve_requisition(p_ref text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare r record;
begin
  perform public.assert_access('procurement', 3);
  select * into r from public.requisitions where ref = p_ref;
  if not found then raise exception 'Requisition % not found', p_ref; end if;
  perform public.assert_sod('requisition (requester ≠ approver)', r.owner_id);
  update public.requisitions set state = 'approved' where id = r.id;
  perform public.audit_write('requisition.approved','requisition', p_ref,
    jsonb_build_object('from', r.state));
  return jsonb_build_object('id', p_ref, 'status', 'approved');
end $$;

create or replace function public.submit_grn(p_po_ref text, p_coverage text, p_pct int, p_note text default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  po record; req_owner uuid; v_ref text; total_pct int;
  v_entity uuid := (select id from public.entities where code = 'KE');
  v_receiver uuid := (select id from public.app_users where auth_id = auth.uid());
begin
  perform public.assert_access('procurement', 2);
  select * into po from public.purchase_orders where ref = p_po_ref;
  if not found then raise exception 'PO % not found', p_po_ref; end if;
  if po.state = 'closed' then raise exception 'PO % is closed', p_po_ref; end if;
  select owner_id into req_owner from public.requisitions where id = po.requisition_id;
  perform public.assert_sod('goods receipt (receiver ≠ requester)', req_owner);
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

-- ---------- onboarding / offboarding (B9) ----------
create or replace function public.offboard_user(p_email text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare u record;
begin
  perform public.assert_access('users', 3);
  select * into u from public.app_users where email = p_email;
  if not found then raise exception 'User % not found', p_email; end if;
  update public.app_users set state = 'exited', status = 'off' where id = u.id;
  update public.user_permissions set level = 0, updated_at = now() where email = p_email;
  update public.staff_files set state = 'exited' where app_user_id = u.id and state = 'active';
  update public.dataroom_grants set state = 'revoked' where grantee = p_email and state = 'active';
  update public.invites set state = 'revoked' where email = p_email and state = 'sent';
  -- audit history is retained by design (append-only)
  perform public.audit_write('user.offboarded','user', p_email,
    jsonb_build_object('name', u.name));
  return jsonb_build_object('email', p_email, 'state', 'exited');
end $$;

-- app_users gets a state machine too (was free default before)
do $$
begin
  execute 'drop trigger if exists state_machine on public.app_users';
  execute format('create trigger state_machine before update of state on public.app_users
                  for each row execute function public.enforce_state_machine(%L)', 'app_user');
end $$;

-- ---------- RLS + grants + THE FLIP ----------
do $$
declare t text;
begin
  foreach t in array array['role_templates','invites','sod_conflicts']
  loop
    execute format('alter table public.%I enable row level security', t);
    execute format('drop policy if exists "read for authenticated" on public.%I', t);
    execute format('create policy "read for authenticated" on public.%I for select to authenticated using (true)', t);
  end loop;
end $$;

do $$
declare fn text;
begin
  foreach fn in array array['invite_user(text,text,text)','offboard_user(text)']
  loop
    execute format('revoke execute on function public.%s from public, anon', fn);
    execute format('grant execute on function public.%s to authenticated', fn);
  end loop;
end $$;

-- ---------- system actions bypass the user permission hook ----------
-- e.g. the reorder loop raises a requisition from inside issue_stock; the
-- issuing clerk may hold inventory rights but not procurement rights.
create or replace function public.assert_access(p_module text, p_min_level int) returns void
language plpgsql security definer set search_path = public as $$
declare
  v_on boolean := coalesce((select value::text = 'true' from public.app_config where key = 'enforce_access'), false);
  v_email text := coalesce(nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'email', '');
  v_level int;
begin
  if not v_on then return; end if;
  if coalesce(current_setting('jikoni.system_action', true), '') = 'true' then return; end if;
  select level into v_level from public.user_permissions where email = v_email and module = p_module;
  if coalesce(v_level, 0) < p_min_level then
    raise exception 'Access denied: % requires level % on %', coalesce(nullif(v_email,''),'(no user)'), p_min_level, p_module;
  end if;
end $$;

create or replace function public.check_reorder(p_item uuid) returns text
language plpgsql security definer set search_path = public as $$
declare
  it record; on_hand numeric; req jsonb;
begin
  select * into it from public.stock_items where id = p_item;
  select coalesce(sum(qty), 0) into on_hand from public.stock_levels where item_id = p_item;
  if it.state = 'active' and it.reorder_level > 0 and on_hand < it.reorder_level
     and it.auto_req_ref is null and it.budget_code is not null and it.reorder_qty > 0 then
    perform set_config('jikoni.system_action', 'true', true);
    req := public.submit_requisition(
      format('Restock %s — %s %s (auto: below reorder level %s, on hand %s)',
             it.name, it.reorder_qty, it.unit, it.reorder_level, on_hand),
      it.reorder_qty * it.unit_cost, it.budget_code);
    perform set_config('jikoni.system_action', '', true);
    update public.stock_items set auto_req_ref = req->>'id' where id = p_item;
    perform public.audit_write('inventory.reorder_triggered','stock_item', it.sku,
      jsonb_build_object('onHand', on_hand, 'reorderLevel', it.reorder_level, 'requisition', req->>'id'));
    return req->>'id';
  end if;
  if on_hand >= it.reorder_level and it.auto_req_ref is not null then
    update public.stock_items set auto_req_ref = null where id = p_item;
  end if;
  return null;
end $$;

-- Phase 5, per the PRD: enforcement switches ON at checkpoints that have
-- been in every transition since Phase 0 — not a rebuild.
update public.app_config set value = 'true'::jsonb, updated_at = now() where key = 'enforce_access';

-- ============================================================
-- 0009 · Leave self-service — edit / delete your own request
-- The applicant can change or withdraw a request only while it
-- is still pending (before HR decides). The reserved-days hold
-- moves with the edit and is released on delete. Audited.
-- ============================================================

create or replace function public.update_leave(p_ref text, p_kind text, p_from date, p_to date, p_reason text default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_me uuid := (select id from public.app_users where auth_id = auth.uid());
  l record; bal record; v_days numeric;
begin
  if v_me is null then raise exception 'No staff record for this login'; end if;
  select * into l from public.leave_applications where ref = p_ref;
  if not found then raise exception 'Leave application % not found', p_ref; end if;
  if l.app_user_id <> v_me then raise exception 'You can only edit your own leave request'; end if;
  if l.state <> 'pending' then raise exception 'Only pending requests can be edited — % is already %', p_ref, l.state; end if;
  if p_to < p_from then raise exception 'End date is before start date'; end if;
  v_days := (p_to - p_from) + 1;

  -- release the old hold, then take the new one (kind/year may have changed)
  update public.leave_balances set reserved = reserved - l.days
  where app_user_id = v_me and kind = l.kind and year = extract(year from l.from_date)::int;

  select * into bal from public.leave_balances
  where app_user_id = v_me and kind = p_kind and year = extract(year from p_from)::int;
  if not found then raise exception 'No % leave balance for %', p_kind, extract(year from p_from)::int; end if;
  if v_days > bal.entitled - bal.used - bal.reserved then
    raise exception 'Insufficient balance: % days requested, % available', v_days, bal.entitled - bal.used - bal.reserved;
  end if;
  update public.leave_balances set reserved = reserved + v_days
  where app_user_id = v_me and kind = p_kind and year = extract(year from p_from)::int;

  update public.leave_applications
  set kind = p_kind, from_date = p_from, to_date = p_to, days = v_days,
      reason = coalesce(p_reason, reason), updated_at = now()
  where id = l.id;

  perform public.audit_write('leave.updated','leave', p_ref,
    jsonb_build_object('kind', p_kind, 'from', p_from, 'to', p_to, 'days', v_days));
  return jsonb_build_object('id', p_ref, 'days', v_days, 'state', 'pending');
end $$;

create or replace function public.delete_leave(p_ref text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_me uuid := (select id from public.app_users where auth_id = auth.uid());
  l record;
begin
  if v_me is null then raise exception 'No staff record for this login'; end if;
  select * into l from public.leave_applications where ref = p_ref;
  if not found then raise exception 'Leave application % not found', p_ref; end if;
  if l.app_user_id <> v_me then raise exception 'You can only delete your own leave request'; end if;
  if l.state <> 'pending' then raise exception 'Only pending requests can be deleted — % is already %', p_ref, l.state; end if;

  update public.leave_balances set reserved = reserved - l.days
  where app_user_id = v_me and kind = l.kind and year = extract(year from l.from_date)::int;
  delete from public.leave_applications where id = l.id;

  perform public.audit_write('leave.deleted','leave', p_ref,
    jsonb_build_object('kind', l.kind, 'from', l.from_date, 'to', l.to_date, 'days', l.days));
  return jsonb_build_object('id', p_ref, 'state', 'deleted');
end $$;

do $$
declare fn text;
begin
  foreach fn in array array['update_leave(text,text,date,date,text)','delete_leave(text)']
  loop
    execute format('revoke execute on function public.%s from public, anon', fn);
    execute format('grant execute on function public.%s to authenticated', fn);
  end loop;
end $$;
-- ============================================================
-- 0010 · Leave overlap guard
-- A new or edited request may not overlap any of the applicant's
-- own pending or approved leave — you can't be on leave twice.
-- Rejected / cancelled requests don't block the dates.
-- ============================================================

create or replace function public.apply_leave(p_kind text, p_from date, p_to date, p_reason text default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_me uuid := (select id from public.app_users where auth_id = auth.uid());
  v_days numeric; v_ref text; bal record; clash record;
  v_year int := extract(year from p_from)::int;
  v_entity uuid := (select id from public.entities where code = 'KE');
begin
  if v_me is null then raise exception 'No staff record for this login'; end if;
  if p_to < p_from then raise exception 'End date is before start date'; end if;
  v_days := (p_to - p_from) + 1;

  select ref, from_date, to_date, state into clash
  from public.leave_applications
  where app_user_id = v_me and state in ('pending','approved')
    and from_date <= p_to and to_date >= p_from
  limit 1;
  if found then
    if clash.state = 'approved' then
      raise exception 'You are already booked on leave from % to %. Please choose dates outside that range.',
        to_char(clash.from_date, 'DD Mon'), to_char(clash.to_date, 'DD Mon');
    else
      raise exception 'You already have a pending request covering % to %. Edit or delete it under My leave requests instead.',
        to_char(clash.from_date, 'DD Mon'), to_char(clash.to_date, 'DD Mon');
    end if;
  end if;

  select * into bal from public.leave_balances where app_user_id = v_me and kind = p_kind and year = v_year;
  if not found then raise exception 'No % leave balance for %', p_kind, v_year; end if;
  if v_days > bal.entitled - bal.used - bal.reserved then
    raise exception 'Insufficient balance: % days requested, % available', v_days, bal.entitled - bal.used - bal.reserved;
  end if;
  v_ref := public.next_ref('LV');
  insert into public.leave_applications(ref, entity_id, app_user_id, kind, from_date, to_date, days, reason)
  values (v_ref, v_entity, v_me, p_kind, p_from, p_to, v_days, p_reason);
  update public.leave_balances set reserved = reserved + v_days
  where app_user_id = v_me and kind = p_kind and year = v_year;
  perform public.audit_write('leave.applied','leave', v_ref,
    jsonb_build_object('kind', p_kind, 'from', p_from, 'to', p_to, 'days', v_days));
  return jsonb_build_object('id', v_ref, 'days', v_days, 'state', 'pending');
end $$;

create or replace function public.update_leave(p_ref text, p_kind text, p_from date, p_to date, p_reason text default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_me uuid := (select id from public.app_users where auth_id = auth.uid());
  l record; bal record; clash record; v_days numeric;
begin
  if v_me is null then raise exception 'No staff record for this login'; end if;
  select * into l from public.leave_applications where ref = p_ref;
  if not found then raise exception 'Leave application % not found', p_ref; end if;
  if l.app_user_id <> v_me then raise exception 'You can only edit your own leave request'; end if;
  if l.state <> 'pending' then raise exception 'Only pending requests can be edited — % is already %', p_ref, l.state; end if;
  if p_to < p_from then raise exception 'End date is before start date'; end if;
  v_days := (p_to - p_from) + 1;

  select ref, from_date, to_date, state into clash
  from public.leave_applications
  where app_user_id = v_me and id <> l.id and state in ('pending','approved')
    and from_date <= p_to and to_date >= p_from
  limit 1;
  if found then
    if clash.state = 'approved' then
      raise exception 'You are already booked on leave from % to %. Please choose dates outside that range.',
        to_char(clash.from_date, 'DD Mon'), to_char(clash.to_date, 'DD Mon');
    else
      raise exception 'You already have a pending request covering % to %. Edit or delete it under My leave requests instead.',
        to_char(clash.from_date, 'DD Mon'), to_char(clash.to_date, 'DD Mon');
    end if;
  end if;

  -- release the old hold, then take the new one (kind/year may have changed)
  update public.leave_balances set reserved = reserved - l.days
  where app_user_id = v_me and kind = l.kind and year = extract(year from l.from_date)::int;

  select * into bal from public.leave_balances
  where app_user_id = v_me and kind = p_kind and year = extract(year from p_from)::int;
  if not found then raise exception 'No % leave balance for %', p_kind, extract(year from p_from)::int; end if;
  if v_days > bal.entitled - bal.used - bal.reserved then
    raise exception 'Insufficient balance: % days requested, % available', v_days, bal.entitled - bal.used - bal.reserved;
  end if;
  update public.leave_balances set reserved = reserved + v_days
  where app_user_id = v_me and kind = p_kind and year = extract(year from p_from)::int;

  update public.leave_applications
  set kind = p_kind, from_date = p_from, to_date = p_to, days = v_days,
      reason = coalesce(p_reason, reason), updated_at = now()
  where id = l.id;

  perform public.audit_write('leave.updated','leave', p_ref,
    jsonb_build_object('kind', p_kind, 'from', p_from, 'to', p_to, 'days', v_days));
  return jsonb_build_object('id', p_ref, 'days', v_days, 'state', 'pending');
end $$;


-- ============================================================
-- Jikoni — Phase CRM Forms: Partners, Opportunities, create-
-- engagement/partner/opportunity RPCs, extensible dropdowns,
-- and an updated bootstrap() that returns live CRM data.
-- Idempotent: safe to re-run.
-- ============================================================

-- ---------- ref counters for ENG / DST (start after the highest seeded ref) ----------
insert into public.ref_counters(kind, prefix, n) values
  ('ENG', 'ENG-', 30),
  ('DST', 'DST-', 19)
on conflict (kind) do nothing;

-- ---------- extensible dropdown options for CRM forms ----------
create table if not exists public.crm_dropdown_options (
  id         uuid primary key default gen_random_uuid(),
  category   text not null,       -- 'eng_stage_up', 'eng_stage_down', 'partner_type', 'partner_status', 'opp_type', 'opp_status'
  value      text not null,
  sort       int not null default 0,
  active     boolean not null default true,
  created_at timestamptz not null default now(),
  unique (category, value)
);

insert into public.crm_dropdown_options(category, value, sort) values
  -- upstream engagement stages
  ('eng_stage_up', 'Discovery',    1),
  ('eng_stage_up', 'Materials',    2),
  ('eng_stage_up', 'Negotiation',  3),
  ('eng_stage_up', 'Term sheet',   4),
  ('eng_stage_up', 'Close',        5),
  -- downstream engagement stages
  ('eng_stage_down', 'Identification', 1),
  ('eng_stage_down', 'EOI',            2),
  ('eng_stage_down', 'Site visit',     3),
  ('eng_stage_down', 'Contracting',    4),
  ('eng_stage_down', 'Deployed',       5),
  -- partner types
  ('partner_type', 'Blended funder',  1),
  ('partner_type', 'Concessional debt', 2),
  ('partner_type', 'Equity investor',  3),
  ('partner_type', 'Institution',      4),
  ('partner_type', 'Manufacturer',     5),
  ('partner_type', 'Programme / TA',   6),
  ('partner_type', 'TA / convener',    7),
  ('partner_type', 'Lender',           8),
  ('partner_type', 'Distributor / EPC',9),
  ('partner_type', 'Government',       10),
  -- partner statuses
  ('partner_status', 'Discovery',      1),
  ('partner_status', 'Materials',      2),
  ('partner_status', 'Negotiation',    3),
  ('partner_status', 'Term sheet',     4),
  ('partner_status', 'EOI',            5),
  ('partner_status', 'Site visit',     6),
  ('partner_status', 'Contracting',    7),
  ('partner_status', 'Ready to fund',  8),
  ('partner_status', 'Active',         9),
  ('partner_status', 'Holding',        10),
  -- opportunity types
  ('opp_type', 'Convening',       1),
  ('opp_type', 'Accelerator',     2),
  ('opp_type', 'Grant / TA',      3),
  ('opp_type', 'Climate finance',  4),
  ('opp_type', 'Tender',          5),
  ('opp_type', 'RFP',             6),
  -- opportunity statuses
  ('opp_status', 'On track',      1),
  ('opp_status', 'Applying',      2),
  ('opp_status', 'Discovery',     3),
  ('opp_status', 'Watching',      4),
  ('opp_status', 'Preparing',     5),
  ('opp_status', 'Won',           6),
  ('opp_status', 'Closed',        7)
on conflict (category, value) do nothing;

-- ---------- partners table ----------
create table if not exists public.partners (
  id         uuid primary key default gen_random_uuid(),
  entity_id  uuid references public.entities(id),
  name       text not null,
  type       text,
  country    text default 'KE',
  owner_name text,
  status     text,
  status_cls text default 'week',
  state      text not null default 'active'
             check (state in ('active','inactive','archived')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- ---------- opportunities table ----------
create table if not exists public.opportunities (
  id         uuid primary key default gen_random_uuid(),
  entity_id  uuid references public.entities(id),
  name       text not null,
  type       text,
  deadline   text,
  linked_to  text,
  status     text,
  status_cls text default 'week',
  state      text not null default 'active'
             check (state in ('active','won','closed')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- triggers
do $$
begin
  if not exists (select 1 from pg_trigger where tgname = 'touch_partners') then
    create trigger touch_partners before update on public.partners
      for each row execute function public.touch_updated_at();
  end if;
  if not exists (select 1 from pg_trigger where tgname = 'touch_opportunities') then
    create trigger touch_opportunities before update on public.opportunities
      for each row execute function public.touch_updated_at();
  end if;
end $$;

-- ---------- state machines ----------
insert into public.record_transitions(record_type, from_state, to_state) values
  ('partner', 'active', 'inactive'),
  ('partner', 'active', 'archived'),
  ('partner', 'inactive', 'active'),
  ('opportunity', 'active', 'won'),
  ('opportunity', 'active', 'closed')
on conflict do nothing;

-- ---------- seed existing hardcoded partners ----------
do $$
declare v_entity uuid := (select id from public.entities where code = 'KE');
begin
  if not exists (select 1 from public.partners) then
    insert into public.partners(entity_id, name, type, country, owner_name, status, status_cls) values
      (v_entity, 'Charm Impact',             'Blended funder',   'UK / KE', 'Wilson',    'Term sheet',   'week'),
      (v_entity, 'EAIF',                     'Concessional debt', 'UK',      'Wilson',    'Negotiation',  'today'),
      (v_entity, 'KIICO',                    'Equity investor',   'KE',      'Wilson',    'Materials',    'today'),
      (v_entity, 'Signum Capital',           'Equity investor',   'SG',      'Wilson',    'Holding',      'over'),
      (v_entity, 'UNDP / WAIIS',            'Programme / TA',    'KE',      'Wilson',    'Discovery',    'week'),
      (v_entity, 'Stanbic Bank',            'Lender',            'UG',      'Wilson',    'Ready to fund', 'done'),
      (v_entity, 'Makueni County VTCs',     'Institution',       'KE',      'Elizabeth', 'Contracting',  'today'),
      (v_entity, 'Catholic Diocese — Machakos', 'Institution',   'KE',      'Elizabeth', 'EOI',          'week'),
      (v_entity, 'BURN Manufacturing',      'Manufacturer',      'KE',      'Elizabeth', 'Active',       'done'),
      (v_entity, 'CLASP',                   'TA / convener',     'Global',  'Elizabeth', 'Site visit',   'week');
  end if;
end $$;

-- ---------- seed existing hardcoded opportunities ----------
do $$
declare v_entity uuid := (select id from public.entities where code = 'KE');
begin
  if not exists (select 1 from public.opportunities) then
    insert into public.opportunities(entity_id, name, type, deadline, linked_to, status, status_cls) values
      (v_entity, 'Africa Clean Cooking Summit', 'Convening',      '9–10 Jul',  'Multiple',       'On track',  'done'),
      (v_entity, 'Accelerate Africa cohort',    'Accelerator',    'Rolling',   'Concept note',   'Applying',  'today'),
      (v_entity, 'FCDO Uganda window',          'Grant / TA',     'Q3',        'ENG (FCDO)',      'Discovery', 'week'),
      (v_entity, 'Carbon finance window',       'Climate finance', 'Q4',        'MRV readiness',  'Watching',  'week'),
      (v_entity, 'County institutional RFP',    'Tender',         'Aug',       'Downstream',     'Preparing', 'week');
  end if;
end $$;

-- ---------- RPC: create engagement ----------
create or replace function public.create_engagement(
  p_name text, p_stage text, p_owner_name text, p_pipeline text,
  p_next_action text default null, p_due_key text default 'week'
) returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_ref text; v_pill text; v_pill_txt text;
  v_entity uuid := (select id from public.entities where code = 'KE');
begin
  perform public.assert_access('crm', 2);
  v_ref := public.next_ref(case when p_pipeline = 'down' then 'DST' else 'ENG' end);
  select case p_due_key when 'today' then 'today' when 'over' then 'over' else 'week' end,
         case p_due_key when 'today' then 'Today' when 'over' then 'Overdue' when 'nweek' then 'Next week' else 'This week' end
    into v_pill, v_pill_txt;
  insert into public.engagements(ref, entity_id, name, stage, owner_name, pill, pill_txt, pipeline)
  values (v_ref, v_entity, p_name, p_stage, p_owner_name, v_pill, v_pill_txt, p_pipeline);
  perform public.audit_write('engagement.created', 'engagement', v_ref,
    jsonb_build_object('name', p_name, 'stage', p_stage, 'owner', p_owner_name, 'pipeline', p_pipeline));
  return jsonb_build_object(
    'id', v_ref, 'n', p_name, 'st', p_stage, 'o', p_owner_name,
    'pl', v_pill, 'plt', v_pill_txt, 'pipeline', p_pipeline);
end $$;

-- ---------- RPC: create partner ----------
create or replace function public.create_partner(
  p_name text, p_type text, p_country text, p_owner_name text, p_status text
) returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_entity uuid := (select id from public.entities where code = 'KE');
  v_cls text;
  v_id uuid;
begin
  perform public.assert_access('crm', 2);
  v_cls := case p_status
    when 'Active'        then 'done'
    when 'Ready to fund' then 'done'
    when 'Holding'       then 'over'
    when 'Negotiation'   then 'today'
    when 'Materials'     then 'today'
    when 'Contracting'   then 'today'
    else 'week' end;
  insert into public.partners(entity_id, name, type, country, owner_name, status, status_cls)
  values (v_entity, p_name, p_type, p_country, p_owner_name, p_status, v_cls)
  returning id into v_id;
  perform public.audit_write('partner.created', 'partner', p_name,
    jsonb_build_object('type', p_type, 'country', p_country, 'owner', p_owner_name, 'status', p_status));
  return jsonb_build_object(
    'id', v_id, 'name', p_name, 'type', p_type, 'country', p_country,
    'ownerName', p_owner_name, 'status', p_status, 'statusCls', v_cls);
end $$;

-- ---------- RPC: create opportunity ----------
create or replace function public.create_opportunity(
  p_name text, p_type text, p_deadline text, p_linked_to text, p_status text
) returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_entity uuid := (select id from public.entities where code = 'KE');
  v_cls text;
  v_id uuid;
begin
  perform public.assert_access('crm', 2);
  v_cls := case p_status
    when 'On track' then 'done'
    when 'Applying' then 'today'
    when 'Won'      then 'done'
    when 'Closed'   then 'over'
    else 'week' end;
  insert into public.opportunities(entity_id, name, type, deadline, linked_to, status, status_cls)
  values (v_entity, p_name, p_type, p_deadline, p_linked_to, p_status, v_cls)
  returning id into v_id;
  perform public.audit_write('opportunity.created', 'opportunity', p_name,
    jsonb_build_object('type', p_type, 'deadline', p_deadline, 'linked', p_linked_to, 'status', p_status));
  return jsonb_build_object(
    'id', v_id, 'name', p_name, 'type', p_type, 'deadline', p_deadline,
    'linkedTo', p_linked_to, 'status', p_status, 'statusCls', v_cls);
end $$;

-- ---------- updated bootstrap() — adds engagements, partners, opportunities, team ----------
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
    'projects', coalesce((select jsonb_object_agg(name, public.project_detail_json(id))
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
      from public.budget_lines), '{}'::jsonb),
    'inventory', jsonb_build_object(
      'items', coalesce((select jsonb_agg(jsonb_build_object(
          'sku', i.sku, 'name', i.name, 'category', i.category, 'unit', i.unit,
          'unitCost', i.unit_cost, 'reorderLevel', i.reorder_level,
          'onHand', coalesce((select sum(qty) from public.stock_levels where item_id = i.id), 0),
          'autoReq', i.auto_req_ref) order by i.sku)
        from public.stock_items i where i.state = 'active'), '[]'::jsonb),
      'locations', coalesce((select jsonb_agg(name order by name) from public.stock_locations where state='active'), '[]'::jsonb),
      'movements', coalesce((select jsonb_agg(jsonb_build_object(
          'when', to_char(m.created_at, 'DD Mon HH24:MI'), 'sku', i.sku, 'type', m.movement_type,
          'qty', m.qty, 'from', fl.name, 'to', tl.name, 'source', m.source_ref, 'note', m.note) order by m.created_at desc)
        from (select * from public.stock_movements order by created_at desc limit 40) m
        join public.stock_items i on i.id = m.item_id
        left join public.stock_locations fl on fl.id = m.from_location
        left join public.stock_locations tl on tl.id = m.to_location), '[]'::jsonb),
      'dispatches', coalesce((select jsonb_agg(jsonb_build_object(
          'id', ref, 'project', project_name, 'destination', destination, 'lines', lines, 'state', state)
          order by created_at desc)
        from public.dispatches), '[]'::jsonb),
      'assets', coalesce((select jsonb_agg(jsonb_build_object(
          'id', ref, 'name', name, 'category', category, 'cost', cost, 'accumDep', accum_dep,
          'nbv', cost - accum_dep, 'acquired', to_char(acquired_on, 'Mon YYYY'), 'state', state)
          order by ref)
        from public.assets), '[]'::jsonb)),
    -- ---- CRM forms data (new) ----
    'engagements', jsonb_build_object(
      'up', coalesce((select jsonb_agg(jsonb_build_object(
          'id', ref, 'n', name, 'st', stage, 'o', owner_name, 'pl', pill, 'plt', pill_txt)
          order by created_at desc)
        from public.engagements where pipeline = 'up' and state = 'active'), '[]'::jsonb),
      'down', coalesce((select jsonb_agg(jsonb_build_object(
          'id', ref, 'n', name, 'st', stage, 'o', owner_name, 'pl', pill, 'plt', pill_txt)
          order by created_at desc)
        from public.engagements where pipeline = 'down' and state = 'active'), '[]'::jsonb)),
    'partners', coalesce((select jsonb_agg(jsonb_build_object(
        'id', id, 'name', name, 'type', type, 'country', country,
        'ownerName', owner_name, 'status', status, 'statusCls', status_cls)
        order by created_at desc)
      from public.partners where state = 'active'), '[]'::jsonb),
    'opportunities', coalesce((select jsonb_agg(jsonb_build_object(
        'id', id, 'name', name, 'type', type, 'deadline', deadline,
        'linkedTo', linked_to, 'status', status, 'statusCls', status_cls)
        order by created_at desc)
      from public.opportunities where state = 'active'), '[]'::jsonb),
    'crmDropdowns', coalesce((select jsonb_object_agg(cat, vals) from (
        select category as cat, jsonb_agg(value order by sort) as vals
        from public.crm_dropdown_options where active group by category) q), '{}'::jsonb),
    'teamNames', coalesce((select jsonb_agg(name order by name) from public.app_users where state = 'active'), '[]'::jsonb)
  );
end $$;

-- ---------- RLS + grants ----------
do $$
declare t text;
begin
  foreach t in array array['partners', 'opportunities', 'crm_dropdown_options']
  loop
    execute format('alter table public.%I enable row level security', t);
    execute format('drop policy if exists "read for authenticated" on public.%I', t);
    execute format('create policy "read for authenticated" on public.%I for select to authenticated using (true)', t);
  end loop;
end $$;

do $$
declare fn text;
begin
  foreach fn in array array[
    'create_engagement(text,text,text,text,text,text)',
    'create_partner(text,text,text,text,text)',
    'create_opportunity(text,text,text,text,text)']
  loop
    execute format('revoke execute on function public.%s from public, anon', fn);
    execute format('grant execute on function public.%s to authenticated', fn);
  end loop;
end $$;


-- ============================================================
-- Jikoni — CRM: the New Engagement form drops the Stage picker and
-- gains a free-text "where we are on the discussion" note.
--   * stage is no longer collected — new engagements enter at the top
--     of the funnel (Discovery upstream / Identification downstream)
--   * the note (p_next_action) is stored as the engagement's first
--     entry in engagement_updates, so it shows in the updates log
-- Same 6-arg signature as 0011, so existing grants stay valid.
-- Idempotent: safe to re-run.
-- ============================================================

create or replace function public.create_engagement(
  p_name text, p_stage text, p_owner_name text, p_pipeline text,
  p_next_action text default null, p_due_key text default 'week'
) returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_ref text; v_pill text; v_pill_txt text; v_stage text; v_id uuid; v_who text;
  v_note text := nullif(trim(coalesce(p_next_action, '')), '');
  v_entity uuid := (select id from public.entities where code = 'KE');
begin
  perform public.assert_access('crm', 2);
  v_ref := public.next_ref(case when p_pipeline = 'down' then 'DST' else 'ENG' end);
  -- stage is no longer asked on the form; start at the top of the funnel
  v_stage := coalesce(nullif(trim(coalesce(p_stage, '')), ''),
                      case when p_pipeline = 'down' then 'Identification' else 'Discovery' end);
  select case p_due_key when 'today' then 'today' when 'over' then 'over' else 'week' end,
         case p_due_key when 'today' then 'Today' when 'over' then 'Overdue' when 'nweek' then 'Next week' else 'This week' end
    into v_pill, v_pill_txt;
  insert into public.engagements(ref, entity_id, name, stage, owner_name, pill, pill_txt, pipeline)
  values (v_ref, v_entity, p_name, v_stage, p_owner_name, v_pill, v_pill_txt, p_pipeline)
  returning id into v_id;
  -- "where we are on the discussion" seeds the engagement's update log
  if v_note is not null then
    v_who := coalesce((select name from public.app_users where auth_id = auth.uid()), p_owner_name);
    insert into public.engagement_updates(engagement_id, channel, who, note, happened)
    values (v_id, 'Note', v_who, v_note, 'Today');
  end if;
  perform public.audit_write('engagement.created', 'engagement', v_ref,
    jsonb_build_object('name', p_name, 'stage', v_stage, 'owner', p_owner_name, 'pipeline', p_pipeline, 'note', v_note));
  return jsonb_build_object(
    'id', v_ref, 'n', p_name, 'st', v_stage, 'o', p_owner_name,
    'pl', v_pill, 'plt', v_pill_txt, 'pipeline', p_pipeline);
end $$;

revoke execute on function public.create_engagement(text,text,text,text,text,text) from public, anon;
grant execute on function public.create_engagement(text,text,text,text,text,text) to authenticated;


-- ============================================================
-- Jikoni Master PRD — Phase 2a follow-up: Inventory management RPCs
-- Fills the gaps that left the Inventory & Assets screens read-only:
--   * create_stock_item   — register a new SKU (levels stay empty until a receipt)
--   * update_stock_item    — edit reorder level / reorder qty / unit cost
--   * set_dispatch_state   — advance a dispatch (dispatched → delivered, → cancelled)
--   * dispose_asset        — retire an asset (active → disposed)
-- Movement posting, transfers, adjustments, asset registration and depreciation
-- already exist in 0004; these four are the only net-new server functions.
-- The dispatch/asset/stock_item state machines (0004:117-136) validate the
-- transitions, so the state RPCs just update the column.
-- Idempotent: safe to re-run.
-- ============================================================

-- SKU counter — used when the caller doesn't supply a code (the form no longer asks for one)
insert into public.ref_counters(kind, prefix, n) values ('SKU', 'SKU-', 100)
on conflict (kind) do nothing;

-- ---------- new SKU (code auto-generated when not supplied) ----------
create or replace function public.create_stock_item(
  p_sku text default null, p_name text default null, p_category text default null, p_unit text default 'unit',
  p_unit_cost numeric default 0, p_reorder_level numeric default 0,
  p_reorder_qty numeric default 0, p_budget_code text default null
) returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_entity uuid := (select id from public.entities where code = 'KE');
  v_code text := nullif(trim(coalesce(p_budget_code, '')), '');
  v_sku  text := nullif(trim(coalesce(p_sku, '')), '');
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
  insert into public.stock_items(entity_id, sku, name, category, unit, unit_cost, reorder_level, reorder_qty, budget_code)
  values (v_entity, v_sku, p_name, nullif(trim(coalesce(p_category,'')),''), coalesce(nullif(trim(p_unit),''),'unit'),
          coalesce(p_unit_cost,0), coalesce(p_reorder_level,0), coalesce(p_reorder_qty,0), v_code);
  perform public.audit_write('inventory.item_created', 'stock_item', v_sku,
    jsonb_build_object('name', p_name, 'category', p_category, 'unitCost', p_unit_cost,
                       'reorderLevel', p_reorder_level, 'budgetCode', v_code));
  -- shape matches bootstrap().inventory.items so the caller can reload
  return jsonb_build_object('sku', v_sku, 'name', p_name, 'category', p_category, 'unit', p_unit,
    'unitCost', coalesce(p_unit_cost,0), 'reorderLevel', coalesce(p_reorder_level,0), 'onHand', 0, 'autoReq', null);
end $$;

-- ---------- edit reorder policy / cost ----------
create or replace function public.update_stock_item(
  p_sku text, p_reorder_level numeric, p_reorder_qty numeric, p_unit_cost numeric
) returns jsonb language plpgsql security definer set search_path = public as $$
declare it record;
begin
  perform public.assert_access('inventory', 2);
  select * into it from public.stock_items where sku = p_sku;
  if not found then raise exception 'Unknown stock item: %', p_sku; end if;
  update public.stock_items
     set reorder_level = coalesce(p_reorder_level, reorder_level),
         reorder_qty   = coalesce(p_reorder_qty, reorder_qty),
         unit_cost     = coalesce(p_unit_cost, unit_cost),
         updated_at    = now()
   where sku = p_sku;
  perform public.audit_write('inventory.item_updated', 'stock_item', p_sku,
    jsonb_build_object(
      'reorderLevel', jsonb_build_object('from', it.reorder_level, 'to', coalesce(p_reorder_level, it.reorder_level)),
      'reorderQty',   jsonb_build_object('from', it.reorder_qty,   'to', coalesce(p_reorder_qty, it.reorder_qty)),
      'unitCost',     jsonb_build_object('from', it.unit_cost,     'to', coalesce(p_unit_cost, it.unit_cost))));
  return jsonb_build_object('sku', p_sku,
    'reorderLevel', coalesce(p_reorder_level, it.reorder_level),
    'unitCost', coalesce(p_unit_cost, it.unit_cost));
end $$;

-- ---------- advance a dispatch (state machine enforces the transition) ----------
create or replace function public.set_dispatch_state(p_ref text, p_state text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare d record;
begin
  perform public.assert_access('inventory', 2);
  select * into d from public.dispatches where ref = p_ref;
  if not found then raise exception 'Unknown dispatch: %', p_ref; end if;
  update public.dispatches set state = p_state, updated_at = now() where ref = p_ref;
  perform public.audit_write('dispatch.state_changed', 'dispatch', p_ref,
    jsonb_build_object('from', d.state, 'to', p_state));
  return jsonb_build_object('id', p_ref, 'state', p_state);
end $$;

-- ---------- retire an asset (active → disposed) ----------
create or replace function public.dispose_asset(p_ref text, p_reason text default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare a record;
begin
  perform public.assert_access('inventory', 2);
  select * into a from public.assets where ref = p_ref;
  if not found then raise exception 'Unknown asset: %', p_ref; end if;
  if a.state = 'disposed' then raise exception 'Asset % is already disposed', p_ref; end if;
  update public.assets set state = 'disposed', updated_at = now() where ref = p_ref;
  perform public.audit_write('asset.disposed', 'asset', p_ref,
    jsonb_build_object('name', a.name, 'nbv', a.cost - a.accum_dep, 'reason', nullif(trim(coalesce(p_reason,'')),'')));
  return jsonb_build_object('id', p_ref, 'state', 'disposed');
end $$;

-- ---------- grants: authenticated only, never public/anon ----------
do $$
declare fn text;
begin
  foreach fn in array array[
    'create_stock_item(text,text,text,text,numeric,numeric,numeric,text)',
    'update_stock_item(text,numeric,numeric,numeric)',
    'set_dispatch_state(text,text)',
    'dispose_asset(text,text)']
  loop
    execute format('revoke execute on function public.%s from public, anon', fn);
    execute format('grant execute on function public.%s to authenticated', fn);
  end loop;
end $$;


-- ============================================================
-- Jikoni Master PRD — Phase 2b: delivery receipts on dispatches
-- Once a dispatch is marked "delivered" the field team attaches a proof-of-
-- delivery receipt (photo / signed note / PDF). The file lives in Supabase
-- Storage; the dispatch row just keeps the object path.
--   * dispatches.receipt_path   — storage path of the uploaded receipt
--   * attach_dispatch_receipt() — records the path (inventory edit access)
--   * storage bucket 'dispatch-receipts' (public read, authenticated write)
-- Idempotent: safe to re-run.
-- ============================================================

-- ---------- column ----------
alter table public.dispatches add column if not exists receipt_path text;

-- ---------- storage bucket + policies (wrapped so a locked-down role can't abort the migration) ----------
do $$
begin
  insert into storage.buckets (id, name, public)
  values ('dispatch-receipts', 'dispatch-receipts', true)
  on conflict (id) do nothing;

  drop policy if exists "dispatch receipts read"   on storage.objects;
  drop policy if exists "dispatch receipts insert" on storage.objects;
  drop policy if exists "dispatch receipts update" on storage.objects;

  create policy "dispatch receipts read" on storage.objects
    for select to public using (bucket_id = 'dispatch-receipts');
  create policy "dispatch receipts insert" on storage.objects
    for insert to authenticated with check (bucket_id = 'dispatch-receipts');
  create policy "dispatch receipts update" on storage.objects
    for update to authenticated using (bucket_id = 'dispatch-receipts');
exception when others then
  raise notice 'storage bucket/policy setup skipped: %', sqlerrm;
end $$;

-- ---------- attach a receipt to a dispatch ----------
create or replace function public.attach_dispatch_receipt(p_ref text, p_path text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare d record;
begin
  perform public.assert_access('inventory', 2);
  if nullif(trim(coalesce(p_path, '')), '') is null then
    raise exception 'A receipt file is required';
  end if;
  select * into d from public.dispatches where ref = p_ref;
  if not found then raise exception 'Unknown dispatch: %', p_ref; end if;
  update public.dispatches set receipt_path = p_path, updated_at = now() where ref = p_ref;
  perform public.audit_write('dispatch.receipt_attached', 'dispatch', p_ref,
    jsonb_build_object('path', p_path));
  return jsonb_build_object('id', p_ref, 'receipt', p_path);
end $$;

-- ---------- grant: authenticated only, never public/anon ----------
do $$
begin
  revoke execute on function public.attach_dispatch_receipt(text, text) from public, anon;
  grant  execute on function public.attach_dispatch_receipt(text, text) to authenticated;
end $$;


-- ============================================================
-- Jikoni Master PRD — Phase 2c: HR module write path (full CRUD) + demo seeds
-- The HR backend (0005) shipped read models + the payroll/leave state machines
-- but no create RPCs, so the Hr.tsx screens were read-only mock-ups. This adds:
--   * add_employee            — new app_user (login-less) + staff_file + leave balances
--   * create_recruitment_req  — open a vacancy
--   * add_candidate / advance_candidate — applicant pipeline
--   * create_enumerator       — register a field worker
--   * create_field_assignment / set_field_assignment_state — per-diems & casual work
-- Plus demo rows for candidates / field_assignments and one posted payroll run so
-- the Recruitment, Field and Payroll screens render populated.
-- Idempotent: safe to re-run.
-- ============================================================

-- staff-number counter (seeds used IGN-00x by hand; new hires get STF-1xx)
insert into public.ref_counters(kind, prefix, n) values ('STF', 'STF-', 100)
on conflict (kind) do nothing;

-- 0005 seeded RCR-101/102 with hardcoded refs but left the counter at 100, so the
-- first next_ref('RCR') would collide. Bump it past the highest existing ref (idempotent).
update public.ref_counters c
   set n = greatest(c.n, coalesce((select max(split_part(ref, '-', 2)::int) from public.recruitment_reqs), 0))
 where c.kind = 'RCR';

-- ---------- add employee: user + staff file + opening leave balances ----------
create or replace function public.add_employee(
  p_name text, p_email text, p_role_title text default null,
  p_contract_type text default 'permanent', p_start_date date default current_date,
  p_gross_salary numeric default 0, p_kra text default null, p_nssf text default null,
  p_shif text default null, p_bank text default null
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
  if exists (select 1 from public.app_users where email = v_email) then
    raise exception 'A user with email % already exists', v_email;
  end if;
  -- login-less user; it links to a real auth account by email when they first sign in
  insert into public.app_users(entity_id, name, email, role_title, role_key)
  values (v_entity, trim(p_name), v_email, nullif(trim(coalesce(p_role_title,'')),''), 'std')
  returning id into v_user;
  v_staff := public.next_ref('STF');
  insert into public.staff_files(entity_id, app_user_id, staff_no, kra_pin, nssf_no, shif_no,
    contract_type, start_date, gross_salary, bank, docs)
  values (v_entity, v_user, v_staff,
    nullif(trim(coalesce(p_kra,'')),''), nullif(trim(coalesce(p_nssf,'')),''), nullif(trim(coalesce(p_shif,'')),''),
    p_contract_type, p_start_date, coalesce(p_gross_salary,0), nullif(trim(coalesce(p_bank,'')),''),
    jsonb_build_array(jsonb_build_object('name','Employment contract','version',1,'uploaded',to_char(coalesce(p_start_date,current_date),'YYYY-MM-DD'))));
  -- opening leave balances for the joining year, from policy
  insert into public.leave_balances(app_user_id, kind, year, entitled, used)
  select v_user, kind, v_year, days_per_year, 0 from public.leave_policies
  on conflict (app_user_id, kind, year) do nothing;
  perform public.audit_write('hr.employee_added','staff', v_staff,
    jsonb_build_object('name', p_name, 'email', v_email, 'contract', p_contract_type, 'gross', p_gross_salary));
  return jsonb_build_object('staffNo', v_staff, 'name', p_name, 'email', v_email);
end $$;

-- ---------- recruitment: open a vacancy ----------
create or replace function public.create_recruitment_req(p_role_title text, p_dept text default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_ref text; v_entity uuid := (select id from public.entities where code = 'KE');
begin
  perform public.assert_access('hr', 2);
  if nullif(trim(coalesce(p_role_title,'')),'') is null then raise exception 'A requisition needs a role title'; end if;
  v_ref := public.next_ref('RCR');
  insert into public.recruitment_reqs(ref, entity_id, role_title, dept, state)
  values (v_ref, v_entity, trim(p_role_title), nullif(trim(coalesce(p_dept,'')),''), 'open');
  perform public.audit_write('hr.requisition_created','recruitment', v_ref,
    jsonb_build_object('role', p_role_title, 'dept', p_dept));
  return jsonb_build_object('id', v_ref, 'role', p_role_title, 'dept', p_dept, 'state', 'open');
end $$;

-- ---------- recruitment: add a candidate to the pipeline ----------
create or replace function public.add_candidate(p_req_ref text, p_name text, p_email text default null, p_stage text default 'applied')
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_req uuid; v_id uuid;
begin
  perform public.assert_access('hr', 2);
  select id into v_req from public.recruitment_reqs where ref = p_req_ref;
  if v_req is null then raise exception 'Unknown requisition: %', p_req_ref; end if;
  if nullif(trim(coalesce(p_name,'')),'') is null then raise exception 'A candidate needs a name'; end if;
  insert into public.candidates(recruitment_id, name, email, stage)
  values (v_req, trim(p_name), nullif(trim(coalesce(p_email,'')),''), coalesce(nullif(trim(p_stage),''),'applied'))
  returning id into v_id;
  perform public.audit_write('hr.candidate_added','recruitment', p_req_ref,
    jsonb_build_object('name', p_name, 'stage', p_stage));
  return jsonb_build_object('id', v_id, 'name', p_name, 'stage', p_stage);
end $$;

create or replace function public.advance_candidate(p_candidate_id uuid, p_stage text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare c record;
begin
  perform public.assert_access('hr', 2);
  select * into c from public.candidates where id = p_candidate_id;
  if not found then raise exception 'Candidate not found'; end if;
  update public.candidates set stage = p_stage, updated_at = now() where id = p_candidate_id;
  perform public.audit_write('hr.candidate_advanced','recruitment', c.recruitment_id::text,
    jsonb_build_object('candidate', c.name, 'from', c.stage, 'to', p_stage));
  return jsonb_build_object('id', p_candidate_id, 'stage', p_stage);
end $$;

-- ---------- field workforce: register an enumerator ----------
create or replace function public.create_enumerator(p_name text, p_county text default null, p_id_no text default null, p_daily_rate numeric default 0)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_id uuid; v_entity uuid := (select id from public.entities where code = 'KE');
begin
  perform public.assert_access('hr', 2);
  if nullif(trim(coalesce(p_name,'')),'') is null then raise exception 'An enumerator needs a name'; end if;
  insert into public.enumerators(entity_id, name, county, id_no, daily_rate)
  values (v_entity, trim(p_name), nullif(trim(coalesce(p_county,'')),''), nullif(trim(coalesce(p_id_no,'')),''), coalesce(p_daily_rate,0))
  returning id into v_id;
  perform public.audit_write('hr.enumerator_created','enumerator', v_id::text,
    jsonb_build_object('name', p_name, 'county', p_county, 'dailyRate', p_daily_rate));
  return jsonb_build_object('id', v_id, 'name', p_name, 'county', p_county);
end $$;

-- ---------- field workforce: per-diem / casual assignment ----------
create or replace function public.create_field_assignment(
  p_enumerator_id uuid, p_project text default null, p_period text default null,
  p_days numeric default 0, p_per_diem numeric default 0, p_contract_doc text default null
) returns jsonb language plpgsql security definer set search_path = public as $$
declare v_id uuid; v_entity uuid := (select id from public.entities where code = 'KE');
begin
  perform public.assert_access('hr', 2);
  if not exists (select 1 from public.enumerators where id = p_enumerator_id) then
    raise exception 'Unknown enumerator';
  end if;
  if p_project is not null and not exists (select 1 from public.projects where name = p_project) then
    raise exception 'Unknown project: %', p_project;
  end if;
  insert into public.field_assignments(entity_id, enumerator_id, project_name, period, days, per_diem, contract_doc, state)
  values (v_entity, p_enumerator_id, p_project, nullif(trim(coalesce(p_period,'')),''), coalesce(p_days,0),
          coalesce(p_per_diem,0), nullif(trim(coalesce(p_contract_doc,'')),''), 'planned')
  returning id into v_id;
  perform public.audit_write('hr.field_assignment_created','field_assignment', v_id::text,
    jsonb_build_object('project', p_project, 'period', p_period, 'days', p_days, 'perDiem', p_per_diem));
  return jsonb_build_object('id', v_id, 'project', p_project, 'perDiem', p_per_diem, 'state', 'planned');
end $$;

create or replace function public.set_field_assignment_state(p_id uuid, p_state text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare a record;
begin
  perform public.assert_access('hr', 2);
  select * into a from public.field_assignments where id = p_id;
  if not found then raise exception 'Field assignment not found'; end if;
  if p_state not in ('planned','active','complete','cancelled') then raise exception 'Unknown state: %', p_state; end if;
  update public.field_assignments set state = p_state, updated_at = now() where id = p_id;
  perform public.audit_write('hr.field_assignment_state','field_assignment', p_id::text,
    jsonb_build_object('from', a.state, 'to', p_state));
  return jsonb_build_object('id', p_id, 'state', p_state);
end $$;

-- ---------- grants: authenticated only ----------
do $$
declare fn text;
begin
  foreach fn in array array[
    'add_employee(text,text,text,text,date,numeric,text,text,text,text)',
    'create_recruitment_req(text,text)',
    'add_candidate(text,text,text,text)',
    'advance_candidate(uuid,text)',
    'create_enumerator(text,text,text,numeric)',
    'create_field_assignment(uuid,text,text,numeric,numeric,text)',
    'set_field_assignment_state(uuid,text)']
  loop
    execute format('revoke execute on function public.%s from public, anon', fn);
    execute format('grant execute on function public.%s to authenticated', fn);
  end loop;
end $$;

-- ============================================================
-- Demo seeds (idempotent — only when the tables are empty)
-- ============================================================

-- applicant pipeline for the two seeded requisitions
insert into public.candidates(recruitment_id, name, email, stage)
select r.id, v.name, v.email, v.stage
from public.recruitment_reqs r
join (values
  ('RCR-101', 'Mercy Achieng',  'mercy.achieng@example.co.ke',  'offer'),
  ('RCR-101', 'John Mwangi',    'john.mwangi@example.co.ke',    'interviewed'),
  ('RCR-101', 'Faith Chelangat','faith.chelangat@example.co.ke','screened'),
  ('RCR-101', 'Kevin Odhiambo', 'kevin.odhiambo@example.co.ke', 'applied'),
  ('RCR-102', 'Brenda Nyaboke', 'brenda.nyaboke@example.co.ke', 'screened'),
  ('RCR-102', 'Daniel Kiptoo',  'daniel.kiptoo@example.co.ke',  'applied')
) as v(ref, name, email, stage) on v.ref = r.ref
where not exists (select 1 from public.candidates);

-- field assignments / per-diems for the seeded enumerators
insert into public.field_assignments(entity_id, enumerator_id, project_name, period, days, per_diem, contract_doc, state)
select (select id from public.entities where code='KE'), e.id, v.project, v.period, v.days, v.per_diem, v.doc, v.state
from public.enumerators e
join (values
  ('Peter Otieno',   '5-County data collection', '2026-07', 8, 14400, 'CAS-2026-011', 'active'),
  ('Grace Wambui',   '5-County data collection', '2026-07', 6, 10800, 'CAS-2026-012', 'active'),
  ('Samuel Kilonzo', 'Makueni VTC rollout',      '2026-07', 4,  7200, 'CAS-2026-013', 'planned'),
  ('Aisha Noor',     '5-County data collection', '2026-07', 5, 10000, 'CAS-2026-014', 'complete')
) as v(name, project, period, days, per_diem, doc, state) on v.name = e.name
where not exists (select 1 from public.field_assignments);

-- one posted payroll run for the prior period, so Payroll history + portal payslips populate.
-- system_action bypasses assert_access; SoD is off and null actors no-op it.
do $$
declare v_ref text;
begin
  if not exists (select 1 from public.payroll_runs where period = '2026-06') then
    perform set_config('jikoni.system_action', 'true', false);
    v_ref := (public.prepare_payroll('2026-06'))->>'id';
    perform public.approve_payroll(v_ref);
    perform public.post_payroll(v_ref);
    perform set_config('jikoni.system_action', '', false);
  end if;
exception when others then
  raise notice 'demo payroll seed skipped: %', sqlerrm;
end $$;


-- ============================================================
-- Jikoni Master PRD — Phase 2c: staff self-service documents
-- Staff upload documents to their own personal file (from the Staff Portal),
-- and can attach a supporting document (e.g. a sick note) when they apply for
-- leave. Files live in a PRIVATE Supabase Storage bucket; the metadata is
-- appended to staff_files.docs so HR sees it on the staff file, and a leave
-- attachment also stamps leave_applications.doc_path so it shows in the queue.
--   * bucket 'staff-documents'  — private; owner + HR read, owner writes own prefix
--   * leave_applications.doc_path — optional attachment on a leave request
--   * add_staff_document()      — append a doc to the caller's own file
-- Path convention: <app_user_id>/<category>/<timestamp>-<filename>
-- Idempotent: safe to re-run.
-- ============================================================

-- ---------- attachment column on a leave request ----------
alter table public.leave_applications add column if not exists doc_path text;

-- ---------- private storage bucket + policies ----------
-- (wrapped so a locked-down role can't abort the migration)
do $$
begin
  insert into storage.buckets (id, name, public)
  values ('staff-documents', 'staff-documents', false)
  on conflict (id) do nothing;

  drop policy if exists "staff docs read"   on storage.objects;
  drop policy if exists "staff docs insert" on storage.objects;
  drop policy if exists "staff docs update" on storage.objects;

  -- Read: the owner (their own <app_user_id>/ prefix) or anyone with HR access.
  create policy "staff docs read" on storage.objects
    for select to authenticated using (
      bucket_id = 'staff-documents' and (
        split_part(name, '/', 1) = (select id::text from public.app_users where auth_id = auth.uid())
        or exists (
          select 1 from public.user_permissions up
          join public.app_users u on u.email = up.email
          where u.auth_id = auth.uid() and up.module = 'hr' and up.level >= 1)
      ));
  -- Write: only into your own <app_user_id>/ prefix.
  create policy "staff docs insert" on storage.objects
    for insert to authenticated with check (
      bucket_id = 'staff-documents'
      and split_part(name, '/', 1) = (select id::text from public.app_users where auth_id = auth.uid()));
  create policy "staff docs update" on storage.objects
    for update to authenticated using (
      bucket_id = 'staff-documents'
      and split_part(name, '/', 1) = (select id::text from public.app_users where auth_id = auth.uid()));
exception when others then
  raise notice 'staff-documents bucket/policy setup skipped: %', sqlerrm;
end $$;

-- ---------- append a document to the caller's own staff file ----------
create or replace function public.add_staff_document(
  p_name text, p_path text, p_category text default 'other', p_leave_ref text default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_me uuid := (select id from public.app_users where auth_id = auth.uid());
  v_ver int;
  v_entry jsonb;
begin
  if v_me is null then raise exception 'No staff record for this login'; end if;
  if nullif(trim(coalesce(p_name, '')), '') is null then raise exception 'A document name is required'; end if;
  if nullif(trim(coalesce(p_path, '')), '') is null then raise exception 'A file is required'; end if;
  if not exists (select 1 from public.staff_files where app_user_id = v_me) then
    raise exception 'No staff file for this login';
  end if;

  -- next version for a document of the same name
  v_ver := coalesce((
    select max((d->>'version')::int)
    from public.staff_files sf, jsonb_array_elements(sf.docs) d
    where sf.app_user_id = v_me and d->>'name' = p_name), 0) + 1;

  v_entry := jsonb_build_object(
    'name', p_name, 'version', v_ver, 'uploaded', to_char(now(), 'YYYY-MM-DD'),
    'path', p_path, 'category', coalesce(nullif(p_category, ''), 'other'), 'leaveRef', p_leave_ref);

  update public.staff_files set docs = docs || v_entry, updated_at = now() where app_user_id = v_me;

  -- a leave attachment also stamps the request so HR sees it in the approvals queue
  if p_leave_ref is not null then
    update public.leave_applications set doc_path = p_path, updated_at = now()
    where ref = p_leave_ref and app_user_id = v_me;
  end if;

  perform public.audit_write('staff.document_added', 'staff_file', v_me::text,
    jsonb_build_object('name', p_name, 'version', v_ver, 'category', p_category, 'leaveRef', p_leave_ref));
  return v_entry;
end $$;

-- ---------- surface doc_path in the self-service summary ----------
create or replace function public.my_hr_summary()
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare
  v_me uuid := (select id from public.app_users where auth_id = auth.uid());
begin
  if v_me is null then return '{}'::jsonb; end if;
  return jsonb_build_object(
    'leave', coalesce((select jsonb_agg(jsonb_build_object(
        'kind', kind, 'year', year, 'entitled', entitled, 'used', used, 'reserved', reserved))
      from public.leave_balances where app_user_id = v_me), '[]'::jsonb),
    'applications', coalesce((select jsonb_agg(jsonb_build_object(
        'id', ref, 'kind', kind, 'from', from_date, 'to', to_date, 'days', days, 'state', state, 'docPath', doc_path)
        order by created_at desc)
      from public.leave_applications where app_user_id = v_me), '[]'::jsonb),
    'payslips', coalesce((select jsonb_agg(jsonb_build_object(
        'period', pr.period, 'gross', i.gross, 'paye', i.paye, 'nssf', i.nssf,
        'shif', i.shif, 'housing', i.housing, 'net', i.net) order by pr.period desc)
      from public.payroll_items i join public.payroll_runs pr on pr.id = i.run_id
      where i.app_user_id = v_me and pr.state = 'posted'), '[]'::jsonb),
    'docs', coalesce((select docs from public.staff_files where app_user_id = v_me), '[]'::jsonb));
end $$;

-- ---------- grant: authenticated only, never public/anon ----------
do $$
begin
  revoke execute on function public.add_staff_document(text, text, text, text) from public, anon;
  grant  execute on function public.add_staff_document(text, text, text, text) to authenticated;
end $$;


-- ============================================================
-- Jikoni Master PRD — Phase 2c: delete a staff self-service document
-- Staff can remove a document they uploaded to their own personal file
-- (from the Staff Portal). Removes the metadata entry from staff_files.docs
-- and, if the doc was a leave attachment, clears leave_applications.doc_path.
-- The underlying object is deleted from the private 'staff-documents' bucket
-- by the client (owner-scoped storage delete policy added below).
--   * delete_staff_document() — remove a doc from the caller's own file by path
--   * "staff docs delete"     — owner may delete objects under their own prefix
-- Idempotent: safe to re-run.
-- ============================================================

-- ---------- storage delete policy: owner may delete their own objects ----------
do $$
begin
  drop policy if exists "staff docs delete" on storage.objects;
  create policy "staff docs delete" on storage.objects
    for delete to authenticated using (
      bucket_id = 'staff-documents'
      and split_part(name, '/', 1) = (select id::text from public.app_users where auth_id = auth.uid()));
exception when others then
  raise notice 'staff-documents delete policy setup skipped: %', sqlerrm;
end $$;

-- ---------- remove a document from the caller's own staff file ----------
create or replace function public.delete_staff_document(p_path text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_me uuid := (select id from public.app_users where auth_id = auth.uid());
  v_entry jsonb;
begin
  if v_me is null then raise exception 'No staff record for this login'; end if;
  if nullif(trim(coalesce(p_path, '')), '') is null then raise exception 'A document path is required'; end if;

  -- locate the entry so we can audit it and honour any leave link
  select d into v_entry
  from public.staff_files sf, jsonb_array_elements(sf.docs) d
  where sf.app_user_id = v_me and d->>'path' = p_path
  limit 1;
  if v_entry is null then raise exception 'That document is not on your file'; end if;

  -- drop the matching entry from the docs array
  update public.staff_files
    set docs = coalesce((
        select jsonb_agg(d)
        from jsonb_array_elements(docs) d
        where d->>'path' <> p_path), '[]'::jsonb),
        updated_at = now()
  where app_user_id = v_me;

  -- if it was a leave attachment, unstamp the request
  if v_entry->>'leaveRef' is not null then
    update public.leave_applications set doc_path = null, updated_at = now()
    where ref = v_entry->>'leaveRef' and app_user_id = v_me and doc_path = p_path;
  end if;

  perform public.audit_write('staff.document_deleted', 'staff_file', v_me::text,
    jsonb_build_object('name', v_entry->>'name', 'version', v_entry->>'version',
      'category', v_entry->>'category', 'leaveRef', v_entry->>'leaveRef'));
  return v_entry;
end $$;

-- ---------- grant: authenticated only, never public/anon ----------
do $$
begin
  revoke execute on function public.delete_staff_document(text) from public, anon;
  grant  execute on function public.delete_staff_document(text) to authenticated;
end $$;


-- ============================================================
-- Jikoni Master PRD — Phase 3: interactive Projects & Programmes
-- The projects module was read-only. This adds the write RPCs the project
-- drawer needs to manage a project end-to-end: milestones, drawdowns, field
-- activity and status. Each RPC checks projects-edit access, audits, and
-- returns the refreshed single-project detail so the UI can upsert without a
-- full reload. project_detail_json is extended to expose row ids + state.
-- Idempotent: safe to re-run.
-- ============================================================

-- ---------- expose ids + state so the UI can target rows ----------
create or replace function public.project_detail_json(p_id uuid) returns jsonb
language sql stable security definer set search_path = public as $$
  select jsonb_build_object(
    'id', p.id, 'state', p.state,
    'funder', p.funder, 'status', p.status, 'budget', p.budget_txt, 'spent', p.spent_txt,
    'pct', p.pct, 'timeline', p.timeline, 'team', p.team, 'reporting', p.reporting, 'field', p.field,
    'docs', p.docs,
    'milestones', coalesce((select jsonb_agg(jsonb_build_object('id', id, 't', title, 's', status) order by sort)
                            from public.project_milestones where project_id = p.id), '[]'::jsonb),
    'drawdowns',  coalesce((select jsonb_agg(jsonb_build_object('id', id, 't', title, 'v', amount_txt, 's', status) order by sort)
                            from public.project_drawdowns where project_id = p.id), '[]'::jsonb))
  from public.projects p where p.id = p_id
$$;

-- helper: { name, detail } payload for a project by id
create or replace function public.project_payload(p_id uuid) returns jsonb
language sql stable security definer set search_path = public as $$
  select jsonb_build_object('name', name, 'detail', public.project_detail_json(id))
  from public.projects where id = p_id
$$;

-- ---------- milestones ----------
create or replace function public.add_project_milestone(
  p_project_id uuid, p_title text, p_status text default 'todo')
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_sort int;
begin
  perform public.assert_access('projects', 2);
  if nullif(trim(coalesce(p_title, '')), '') is null then raise exception 'A milestone title is required'; end if;
  if p_status not in ('done','now','todo') then raise exception 'Invalid milestone status %', p_status; end if;
  if not exists (select 1 from public.projects where id = p_project_id) then raise exception 'Project not found'; end if;
  select coalesce(max(sort), 0) + 1 into v_sort from public.project_milestones where project_id = p_project_id;
  insert into public.project_milestones(project_id, title, status, sort)
  values (p_project_id, trim(p_title), p_status, v_sort);
  perform public.audit_write('project.milestone_added','project', p_project_id::text,
    jsonb_build_object('title', p_title, 'status', p_status));
  return public.project_payload(p_project_id);
end $$;

create or replace function public.set_milestone_status(p_milestone_id uuid, p_status text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_project uuid;
begin
  perform public.assert_access('projects', 2);
  if p_status not in ('done','now','todo') then raise exception 'Invalid milestone status %', p_status; end if;
  update public.project_milestones set status = p_status where id = p_milestone_id returning project_id into v_project;
  if v_project is null then raise exception 'Milestone not found'; end if;
  perform public.audit_write('project.milestone_status','project', v_project::text,
    jsonb_build_object('milestone', p_milestone_id, 'status', p_status));
  return public.project_payload(v_project);
end $$;

-- ---------- drawdowns ----------
create or replace function public.add_project_drawdown(
  p_project_id uuid, p_title text, p_amount_txt text, p_status text default 'Requested')
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_sort int;
begin
  perform public.assert_access('projects', 2);
  if nullif(trim(coalesce(p_title, '')), '') is null then raise exception 'A drawdown title is required'; end if;
  if nullif(trim(coalesce(p_amount_txt, '')), '') is null then raise exception 'An amount is required'; end if;
  if p_status not in ('Requested','Received','On schedule','Cancelled') then raise exception 'Invalid drawdown status %', p_status; end if;
  if not exists (select 1 from public.projects where id = p_project_id) then raise exception 'Project not found'; end if;
  select coalesce(max(sort), 0) + 1 into v_sort from public.project_drawdowns where project_id = p_project_id;
  insert into public.project_drawdowns(project_id, title, amount_txt, status, sort)
  values (p_project_id, trim(p_title), trim(p_amount_txt), p_status, v_sort);
  perform public.audit_write('project.drawdown_added','project', p_project_id::text,
    jsonb_build_object('title', p_title, 'amount', p_amount_txt, 'status', p_status));
  return public.project_payload(p_project_id);
end $$;

create or replace function public.set_drawdown_status(p_drawdown_id uuid, p_status text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_project uuid;
begin
  perform public.assert_access('projects', 2);
  if p_status not in ('Requested','Received','On schedule','Cancelled') then raise exception 'Invalid drawdown status %', p_status; end if;
  update public.project_drawdowns set status = p_status where id = p_drawdown_id returning project_id into v_project;
  if v_project is null then raise exception 'Drawdown not found'; end if;
  perform public.audit_write('project.drawdown_status','project', v_project::text,
    jsonb_build_object('drawdown', p_drawdown_id, 'status', p_status));
  return public.project_payload(v_project);
end $$;

-- ---------- field activity (also refreshes the project's field summary string) ----------
create or replace function public.log_field_activity(
  p_project_id uuid, p_kind text, p_county text default null, p_note text default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_visits int; v_installs int; v_assess int; v_parts text[]; v_summary text;
begin
  perform public.assert_access('projects', 2);
  if p_kind not in ('site_visit','install','readiness_assessment') then raise exception 'Invalid activity kind %', p_kind; end if;
  if not exists (select 1 from public.projects where id = p_project_id) then raise exception 'Project not found'; end if;

  insert into public.field_activities(project_id, kind, county, note)
  values (p_project_id, p_kind, nullif(trim(coalesce(p_county,'')), ''), nullif(trim(coalesce(p_note,'')), ''));

  -- recompute the display summary on projects.field
  select count(*) filter (where kind = 'site_visit'),
         count(*) filter (where kind = 'install'),
         count(*) filter (where kind = 'readiness_assessment')
    into v_visits, v_installs, v_assess
  from public.field_activities where project_id = p_project_id;

  v_parts := array[]::text[];
  if v_visits  > 0 then v_parts := v_parts || (v_visits  || ' site visit'  || case when v_visits  = 1 then '' else 's' end); end if;
  if v_installs> 0 then v_parts := v_parts || (v_installs|| ' install'     || case when v_installs= 1 then '' else 's' end); end if;
  if v_assess  > 0 then v_parts := v_parts || (v_assess  || ' assessment'  || case when v_assess  = 1 then '' else 's' end); end if;
  v_summary := array_to_string(v_parts, ' · ') || ' logged';

  update public.projects set field = v_summary, updated_at = now() where id = p_project_id;
  perform public.audit_write('project.field_activity','project', p_project_id::text,
    jsonb_build_object('kind', p_kind, 'county', p_county));
  return public.project_payload(p_project_id);
end $$;

-- ---------- project status / state ----------
create or replace function public.set_project_state(p_project_id uuid, p_new_state text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_old text; v_status text;
begin
  perform public.assert_access('projects', 2);
  select state into v_old from public.projects where id = p_project_id;
  if v_old is null then raise exception 'Project not found'; end if;
  perform public.assert_transition('project', v_old, p_new_state);
  v_status := case p_new_state
    when 'active' then 'Active' when 'reporting' then 'Reporting'
    when 'closed' then 'Closed' else 'Setup' end;
  update public.projects set state = p_new_state, status = v_status, updated_at = now() where id = p_project_id;
  perform public.audit_write('project.state','project', p_project_id::text,
    jsonb_build_object('from', v_old, 'to', p_new_state));
  return public.project_payload(p_project_id);
end $$;

-- ---------- grants: authenticated only, never public/anon ----------
do $$
begin
  revoke execute on function
    public.add_project_milestone(uuid, text, text),
    public.set_milestone_status(uuid, text),
    public.add_project_drawdown(uuid, text, text, text),
    public.set_drawdown_status(uuid, text),
    public.log_field_activity(uuid, text, text, text),
    public.set_project_state(uuid, text)
  from public, anon;
  grant execute on function
    public.add_project_milestone(uuid, text, text),
    public.set_milestone_status(uuid, text),
    public.add_project_drawdown(uuid, text, text, text),
    public.set_drawdown_status(uuid, text),
    public.log_field_activity(uuid, text, text, text),
    public.set_project_state(uuid, text)
  to authenticated;
end $$;


-- ============================================================
-- Jikoni — Field workforce: auto-generate the casual contract reference
-- The New-field-assignment form no longer asks for a per-diem total or a
-- contract/doc ref. create_field_assignment now mints the contract reference
-- itself (CAS-<year>-<seq>) from a ref counter when the caller doesn't pass one,
-- so every casual assignment gets a unique, sequential doc reference.
-- Idempotent: safe to re-run.
-- ============================================================

-- casual-contract counter. Seeds (0015) used CAS-2026-011..014 by hand, so start
-- at 14 and bump past the highest existing CAS-YYYY-NNN so the next mint can't collide.
insert into public.ref_counters(kind, prefix, n) values ('CAS', 'CAS-', 14)
on conflict (kind) do nothing;

update public.ref_counters c
   set n = greatest(c.n, coalesce((
     select max(split_part(contract_doc, '-', 3)::int)
     from public.field_assignments
     where contract_doc ~ '^CAS-\d+-\d+$'
   ), 0))
 where c.kind = 'CAS';

-- Same signature as 0015 (defaults preserved) so PostgREST callers that omit
-- p_per_diem / p_contract_doc still resolve; contract_doc is generated when absent.
create or replace function public.create_field_assignment(
  p_enumerator_id uuid, p_project text default null, p_period text default null,
  p_days numeric default 0, p_per_diem numeric default 0, p_contract_doc text default null
) returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_id uuid; v_doc text; v_seq int;
  v_entity uuid := (select id from public.entities where code = 'KE');
begin
  perform public.assert_access('hr', 2);
  if not exists (select 1 from public.enumerators where id = p_enumerator_id) then
    raise exception 'Unknown enumerator';
  end if;
  if p_project is not null and not exists (select 1 from public.projects where name = p_project) then
    raise exception 'Unknown project: %', p_project;
  end if;
  -- use the caller's reference if one was given, otherwise auto-mint CAS-<year>-<seq>
  v_doc := nullif(trim(coalesce(p_contract_doc, '')), '');
  if v_doc is null then
    update public.ref_counters set n = n + 1 where kind = 'CAS' returning n into v_seq;
    v_doc := 'CAS-' || extract(year from current_date)::int || '-' || lpad(v_seq::text, 3, '0');
  end if;
  insert into public.field_assignments(entity_id, enumerator_id, project_name, period, days, per_diem, contract_doc, state)
  values (v_entity, p_enumerator_id, p_project, nullif(trim(coalesce(p_period,'')),''), coalesce(p_days,0),
          coalesce(p_per_diem,0), v_doc, 'planned')
  returning id into v_id;
  perform public.audit_write('hr.field_assignment_created','field_assignment', v_id::text,
    jsonb_build_object('project', p_project, 'period', p_period, 'days', p_days, 'contractDoc', v_doc));
  return jsonb_build_object('id', v_id, 'project', p_project, 'contractDoc', v_doc, 'state', 'planned');
end $$;

grant execute on function public.create_field_assignment(uuid,text,text,numeric,numeric,text) to authenticated;


-- ============================================================
-- Jikoni — Partnerships CRM: DB-backed engagement progress tracker
-- The engagement detail drawer was static mock data. This makes the two
-- interactive parts persistent so the owner/CEO can open a record and see the
-- real, saved progress of the conversation:
--   * engagement_notes     — the Updates log (channel/who/note + stage move)
--   * engagement_partners  — which partners an engagement involves (many)
--   * log_engagement_note()      — append a note, optionally advance the stage
--   * set_engagement_partners()  — replace the linked-partner set
-- Seeds the existing hardcoded updates so the log isn't empty on first load, and
-- extends bootstrap() to return per-engagement updates + an engPartners map.
-- Idempotent: safe to re-run.
-- ============================================================

-- ---------- tables ----------
create table if not exists public.engagement_notes (
  id            uuid primary key default gen_random_uuid(),
  engagement_id uuid not null references public.engagements(id) on delete cascade,
  channel       text,
  who           text,
  note          text not null,
  stage_from    text,
  stage_to      text,
  created_at    timestamptz not null default now()
);
create index if not exists engagement_notes_eng_idx on public.engagement_notes(engagement_id, created_at desc);

create table if not exists public.engagement_partners (
  engagement_id uuid not null references public.engagements(id) on delete cascade,
  partner_id    uuid not null references public.partners(id) on delete cascade,
  created_at    timestamptz not null default now(),
  primary key (engagement_id, partner_id)
);

-- ---------- RLS: read for signed-in users; writes only via definer RPCs ----------
do $$
declare t text;
begin
  foreach t in array array['engagement_notes', 'engagement_partners']
  loop
    execute format('alter table public.%I enable row level security', t);
    execute format('drop policy if exists "read for authenticated" on public.%I', t);
    execute format('create policy "read for authenticated" on public.%I for select to authenticated using (true)', t);
  end loop;
end $$;

-- ---------- RPC: log an update (diary note + optional stage move) ----------
create or replace function public.log_engagement_note(
  p_eng_ref text, p_channel text, p_who text, p_note text, p_stage_to text default null
) returns jsonb language plpgsql security definer set search_path = public as $$
declare
  e public.engagements;
  v_id uuid; v_stage_to text := nullif(trim(coalesce(p_stage_to, '')), '');
begin
  perform public.assert_access('crm', 2);
  select * into e from public.engagements where ref = p_eng_ref;
  if not found then raise exception 'Unknown engagement: %', p_eng_ref; end if;
  if nullif(trim(coalesce(p_note, '')), '') is null then raise exception 'An update needs a note'; end if;

  insert into public.engagement_notes(engagement_id, channel, who, note, stage_from, stage_to)
  values (e.id, nullif(trim(coalesce(p_channel,'')),''), nullif(trim(coalesce(p_who,'')),''),
          trim(p_note), e.stage, v_stage_to)
  returning id into v_id;

  -- advance the engagement's stage when the update moves it
  if v_stage_to is not null and v_stage_to is distinct from e.stage then
    update public.engagements set stage = v_stage_to, updated_at = now() where id = e.id;
  end if;

  perform public.audit_write('crm.engagement_note', 'engagement', p_eng_ref,
    jsonb_build_object('channel', p_channel, 'who', p_who, 'from', e.stage, 'to', v_stage_to));
  return jsonb_build_object('id', v_id, 'ref', p_eng_ref, 'stage', coalesce(v_stage_to, e.stage));
end $$;

-- ---------- RPC: set the linked partners (replace the whole set) ----------
create or replace function public.set_engagement_partners(p_eng_ref text, p_partner_ids uuid[])
returns jsonb language plpgsql security definer set search_path = public as $$
declare e_id uuid;
begin
  perform public.assert_access('crm', 2);
  select id into e_id from public.engagements where ref = p_eng_ref;
  if e_id is null then raise exception 'Unknown engagement: %', p_eng_ref; end if;

  delete from public.engagement_partners where engagement_id = e_id;
  insert into public.engagement_partners(engagement_id, partner_id)
  select e_id, pid from unnest(coalesce(p_partner_ids, '{}'::uuid[])) as pid
  where exists (select 1 from public.partners where id = pid)
  on conflict do nothing;

  perform public.audit_write('crm.engagement_partners', 'engagement', p_eng_ref,
    jsonb_build_object('count', coalesce(array_length(p_partner_ids, 1), 0)));
  return jsonb_build_object('ref', p_eng_ref, 'count', coalesce(array_length(p_partner_ids, 1), 0));
end $$;

-- ---------- seed the existing hardcoded updates (from data.ts engDetails) ----------
insert into public.engagement_notes(engagement_id, channel, who, note, created_at)
select e.id, v.channel, v.who, v.note, now() - v.ago
from public.engagements e
join (values
  ('ENG-002', 'Email',   'Wilson',    'Chased DSA signature; dataset ready to share on confirmation.', interval '0 day'),
  ('ENG-002', 'Call',    'Wilson',    'Agreed scope of the data exchange ahead of the summit.',        interval '3 day'),
  ('ENG-008', 'Meeting', 'Wilson',    'Discussed concessional terms; follow-up call scheduled.',       interval '2 day'),
  ('ENG-012', 'Call',    'Wilson',    'Term sheet received; reviewing repayment and milestone conditions.', interval '0 day'),
  ('ENG-012', 'Email',   'Wilson',    'Shared the updated model and pipeline.',                        interval '7 day'),
  ('ENG-019', 'Email',   'Wilson',    'Sent intro deck; awaiting response.',                           interval '16 day'),
  ('ENG-026', 'Call',    'Wilson',    'Discussed Ethiopia collaboration; brief requested.',            interval '5 day'),
  ('DST-004', 'Email',   'Elizabeth', '22 of 63 institutions now registered on the platform.',         interval '1 day'),
  ('DST-004', 'Field',   'Elizabeth', 'Onboarding workshop held with the county.',                     interval '7 day'),
  ('DST-011', 'Field',   'Elizabeth', 'EOI signed by the diocese.',                                    interval '3 day'),
  ('DST-018', 'Call',    'Elizabeth', 'Tentative site-visit window agreed; not yet confirmed.',        interval '16 day')
) as v(ref, channel, who, note, ago) on v.ref = e.ref
where not exists (select 1 from public.engagement_notes);

-- ---------- updated bootstrap(): per-engagement updates + engPartners map ----------
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
    'projects', coalesce((select jsonb_object_agg(name, public.project_detail_json(id))
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
      from public.budget_lines), '{}'::jsonb),
    'inventory', jsonb_build_object(
      'items', coalesce((select jsonb_agg(jsonb_build_object(
          'sku', i.sku, 'name', i.name, 'category', i.category, 'unit', i.unit,
          'unitCost', i.unit_cost, 'reorderLevel', i.reorder_level,
          'onHand', coalesce((select sum(qty) from public.stock_levels where item_id = i.id), 0),
          'autoReq', i.auto_req_ref) order by i.sku)
        from public.stock_items i where i.state = 'active'), '[]'::jsonb),
      'locations', coalesce((select jsonb_agg(name order by name) from public.stock_locations where state='active'), '[]'::jsonb),
      'movements', coalesce((select jsonb_agg(jsonb_build_object(
          'when', to_char(m.created_at, 'DD Mon HH24:MI'), 'sku', i.sku, 'type', m.movement_type,
          'qty', m.qty, 'from', fl.name, 'to', tl.name, 'source', m.source_ref, 'note', m.note) order by m.created_at desc)
        from (select * from public.stock_movements order by created_at desc limit 40) m
        join public.stock_items i on i.id = m.item_id
        left join public.stock_locations fl on fl.id = m.from_location
        left join public.stock_locations tl on tl.id = m.to_location), '[]'::jsonb),
      'dispatches', coalesce((select jsonb_agg(jsonb_build_object(
          'id', ref, 'project', project_name, 'destination', destination, 'lines', lines, 'state', state)
          order by created_at desc)
        from public.dispatches), '[]'::jsonb),
      'assets', coalesce((select jsonb_agg(jsonb_build_object(
          'id', ref, 'name', name, 'category', category, 'cost', cost, 'accumDep', accum_dep,
          'nbv', cost - accum_dep, 'acquired', to_char(acquired_on, 'Mon YYYY'), 'state', state)
          order by ref)
        from public.assets), '[]'::jsonb)),
    -- ---- CRM forms data ----
    'engagements', jsonb_build_object(
      'up', coalesce((select jsonb_agg(jsonb_build_object(
          'id', ref, 'n', name, 'st', stage, 'o', owner_name, 'pl', pill, 'plt', pill_txt,
          'updates', coalesce((select jsonb_agg(jsonb_build_object(
              'ts', n.created_at, 'd', to_char(n.created_at, 'DD Mon'), 'ch', n.channel, 'who', n.who, 'note', n.note)
              order by n.created_at desc)
            from public.engagement_notes n where n.engagement_id = engagements.id), '[]'::jsonb))
          order by created_at desc)
        from public.engagements where pipeline = 'up' and state = 'active'), '[]'::jsonb),
      'down', coalesce((select jsonb_agg(jsonb_build_object(
          'id', ref, 'n', name, 'st', stage, 'o', owner_name, 'pl', pill, 'plt', pill_txt,
          'updates', coalesce((select jsonb_agg(jsonb_build_object(
              'ts', n.created_at, 'd', to_char(n.created_at, 'DD Mon'), 'ch', n.channel, 'who', n.who, 'note', n.note)
              order by n.created_at desc)
            from public.engagement_notes n where n.engagement_id = engagements.id), '[]'::jsonb))
          order by created_at desc)
        from public.engagements where pipeline = 'down' and state = 'active'), '[]'::jsonb)),
    'engPartners', coalesce((select jsonb_object_agg(ref, pids) from (
        select e.ref, jsonb_agg(ep.partner_id order by ep.created_at) as pids
        from public.engagements e
        join public.engagement_partners ep on ep.engagement_id = e.id
        group by e.ref) q), '{}'::jsonb),
    'partners', coalesce((select jsonb_agg(jsonb_build_object(
        'id', id, 'name', name, 'type', type, 'country', country,
        'ownerName', owner_name, 'status', status, 'statusCls', status_cls)
        order by created_at desc)
      from public.partners where state = 'active'), '[]'::jsonb),
    'opportunities', coalesce((select jsonb_agg(jsonb_build_object(
        'id', id, 'name', name, 'type', type, 'deadline', deadline,
        'linkedTo', linked_to, 'status', status, 'statusCls', status_cls)
        order by created_at desc)
      from public.opportunities where state = 'active'), '[]'::jsonb),
    'crmDropdowns', coalesce((select jsonb_object_agg(cat, vals) from (
        select category as cat, jsonb_agg(value order by sort) as vals
        from public.crm_dropdown_options where active group by category) q), '{}'::jsonb),
    'teamNames', coalesce((select jsonb_agg(name order by name) from public.app_users where state = 'active'), '[]'::jsonb)
  );
end $$;

-- ---------- grants: authenticated only, never public/anon ----------
do $$
declare fn text;
begin
  foreach fn in array array[
    'log_engagement_note(text,text,text,text,text)',
    'set_engagement_partners(text,uuid[])']
  loop
    execute format('revoke execute on function public.%s from public, anon', fn);
    execute format('grant execute on function public.%s to authenticated', fn);
  end loop;
end $$;


-- ============================================================
-- Jikoni — Partnerships CRM: engagement documents
-- Documents are only attached when someone actually uploads one — either while
-- creating an engagement or when logging an update. The file lives in Supabase
-- Storage; a metadata row keeps the object path so anyone with CRM access can
-- open / download it from the engagement drawer.
--   * engagement_documents        — name + storage path per engagement (+ note)
--   * add_engagement_document()    — records an uploaded file (crm edit access)
--   * storage bucket 'engagement-docs' (public read, authenticated write)
-- Bootstrap is left untouched — the client folds docs in by ref (same approach
-- as dispatch receipts), so no re-declaration of the big bootstrap() function.
-- Idempotent: safe to re-run.
-- ============================================================

-- ---------- table ----------
create table if not exists public.engagement_documents (
  id            uuid primary key default gen_random_uuid(),
  engagement_id uuid not null references public.engagements(id) on delete cascade,
  note_id       uuid references public.engagement_notes(id) on delete set null,
  name          text not null,
  path          text not null,
  who           text,
  created_at    timestamptz not null default now()
);
create index if not exists engagement_documents_eng_idx on public.engagement_documents(engagement_id, created_at desc);

-- read for signed-in users; writes only via the definer RPC
alter table public.engagement_documents enable row level security;
drop policy if exists "read for authenticated" on public.engagement_documents;
create policy "read for authenticated" on public.engagement_documents for select to authenticated using (true);

-- ---------- storage bucket + policies (wrapped so a locked-down role can't abort the migration) ----------
do $$
begin
  insert into storage.buckets (id, name, public)
  values ('engagement-docs', 'engagement-docs', true)
  on conflict (id) do nothing;

  drop policy if exists "engagement docs read"   on storage.objects;
  drop policy if exists "engagement docs insert" on storage.objects;
  drop policy if exists "engagement docs update" on storage.objects;

  create policy "engagement docs read" on storage.objects
    for select to public using (bucket_id = 'engagement-docs');
  create policy "engagement docs insert" on storage.objects
    for insert to authenticated with check (bucket_id = 'engagement-docs');
  create policy "engagement docs update" on storage.objects
    for update to authenticated using (bucket_id = 'engagement-docs');
exception when others then
  raise notice 'storage bucket/policy setup skipped: %', sqlerrm;
end $$;

-- ---------- record an uploaded document against an engagement ----------
create or replace function public.add_engagement_document(
  p_eng_ref text, p_name text, p_path text, p_who text default null
) returns jsonb language plpgsql security definer set search_path = public as $$
declare v_id uuid; e_id uuid;
begin
  perform public.assert_access('crm', 2);
  if nullif(trim(coalesce(p_path, '')), '') is null then raise exception 'A document file is required'; end if;
  select id into e_id from public.engagements where ref = p_eng_ref;
  if e_id is null then raise exception 'Unknown engagement: %', p_eng_ref; end if;
  insert into public.engagement_documents(engagement_id, name, path, who)
  values (e_id, coalesce(nullif(trim(p_name), ''), 'Document'), trim(p_path), nullif(trim(coalesce(p_who,'')),''))
  returning id into v_id;
  perform public.audit_write('crm.engagement_document', 'engagement', p_eng_ref,
    jsonb_build_object('name', p_name, 'path', p_path));
  return jsonb_build_object('id', v_id, 'ref', p_eng_ref, 'name', p_name, 'path', p_path);
end $$;

-- ---------- grant: authenticated only, never public/anon ----------
do $$
begin
  revoke execute on function public.add_engagement_document(text, text, text, text) from public, anon;
  grant  execute on function public.add_engagement_document(text, text, text, text) to authenticated;
end $$;


-- ============================================================
-- Jikoni — Partnerships CRM: rename the upstream (capital) stage ladder
-- The old ladder mixed relationship stages with artifacts ("Materials",
-- "Term sheet"). New solid ladder (all stages):
--   Discovery → Due diligence → Negotiation → Agreement → Commitment → Closed
-- Remap existing upstream engagements so the drawer's progress ribbon keeps
-- highlighting the right rung. Downstream is unchanged.
-- Idempotent: safe to re-run (old values simply no longer exist after the first run).
-- ============================================================

update public.engagements
   set stage = case stage
                 when 'Materials'  then 'Due diligence'
                 when 'Term sheet' then 'Agreement'
                 when 'Committed'  then 'Commitment'
                 else stage
               end,
       updated_at = now()
 where pipeline = 'up'
   and stage in ('Materials', 'Term sheet', 'Committed');


-- ======== supabase/migrations/0023_compliance_frontend.sql ========
-- ============================================================
-- Jikoni — Compliance & Governance: wire the module to the frontend
-- The Phase 4 backend (policies, company_documents, compliance_obligations,
-- risks, contracts) already exists but was never read by the app. This makes
-- Compliance a first-class, Supabase-backed, interactive module like the rest:
--   * dedicated 'compliance' access key (backfilled from each user's reports level)
--   * compliance-docs storage bucket (public-read, authenticated-write)
--   * create RPCs: create_risk / add_policy / add_company_document / add_contract
--   * mark_obligation_filed re-gated onto 'compliance'
--   * bootstrap() extended with policies/companyDocuments/obligations/risks/contracts
--   * seeds reconciled to the intended demo content
-- Idempotent: safe to re-run.
-- ============================================================

-- ---------- access key: backfill 'compliance' from each user's 'reports' level ----------
insert into public.user_permissions(email, module, level)
select email, 'compliance', level from public.user_permissions where module = 'reports'
on conflict (email, module) do nothing;

-- ---------- storage bucket 'compliance-docs' (public read, authenticated write) ----------
do $$
begin
  insert into storage.buckets (id, name, public)
  values ('compliance-docs', 'compliance-docs', true)
  on conflict (id) do nothing;

  drop policy if exists "compliance-docs read"   on storage.objects;
  drop policy if exists "compliance-docs write"  on storage.objects;
  drop policy if exists "compliance-docs update" on storage.objects;
  create policy "compliance-docs read"   on storage.objects
    for select to public using (bucket_id = 'compliance-docs');
  create policy "compliance-docs write"  on storage.objects
    for insert to authenticated with check (bucket_id = 'compliance-docs');
  create policy "compliance-docs update" on storage.objects
    for update to authenticated using (bucket_id = 'compliance-docs');
end $$;

-- ---------- mutation RPCs (mirror the create_partner template) ----------

-- risk register: new risk gets an RSK- ref; severity is likelihood × impact
create or replace function public.create_risk(
  p_risk text, p_category text, p_likelihood int, p_impact int, p_mitigation text, p_owner text
) returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_entity uuid := (select id from public.entities where code = 'KE');
  v_ref text;
begin
  perform public.assert_access('compliance', 2);
  if p_likelihood not between 1 and 5 or p_impact not between 1 and 5 then
    raise exception 'Likelihood and impact must be 1–5';
  end if;
  v_ref := public.next_ref('RSK');
  insert into public.risks(ref, entity_id, risk, category, likelihood, impact, mitigation, owner_name, state)
  values (v_ref, v_entity, p_risk, nullif(p_category,''), p_likelihood, p_impact, nullif(p_mitigation,''), nullif(p_owner,''), 'open');
  perform public.audit_write('risk.created', 'risk', v_ref,
    jsonb_build_object('risk', p_risk, 'likelihood', p_likelihood, 'impact', p_impact, 'owner', p_owner));
  return jsonb_build_object('ref', v_ref, 'risk', p_risk);
end $$;

-- policies: adding a version supersedes the prior active one for the same code
create or replace function public.add_policy(
  p_code text, p_title text, p_effective_from date, p_doc text
) returns jsonb language plpgsql security definer set search_path = public as $$
declare v_ver int;
begin
  perform public.assert_access('compliance', 2);
  select coalesce(max(version), 0) into v_ver from public.policies where code = p_code;
  update public.policies set state = 'superseded' where code = p_code and state = 'active';
  insert into public.policies(code, title, version, effective_from, doc, state)
  values (p_code, p_title, v_ver + 1, p_effective_from, nullif(p_doc,''), 'active');
  perform public.audit_write('policy.added', 'policy', p_code,
    jsonb_build_object('title', p_title, 'version', v_ver + 1));
  return jsonb_build_object('code', p_code, 'title', p_title, 'version', v_ver + 1);
end $$;

-- company documents: upsert by name (statutory docs are one-per-name with an expiry)
create or replace function public.add_company_document(
  p_name text, p_kind text, p_expires_on date, p_doc text
) returns jsonb language plpgsql security definer set search_path = public as $$
declare v_entity uuid := (select id from public.entities where code = 'KE');
begin
  perform public.assert_access('compliance', 2);
  insert into public.company_documents(entity_id, name, kind, expires_on, doc, state)
  values (v_entity, p_name, nullif(p_kind,''), p_expires_on, nullif(p_doc,''), 'active')
  on conflict (name) do update set
    kind = coalesce(nullif(excluded.kind,''), public.company_documents.kind),
    expires_on = excluded.expires_on,
    doc = coalesce(excluded.doc, public.company_documents.doc),
    updated_at = now();
  perform public.audit_write('company_document.added', 'company_document', p_name,
    jsonb_build_object('kind', p_kind, 'expiresOn', p_expires_on));
  return jsonb_build_object('name', p_name);
end $$;

-- contracts registry (governance home; also read by Procurement + CRM)
create or replace function public.add_contract(
  p_counterparty text, p_kind text, p_title text, p_detail text, p_expires_on date
) returns jsonb language plpgsql security definer set search_path = public as $$
declare v_entity uuid := (select id from public.entities where code = 'KE');
begin
  perform public.assert_access('compliance', 2);
  if p_kind not in ('vendor','funder','customer','partner') then
    raise exception 'Contract kind must be vendor, funder, customer or partner';
  end if;
  insert into public.contracts(entity_id, counterparty, kind, title, detail, expires_on,
                               vendor_id, state)
  values (v_entity, p_counterparty, p_kind, p_title, nullif(p_detail,''), p_expires_on,
          (select id from public.vendors where name = p_counterparty), 'active')
  on conflict (counterparty, title) do update set
    detail = coalesce(excluded.detail, public.contracts.detail),
    expires_on = excluded.expires_on,
    updated_at = now();
  perform public.audit_write('contract.added', 'contract', p_title,
    jsonb_build_object('counterparty', p_counterparty, 'kind', p_kind, 'expiresOn', p_expires_on));
  return jsonb_build_object('counterparty', p_counterparty, 'title', p_title);
end $$;

-- re-gate the existing obligation-filed RPC onto the new module
create or replace function public.mark_obligation_filed(p_obligation text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare o record; nxt date;
begin
  perform public.assert_access('compliance', 2);
  select * into o from public.compliance_obligations where obligation = p_obligation;
  if not found then raise exception 'Unknown obligation: %', p_obligation; end if;
  nxt := case o.frequency
    when 'monthly' then o.next_due + interval '1 month'
    when 'quarterly' then o.next_due + interval '3 months'
    else o.next_due + interval '1 year' end;
  update public.compliance_obligations set state = 'pending', next_due = nxt where id = o.id;
  perform public.audit_write('compliance.filed','obligation', p_obligation,
    jsonb_build_object('filedFor', o.next_due, 'nextDue', nxt));
  return jsonb_build_object('obligation', p_obligation, 'nextDue', nxt);
end $$;

-- ---------- seeds: reconcile to the intended demo content (idempotent) ----------
insert into public.policies(code, title, version, effective_from, state) values
  ('IGN-PROC-001', 'Procurement policy & SOP',            2, '2026-01-01', 'active'),
  ('IGN-FIN-001',  'Financial management manual',         1, '2025-07-01', 'active'),
  ('IGN-HR-001',   'HR policy & staff handbook',          1, '2025-07-01', 'active'),
  ('IGN-GOV-002',  'Code of Conduct',                     1, '2025-07-01', 'active'),
  ('IGN-GOV-004',  'Safeguarding / Child Protection',     1, '2024-10-01', 'active'),
  ('IGN-GOV-005',  'Data protection policy (Kenya DPA)',  1, '2025-10-01', 'active'),
  ('IGN-PROC-002', 'Anti-corruption & sanctions policy',  1, '2025-10-01', 'active')
on conflict (code, version) do nothing;

with ke as (select id from public.entities where code = 'KE')
insert into public.company_documents(entity_id, name, kind, expires_on)
select ke.id, v.name, v.kind, v.expires::date from ke, (values
  ('Certificate of incorporation', 'statutory', null),
  ('KRA PIN certificate',          'statutory', null),
  ('Tax Compliance Certificate',   'statutory', '2027-02-14'),
  ('CR12 (shareholding)',          'statutory', null),
  ('NSSF / SHIF registration',     'statutory', null),
  ('Single Business Permit',       'licence',   '2026-12-31'),
  ('Annual Returns (Registrar)',   'statutory', '2026-09-30'),
  ('EPRA licence — LPG handling',  'licence',   '2027-03-31')
) as v(name, kind, expires)
on conflict (name) do nothing;

with ke as (select id from public.entities where code = 'KE')
insert into public.risks(ref, entity_id, risk, category, likelihood, impact, mitigation, owner_name, state)
select v.ref, ke.id, v.risk, v.category, v.l, v.i, v.mitigation, v.owner, v.state from ke, (values
  ('RSK-105', 'Single-funder dependency (Wave 1)', 'Funding',  3, 5, 'Diversify pipeline — 7 funders live',        'Wilson',    'open'),
  ('RSK-106', 'FX exposure (USD / KES)',           'Market',   3, 3, 'Monthly revaluation; USD grant account',      'Dennis',    'open'),
  ('RSK-107', 'Field data quality',                'Delivery', 2, 3, 'Enumerator rubric + supervisor QA',           'Elizabeth', 'open'),
  ('RSK-108', 'Key-person dependency',             'People',   2, 3, 'Documented SOPs; cross-training',             'Dennis',    'open'),
  ('RSK-109', 'Carbon registry ambiguity',         'Delivery', 2, 3, 'MRV lineage; verifier engagement',            'Wanjiku',   'open')
) as v(ref, risk, category, l, i, mitigation, owner, state)
on conflict (ref) do nothing;

-- keep the RSK counter ahead of the seeded refs so create_risk doesn't collide
update public.ref_counters set n = greatest(n, 109) where kind = 'RSK';

-- ---------- bootstrap(): add compliance keys (policies/docs/obligations/risks/contracts) ----------
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
    'projects', coalesce((select jsonb_object_agg(name, public.project_detail_json(id))
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
      from public.budget_lines), '{}'::jsonb),
    'inventory', jsonb_build_object(
      'items', coalesce((select jsonb_agg(jsonb_build_object(
          'sku', i.sku, 'name', i.name, 'category', i.category, 'unit', i.unit,
          'unitCost', i.unit_cost, 'reorderLevel', i.reorder_level,
          'onHand', coalesce((select sum(qty) from public.stock_levels where item_id = i.id), 0),
          'autoReq', i.auto_req_ref) order by i.sku)
        from public.stock_items i where i.state = 'active'), '[]'::jsonb),
      'locations', coalesce((select jsonb_agg(name order by name) from public.stock_locations where state='active'), '[]'::jsonb),
      'movements', coalesce((select jsonb_agg(jsonb_build_object(
          'when', to_char(m.created_at, 'DD Mon HH24:MI'), 'sku', i.sku, 'type', m.movement_type,
          'qty', m.qty, 'from', fl.name, 'to', tl.name, 'source', m.source_ref, 'note', m.note) order by m.created_at desc)
        from (select * from public.stock_movements order by created_at desc limit 40) m
        join public.stock_items i on i.id = m.item_id
        left join public.stock_locations fl on fl.id = m.from_location
        left join public.stock_locations tl on tl.id = m.to_location), '[]'::jsonb),
      'dispatches', coalesce((select jsonb_agg(jsonb_build_object(
          'id', ref, 'project', project_name, 'destination', destination, 'lines', lines, 'state', state)
          order by created_at desc)
        from public.dispatches), '[]'::jsonb),
      'assets', coalesce((select jsonb_agg(jsonb_build_object(
          'id', ref, 'name', name, 'category', category, 'cost', cost, 'accumDep', accum_dep,
          'nbv', cost - accum_dep, 'acquired', to_char(acquired_on, 'Mon YYYY'), 'state', state)
          order by ref)
        from public.assets), '[]'::jsonb)),
    -- ---- CRM forms data ----
    'engagements', jsonb_build_object(
      'up', coalesce((select jsonb_agg(jsonb_build_object(
          'id', ref, 'n', name, 'st', stage, 'o', owner_name, 'pl', pill, 'plt', pill_txt)
          order by created_at desc)
        from public.engagements where pipeline = 'up' and state = 'active'), '[]'::jsonb),
      'down', coalesce((select jsonb_agg(jsonb_build_object(
          'id', ref, 'n', name, 'st', stage, 'o', owner_name, 'pl', pill, 'plt', pill_txt)
          order by created_at desc)
        from public.engagements where pipeline = 'down' and state = 'active'), '[]'::jsonb)),
    'partners', coalesce((select jsonb_agg(jsonb_build_object(
        'id', id, 'name', name, 'type', type, 'country', country,
        'ownerName', owner_name, 'status', status, 'statusCls', status_cls)
        order by created_at desc)
      from public.partners where state = 'active'), '[]'::jsonb),
    'opportunities', coalesce((select jsonb_agg(jsonb_build_object(
        'id', id, 'name', name, 'type', type, 'deadline', deadline,
        'linkedTo', linked_to, 'status', status, 'statusCls', status_cls)
        order by created_at desc)
      from public.opportunities where state = 'active'), '[]'::jsonb),
    'crmDropdowns', coalesce((select jsonb_object_agg(cat, vals) from (
        select category as cat, jsonb_agg(value order by sort) as vals
        from public.crm_dropdown_options where active group by category) q), '{}'::jsonb),
    'teamNames', coalesce((select jsonb_agg(name order by name) from public.app_users where state = 'active'), '[]'::jsonb),
    -- ---- Compliance & Governance (new) ----
    'compliance', jsonb_build_object(
      'policies', coalesce((select jsonb_agg(jsonb_build_object(
          'code', code, 'title', title, 'version', 'v' || version, 'effectiveFrom', effective_from,
          'doc', doc, 'state', state,
          'statusCls', case
            when state = 'superseded' then 'week'
            when state = 'draft' then 'today'
            when effective_from is not null and effective_from < (now() - interval '1 year')::date then 'today'
            else 'done' end,
          'statusTxt', case
            when state = 'superseded' then 'Superseded'
            when state = 'draft' then 'Draft'
            when effective_from is not null and effective_from < (now() - interval '1 year')::date then 'Review due'
            else 'Current' end)
          order by code)
        from public.policies where state <> 'superseded'), '[]'::jsonb),
      'companyDocuments', coalesce((select jsonb_agg(jsonb_build_object(
          'name', name, 'kind', kind, 'doc', doc,
          'expiry', case when expires_on is null then '—' else to_char(expires_on, 'DD Mon YYYY') end,
          'statusCls', case
            when expires_on is null then 'done'
            when expires_on < now()::date then 'over'
            when expires_on < (now() + interval '60 days')::date then 'today'
            when expires_on < (now() + interval '6 months')::date then 'week'
            else 'done' end,
          'statusTxt', case
            when expires_on is null then 'On file'
            when expires_on < now()::date then 'Expired'
            when expires_on < (now() + interval '60 days')::date then 'Renew soon'
            when expires_on < (now() + interval '6 months')::date then 'Upcoming'
            else 'Valid' end)
          order by expires_on nulls first, name)
        from public.company_documents where state = 'active'), '[]'::jsonb),
      'obligations', coalesce((select jsonb_agg(jsonb_build_object(
          'obligation', obligation, 'authority', authority, 'dueRule', due_rule,
          'nextDue', next_due, 'when', to_char(next_due, 'DD Mon'), 'state', state, 'ownerModule', owner_module,
          'statusCls', case
            when state = 'overdue' or next_due < now()::date then 'over'
            when next_due < (now() + interval '10 days')::date then 'today'
            else 'week' end,
          'statusTxt', case
            when state = 'overdue' or next_due < now()::date then 'Overdue'
            when next_due < (now() + interval '10 days')::date then 'Due soon'
            when next_due < (date_trunc('month', now()) + interval '1 month')::date then 'This month'
            else 'Upcoming' end)
          order by next_due)
        from public.compliance_obligations), '[]'::jsonb),
      'risks', coalesce((select jsonb_agg(jsonb_build_object(
          'ref', ref, 'risk', risk, 'category', category, 'owner', owner_name,
          'likelihood', likelihood, 'impact', impact, 'score', likelihood * impact,
          'mitigation', mitigation, 'state', state,
          'statusCls', case when likelihood * impact >= 12 then 'over'
                            when likelihood * impact >= 6 then 'today' else 'week' end,
          'statusTxt', case when likelihood * impact >= 12 then 'High'
                            when likelihood * impact >= 6 then 'Medium' else 'Low' end)
          order by likelihood * impact desc, ref)
        from public.risks where state <> 'closed'), '[]'::jsonb),
      'contracts', coalesce((select jsonb_agg(jsonb_build_object(
          'counterparty', counterparty, 'kind', kind, 'title', title, 'detail', detail,
          'expiry', case when expires_on is null then '—' else to_char(expires_on, 'DD Mon YYYY') end,
          'state', state,
          'statusCls', case state when 'active' then 'done' when 'renew_soon' then 'today'
                                  when 'expired' then 'over' else 'week' end,
          'statusTxt', case state when 'active' then 'Active' when 'renew_soon' then 'Renew soon'
                                  when 'expired' then 'Expired' else 'Terminated' end)
          order by expires_on nulls last, counterparty)
        from public.contracts where state <> 'terminated'), '[]'::jsonb))
  );
end $$;

-- ---------- grants: create RPCs are authenticated-only ----------
do $$
declare fn text;
begin
  foreach fn in array array[
    'create_risk(text,text,int,int,text,text)',
    'add_policy(text,text,date,text)',
    'add_company_document(text,text,date,text)',
    'add_contract(text,text,text,text,date)',
    'mark_obligation_filed(text)']
  loop
    execute format('revoke execute on function public.%s from public, anon', fn);
    execute format('grant execute on function public.%s to authenticated', fn);
  end loop;
end $$;


-- ======== supabase/migrations/0024_create_project.sql ========
-- ============================================================
-- Jikoni — Projects & Programmes: standalone "Add project"
-- Projects could previously only be created by converting a won CRM engagement
-- (create_project_from_eng). This adds a direct create path so a user can add a
-- project from the module itself. Mirrors create_project_from_eng: inserts an
-- is_extra project, seeds three starter milestones, audit-logs, and returns the
-- {name, detail} payload the frontend store already consumes.
-- Idempotent: safe to re-run.
-- ============================================================

create or replace function public.create_project(
  p_name text, p_funder text, p_budget_txt text, p_timeline text, p_team text, p_status text
) returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_entity uuid := (select id from public.entities where code = 'KE');
  p record;
begin
  perform public.assert_access('projects', 2);
  if nullif(trim(coalesce(p_name, '')), '') is null then
    raise exception 'A project name is required';
  end if;
  if exists (select 1 from public.projects where name = trim(p_name)) then
    raise exception 'A project named "%" already exists', trim(p_name);
  end if;
  insert into public.projects(entity_id, name, funder, status, budget_txt, timeline, team, is_extra, docs)
  values (v_entity, trim(p_name), nullif(trim(coalesce(p_funder, '')), ''),
          coalesce(nullif(trim(coalesce(p_status, '')), ''), 'Setup'),
          coalesce(nullif(trim(coalesce(p_budget_txt, '')), ''), 'TBD'),
          coalesce(nullif(trim(coalesce(p_timeline, '')), ''), '2026'),
          nullif(trim(coalesce(p_team, '')), ''), true, '[]'::jsonb)
  returning * into p;
  -- Bare project: no placeholder milestones/drawdowns, so a fresh project stays
  -- out of the Milestones/Grants/Budgets aggregates until it has real data. The
  -- user fills those in from the project drawer.
  perform public.audit_write('project.created', 'project', p.name,
    jsonb_build_object('funder', p_funder, 'budget', p_budget_txt, 'team', p_team));
  return jsonb_build_object('name', p.name, 'created', true,
    'detail', public.project_detail_json(p.id));
end $$;

revoke execute on function public.create_project(text,text,text,text,text,text) from public, anon;
grant execute on function public.create_project(text,text,text,text,text,text) to authenticated;
-- ============================================================
-- Jikoni — Projects & Programmes: real project documents
-- Project docs were plain label strings with no file behind them. This adds a
-- project-docs storage bucket + an add_project_document RPC that appends a
-- {name, path} object to projects.docs, so the drawer can offer real View /
-- Download. The docs column already accepts either legacy strings or objects
-- (the frontend renders both). Idempotent: safe to re-run.
-- ============================================================

-- ---------- storage bucket 'project-docs' (public read, authenticated write) ----------
do $$
begin
  insert into storage.buckets (id, name, public)
  values ('project-docs', 'project-docs', true)
  on conflict (id) do nothing;

  drop policy if exists "project-docs read"   on storage.objects;
  drop policy if exists "project-docs write"  on storage.objects;
  drop policy if exists "project-docs update" on storage.objects;
  create policy "project-docs read"   on storage.objects
    for select to public using (bucket_id = 'project-docs');
  create policy "project-docs write"  on storage.objects
    for insert to authenticated with check (bucket_id = 'project-docs');
  create policy "project-docs update" on storage.objects
    for update to authenticated using (bucket_id = 'project-docs');
end $$;

-- ---------- append a document to a project ----------
create or replace function public.add_project_document(
  p_project_id uuid, p_name text, p_path text
) returns jsonb language plpgsql security definer set search_path = public as $$
begin
  perform public.assert_access('projects', 2);
  if not exists (select 1 from public.projects where id = p_project_id) then
    raise exception 'Project not found';
  end if;
  if nullif(trim(coalesce(p_name, '')), '') is null or nullif(trim(coalesce(p_path, '')), '') is null then
    raise exception 'A document name and path are required';
  end if;
  update public.projects
     set docs = coalesce(docs, '[]'::jsonb) || jsonb_build_object('name', trim(p_name), 'path', p_path),
         updated_at = now()
   where id = p_project_id;
  perform public.audit_write('project.document_added', 'project', p_project_id::text,
    jsonb_build_object('name', p_name, 'path', p_path));
  return public.project_payload(p_project_id);
end $$;

revoke execute on function public.add_project_document(uuid,text,text) from public, anon;
grant execute on function public.add_project_document(uuid,text,text) to authenticated;

-- ============================================================
-- ======== supabase/migrations/0026_hr_personnel_suite.sql ========
-- ============================================================
-- Jikoni — HR Personnel Management suite (Jikoni_9 flows, live)
-- Backs the new HR tabs with real tables + RPCs:
--   * staff_files: dept, contract_end, next_of_kin (Personnel Management)
--   * appraisals            — cycle → self → manager review → sign-off, KPI checklist
--   * certifications        — register + HR verification queue, expiry tracking
--   * staff_feedback        — routed to HR / leadership, anonymous supported
--   * staff_exits           — clearance checklist → certificate of service
-- Idempotent: safe to re-run.
-- ============================================================

-- ---------- personnel fields on the staff file ----------
alter table public.staff_files add column if not exists dept text;
alter table public.staff_files add column if not exists contract_end date;
alter table public.staff_files add column if not exists next_of_kin jsonb not null default '[]'::jsonb; -- [{name, relationship, phone, cover}]

-- ---------- appraisals ----------
create table if not exists public.appraisals (
  id          uuid primary key default gen_random_uuid(),
  entity_id   uuid references public.entities(id),
  app_user_id uuid not null references public.app_users(id),
  cycle       text not null,                                  -- 'H1 2026'
  reviewer_id uuid references public.app_users(id),
  kpis        jsonb not null default '[]'::jsonb,             -- [{k, met}]
  stage       text not null default 'not_started' check (stage in ('not_started','self','manager','signed_off')),
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  unique (app_user_id, cycle)
);

-- ---------- certifications ----------
create table if not exists public.certifications (
  id          uuid primary key default gen_random_uuid(),
  entity_id   uuid references public.entities(id),
  app_user_id uuid references public.app_users(id),           -- null for group entries ("Field team")
  holder      text not null,                                  -- display name
  name        text not null,
  issuer      text,
  expiry      date,
  state       text not null default 'pending' check (state in ('pending','verified','rejected')),
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

-- ---------- employee feedback ----------
create table if not exists public.staff_feedback (
  id         uuid primary key default gen_random_uuid(),
  ref        text not null unique,
  entity_id  uuid references public.entities(id),
  author_id  uuid references public.app_users(id),            -- null = anonymous
  category   text,
  body       text not null,
  audience   text not null default 'hr' check (audience in ('hr','leadership')),
  state      text not null default 'open' check (state in ('open','in_review','acknowledged','actioned','closed')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- ---------- offboarding & exit ----------
create table if not exists public.staff_exits (
  id          uuid primary key default gen_random_uuid(),
  ref         text not null unique,
  entity_id   uuid references public.entities(id),
  app_user_id uuid references public.app_users(id),           -- null for non-system people (field officers)
  person      text not null,
  role_title  text,
  reason      text,
  final_day   date,
  clearance   jsonb not null default '[]'::jsonb,             -- [{area, done}]
  state       text not null default 'in_progress' check (state in ('in_progress','cleared')),
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

-- ref counters (FB seeds go to 018; EXT seeds to 004)
insert into public.ref_counters(kind, prefix, n) values ('FB', 'FB-0', 15) on conflict (kind) do nothing;
insert into public.ref_counters(kind, prefix, n) values ('EXT', 'EXT-00', 2) on conflict (kind) do nothing;

-- ---------- personnel: HR-editable profile fields ----------
create or replace function public.update_staff_hr_profile(
  p_staff_no text, p_dept text default null, p_contract_end date default null, p_next_of_kin jsonb default null
) returns jsonb language plpgsql security definer set search_path = public as $$
declare s record;
begin
  perform public.assert_access('hr', 3);
  select * into s from public.staff_files where staff_no = p_staff_no;
  if not found then raise exception 'Unknown staff number: %', p_staff_no; end if;
  update public.staff_files
     set dept         = coalesce(nullif(trim(coalesce(p_dept,'')),''), dept),
         contract_end = coalesce(p_contract_end, contract_end),
         next_of_kin  = coalesce(p_next_of_kin, next_of_kin),
         updated_at   = now()
   where staff_no = p_staff_no;
  perform public.audit_write('hr.staff_profile_updated','staff', p_staff_no,
    jsonb_build_object('dept', p_dept, 'contractEnd', p_contract_end, 'kin', p_next_of_kin is not null));
  return jsonb_build_object('staffNo', p_staff_no);
end $$;

-- ---------- appraisals: open a cycle for everyone active ----------
create or replace function public.start_appraisal_cycle(p_cycle text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_entity uuid := (select id from public.entities where code = 'KE');
  v_md uuid := (select id from public.app_users where role_title = 'Managing Director' limit 1);
  v_n int;
begin
  perform public.assert_access('hr', 3);
  if nullif(trim(coalesce(p_cycle,'')),'') is null then raise exception 'A cycle needs a name, e.g. H1 2026'; end if;
  insert into public.appraisals(entity_id, app_user_id, cycle, reviewer_id, kpis, stage)
  select v_entity, sf.app_user_id, trim(p_cycle), v_md,
    jsonb_build_array(
      jsonb_build_object('k','Delivery against plan','met',false),
      jsonb_build_object('k','Quality & compliance','met',false),
      jsonb_build_object('k','Collaboration & culture','met',false),
      jsonb_build_object('k','Growth objective','met',false)),
    'not_started'
  from public.staff_files sf
  where sf.state = 'active'
    and not exists (select 1 from public.appraisals a where a.app_user_id = sf.app_user_id and a.cycle = trim(p_cycle));
  get diagnostics v_n = row_count;
  perform public.audit_write('hr.appraisal_cycle_started','appraisal', trim(p_cycle), jsonb_build_object('opened', v_n));
  return jsonb_build_object('cycle', trim(p_cycle), 'opened', v_n);
end $$;

create or replace function public.toggle_appraisal_kpi(p_id uuid, p_idx int)
returns jsonb language plpgsql security definer set search_path = public as $$
declare a record; v jsonb;
begin
  perform public.assert_access('hr', 2);
  select * into a from public.appraisals where id = p_id;
  if not found then raise exception 'Appraisal not found'; end if;
  if a.stage = 'signed_off' then raise exception 'This review is signed off — KPIs are locked'; end if;
  if p_idx < 0 or p_idx >= jsonb_array_length(a.kpis) then raise exception 'No KPI at position %', p_idx; end if;
  v := jsonb_set(a.kpis, array[p_idx::text, 'met'], to_jsonb(not coalesce((a.kpis -> p_idx ->> 'met')::boolean, false)));
  update public.appraisals set kpis = v, updated_at = now() where id = p_id;
  return jsonb_build_object('id', p_id, 'kpis', v);
end $$;

create or replace function public.advance_appraisal(p_id uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
declare a record; v_next text;
begin
  perform public.assert_access('hr', 2);
  select ap.*, u.name into a from public.appraisals ap join public.app_users u on u.id = ap.app_user_id where ap.id = p_id;
  if not found then raise exception 'Appraisal not found'; end if;
  v_next := case a.stage
    when 'not_started' then 'self'
    when 'self'        then 'manager'
    when 'manager'     then 'signed_off'
    else null end;
  if v_next is null then raise exception 'Already signed off'; end if;
  update public.appraisals set stage = v_next, updated_at = now() where id = p_id;
  perform public.audit_write('hr.appraisal_advanced','appraisal', a.cycle,
    jsonb_build_object('who', a.name, 'from', a.stage, 'to', v_next));
  return jsonb_build_object('id', p_id, 'stage', v_next);
end $$;

-- ---------- certifications ----------
create or replace function public.add_certification(
  p_holder text, p_name text, p_issuer text default null, p_expiry date default null,
  p_staff_no text default null, p_verified boolean default false
) returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_entity uuid := (select id from public.entities where code = 'KE');
  v_user uuid; v_id uuid;
begin
  perform public.assert_access('hr', 2);
  if nullif(trim(coalesce(p_name,'')),'') is null then raise exception 'A certification needs a name'; end if;
  if nullif(trim(coalesce(p_holder,'')),'') is null then raise exception 'A certification needs a holder'; end if;
  if p_staff_no is not null then
    select app_user_id into v_user from public.staff_files where staff_no = p_staff_no;
  end if;
  insert into public.certifications(entity_id, app_user_id, holder, name, issuer, expiry, state)
  values (v_entity, v_user, trim(p_holder), trim(p_name), nullif(trim(coalesce(p_issuer,'')),''), p_expiry,
          case when p_verified then 'verified' else 'pending' end)
  returning id into v_id;
  perform public.audit_write('hr.certification_added','staff', coalesce(p_staff_no, trim(p_holder)),
    jsonb_build_object('name', p_name, 'issuer', p_issuer, 'state', case when p_verified then 'verified' else 'pending' end));
  return jsonb_build_object('id', v_id, 'holder', p_holder, 'name', p_name);
end $$;

create or replace function public.verify_certification(p_id uuid, p_ok boolean default true)
returns jsonb language plpgsql security definer set search_path = public as $$
declare c record; v_state text := case when p_ok then 'verified' else 'rejected' end;
begin
  perform public.assert_access('hr', 2);
  select * into c from public.certifications where id = p_id;
  if not found then raise exception 'Certification not found'; end if;
  update public.certifications set state = v_state, updated_at = now() where id = p_id;
  perform public.audit_write('hr.certification_' || v_state,'staff', c.holder,
    jsonb_build_object('name', c.name, 'issuer', c.issuer));
  return jsonb_build_object('id', p_id, 'state', v_state);
end $$;

-- ---------- employee feedback ----------
create or replace function public.submit_feedback(
  p_body text, p_category text default null, p_audience text default 'hr', p_anonymous boolean default false
) returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_entity uuid := (select id from public.entities where code = 'KE');
  v_me uuid := (select id from public.app_users where auth_id = auth.uid());
  v_ref text;
begin
  -- any signed-in member of staff can send feedback; no module gate
  if nullif(trim(coalesce(p_body,'')),'') is null then raise exception 'Feedback needs a message'; end if;
  if p_audience not in ('hr','leadership') then raise exception 'Audience must be hr or leadership'; end if;
  v_ref := public.next_ref('FB');
  insert into public.staff_feedback(ref, entity_id, author_id, category, body, audience, state)
  values (v_ref, v_entity, case when p_anonymous then null else v_me end,
          nullif(trim(coalesce(p_category,'')),''), trim(p_body), p_audience, 'open');
  perform public.audit_write('hr.feedback_submitted','feedback', v_ref,
    jsonb_build_object('audience', p_audience, 'anonymous', p_anonymous, 'category', p_category));
  return jsonb_build_object('id', v_ref);
end $$;

create or replace function public.set_feedback_state(p_ref text, p_state text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare f record;
begin
  perform public.assert_access('hr', 2);
  if p_state not in ('open','in_review','acknowledged','actioned','closed') then
    raise exception 'Unknown feedback state: %', p_state;
  end if;
  select * into f from public.staff_feedback where ref = p_ref;
  if not found then raise exception 'Feedback % not found', p_ref; end if;
  update public.staff_feedback set state = p_state, updated_at = now() where ref = p_ref;
  perform public.audit_write('hr.feedback_' || p_state,'feedback', p_ref, jsonb_build_object('from', f.state));
  return jsonb_build_object('id', p_ref, 'state', p_state);
end $$;

-- ---------- offboarding & exit ----------
create or replace function public.start_exit(
  p_person text, p_reason text default null, p_final_day date default null, p_staff_no text default null
) returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_entity uuid := (select id from public.entities where code = 'KE');
  v_user uuid; v_role text; v_ref text;
begin
  perform public.assert_access('hr', 2);
  if nullif(trim(coalesce(p_person,'')),'') is null then raise exception 'An exit needs a person'; end if;
  if p_staff_no is not null then
    select sf.app_user_id, u.role_title into v_user, v_role
    from public.staff_files sf join public.app_users u on u.id = sf.app_user_id
    where sf.staff_no = p_staff_no;
    if v_user is not null and exists (select 1 from public.staff_exits where app_user_id = v_user and state = 'in_progress') then
      raise exception '% already has an exit in progress', p_person;
    end if;
  end if;
  v_ref := public.next_ref('EXT');
  insert into public.staff_exits(ref, entity_id, app_user_id, person, role_title, reason, final_day, clearance, state)
  values (v_ref, v_entity, v_user, trim(p_person), v_role, nullif(trim(coalesce(p_reason,'')),''), p_final_day,
    jsonb_build_array(
      jsonb_build_object('area','Supervisor handover','done',false),
      jsonb_build_object('area','IT — access & equipment','done',false),
      jsonb_build_object('area','Finance — advances & floats','done',false),
      jsonb_build_object('area','Assets returned','done',false),
      jsonb_build_object('area','HR — documents & exit interview','done',false),
      jsonb_build_object('area','Final pay computed','done',false),
      jsonb_build_object('area','Certificate of service issued','done',false)),
    'in_progress');
  perform public.audit_write('hr.exit_started','exit', v_ref,
    jsonb_build_object('person', p_person, 'reason', p_reason, 'finalDay', p_final_day));
  return jsonb_build_object('id', v_ref, 'person', p_person);
end $$;

create or replace function public.sign_exit_step(p_ref text, p_idx int)
returns jsonb language plpgsql security definer set search_path = public as $$
declare x record; v jsonb; v_all boolean;
begin
  perform public.assert_access('hr', 2);
  select * into x from public.staff_exits where ref = p_ref;
  if not found then raise exception 'Exit % not found', p_ref; end if;
  if x.state = 'cleared' then raise exception '% is fully cleared already', p_ref; end if;
  if p_idx < 0 or p_idx >= jsonb_array_length(x.clearance) then raise exception 'No clearance area at position %', p_idx; end if;
  v := jsonb_set(x.clearance, array[p_idx::text, 'done'], to_jsonb(not coalesce((x.clearance -> p_idx ->> 'done')::boolean, false)));
  v_all := not exists (select 1 from jsonb_array_elements(v) e where not coalesce((e ->> 'done')::boolean, false));
  update public.staff_exits
     set clearance = v, state = case when v_all then 'cleared' else 'in_progress' end, updated_at = now()
   where ref = p_ref;
  if v_all then
    if x.app_user_id is not null then
      update public.staff_files set state = 'exited', updated_at = now() where app_user_id = x.app_user_id;
    end if;
    perform public.audit_write('hr.exit_cleared','exit', p_ref,
      jsonb_build_object('person', x.person, 'certificateOfService', true));
  end if;
  return jsonb_build_object('id', p_ref, 'clearance', v, 'state', case when v_all then 'cleared' else 'in_progress' end);
end $$;

-- ---------- RLS + grants ----------
do $$
declare t text;
begin
  foreach t in array array['appraisals','certifications','staff_feedback','staff_exits']
  loop
    execute format('alter table public.%I enable row level security', t);
    execute format('drop policy if exists "read for authenticated" on public.%I', t);
    execute format('create policy "read for authenticated" on public.%I for select to authenticated using (true)', t);
  end loop;
end $$;

do $$
declare fn text;
begin
  foreach fn in array array[
    'update_staff_hr_profile(text,text,date,jsonb)',
    'start_appraisal_cycle(text)','toggle_appraisal_kpi(uuid,int)','advance_appraisal(uuid)',
    'add_certification(text,text,text,date,text,boolean)','verify_certification(uuid,boolean)',
    'submit_feedback(text,text,text,boolean)','set_feedback_state(text,text)',
    'start_exit(text,text,date,text)','sign_exit_step(text,int)']
  loop
    execute format('revoke execute on function public.%s from public, anon', fn);
    execute format('grant execute on function public.%s to authenticated', fn);
  end loop;
end $$;

-- ---------- seeds (only when empty — mirrors the Jikoni_9 demo state) ----------

-- personnel fields: departments, two contracts entering the renewal window, next of kin
update public.staff_files sf set dept = v.dept
from (values
  ('IGN-001','Leadership'), ('IGN-002','Leadership'), ('IGN-003','Tech'),
  ('IGN-004','Operations'), ('IGN-005','Commercial / BD'), ('IGN-006','Partnerships'), ('IGN-007','Communications')
) as v(staff_no, dept)
where sf.staff_no = v.staff_no and sf.dept is null;

update public.staff_files set contract_type = 'fixed_term', contract_end = date '2026-09-30'
 where staff_no = 'IGN-006' and contract_end is null;
update public.staff_files set contract_type = 'fixed_term', contract_end = date '2026-10-15'
 where staff_no = 'IGN-007' and contract_end is null;

update public.staff_files set next_of_kin = '[{"name":"Grace Njeri","relationship":"Spouse","phone":"+254 722 000 111","cover":"medical"},{"name":"Amani Njeri","relationship":"Child","phone":"","cover":"medical"}]'::jsonb
 where staff_no = 'IGN-001' and next_of_kin = '[]'::jsonb;
update public.staff_files set next_of_kin = '[{"name":"Peter Kariuki","relationship":"Next of kin","phone":"+254 733 222 333","cover":"emergency"}]'::jsonb
 where staff_no = 'IGN-004' and next_of_kin = '[]'::jsonb;
update public.staff_files set next_of_kin = '[{"name":"Mary Wairimu","relationship":"Next of kin","phone":"+254 711 444 555","cover":"emergency"}]'::jsonb
 where staff_no = 'IGN-003' and next_of_kin = '[]'::jsonb;

-- appraisal cycle H1 2026 (Wilson self · Elizabeth not started · Brian manager · Lily signed off)
insert into public.appraisals(entity_id, app_user_id, cycle, reviewer_id, kpis, stage)
select (select id from public.entities where code='KE'), sf.app_user_id, 'H1 2026',
       (select app_user_id from public.staff_files where staff_no = v.rev),
       v.kpis::jsonb, v.stage
from (values
  ('IGN-005','IGN-001','[{"k":"Upstream pipeline value","met":true},{"k":"Partner MOUs signed","met":true},{"k":"Carbon programme milestones","met":true},{"k":"CRM hygiene","met":false}]','self'),
  ('IGN-006','IGN-001','[{"k":"Downstream partnerships live","met":true},{"k":"County agreements","met":true},{"k":"Programme co-funding","met":true},{"k":"Reporting discipline","met":false}]','not_started'),
  ('IGN-003','IGN-001','[{"k":"Platform releases shipped","met":true},{"k":"Uptime & data integrity","met":true},{"k":"Internal tooling adoption","met":false},{"k":"Documentation coverage","met":false}]','manager'),
  ('IGN-007','IGN-002','[{"k":"Brand & comms calendar","met":true},{"k":"Summit visibility","met":true},{"k":"Media placements","met":true},{"k":"Internal comms cadence","met":true}]','signed_off')
) as v(staff_no, rev, kpis, stage)
join public.staff_files sf on sf.staff_no = v.staff_no
where not exists (select 1 from public.appraisals);

-- certifications register + verification queue
insert into public.certifications(entity_id, app_user_id, holder, name, issuer, expiry, state)
select (select id from public.entities where code='KE'),
       (select app_user_id from public.staff_files where staff_no = v.staff_no),
       v.holder, v.name, v.issuer, v.expiry::date, v.state
from (values
  ('IGN-003','Brian','AWS Solutions Architect','Amazon','2027-03-31','verified'),
  ('IGN-004','Joan','CPA (K) — Part II','ICPAK',null,'verified'),
  ('IGN-005','Wilson','Carbon markets & MRV','Gold Standard','2026-09-30','verified'),
  ('IGN-006','Elizabeth','Project Management (PMP)','PMI','2028-01-31','verified'),
  (null,'Field team','Clean cooking installation','Ignis / BURN','2026-12-31','verified'),
  (null,'Tabitha','M&E and impact evaluation','Kenya School of Gov.',null,'pending'),
  ('IGN-007','Lily','Digital communications','Google',null,'pending')
) as v(staff_no, holder, name, issuer, expiry, state)
where not exists (select 1 from public.certifications);

-- feedback inbox
insert into public.staff_feedback(ref, entity_id, author_id, category, body, audience, state, created_at)
select v.ref, (select id from public.entities where code='KE'),
       (select app_user_id from public.staff_files where staff_no = v.staff_no),
       v.category, v.body, 'hr', v.state, now() - v.age::interval
from (values
  ('FB-018','IGN-004','Operations','Field per-diem reimbursement takes too long','in_review','2 days'),
  ('FB-017',null,'People','Request for a clearer remote-work policy','acknowledged','7 days'),
  ('FB-016','IGN-003','Ways of working','Suggestion: monthly cross-team demo session','actioned','14 days')
) as v(ref, staff_no, category, body, state, age)
where not exists (select 1 from public.staff_feedback);

-- exits (Lily mid-clearance · J. Kamau fully cleared, not a system user)
insert into public.staff_exits(ref, entity_id, app_user_id, person, role_title, reason, final_day, clearance, state)
select v.ref, (select id from public.entities where code='KE'),
       (select app_user_id from public.staff_files where staff_no = v.staff_no),
       v.person, v.role, v.reason, v.final_day::date, v.clearance::jsonb, v.state
from (values
  ('EXT-004','IGN-007','Lily','Communications','Contract end','2026-10-15',
   '[{"area":"Supervisor handover","done":true},{"area":"IT — access & equipment","done":true},{"area":"Finance — advances & floats","done":true},{"area":"Assets returned","done":false},{"area":"HR — documents & exit interview","done":false},{"area":"Final pay computed","done":false},{"area":"Certificate of service issued","done":false}]','in_progress'),
  ('EXT-003',null,'J. Kamau','Field officer','Resignation','2026-06-30',
   '[{"area":"Supervisor handover","done":true},{"area":"IT — access & equipment","done":true},{"area":"Finance — advances & floats","done":true},{"area":"Assets returned","done":true},{"area":"HR — documents & exit interview","done":true},{"area":"Final pay computed","done":true},{"area":"Certificate of service issued","done":true}]','cleared')
) as v(ref, staff_no, person, role, reason, final_day, clearance, state)
where not exists (select 1 from public.staff_exits);

-- ============================================================
-- ======== supabase/migrations/0027_staff_portal_self_service.sql ========
-- ============================================================
-- Jikoni — Staff Portal self-service (Jikoni_9 flows, live)
-- The HR suite (0026) gates writes behind assert_access('hr', …), which
-- regular staff don't hold. The portal needs me-scoped equivalents where
-- the guard is "this record is about the caller", not module access:
--   * self_assess_kpi / submit_self_assessment — my appraisal only
--   * submit_my_certification — lands in HR's verification queue
-- Feedback already works for any signed-in user (submit_feedback, 0026).
-- Idempotent: safe to re-run.
-- ============================================================

-- ---------- my appraisal: rate my own KPIs during self-assessment ----------
create or replace function public.self_assess_kpi(p_id uuid, p_idx int)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_me uuid := (select id from public.app_users where auth_id = auth.uid());
  a record; v jsonb;
begin
  if v_me is null then raise exception 'No staff record is linked to this login'; end if;
  select * into a from public.appraisals where id = p_id;
  if not found then raise exception 'Appraisal not found'; end if;
  if a.app_user_id <> v_me then raise exception 'This is not your review'; end if;
  if a.stage not in ('not_started','self') then
    raise exception 'Self-assessment is closed — the review is with your manager';
  end if;
  if p_idx < 0 or p_idx >= jsonb_array_length(a.kpis) then raise exception 'No KPI at position %', p_idx; end if;
  v := jsonb_set(a.kpis, array[p_idx::text, 'met'], to_jsonb(not coalesce((a.kpis -> p_idx ->> 'met')::boolean, false)));
  update public.appraisals set kpis = v, stage = 'self', updated_at = now() where id = p_id;
  return jsonb_build_object('id', p_id, 'kpis', v, 'stage', 'self');
end $$;

-- ---------- my appraisal: hand my self-assessment to the manager ----------
create or replace function public.submit_self_assessment(p_id uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_me uuid := (select id from public.app_users where auth_id = auth.uid());
  a record;
begin
  if v_me is null then raise exception 'No staff record is linked to this login'; end if;
  select ap.*, u.name into a from public.appraisals ap join public.app_users u on u.id = ap.app_user_id where ap.id = p_id;
  if not found then raise exception 'Appraisal not found'; end if;
  if a.app_user_id <> v_me then raise exception 'This is not your review'; end if;
  if a.stage not in ('not_started','self') then raise exception 'Already submitted'; end if;
  update public.appraisals set stage = 'manager', updated_at = now() where id = p_id;
  perform public.audit_write('hr.self_assessment_submitted','appraisal', a.cycle,
    jsonb_build_object('who', a.name));
  return jsonb_build_object('id', p_id, 'stage', 'manager');
end $$;

-- ---------- my certifications: submit for HR verification ----------
create or replace function public.submit_my_certification(p_name text, p_issuer text default null, p_expiry date default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_entity uuid := (select id from public.entities where code = 'KE');
  v_me uuid := (select id from public.app_users where auth_id = auth.uid());
  v_name text; v_id uuid;
begin
  if v_me is null then raise exception 'No staff record is linked to this login'; end if;
  if nullif(trim(coalesce(p_name,'')),'') is null then raise exception 'A certification needs a name'; end if;
  select name into v_name from public.app_users where id = v_me;
  insert into public.certifications(entity_id, app_user_id, holder, name, issuer, expiry, state)
  values (v_entity, v_me, v_name, trim(p_name), nullif(trim(coalesce(p_issuer,'')),''), p_expiry, 'pending')
  returning id into v_id;
  perform public.audit_write('hr.certification_submitted','staff', v_name,
    jsonb_build_object('name', p_name, 'issuer', p_issuer));
  return jsonb_build_object('id', v_id, 'name', p_name, 'state', 'pending');
end $$;

do $$
declare fn text;
begin
  foreach fn in array array[
    'self_assess_kpi(uuid,int)','submit_self_assessment(uuid)','submit_my_certification(text,text,date)']
  loop
    execute format('revoke execute on function public.%s from public, anon', fn);
    execute format('grant execute on function public.%s to authenticated', fn);
  end loop;
end $$;

-- ======== supabase/migrations/0028_appraisal_self_vs_manager.sql ========
-- ============================================================
-- Jikoni — Appraisals: independent self vs manager ratings
-- Until now HR (toggle_appraisal_kpi) and the employee
-- (self_assess_kpi) flipped the SAME kpis[].met flag, so the two
-- "independent" assessments overwrote each other. This migration
-- splits them:
--   * kpis[]        → [{k, met, self_met}]  met = manager, self_met = employee
--   * self_assess_kpi now flips self_met
--   * set_appraisal_kpis lets HR agree a custom KPI list while a
--     review is still not_started (locks when self-assessment opens)
--   * start_appraisal_cycle seeds self_met on the default template
-- toggle_appraisal_kpi / advance_appraisal / submit_self_assessment
-- are unchanged on purpose (manager may rate any time before
-- sign-off; submitting an all-✗ self-assessment is legitimate).
-- Idempotent: safe to re-run.
-- ============================================================

-- ---------- backfill: give every existing kpi element a self_met ----------
-- Copy met → self_met where the key is missing. Signed-off history must show
-- the same outcome on both sides; in-flight rows get a forgiving baseline the
-- manager can adjust before sign-off.
update public.appraisals a
set kpis = coalesce((
      select jsonb_agg(e || jsonb_build_object('self_met',
               coalesce((e->>'self_met')::boolean, (e->>'met')::boolean, false))
             order by ord)
      from jsonb_array_elements(a.kpis) with ordinality as t(e, ord)
    ), '[]'::jsonb),
    updated_at = now()
where exists (select 1 from jsonb_array_elements(a.kpis) e where not (e ? 'self_met'));

-- ---------- my appraisal: self-rating now writes self_met ----------
create or replace function public.self_assess_kpi(p_id uuid, p_idx int)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_me uuid := (select id from public.app_users where auth_id = auth.uid());
  a record; v jsonb;
begin
  if v_me is null then raise exception 'No staff record is linked to this login'; end if;
  select * into a from public.appraisals where id = p_id;
  if not found then raise exception 'Appraisal not found'; end if;
  if a.app_user_id <> v_me then raise exception 'This is not your review'; end if;
  if a.stage not in ('not_started','self') then
    raise exception 'Self-assessment is closed — the review is with your manager';
  end if;
  if p_idx < 0 or p_idx >= jsonb_array_length(a.kpis) then raise exception 'No KPI at position %', p_idx; end if;
  v := jsonb_set(a.kpis, array[p_idx::text, 'self_met'],
         to_jsonb(not coalesce((a.kpis -> p_idx ->> 'self_met')::boolean, false)));
  update public.appraisals set kpis = v, stage = 'self', updated_at = now() where id = p_id;
  return jsonb_build_object('id', p_id, 'kpis', v, 'stage', 'self');
end $$;

-- ---------- HR: agree the KPI list before self-assessment opens ----------
-- Whole-list replace; ratings reset to false (nothing real exists yet at
-- not_started). Locks the moment the employee starts rating, because
-- self_assess_kpi moves the stage to 'self' on their first click.
create or replace function public.set_appraisal_kpis(p_id uuid, p_kpis jsonb)
returns jsonb language plpgsql security definer set search_path = public as $$
declare a record; v jsonb; v_distinct int;
begin
  perform public.assert_access('hr', 2);
  select ap.*, u.name as who into a from public.appraisals ap
    join public.app_users u on u.id = ap.app_user_id where ap.id = p_id;
  if not found then raise exception 'Appraisal not found'; end if;
  if a.stage <> 'not_started' then
    raise exception 'KPIs lock once self-assessment opens';
  end if;
  if p_kpis is null or jsonb_typeof(p_kpis) <> 'array' or jsonb_array_length(p_kpis) = 0 then
    raise exception 'A review needs at least one KPI';
  end if;
  if jsonb_array_length(p_kpis) > 12 then raise exception 'Keep it under 12 KPIs'; end if;
  select coalesce(jsonb_agg(jsonb_build_object('k', t.k, 'met', false, 'self_met', false) order by t.ord), '[]'::jsonb),
         count(distinct lower(t.k))
    into v, v_distinct
  from (select nullif(trim(e->>'k'),'') as k, ord
        from jsonb_array_elements(p_kpis) with ordinality as x(e, ord)) t
  where t.k is not null;
  if jsonb_array_length(v) <> jsonb_array_length(p_kpis) or v_distinct <> jsonb_array_length(v) then
    raise exception 'Each KPI needs a distinct, non-empty name';
  end if;
  update public.appraisals set kpis = v, updated_at = now() where id = p_id;
  perform public.audit_write('hr.appraisal_kpis_set','appraisal', a.cycle,
    jsonb_build_object('who', a.who, 'count', jsonb_array_length(v)));
  return jsonb_build_object('id', p_id, 'kpis', v);
end $$;

-- ---------- cycle start: seed the template with both rating fields ----------
create or replace function public.start_appraisal_cycle(p_cycle text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_entity uuid := (select id from public.entities where code = 'KE');
  v_md uuid := (select id from public.app_users where role_title = 'Managing Director' limit 1);
  v_n int;
begin
  perform public.assert_access('hr', 3);
  if nullif(trim(coalesce(p_cycle,'')),'') is null then raise exception 'A cycle needs a name, e.g. H1 2026'; end if;
  insert into public.appraisals(entity_id, app_user_id, cycle, reviewer_id, kpis, stage)
  select v_entity, sf.app_user_id, trim(p_cycle), v_md,
    jsonb_build_array(
      jsonb_build_object('k','Delivery against plan','met',false,'self_met',false),
      jsonb_build_object('k','Quality & compliance','met',false,'self_met',false),
      jsonb_build_object('k','Collaboration & culture','met',false,'self_met',false),
      jsonb_build_object('k','Growth objective','met',false,'self_met',false)),
    'not_started'
  from public.staff_files sf
  where sf.state = 'active'
    and not exists (select 1 from public.appraisals a where a.app_user_id = sf.app_user_id and a.cycle = trim(p_cycle));
  get diagnostics v_n = row_count;
  perform public.audit_write('hr.appraisal_cycle_started','appraisal', trim(p_cycle), jsonb_build_object('opened', v_n));
  return jsonb_build_object('cycle', trim(p_cycle), 'opened', v_n);
end $$;

-- ---------- grants (replaced functions keep theirs; only the new one needs this) ----------
do $$ begin
  revoke execute on function public.set_appraisal_kpis(uuid, jsonb) from public, anon;
  grant execute on function public.set_appraisal_kpis(uuid, jsonb) to authenticated;
end $$;

-- ======== supabase/migrations/0029_exit_self_service_and_suspension.sql ========
-- ============================================================
-- Jikoni — Exit self-service + account suspension on clearance
-- Two gaps closed:
--   1. The departing employee could only WATCH the clearance list.
--      Areas now carry an owner ('staff' | 'company'); the employee
--      ticks their own two — Supervisor handover, Assets returned —
--      from My Exit via sign_my_exit_step. HR can still tick all.
--   2. Clearing an exit never closed access. sign_exit_step (and the
--      self variant, if their tick is the last) now stamps
--      cleared_at + access_until = now() + 24h. Once that grace
--      window passes, enforce_exit_suspensions() offboards the user
--      (reusing offboard_user: state exited, permissions zeroed,
--      grants/invites revoked) and bans the auth login. The sweep is
--      run opportunistically by my_access_state(), which every
--      client calls at session load.
-- Idempotent: safe to re-run.
-- ============================================================

alter table public.staff_exits add column if not exists cleared_at   timestamptz;
alter table public.staff_exits add column if not exists access_until timestamptz;

-- ---------- backfill: clearance areas gain an owner ----------
update public.staff_exits x
set clearance = coalesce((
      select jsonb_agg(e || jsonb_build_object('owner',
               case when e->>'area' in ('Supervisor handover','Assets returned')
                    then 'staff' else 'company' end)
             order by ord)
      from jsonb_array_elements(x.clearance) with ordinality as t(e, ord)
    ), '[]'::jsonb),
    updated_at = now()
where exists (select 1 from jsonb_array_elements(x.clearance) e where not (e ? 'owner'));

-- ---------- start_exit: seed areas with owners ----------
create or replace function public.start_exit(
  p_person text, p_reason text default null, p_final_day date default null, p_staff_no text default null
) returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_entity uuid := (select id from public.entities where code = 'KE');
  v_user uuid; v_role text; v_ref text;
begin
  perform public.assert_access('hr', 2);
  if nullif(trim(coalesce(p_person,'')),'') is null then raise exception 'An exit needs a person'; end if;
  if p_staff_no is not null then
    select sf.app_user_id, u.role_title into v_user, v_role
    from public.staff_files sf join public.app_users u on u.id = sf.app_user_id
    where sf.staff_no = p_staff_no;
    if v_user is not null and exists (select 1 from public.staff_exits where app_user_id = v_user and state = 'in_progress') then
      raise exception '% already has an exit in progress', p_person;
    end if;
  end if;
  v_ref := public.next_ref('EXT');
  insert into public.staff_exits(ref, entity_id, app_user_id, person, role_title, reason, final_day, clearance, state)
  values (v_ref, v_entity, v_user, trim(p_person), v_role, nullif(trim(coalesce(p_reason,'')),''), p_final_day,
    jsonb_build_array(
      jsonb_build_object('area','Supervisor handover','done',false,'owner','staff'),
      jsonb_build_object('area','IT — access & equipment','done',false,'owner','company'),
      jsonb_build_object('area','Finance — advances & floats','done',false,'owner','company'),
      jsonb_build_object('area','Assets returned','done',false,'owner','staff'),
      jsonb_build_object('area','HR — documents & exit interview','done',false,'owner','company'),
      jsonb_build_object('area','Final pay computed','done',false,'owner','company'),
      jsonb_build_object('area','Certificate of service issued','done',false,'owner','company')),
    'in_progress');
  perform public.audit_write('hr.exit_started','exit', v_ref,
    jsonb_build_object('person', p_person, 'reason', p_reason, 'finalDay', p_final_day));
  return jsonb_build_object('id', v_ref, 'person', p_person);
end $$;

-- ---------- HR signs any area; full clearance starts the 24h clock ----------
create or replace function public.sign_exit_step(p_ref text, p_idx int)
returns jsonb language plpgsql security definer set search_path = public as $$
declare x record; v jsonb; v_all boolean;
begin
  perform public.assert_access('hr', 2);
  select * into x from public.staff_exits where ref = p_ref;
  if not found then raise exception 'Exit % not found', p_ref; end if;
  if x.state = 'cleared' then raise exception '% is fully cleared already', p_ref; end if;
  if p_idx < 0 or p_idx >= jsonb_array_length(x.clearance) then raise exception 'No clearance area at position %', p_idx; end if;
  v := jsonb_set(x.clearance, array[p_idx::text, 'done'], to_jsonb(not coalesce((x.clearance -> p_idx ->> 'done')::boolean, false)));
  v_all := not exists (select 1 from jsonb_array_elements(v) e where not coalesce((e ->> 'done')::boolean, false));
  update public.staff_exits
     set clearance = v, state = case when v_all then 'cleared' else 'in_progress' end,
         cleared_at   = case when v_all then now() else cleared_at end,
         access_until = case when v_all then now() + interval '24 hours' else access_until end,
         updated_at = now()
   where ref = p_ref;
  if v_all then
    if x.app_user_id is not null then
      update public.staff_files set state = 'exited', updated_at = now() where app_user_id = x.app_user_id;
    end if;
    perform public.audit_write('hr.exit_cleared','exit', p_ref,
      jsonb_build_object('person', x.person, 'certificateOfService', true, 'accessCloses', now() + interval '24 hours'));
  end if;
  return jsonb_build_object('id', p_ref, 'clearance', v, 'state', case when v_all then 'cleared' else 'in_progress' end);
end $$;

-- ---------- the departing employee ticks their own areas ----------
create or replace function public.sign_my_exit_step(p_ref text, p_idx int)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_me uuid := (select id from public.app_users where auth_id = auth.uid());
  x record; v jsonb; v_all boolean;
begin
  if v_me is null then raise exception 'No staff record is linked to this login'; end if;
  select * into x from public.staff_exits where ref = p_ref;
  if not found then raise exception 'Exit % not found', p_ref; end if;
  if x.app_user_id is distinct from v_me then raise exception 'This is not your exit'; end if;
  if x.state = 'cleared' then raise exception 'Your exit is fully cleared already'; end if;
  if p_idx < 0 or p_idx >= jsonb_array_length(x.clearance) then raise exception 'No clearance area at position %', p_idx; end if;
  if coalesce(x.clearance -> p_idx ->> 'owner', 'company') <> 'staff' then
    raise exception '"%" is signed off by the function that owns it — you can only tick your own parts', x.clearance -> p_idx ->> 'area';
  end if;
  v := jsonb_set(x.clearance, array[p_idx::text, 'done'], to_jsonb(not coalesce((x.clearance -> p_idx ->> 'done')::boolean, false)));
  v_all := not exists (select 1 from jsonb_array_elements(v) e where not coalesce((e ->> 'done')::boolean, false));
  update public.staff_exits
     set clearance = v, state = case when v_all then 'cleared' else 'in_progress' end,
         cleared_at   = case when v_all then now() else cleared_at end,
         access_until = case when v_all then now() + interval '24 hours' else access_until end,
         updated_at = now()
   where ref = p_ref;
  perform public.audit_write('hr.exit_step_self_signed','exit', p_ref,
    jsonb_build_object('person', x.person, 'area', x.clearance -> p_idx ->> 'area'));
  if v_all then
    update public.staff_files set state = 'exited', updated_at = now() where app_user_id = x.app_user_id;
    perform public.audit_write('hr.exit_cleared','exit', p_ref,
      jsonb_build_object('person', x.person, 'certificateOfService', true, 'accessCloses', now() + interval '24 hours'));
  end if;
  return jsonb_build_object('id', p_ref, 'clearance', v, 'state', case when v_all then 'cleared' else 'in_progress' end);
end $$;

-- ---------- suspend accounts whose 24h grace has passed ----------
-- Reuses offboard_user (state exited, permissions zeroed, grants + invites
-- revoked) under the system-action bypass, then bans the auth login so the
-- password stops working. Auth-schema access is attempted best-effort — the
-- app-side block holds even if that update is not permitted.
create or replace function public.enforce_exit_suspensions()
returns jsonb language plpgsql security definer set search_path = public as $$
declare r record; v_n int := 0;
begin
  for r in
    select x.ref, u.id as uid, u.auth_id, u.email, u.name
    from public.staff_exits x
    join public.app_users u on u.id = x.app_user_id
    where x.state = 'cleared' and x.access_until is not null and x.access_until < now()
      and u.state <> 'exited'
  loop
    perform set_config('jikoni.system_action', 'true', true);
    perform public.offboard_user(r.email);
    perform set_config('jikoni.system_action', 'false', true);
    if r.auth_id is not null then
      begin
        update auth.users set banned_until = timestamptz '2999-12-31' where id = r.auth_id;
      exception when others then
        perform public.audit_write('user.suspend_auth_ban_failed','user', r.email, jsonb_build_object('error', sqlerrm));
      end;
    end if;
    perform public.audit_write('user.suspended_after_exit','user', r.email,
      jsonb_build_object('name', r.name, 'exit', r.ref));
    v_n := v_n + 1;
  end loop;
  return jsonb_build_object('suspended', v_n);
end $$;

-- ---------- the client's session gate: sweep, then report my state ----------
create or replace function public.my_access_state()
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_me record;
  v_until timestamptz;
begin
  perform public.enforce_exit_suspensions();
  select u.id, u.state into v_me from public.app_users u where u.auth_id = auth.uid();
  if v_me.id is null then return jsonb_build_object('state', 'unlinked'); end if;
  select x.access_until into v_until
  from public.staff_exits x
  where x.app_user_id = v_me.id and x.state = 'cleared'
  order by x.cleared_at desc nulls last limit 1;
  return jsonb_build_object('state', v_me.state, 'accessUntil', v_until);
end $$;

-- ---------- grants ----------
do $$
declare fn text;
begin
  foreach fn in array array[
    'sign_my_exit_step(text,int)','enforce_exit_suspensions()','my_access_state()']
  loop
    execute format('revoke execute on function public.%s from public, anon', fn);
    execute format('grant execute on function public.%s to authenticated', fn);
  end loop;
end $$;

-- ======== supabase/migrations/0030_cancel_exit.sql ========
-- ============================================================
-- Jikoni — Cancel a mistaken exit
-- An exit can be started (or even cleared) by mistake. cancel_exit
-- removes the exit record and undoes its side effects: the staff
-- file returns to active, and if the 24h grace had already passed
-- (account offboarded + auth banned by 0029), the person is
-- reinstated and the login unbanned. Module permissions zeroed by
-- offboard_user are NOT restorable automatically — re-grant those
-- in User Management.
-- Idempotent: safe to re-run.
-- ============================================================

-- reinstatement becomes a legal transition for both records (were one-way active → exited)
insert into public.record_transitions(record_type, from_state, to_state)
select v.record_type, v.from_state, v.to_state
from (values ('app_user','exited','active'), ('staff','exited','active')) as v(record_type, from_state, to_state)
where not exists (select 1 from public.record_transitions r
                  where r.record_type = v.record_type and r.from_state = v.from_state and r.to_state = v.to_state);

create or replace function public.cancel_exit(p_ref text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare x record; u record; v_reinstated boolean := false;
begin
  perform public.assert_access('hr', 2);
  select * into x from public.staff_exits where ref = p_ref;
  if not found then raise exception 'Exit % not found', p_ref; end if;
  if x.app_user_id is not null then
    update public.staff_files set state = 'active', updated_at = now()
     where app_user_id = x.app_user_id and state = 'exited';
    select * into u from public.app_users where id = x.app_user_id;
    if u.state = 'exited' then
      update public.app_users set state = 'active', status = 'active', updated_at = now() where id = u.id;
      v_reinstated := true;
      if u.auth_id is not null then
        begin
          update auth.users set banned_until = null where id = u.auth_id;
        exception when others then
          perform public.audit_write('user.unban_failed','user', u.email, jsonb_build_object('error', sqlerrm));
        end;
      end if;
    end if;
  end if;
  delete from public.staff_exits where ref = p_ref;
  perform public.audit_write('hr.exit_cancelled','exit', p_ref,
    jsonb_build_object('person', x.person, 'wasState', x.state, 'reinstated', v_reinstated));
  return jsonb_build_object('id', p_ref, 'person', x.person, 'reinstated', v_reinstated);
end $$;

do $$ begin
  revoke execute on function public.cancel_exit(text) from public, anon;
  grant execute on function public.cancel_exit(text) to authenticated;
end $$;

-- ======== supabase/migrations/0031_certification_files.sql ========
-- ============================================================
-- Jikoni — Certificate files
-- Certifications could only be recorded by name; you couldn't attach
-- the actual certificate. Now both sides upload the file:
--   * staff, from the Staff Portal "My Certificates" tab
--   * HR, when adding a certification to a staff file
-- The PDF/image lives in the existing private 'staff-documents'
-- bucket under the HOLDER's <app_user_id>/certifications/ prefix, so
-- the employee (own prefix) and HR (module read) can both open it.
-- HR gains write access into any staff prefix so it can upload on a
-- person's behalf. certifications.doc_path stores the object path.
-- Idempotent: safe to re-run.
-- ============================================================

alter table public.certifications add column if not exists doc_path text;

-- ---------- storage: let HR write into any staff prefix ----------
-- (owner-prefix write already exists from 0016; this adds an HR-scoped
--  permissive policy so HR can upload a certificate for someone else)
do $$
begin
  drop policy if exists "staff docs hr insert" on storage.objects;
  drop policy if exists "staff docs hr update" on storage.objects;

  create policy "staff docs hr insert" on storage.objects
    for insert to authenticated with check (
      bucket_id = 'staff-documents' and exists (
        select 1 from public.user_permissions up
        join public.app_users u on u.email = up.email
        where u.auth_id = auth.uid() and up.module = 'hr' and up.level >= 2));
  create policy "staff docs hr update" on storage.objects
    for update to authenticated using (
      bucket_id = 'staff-documents' and exists (
        select 1 from public.user_permissions up
        join public.app_users u on u.email = up.email
        where u.auth_id = auth.uid() and up.module = 'hr' and up.level >= 2));
exception when others then
  raise notice 'staff-documents HR write policy setup skipped: %', sqlerrm;
end $$;

-- ---------- HR adds a certification, optionally with the file ----------
drop function if exists public.add_certification(text, text, text, date, text, boolean);
create or replace function public.add_certification(
  p_holder text, p_name text, p_issuer text default null, p_expiry date default null,
  p_staff_no text default null, p_verified boolean default false, p_doc_path text default null
) returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_entity uuid := (select id from public.entities where code = 'KE');
  v_user uuid; v_id uuid;
begin
  perform public.assert_access('hr', 2);
  if nullif(trim(coalesce(p_name,'')),'') is null then raise exception 'A certification needs a name'; end if;
  if nullif(trim(coalesce(p_holder,'')),'') is null then raise exception 'A certification needs a holder'; end if;
  if p_staff_no is not null then
    select app_user_id into v_user from public.staff_files where staff_no = p_staff_no;
  end if;
  insert into public.certifications(entity_id, app_user_id, holder, name, issuer, expiry, state, doc_path)
  values (v_entity, v_user, trim(p_holder), trim(p_name), nullif(trim(coalesce(p_issuer,'')),''), p_expiry,
          case when p_verified then 'verified' else 'pending' end, nullif(trim(coalesce(p_doc_path,'')),''))
  returning id into v_id;
  perform public.audit_write('hr.certification_added','staff', coalesce(p_staff_no, trim(p_holder)),
    jsonb_build_object('name', p_name, 'issuer', p_issuer, 'state', case when p_verified then 'verified' else 'pending' end, 'file', p_doc_path is not null));
  return jsonb_build_object('id', v_id, 'holder', p_holder, 'name', p_name);
end $$;

-- ---------- staff submit their own certification, optionally with the file ----------
drop function if exists public.submit_my_certification(text, text, date);
create or replace function public.submit_my_certification(
  p_name text, p_issuer text default null, p_expiry date default null, p_doc_path text default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_entity uuid := (select id from public.entities where code = 'KE');
  v_me uuid := (select id from public.app_users where auth_id = auth.uid());
  v_name text; v_id uuid;
begin
  if v_me is null then raise exception 'No staff record is linked to this login'; end if;
  if nullif(trim(coalesce(p_name,'')),'') is null then raise exception 'A certification needs a name'; end if;
  select name into v_name from public.app_users where id = v_me;
  insert into public.certifications(entity_id, app_user_id, holder, name, issuer, expiry, state, doc_path)
  values (v_entity, v_me, v_name, trim(p_name), nullif(trim(coalesce(p_issuer,'')),''), p_expiry, 'pending',
          nullif(trim(coalesce(p_doc_path,'')),''))
  returning id into v_id;
  perform public.audit_write('hr.certification_submitted','staff', v_name,
    jsonb_build_object('name', p_name, 'issuer', p_issuer, 'file', p_doc_path is not null));
  return jsonb_build_object('id', v_id, 'name', p_name, 'state', 'pending');
end $$;

-- ---------- grants for the new signatures ----------
do $$ begin
  revoke execute on function public.add_certification(text, text, text, date, text, boolean, text) from public, anon;
  grant  execute on function public.add_certification(text, text, text, date, text, boolean, text) to authenticated;
  revoke execute on function public.submit_my_certification(text, text, date, text) from public, anon;
  grant  execute on function public.submit_my_certification(text, text, date, text) to authenticated;
end $$;

-- ======== supabase/migrations/0032_recruitment_public_applications.sql ========
-- ============================================================
-- Jikoni — Recruitment: public job board + auto-ranked applicants
-- Until now HR could only type candidates into a pipeline by hand.
-- This turns a requisition into a publishable job posting with stated
-- criteria (required skills / minimum years / education), advertises it
-- on a PUBLIC careers page (no login), lets anyone apply with a CV, and
-- auto-scores every application against the criteria so HR sees the
-- total applicant count and an auto-ranked shortlist (top N, configurable).
--
-- Reuses the existing recruitment_reqs + candidates tables (extended,
-- not replaced) so the current Recruitment tab and Staff Portal keep
-- working. Follows house conventions: security definer RPCs, next_ref,
-- audit_write, storage policies shaped like 0031. Idempotent.
-- ============================================================

-- ---------- posting criteria on the requisition ----------
alter table public.recruitment_reqs add column if not exists description     text;
alter table public.recruitment_reqs add column if not exists location        text;
alter table public.recruitment_reqs add column if not exists employment_type text not null default 'permanent';
alter table public.recruitment_reqs add column if not exists req_skills      jsonb not null default '[]'::jsonb;
alter table public.recruitment_reqs add column if not exists min_years       numeric not null default 0;
alter table public.recruitment_reqs add column if not exists min_education   text not null default 'none';
alter table public.recruitment_reqs add column if not exists shortlist_size  int not null default 4;
alter table public.recruitment_reqs add column if not exists published       boolean not null default false;
alter table public.recruitment_reqs add column if not exists published_at    timestamptz;
alter table public.recruitment_reqs add column if not exists closes_at       date;

-- ---------- application detail on the candidate ----------
alter table public.candidates add column if not exists phone       text;
alter table public.candidates add column if not exists years_exp   numeric not null default 0;
alter table public.candidates add column if not exists skills      jsonb not null default '[]'::jsonb;
alter table public.candidates add column if not exists education   text not null default 'none';
alter table public.candidates add column if not exists cv_path     text;
alter table public.candidates add column if not exists source      text not null default 'hr';
alter table public.candidates add column if not exists eligibility int not null default 0;

-- ============================================================
-- Scoring: 55% skills · 30% experience · 15% education → 0..100
-- ============================================================
create or replace function public.score_application(
  p_req uuid, p_skills jsonb, p_years numeric, p_education text
) returns int
language plpgsql stable security definer set search_path = public as $$
declare
  v_req_skills text[]; v_app_skills text[];
  v_min_years numeric; v_min_edu text;
  v_total int; v_matched int;
  v_skill numeric; v_exp numeric; v_edu numeric;
  v_rank_req int; v_rank_app int;
begin
  select
    coalesce(array(select lower(trim(x)) from jsonb_array_elements_text(coalesce(req_skills,'[]'::jsonb)) x), '{}'),
    coalesce(min_years, 0),
    coalesce(min_education, 'none')
  into v_req_skills, v_min_years, v_min_edu
  from public.recruitment_reqs where id = p_req;

  v_app_skills := coalesce(array(select lower(trim(x)) from jsonb_array_elements_text(coalesce(p_skills,'[]'::jsonb)) x), '{}');

  -- skills: share of required skills the applicant lists
  v_total := coalesce(array_length(v_req_skills, 1), 0);
  if v_total = 0 then
    v_skill := 100;
  else
    select count(*) into v_matched from unnest(v_req_skills) rs where rs = any (v_app_skills);
    v_skill := round(v_matched::numeric / v_total * 100);
  end if;

  -- experience: capped ratio against the minimum
  if v_min_years <= 0 then
    v_exp := 100;
  else
    v_exp := least(100, round(coalesce(p_years, 0) / v_min_years * 100));
  end if;

  -- education: meets-or-exceeds the required level → full marks
  v_rank_req := case v_min_edu           when 'certificate' then 1 when 'diploma' then 2 when 'degree' then 3 when 'masters' then 4 else 0 end;
  v_rank_app := case lower(coalesce(p_education,'none')) when 'certificate' then 1 when 'diploma' then 2 when 'degree' then 3 when 'masters' then 4 else 0 end;
  if v_rank_req = 0 or v_rank_app >= v_rank_req then
    v_edu := 100;
  else
    v_edu := round(v_rank_app::numeric / v_rank_req * 100);
  end if;

  return round(0.55 * v_skill + 0.30 * v_exp + 0.15 * v_edu);
end $$;

-- Is a posting live? security definer so the public/storage layer can check
-- without a read policy on recruitment_reqs.
create or replace function public.is_published_job(p_ref text)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.recruitment_reqs where ref = p_ref and published = true);
$$;

-- ============================================================
-- Public (anon) surface — list live jobs + submit an application
-- ============================================================
create or replace function public.list_public_jobs()
returns jsonb language sql stable security definer set search_path = public as $$
  select coalesce(jsonb_agg(j order by j->>'ref'), '[]'::jsonb) from (
    select jsonb_build_object(
      'ref', ref, 'roleTitle', role_title, 'dept', dept, 'location', location,
      'employmentType', employment_type, 'description', description,
      'reqSkills', coalesce(req_skills,'[]'::jsonb), 'minYears', min_years,
      'minEducation', min_education, 'closesAt', closes_at
    ) as j
    from public.recruitment_reqs
    where published = true and state not in ('filled','closed')
  ) t;
$$;

create or replace function public.apply_to_job(
  p_req_ref text, p_name text, p_email text, p_phone text default null,
  p_years numeric default 0, p_skills jsonb default '[]'::jsonb,
  p_education text default 'none', p_cv_path text default null
) returns jsonb language plpgsql security definer set search_path = public as $$
declare v_req record; v_score int; v_id uuid;
begin
  select id, published, state into v_req from public.recruitment_reqs where ref = p_req_ref;
  if v_req.id is null then raise exception 'Unknown job'; end if;
  if not v_req.published or v_req.state in ('filled','closed') then
    raise exception 'This role is not accepting applications';
  end if;
  if nullif(trim(coalesce(p_name,'')),'')  is null then raise exception 'Your name is required'; end if;
  if nullif(trim(coalesce(p_email,'')),'') is null then raise exception 'Your email is required'; end if;

  v_score := public.score_application(v_req.id, coalesce(p_skills,'[]'::jsonb), coalesce(p_years,0), coalesce(p_education,'none'));

  insert into public.candidates(recruitment_id, name, email, phone, years_exp, skills, education, cv_path, source, stage, eligibility)
  values (v_req.id, trim(p_name), lower(trim(p_email)), nullif(trim(coalesce(p_phone,'')),''),
          coalesce(p_years,0), coalesce(p_skills,'[]'::jsonb), lower(coalesce(p_education,'none')),
          nullif(trim(coalesce(p_cv_path,'')),''), 'public', 'applied', v_score)
  returning id into v_id;

  perform public.audit_write('hr.public_application','recruitment', p_req_ref,
    jsonb_build_object('name', p_name, 'email', p_email));
  return jsonb_build_object('ok', true);  -- score is deliberately not returned to the applicant
end $$;

-- ============================================================
-- HR surface — edit criteria + publish (HR level 2)
-- ============================================================
create or replace function public.update_posting(
  p_ref text, p_description text default null, p_location text default null,
  p_employment_type text default 'permanent', p_req_skills jsonb default '[]'::jsonb,
  p_min_years numeric default 0, p_min_education text default 'none',
  p_shortlist_size int default 4, p_closes_at date default null
) returns jsonb language plpgsql security definer set search_path = public as $$
declare v_req uuid;
begin
  perform public.assert_access('hr', 2);
  select id into v_req from public.recruitment_reqs where ref = p_ref;
  if v_req is null then raise exception 'Unknown job: %', p_ref; end if;

  update public.recruitment_reqs set
    description     = nullif(trim(coalesce(p_description,'')),''),
    location        = nullif(trim(coalesce(p_location,'')),''),
    employment_type = coalesce(nullif(trim(p_employment_type),''),'permanent'),
    req_skills      = coalesce(p_req_skills,'[]'::jsonb),
    min_years       = greatest(0, coalesce(p_min_years,0)),
    min_education   = coalesce(nullif(trim(p_min_education),''),'none'),
    shortlist_size  = greatest(1, coalesce(p_shortlist_size,4)),
    closes_at       = p_closes_at,
    updated_at      = now()
  where id = v_req;

  -- keep the ranking honest when criteria change: re-score public applicants
  update public.candidates c
    set eligibility = public.score_application(v_req, c.skills, c.years_exp, c.education), updated_at = now()
    where c.recruitment_id = v_req and c.source = 'public';

  perform public.audit_write('hr.posting_updated','recruitment', p_ref,
    jsonb_build_object('skills', p_req_skills, 'minYears', p_min_years, 'minEducation', p_min_education));
  return jsonb_build_object('ref', p_ref);
end $$;

create or replace function public.publish_posting(p_ref text, p_published boolean)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_req uuid;
begin
  perform public.assert_access('hr', 2);
  select id into v_req from public.recruitment_reqs where ref = p_ref;
  if v_req is null then raise exception 'Unknown job: %', p_ref; end if;
  update public.recruitment_reqs set
    published    = coalesce(p_published, false),
    published_at = case when p_published then coalesce(published_at, now()) else published_at end,
    updated_at   = now()
  where id = v_req;
  perform public.audit_write('hr.posting_' || case when p_published then 'published' else 'unpublished' end,
    'recruitment', p_ref, '{}'::jsonb);
  return jsonb_build_object('ref', p_ref, 'published', coalesce(p_published, false));
end $$;

-- ---------- grants ----------
do $$ begin
  revoke execute on function public.is_published_job(text) from public;
  grant  execute on function public.is_published_job(text) to anon, authenticated;
  revoke execute on function public.list_public_jobs() from public;
  grant  execute on function public.list_public_jobs() to anon, authenticated;
  revoke execute on function public.apply_to_job(text,text,text,text,numeric,jsonb,text,text) from public;
  grant  execute on function public.apply_to_job(text,text,text,text,numeric,jsonb,text,text) to anon, authenticated;
  revoke execute on function public.update_posting(text,text,text,text,jsonb,numeric,text,int,date) from public, anon;
  grant  execute on function public.update_posting(text,text,text,text,jsonb,numeric,text,int,date) to authenticated;
  revoke execute on function public.publish_posting(text,boolean) from public, anon;
  grant  execute on function public.publish_posting(text,boolean) to authenticated;
end $$;

-- ============================================================
-- Storage: private 'job-applications' bucket for CV uploads
--   path convention  <posting_ref>/<uuid>-<filename>
--   anon may upload only under a live posting's ref; HR reads all.
-- ============================================================
do $$
begin
  insert into storage.buckets (id, name, public)
  values ('job-applications', 'job-applications', false)
  on conflict (id) do nothing;

  drop policy if exists "job apps anon insert" on storage.objects;
  drop policy if exists "job apps hr read"     on storage.objects;

  create policy "job apps anon insert" on storage.objects
    for insert to anon, authenticated with check (
      bucket_id = 'job-applications' and public.is_published_job(split_part(name, '/', 1)));

  create policy "job apps hr read" on storage.objects
    for select to authenticated using (
      bucket_id = 'job-applications' and exists (
        select 1 from public.user_permissions up
        join public.app_users u on u.email = up.email
        where u.auth_id = auth.uid() and up.module = 'hr' and up.level >= 1));
exception when others then
  raise notice 'job-applications bucket/policy setup skipped: %', sqlerrm;
end $$;

-- ============================================================
-- Demo seed — publish the existing RCR-101 with criteria and a pool of
-- public applicants of varying fit, so the ranked shortlist demos live.
-- (Idempotent: only fires while RCR-101 is still unpublished / no public
--  applicants exist yet.)
-- ============================================================
update public.recruitment_reqs set
  description     = 'Coordinate field data collection across our five focus counties — plan routes, manage enumerators, and quality-assure survey submissions.',
  location        = 'Nairobi (with county travel)',
  employment_type = 'fixed_term',
  req_skills      = '["Data collection","KoboToolbox","Excel","Community engagement"]'::jsonb,
  min_years       = 3,
  min_education   = 'diploma',
  shortlist_size  = 4,
  closes_at       = (current_date + 30),
  published       = true,
  published_at    = coalesce(published_at, now())
where ref = 'RCR-101' and published = false;

insert into public.candidates(recruitment_id, name, email, phone, years_exp, skills, education, source, stage, eligibility)
select r.id, v.name, v.email, v.phone, v.years, v.skills::jsonb, v.edu, 'public', 'applied',
       public.score_application(r.id, v.skills::jsonb, v.years, v.edu)
from public.recruitment_reqs r
join (values
  ('Aisha Otieno',  'aisha.otieno@example.co.ke',   '0700000001', 5, '["Data collection","KoboToolbox","Excel","Community engagement"]', 'degree'),
  ('Brian Wanjiru', 'brian.wanjiru@example.co.ke',  '0700000002', 4, '["Data collection","KoboToolbox","Excel"]',                       'diploma'),
  ('Cynthia Kamau', 'cynthia.kamau@example.co.ke',  '0700000003', 3, '["Data collection","Excel"]',                                     'diploma'),
  ('David Achieng', 'david.achieng@example.co.ke',  '0700000004', 2, '["Community engagement","Excel"]',                                'degree'),
  ('Esther Njoroge','esther.njoroge@example.co.ke', '0700000005', 1, '["Excel"]',                                                       'certificate'),
  ('Felix Mutua',   'felix.mutua@example.co.ke',    '0700000006', 6, '["Data collection","KoboToolbox"]',                               'certificate')
) as v(name, email, phone, years, skills, edu) on r.ref = 'RCR-101'
where not exists (select 1 from public.candidates where source = 'public');

-- ======== supabase/migrations/0033_cv_ai_screening.sql ========
-- ============================================================
-- Jikoni — Recruitment: AI CV screening
-- Eligibility so far trusts only what the applicant typed into the form.
-- This adds columns to hold an AI verdict: HR triggers a read of the actual
-- uploaded CV (via the /api/screen-cv serverless function, which calls Claude),
-- and the model reports whether the CV genuinely evidences the job's required
-- skills / experience / education. The verdict is stored here so it shows,
-- ranked, in the HR Recruitment view. Idempotent.
-- ============================================================

alter table public.candidates add column if not exists ai_verdict     text
  check (ai_verdict in ('strong','possible','weak'));
alter table public.candidates add column if not exists ai_summary     text;
alter table public.candidates add column if not exists ai_checked     jsonb not null default '[]'::jsonb;  -- [{requirement, evidenced, note}]
alter table public.candidates add column if not exists ai_concerns    jsonb not null default '[]'::jsonb;  -- [string]
alter table public.candidates add column if not exists ai_screened_at timestamptz;

-- ======== supabase/migrations/0034_purge_demo_users_keep_wanjiku.sql ========
-- ============================================================
-- 0034 — Purge all demo/seed members, keep only wanjiku@ignis.africa
-- Going-live cleanup: User Management should start from a single super-admin
-- account. app_users has many FK references with no ON DELETE CASCADE, so we
-- clear the person-specific HR rows, null out ownership/actor references on
-- business records, then delete the users and their auth logins.
-- Idempotent: re-running is a no-op once only wanjiku remains.
-- ============================================================
do $$
declare keep constant text := 'wanjiku@ignis.africa';
begin
  -- 1) person-specific HR rows belonging to a doomed user → delete outright
  delete from public.payroll_items      where app_user_id in (select id from public.app_users where email <> keep);
  delete from public.leave_balances      where app_user_id in (select id from public.app_users where email <> keep);
  delete from public.leave_applications  where app_user_id in (select id from public.app_users where email <> keep);
  delete from public.appraisals          where app_user_id in (select id from public.app_users where email <> keep);
  delete from public.certifications      where app_user_id in (select id from public.app_users where email <> keep);
  delete from public.staff_feedback      where author_id   in (select id from public.app_users where email <> keep);
  delete from public.staff_exits         where app_user_id in (select id from public.app_users where email <> keep);
  delete from public.staff_files         where app_user_id in (select id from public.app_users where email <> keep);

  -- 2) nullable ownership / actor references on business records → set null
  update public.appraisals          set reviewer_id = null where reviewer_id in (select id from public.app_users where email <> keep);
  update public.leave_applications  set approver_id = null where approver_id in (select id from public.app_users where email <> keep);
  update public.payroll_runs        set prepared_by = null where prepared_by in (select id from public.app_users where email <> keep);
  update public.payroll_runs        set approved_by = null where approved_by in (select id from public.app_users where email <> keep);
  update public.dispatches          set created_by  = null where created_by  in (select id from public.app_users where email <> keep);
  update public.documents           set owner_id    = null where owner_id    in (select id from public.app_users where email <> keep);
  update public.goods_received_notes set receiver_id = null where receiver_id in (select id from public.app_users where email <> keep);
  update public.invites             set invited_by  = null where invited_by  in (select id from public.app_users where email <> keep);
  update public.purchase_orders     set owner_id    = null where owner_id    in (select id from public.app_users where email <> keep);
  update public.requisitions        set owner_id    = null where owner_id    in (select id from public.app_users where email <> keep);
  update public.sales_invoices      set owner_id    = null where owner_id    in (select id from public.app_users where email <> keep);
  update public.sanctions_checks    set checked_by  = null where checked_by  in (select id from public.app_users where email <> keep);
  update public.stock_movements     set created_by  = null where created_by  in (select id from public.app_users where email <> keep);
  update public.tasks               set owner_id    = null where owner_id    in (select id from public.app_users where email <> keep);
  update public.vendor_screenings   set screened_by = null where screened_by in (select id from public.app_users where email <> keep);
  update public.vendors             set owner_id    = null where owner_id    in (select id from public.app_users where email <> keep);

  -- 3) email-keyed rows
  delete from public.user_permissions where email <> keep;
  delete from public.invites          where email <> keep;

  -- 4) finally the members themselves
  delete from public.app_users where email <> keep;
end $$;

-- 5) remove their Supabase Auth logins so they can no longer sign in
delete from auth.users where email <> 'wanjiku@ignis.africa';


-- ============================================================
-- 0035 — Purge illustrative/demo module data for a clean slate.
-- The prototype seeded every module with demo records (0003_seed_kenya
-- and the phase migrations). Now that the tool is going live we clear
-- those out so real data can be entered module by module.
--
-- KEPT (not demo, or would break the app / auth if removed):
--   • User Management — app_users, user_permissions, role_templates
--   • Config / reference — entities, chart_of_accounts, approval_matrix,
--     budget_lines (definitions; usage reset to 0), crm_dropdown_options,
--     app_config, statutory_rates, leave_policies, stock_locations,
--     ref_counters, record_transitions, sod_conflicts
--   • audit_log (append-only — immutable by trigger)
--   • The surviving real users' HR footing — staff_files (employment
--     record) and leave_balances (entitlements) so HR & leave still work
--
-- Deletes run children-before-parents to satisfy foreign keys.
-- Idempotent: plain DELETEs; re-running against empty tables is a no-op.
-- ============================================================

begin;

-- ---------- children of engagements ----------
delete from public.engagement_partners;
delete from public.engagement_notes;
delete from public.engagement_updates;
delete from public.engagement_documents;

-- ---------- children of projects ----------
delete from public.eng_project_links;      -- also references engagements
delete from public.project_drawdowns;
delete from public.project_milestones;
delete from public.field_activities;
delete from public.field_assignments;      -- also references enumerators
delete from public.dispatches;

-- ---------- recruitment / field roster ----------
delete from public.candidates;             -- child of recruitment_reqs
delete from public.recruitment_reqs;
delete from public.enumerators;

-- ---------- inventory & assets (stock ledger is append-only; lift the guard) ----------
alter table public.stock_movements disable trigger ledger_no_edit;
delete from public.asset_depreciations;    -- child of assets
delete from public.stock_movements;        -- child of stock_items
delete from public.stock_levels;           -- child of stock_items
delete from public.stock_items;
delete from public.assets;
alter table public.stock_movements enable trigger ledger_no_edit;

-- ---------- procurement / finance payments (children of vendors / invoices) ----------
delete from public.sanctions_checks;       -- child of vendors
delete from public.vendor_screenings;      -- child of vendors
delete from public.purchase_orders;        -- child of vendors
delete from public.contracts;              -- child of vendors
delete from public.mpesa_payments;         -- child of payments
delete from public.payments;               -- child of invoices_ap
delete from public.invoices_ap;            -- child of vendors
delete from public.etims_submissions;      -- child of sales_invoices
delete from public.sales_invoices;
delete from public.requisitions;
delete from public.goods_received_notes;
delete from public.vendors;

-- ---------- finance ledger & banking ----------
delete from public.journal_lines;          -- child of journal_entries
delete from public.journal_entries;
delete from public.bank_accounts;
delete from public.petty_cash_floats;

-- ---------- payroll ----------
delete from public.payroll_items;          -- child of payroll_runs
delete from public.payroll_runs;

-- ---------- now the parents ----------
delete from public.engagements;
delete from public.projects;

-- ---------- Partnerships CRM registries & fundraise ----------
delete from public.partners;
delete from public.opportunities;
delete from public.diligence_requests;     -- child of raise_pipeline
delete from public.term_sheets;            -- child of raise_pipeline
delete from public.raise_pipeline;
delete from public.dataroom_access_log;    -- child of dataroom_grants
delete from public.dataroom_grants;

-- ---------- Compliance & Governance ----------
delete from public.policies;
delete from public.company_documents;
delete from public.compliance_obligations;
delete from public.risks;

-- ---------- Home — My Week tasks ----------
delete from public.tasks;

-- ---------- HR — demo personnel rows (app_users, staff_files, leave_balances kept) ----------
delete from public.appraisals;
delete from public.certifications;
delete from public.staff_feedback;
delete from public.staff_exits;
delete from public.leave_applications;

-- ---------- reset budget-line usage; clean the kept users' leave ledger ----------
update public.budget_lines set committed = 0, actual = 0;
update public.leave_balances set used = 0, reserved = 0;

commit;

-- ======== supabase/migrations/0036_ui_refinements.sql ========
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


-- ======== supabase/migrations/0037_projects_crm_round.sql ========
-- ============================================================
-- Jikoni Tool — Projects money model + CRM tagging/notifications
-- Backend for the Projects & Programmes + Partnerships CRM feature round:
--   * projects.budget_amount / start_date / end_date  — numeric budget + timeline
--   * project_milestones.amount / start_date / end_date — money + dates per milestone
--   * project_drawdowns.milestone_id                   — completing a milestone auto-
--                                                        creates a Received drawdown
--   * create_project             — numeric budget + start/end dates
--   * add_project_milestone      — amount + dates; total may not exceed the budget
--   * set_milestone_status       — done → auto-drawdown + recompute spent; reopen removes
--   * create_field_activity      — assign someone (name/phone/email) to a site
--   * partners.contact_name/email/phone + create_partner
--   * create_engagement + p_tagged_email — in-app notification for a tagged teammate
--   * notifications table + mark_notifications_seen — drives the bell + CRM badge
-- Contact fields, field activities and notifications are folded into the client read
-- model in loadFromDb (like dispatch receipts / asset assignments), so bootstrap()
-- stays untouched. Idempotent: safe to re-run.
-- ============================================================

-- ---------- new columns ----------
alter table public.projects add column if not exists budget_amount numeric not null default 0;
alter table public.projects add column if not exists start_date date;
alter table public.projects add column if not exists end_date date;

alter table public.project_milestones add column if not exists amount numeric not null default 0;
alter table public.project_milestones add column if not exists start_date date;
alter table public.project_milestones add column if not exists end_date date;

alter table public.project_drawdowns add column if not exists milestone_id uuid
  references public.project_milestones(id) on delete cascade;

alter table public.field_activities add column if not exists assignee text;
alter table public.field_activities add column if not exists phone text;
alter table public.field_activities add column if not exists email text;
alter table public.field_activities drop constraint if exists field_activities_kind_check;
alter table public.field_activities add constraint field_activities_kind_check
  check (kind in ('site_visit','install','readiness_assessment','assignment'));

alter table public.partners add column if not exists contact_name text;
alter table public.partners add column if not exists email text;
alter table public.partners add column if not exists phone text;

-- ---------- notifications (drives the topbar bell + CRM badge) ----------
create table if not exists public.notifications (
  id           uuid primary key default gen_random_uuid(),
  entity_id    uuid references public.entities(id),
  recipient_email text not null,
  kind         text not null,
  title        text not null,
  body         text,
  link_view    text,
  link_ref     text,
  seen         boolean not null default false,
  created_at   timestamptz not null default now()
);
create index if not exists notifications_recipient_idx on public.notifications(recipient_email, seen);

alter table public.notifications enable row level security;
drop policy if exists "own notifications read" on public.notifications;
create policy "own notifications read" on public.notifications for select to authenticated
  using (recipient_email = lower(coalesce(nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'email', '')));
drop policy if exists "own notifications update" on public.notifications;
create policy "own notifications update" on public.notifications for update to authenticated
  using (recipient_email = lower(coalesce(nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'email', '')));

-- ---------- money helpers ----------
create or replace function public.fmt_kes(p numeric) returns text
language sql immutable as $$ select 'KES ' || to_char(coalesce(p, 0), 'FM999,999,999,990') $$;

-- Recompute a project's displayed spend + burn % from its completed milestones.
create or replace function public.recompute_project_money(p_id uuid) returns void
language plpgsql security definer set search_path = public as $$
declare v_spent numeric; v_budget numeric;
begin
  select coalesce(sum(amount), 0) into v_spent
    from public.project_milestones where project_id = p_id and status = 'done';
  select budget_amount into v_budget from public.projects where id = p_id;
  update public.projects
     set spent_txt  = public.fmt_kes(v_spent),
         pct        = case when coalesce(v_budget, 0) > 0
                           then round(v_spent / v_budget * 100)::text || '%' else '0%' end,
         updated_at = now()
   where id = p_id;
end $$;

-- ---------- project read-model json (now carries money + dates) ----------
create or replace function public.project_detail_json(p_id uuid) returns jsonb
language sql stable security definer set search_path = public as $$
  select jsonb_build_object(
    'id', p.id, 'state', p.state,
    'funder', p.funder, 'status', p.status, 'budget', p.budget_txt, 'spent', p.spent_txt,
    'pct', p.pct, 'timeline', p.timeline, 'team', p.team, 'reporting', p.reporting, 'field', p.field,
    'budgetAmount', p.budget_amount,
    'spentAmount', coalesce((select sum(amount) from public.project_milestones
                             where project_id = p.id and status = 'done'), 0),
    'startDate', p.start_date, 'endDate', p.end_date,
    'docs', p.docs,
    'milestones', coalesce((select jsonb_agg(jsonb_build_object(
                              'id', id, 't', title, 's', status,
                              'amount', amount, 'start', start_date, 'end', end_date) order by sort)
                            from public.project_milestones where project_id = p.id), '[]'::jsonb),
    'drawdowns',  coalesce((select jsonb_agg(jsonb_build_object(
                              'id', id, 't', title, 'v', amount_txt, 's', status) order by sort)
                            from public.project_drawdowns where project_id = p.id), '[]'::jsonb))
  from public.projects p where p.id = p_id
$$;

-- ---------- create a project (numeric budget + start/end dates) ----------
drop function if exists public.create_project(text,text,text,text,text,text);
create or replace function public.create_project(
  p_name text, p_funder text, p_budget_amount numeric,
  p_start_date date, p_end_date date, p_team text, p_status text
) returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_entity uuid := (select id from public.entities where code = 'KE');
  v_timeline text;
  p record;
begin
  perform public.assert_access('projects', 2);
  if nullif(trim(coalesce(p_name, '')), '') is null then raise exception 'A project name is required'; end if;
  if exists (select 1 from public.projects where name = trim(p_name)) then
    raise exception 'A project named "%" already exists', trim(p_name);
  end if;
  v_timeline := case
    when p_start_date is not null and p_end_date is not null
      then to_char(p_start_date, 'Mon YYYY') || ' → ' || to_char(p_end_date, 'Mon YYYY')
    when p_start_date is not null then 'From ' || to_char(p_start_date, 'Mon YYYY')
    else '2026' end;
  insert into public.projects(entity_id, name, funder, status, budget_amount, budget_txt, spent_txt, pct,
                              start_date, end_date, timeline, team, is_extra, docs)
  values (v_entity, trim(p_name), nullif(trim(coalesce(p_funder, '')), ''),
          coalesce(nullif(trim(coalesce(p_status, '')), ''), 'Setup'),
          coalesce(p_budget_amount, 0), public.fmt_kes(coalesce(p_budget_amount, 0)), 'KES 0', '0%',
          p_start_date, p_end_date, v_timeline,
          nullif(trim(coalesce(p_team, '')), ''), true, '[]'::jsonb)
  returning * into p;
  perform public.audit_write('project.created', 'project', p.name,
    jsonb_build_object('funder', p_funder, 'budget', p_budget_amount, 'start', p_start_date, 'end', p_end_date, 'team', p_team));
  return jsonb_build_object('name', p.name, 'created', true, 'detail', public.project_detail_json(p.id));
end $$;

-- ---------- add a milestone (amount + dates; total may not exceed budget) ----------
drop function if exists public.add_project_milestone(uuid,text,text);
create or replace function public.add_project_milestone(
  p_project_id uuid, p_title text, p_amount numeric default 0,
  p_start_date date default null, p_end_date date default null, p_status text default 'todo')
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_sort int; v_budget numeric; v_used numeric;
begin
  perform public.assert_access('projects', 2);
  if nullif(trim(coalesce(p_title, '')), '') is null then raise exception 'A milestone title is required'; end if;
  if p_status not in ('done','now','todo') then raise exception 'Invalid milestone status %', p_status; end if;
  if coalesce(p_amount, 0) < 0 then raise exception 'Milestone amount cannot be negative'; end if;
  select budget_amount into v_budget from public.projects where id = p_project_id;
  if v_budget is null then raise exception 'Project not found'; end if;
  select coalesce(sum(amount), 0) into v_used from public.project_milestones where project_id = p_project_id;
  if v_used + coalesce(p_amount, 0) > v_budget then
    raise exception 'Milestones would total % which exceeds the project budget of %',
      public.fmt_kes(v_used + coalesce(p_amount, 0)), public.fmt_kes(v_budget);
  end if;
  select coalesce(max(sort), 0) + 1 into v_sort from public.project_milestones where project_id = p_project_id;
  insert into public.project_milestones(project_id, title, status, sort, amount, start_date, end_date)
  values (p_project_id, trim(p_title), p_status, v_sort, coalesce(p_amount, 0), p_start_date, p_end_date);
  perform public.recompute_project_money(p_project_id);
  perform public.audit_write('project.milestone_added','project', p_project_id::text,
    jsonb_build_object('title', p_title, 'amount', p_amount, 'status', p_status));
  return public.project_payload(p_project_id);
end $$;

-- ---------- complete a milestone → recognise its amount as a drawdown ----------
create or replace function public.set_milestone_status(p_milestone_id uuid, p_status text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_project uuid; v_title text; v_amount numeric; v_sort int;
begin
  perform public.assert_access('projects', 2);
  if p_status not in ('done','now','todo') then raise exception 'Invalid milestone status %', p_status; end if;
  update public.project_milestones set status = p_status where id = p_milestone_id
    returning project_id, title, amount into v_project, v_title, v_amount;
  if v_project is null then raise exception 'Milestone not found'; end if;
  if p_status = 'done' then
    -- recognise the milestone amount as a Received drawdown (one per milestone)
    if not exists (select 1 from public.project_drawdowns where milestone_id = p_milestone_id) then
      select coalesce(max(sort), 0) + 1 into v_sort from public.project_drawdowns where project_id = v_project;
      insert into public.project_drawdowns(project_id, title, amount_txt, status, sort, milestone_id)
      values (v_project, v_title, public.fmt_kes(v_amount), 'Received', v_sort, p_milestone_id);
    end if;
  else
    -- reopened → pull the auto-created drawdown back out
    delete from public.project_drawdowns where milestone_id = p_milestone_id;
  end if;
  perform public.recompute_project_money(v_project);
  perform public.audit_write('project.milestone_status','project', v_project::text,
    jsonb_build_object('milestone', p_milestone_id, 'status', p_status));
  return public.project_payload(v_project);
end $$;

-- ---------- assign someone to a field activity ----------
create or replace function public.create_field_activity(
  p_project_id uuid, p_assignee text, p_phone text, p_email text,
  p_activity_on date default current_date, p_note text default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_id uuid;
begin
  perform public.assert_access('projects', 2);
  if not exists (select 1 from public.projects where id = p_project_id) then raise exception 'Project not found'; end if;
  if nullif(trim(coalesce(p_assignee, '')), '') is null then raise exception 'An assignee is required'; end if;
  insert into public.field_activities(project_id, kind, county, note, activity_on, assignee, phone, email)
  values (p_project_id, 'assignment', null, nullif(trim(coalesce(p_note, '')), ''),
          coalesce(p_activity_on, current_date), trim(p_assignee),
          nullif(trim(coalesce(p_phone, '')), ''), nullif(trim(coalesce(p_email, '')), ''))
  returning id into v_id;
  perform public.audit_write('project.field_activity','project', p_project_id::text,
    jsonb_build_object('assignee', p_assignee, 'note', p_note));
  return jsonb_build_object('id', v_id);
end $$;

-- ---------- create a partner (now captures a contact person) ----------
drop function if exists public.create_partner(text,text,text,text,text);
create or replace function public.create_partner(
  p_name text, p_type text, p_country text, p_owner_name text, p_status text,
  p_contact_name text default null, p_email text default null, p_phone text default null
) returns jsonb language plpgsql security definer set search_path = public as $$
declare v_entity uuid := (select id from public.entities where code = 'KE'); v_cls text; v_id uuid;
begin
  perform public.assert_access('crm', 2);
  v_cls := case p_status
    when 'Active'        then 'done'
    when 'Ready to fund' then 'done'
    when 'Holding'       then 'over'
    when 'Negotiation'   then 'today'
    when 'Materials'     then 'today'
    when 'Contracting'   then 'today'
    else 'week' end;
  insert into public.partners(entity_id, name, type, country, owner_name, status, status_cls,
                              contact_name, email, phone)
  values (v_entity, p_name, p_type, p_country, p_owner_name, p_status, v_cls,
          nullif(trim(coalesce(p_contact_name, '')), ''), nullif(trim(coalesce(p_email, '')), ''),
          nullif(trim(coalesce(p_phone, '')), ''))
  returning id into v_id;
  perform public.audit_write('partner.created', 'partner', p_name,
    jsonb_build_object('type', p_type, 'country', p_country, 'owner', p_owner_name,
                       'status', p_status, 'contact', p_contact_name, 'email', p_email));
  return jsonb_build_object(
    'id', v_id, 'name', p_name, 'type', p_type, 'country', p_country,
    'ownerName', p_owner_name, 'status', p_status, 'statusCls', v_cls,
    'contactName', p_contact_name, 'email', p_email, 'phone', p_phone);
end $$;

-- ---------- create an engagement (optionally tag a teammate) ----------
drop function if exists public.create_engagement(text,text,text,text,text,text);
create or replace function public.create_engagement(
  p_name text, p_stage text, p_owner_name text, p_pipeline text,
  p_next_action text default null, p_due_key text default 'week', p_tagged_email text default null
) returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_ref text; v_pill text; v_pill_txt text; v_stage text; v_id uuid; v_who text;
  v_note text := nullif(trim(coalesce(p_next_action, '')), '');
  v_tag  text := lower(nullif(trim(coalesce(p_tagged_email, '')), ''));
  v_entity uuid := (select id from public.entities where code = 'KE');
begin
  perform public.assert_access('crm', 2);
  v_ref := public.next_ref(case when p_pipeline = 'down' then 'DST' else 'ENG' end);
  v_stage := coalesce(nullif(trim(coalesce(p_stage, '')), ''),
                      case when p_pipeline = 'down' then 'Identification' else 'Discovery' end);
  select case p_due_key when 'today' then 'today' when 'over' then 'over' else 'week' end,
         case p_due_key when 'today' then 'Today' when 'over' then 'Overdue' when 'nweek' then 'Next week' else 'This week' end
    into v_pill, v_pill_txt;
  insert into public.engagements(ref, entity_id, name, stage, owner_name, pill, pill_txt, pipeline)
  values (v_ref, v_entity, p_name, v_stage, p_owner_name, v_pill, v_pill_txt, p_pipeline)
  returning id into v_id;
  v_who := coalesce((select name from public.app_users where auth_id = auth.uid()), p_owner_name);
  if v_note is not null then
    insert into public.engagement_updates(engagement_id, channel, who, note, happened)
    values (v_id, 'Note', v_who, v_note, 'Today');
  end if;
  -- tag a teammate → in-app notification (email is sent client-side via /api/notify)
  if v_tag is not null and exists (select 1 from public.app_users where email = v_tag) then
    insert into public.notifications(entity_id, recipient_email, kind, title, body, link_view, link_ref)
    values (v_entity, v_tag, 'eng_tag',
            v_who || ' tagged you on ' || v_ref,
            p_name || ' — ' || v_stage, 'crm', v_ref);
  end if;
  perform public.audit_write('engagement.created', 'engagement', v_ref,
    jsonb_build_object('name', p_name, 'stage', v_stage, 'owner', p_owner_name,
                       'pipeline', p_pipeline, 'note', v_note, 'tagged', v_tag));
  return jsonb_build_object(
    'id', v_ref, 'n', p_name, 'st', v_stage, 'o', p_owner_name,
    'pl', v_pill, 'plt', v_pill_txt, 'pipeline', p_pipeline, 'taggedEmail', v_tag);
end $$;

-- ---------- mark my notifications read ----------
create or replace function public.mark_notifications_seen(p_ids uuid[] default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_email text := lower(coalesce(nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'email', ''));
  v_n int;
begin
  update public.notifications set seen = true
   where recipient_email = v_email and seen = false and (p_ids is null or id = any(p_ids));
  get diagnostics v_n = row_count;
  return jsonb_build_object('seen', v_n);
end $$;

-- ---------- grants ----------
do $$
declare fn text;
begin
  foreach fn in array array[
    'create_project(text,text,numeric,date,date,text,text)',
    'add_project_milestone(uuid,text,numeric,date,date,text)',
    'set_milestone_status(uuid,text)',
    'create_field_activity(uuid,text,text,text,date,text)',
    'create_partner(text,text,text,text,text,text,text,text)',
    'create_engagement(text,text,text,text,text,text,text)',
    'mark_notifications_seen(uuid[])']
  loop
    execute format('revoke execute on function public.%s from public, anon', fn);
    execute format('grant execute on function public.%s to authenticated', fn);
  end loop;
end $$;


-- ======== supabase/migrations/0038_finance_procurement_wiring.sql ========
-- ============================================================
-- Jikoni Tool — Finance & Procurement wiring round
-- The procure-to-pay + payables/receivables spine already exists as RPCs
-- (submit_requisition, budget_check, approve_requisition, raise_po, submit_grn,
-- capture_ap_invoice, three_way_match, pay_invoice, screen_vendor,
-- submit_sales_invoice, post_journal). This migration adds the few missing pieces
-- so the modules run end to end on real data:
--   * create_vendor        — onboard a supplier (screening comes after, via screen_vendor)
--   * record_ar_receipt     — record a collection against a sales invoice + post the journal
--   * account_balances()    — trial-balance read model for the General Ledger tab
--   * chart_of_accounts read policy (the only spine table without one)
-- Idempotent: safe to re-run.
-- ============================================================

-- chart_of_accounts is the only spine table missing a read policy (needed for the GL tab)
alter table public.chart_of_accounts enable row level security;
drop policy if exists "read for authenticated" on public.chart_of_accounts;
create policy "read for authenticated" on public.chart_of_accounts for select to authenticated using (true);

-- ---------- onboard a vendor (screening + tax gate applied later) ----------
create or replace function public.create_vendor(
  p_name text, p_category text default null, p_country text default 'Kenya',
  p_kra_pin text default null, p_bank text default null
) returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_entity uuid := (select id from public.entities where code = 'KE');
  v_owner  uuid := (select id from public.app_users where auth_id = auth.uid());
  v_pin text := nullif(trim(coalesce(p_kra_pin, '')), '');
  v_id uuid;
begin
  perform public.assert_access('procurement', 2);
  if nullif(trim(coalesce(p_name, '')), '') is null then raise exception 'A vendor needs a name'; end if;
  if exists (select 1 from public.vendors where name = trim(p_name)) then
    raise exception 'A vendor named "%" already exists', trim(p_name);
  end if;
  insert into public.vendors(entity_id, owner_id, name, category, country, tax_status, bank, since,
                             screen_status, state)
  values (v_entity, v_owner, trim(p_name), nullif(trim(coalesce(p_category, '')), ''),
          coalesce(nullif(trim(coalesce(p_country, '')), ''), 'Kenya'),
          case when v_pin is not null then 'PIN ' || v_pin else 'Pending PIN' end,
          nullif(trim(coalesce(p_bank, '')), ''), to_char(now(), 'Mon YYYY'),
          'pending', 'draft')
  returning id into v_id;
  perform public.audit_write('vendor.created', 'vendor', trim(p_name),
    jsonb_build_object('category', p_category, 'country', p_country, 'kra', v_pin));
  return jsonb_build_object('id', v_id, 'name', trim(p_name), 'category', p_category,
    'country', coalesce(p_country, 'Kenya'), 'screenStatus', 'pending', 'state', 'draft');
end $$;

-- ---------- record a collection against a sales invoice ----------
create or replace function public.record_ar_receipt(p_inv_ref text, p_amount numeric, p_method text default 'bank')
returns jsonb language plpgsql security definer set search_path = public as $$
declare inv record; je text;
begin
  perform public.assert_access('finance', 2);
  if coalesce(p_amount, 0) <= 0 then raise exception 'A receipt amount is required'; end if;
  select * into inv from public.sales_invoices where ref = p_inv_ref;
  if not found then raise exception 'Sales invoice % not found', p_inv_ref; end if;
  if inv.state = 'paid' then raise exception '% is already settled', p_inv_ref; end if;
  -- cash in, receivable down
  je := public.post_journal('Receipt for ' || p_inv_ref || ' — ' || inv.customer, 'receipt', p_inv_ref,
    jsonb_build_array(
      jsonb_build_object('account', case when p_method = 'mpesa' then '1000' else '1000' end, 'debit', p_amount),
      jsonb_build_object('account', '1100', 'credit', p_amount)));
  update public.sales_invoices set state = 'paid', due_pill_cls = 'done', due_pill_txt = 'Paid', updated_at = now()
   where id = inv.id;
  perform public.audit_write('receipt.recorded', 'sales_invoice', p_inv_ref,
    jsonb_build_object('amount', p_amount, 'method', p_method, 'journal', je));
  return jsonb_build_object('invoice', p_inv_ref, 'amount', p_amount, 'journal', je);
end $$;

-- ---------- trial-balance read model for the General Ledger tab ----------
-- Sums posted journal lines per account and joins the chart of accounts so the GL
-- shows a balance per account with its type. Balance is signed by account kind.
create or replace function public.account_balances() returns jsonb
language sql stable security definer set search_path = public as $$
  select coalesce(jsonb_agg(jsonb_build_object(
      'code', code, 'name', name, 'kind', kind,
      'debit', debit, 'credit', credit,
      'balance', case when kind in ('asset','expense') then debit - credit else credit - debit end)
      order by code), '[]'::jsonb)
  from (
    select coa.code, coa.name, coa.kind,
           coalesce(sum(jl.debit), 0)  as debit,
           coalesce(sum(jl.credit), 0) as credit
    from public.chart_of_accounts coa
    left join public.journal_lines jl on jl.account_code = coa.code
    left join public.journal_entries je on je.id = jl.journal_id and je.state = 'posted'
    where coa.active
    group by coa.code, coa.name, coa.kind
    having coalesce(sum(jl.debit), 0) <> 0 or coalesce(sum(jl.credit), 0) <> 0
  ) q
$$;

-- ---------- grants ----------
do $$
declare fn text;
begin
  foreach fn in array array[
    'create_vendor(text,text,text,text,text)',
    'record_ar_receipt(text,numeric,text)',
    'account_balances()']
  loop
    execute format('revoke execute on function public.%s from public, anon', fn);
    execute format('grant execute on function public.%s to authenticated', fn);
  end loop;
end $$;


-- ======== supabase/migrations/0039_v2_control_gaps.sql ========
-- ============================================================
-- Jikoni Tool — Finance & Procurement PRD v2: control-gap fixes
-- Closes the loopholes called out in the v2 PRD (backend-enforced + testable):
--   #2 vendor bank-detail change → callback verification before it takes effect
--   #3 duplicate supplier-invoice check on capture
--   #4 PO amendment → re-approval when the change exceeds tolerance
--   #5 three-way-match tolerance + PO-amend tolerance are configurable (app_config)
--   #6 over-delivery on a GRN is held, not silently accepted
--   #1 notifications fire on approvals + exceptions (notify_role helper)
-- Plus set_app_config so Settings can edit the rules. Idempotent: safe to re-run.
-- ============================================================

-- ---------- configurable rules ----------
insert into public.app_config(key, value) values
  ('match_tolerance_pct', '0.5'::jsonb),
  ('po_amend_tolerance_pct', '5'::jsonb),
  ('manual_journal_threshold', '100000'::jsonb),
  ('reminder_hours', '24'::jsonb),
  ('escalation_hours', '72'::jsonb)
on conflict (key) do nothing;

-- admin setter for the Settings screen
create or replace function public.set_app_config(p_key text, p_value jsonb)
returns jsonb language plpgsql security definer set search_path = public as $$
begin
  perform public.assert_access('users', 2);
  if p_key not in ('match_tolerance_pct','po_amend_tolerance_pct','manual_journal_threshold',
                   'reminder_hours','escalation_hours','enforce_sod','enforce_access') then
    raise exception 'Unknown setting: %', p_key;
  end if;
  insert into public.app_config(key, value, updated_at) values (p_key, p_value, now())
  on conflict (key) do update set value = excluded.value, updated_at = now();
  perform public.audit_write('config.updated','app_config', p_key, jsonb_build_object('value', p_value));
  return jsonb_build_object('key', p_key, 'value', p_value);
end $$;

-- ---------- notifications: fan a notification out to everyone holding a role ----------
create or replace function public.notify_role(
  p_module text, p_min_level int, p_kind text, p_title text, p_body text,
  p_link_view text, p_link_ref text
) returns void language plpgsql security definer set search_path = public as $$
declare v_entity uuid := (select id from public.entities where code = 'KE');
begin
  insert into public.notifications(entity_id, recipient_email, kind, title, body, link_view, link_ref)
  select v_entity, up.email, p_kind, p_title, p_body, p_link_view, p_link_ref
  from public.user_permissions up
  where up.module = p_module and up.level >= p_min_level;
end $$;

-- ---------- PO amendment (loophole #4) ----------
alter table public.purchase_orders add column if not exists needs_reapproval boolean not null default false;

create or replace function public.amend_po(
  p_po_ref text, p_new_amount numeric, p_new_delivery text default null, p_reason text default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  po record; bcode text; tol numeric; delta_pct numeric; v_reapp boolean;
begin
  perform public.assert_access('procurement', 2);
  select * into po from public.purchase_orders where ref = p_po_ref;
  if not found then raise exception 'PO % not found', p_po_ref; end if;
  if po.state in ('closed','cancelled') then raise exception 'PO % is % and cannot be amended', p_po_ref, po.state; end if;
  if coalesce(p_new_amount, 0) <= 0 then raise exception 'A new amount is required'; end if;
  tol := coalesce((select value::numeric from public.app_config where key = 'po_amend_tolerance_pct'), 5);
  delta_pct := case when po.amount > 0 then abs(p_new_amount - po.amount) / po.amount * 100 else 100 end;
  v_reapp := delta_pct > tol;
  -- move the budget commitment by the delta on the coded line
  select budget_code into bcode from public.requisitions where id = po.requisition_id;
  if bcode is not null then
    update public.budget_lines set committed = greatest(committed + (p_new_amount - po.amount), 0) where code = bcode;
  end if;
  update public.purchase_orders
     set amount = p_new_amount,
         delivery = coalesce(nullif(trim(coalesce(p_new_delivery, '')), ''), delivery),
         needs_reapproval = v_reapp, updated_at = now()
   where id = po.id;
  perform public.audit_write('po.amended','po', p_po_ref,
    jsonb_build_object('from', po.amount, 'to', p_new_amount, 'deltaPct', round(delta_pct, 1), 'reason', p_reason, 'reapproval', v_reapp));
  if v_reapp then
    perform public.notify_role('procurement', 3, 'po_amend',
      p_po_ref || ' amended — needs re-approval',
      po.vendor_name || ': ' || public.fmt_kes(po.amount) || ' → ' || public.fmt_kes(p_new_amount) || ' (' || round(delta_pct, 1) || '%)',
      'procurement', p_po_ref);
  end if;
  return jsonb_build_object('id', p_po_ref, 'amount', p_new_amount, 'reapproval', v_reapp, 'deltaPct', round(delta_pct, 1));
end $$;

create or replace function public.approve_po_amendment(p_po_ref text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare po record;
begin
  perform public.assert_access('procurement', 3);
  select * into po from public.purchase_orders where ref = p_po_ref;
  if not found then raise exception 'PO % not found', p_po_ref; end if;
  update public.purchase_orders set needs_reapproval = false, updated_at = now() where id = po.id;
  perform public.audit_write('po.amendment_approved','po', p_po_ref, jsonb_build_object('amount', po.amount));
  return jsonb_build_object('id', p_po_ref, 'reapproval', false);
end $$;

-- ---------- goods received: hold over-delivery (loophole #6) ----------
create or replace function public.submit_grn(p_po_ref text, p_coverage text, p_pct int, p_note text default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  po record; req_owner uuid; v_ref text; existing int; added int; total_pct int;
  v_entity uuid := (select id from public.entities where code = 'KE');
  v_receiver uuid := (select id from public.app_users where auth_id = auth.uid());
begin
  perform public.assert_access('procurement', 2);
  select * into po from public.purchase_orders where ref = p_po_ref;
  if not found then raise exception 'PO % not found', p_po_ref; end if;
  if po.state = 'closed' then raise exception 'PO % is closed', p_po_ref; end if;
  select owner_id into req_owner from public.requisitions where id = po.requisition_id;
  perform public.assert_sod('goods receipt (receiver ≠ requester)', req_owner);
  select coalesce(sum(pct), 0) into existing from public.goods_received_notes where po_id = po.id and state = 'received';
  if existing >= 100 then raise exception 'PO % is already fully received', p_po_ref; end if;
  added := case when p_coverage = 'full' then 100 - existing else least(greatest(p_pct, 1), 99) end;
  -- over-delivery is held, not silently accepted: a partial that exceeds the balance is blocked
  if existing + added > 100 then
    raise exception 'Over-delivery: PO % already has % of 100 received — amend the PO to receive more', p_po_ref, existing;
  end if;
  v_ref := public.next_ref('GRN');
  insert into public.goods_received_notes(ref, entity_id, po_id, receiver_id, coverage, pct, note)
  values (v_ref, v_entity, po.id, v_receiver,
          case when p_coverage = 'full' then 'full' else 'partial' end, added, p_note);
  select coalesce(sum(pct), 0) into total_pct from public.goods_received_notes where po_id = po.id and state = 'received';
  if po.state = 'open' and total_pct < 100 then
    update public.purchase_orders set state = 'partially_received' where id = po.id;
  end if;
  perform public.audit_write('grn.received','grn', v_ref,
    jsonb_build_object('po', p_po_ref, 'coverage', p_coverage, 'pct', added));
  return jsonb_build_object('id', v_ref, 'po', p_po_ref, 'totalPct', least(total_pct, 100));
end $$;

-- ---------- payables: duplicate check + amendment gate + configurable tolerance ----------
create or replace function public.three_way_match(p_invoice_id uuid) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  inv record; po record; grn_pct int; tol numeric;
  amount_ok boolean; grn_ok boolean; over boolean;
begin
  select * into inv from public.invoices_ap where id = p_invoice_id;
  select * into po from public.purchase_orders where id = inv.po_id;
  select coalesce(sum(pct), 0) into grn_pct from public.goods_received_notes where po_id = po.id and state = 'received';
  tol := coalesce((select value::numeric from public.app_config where key = 'match_tolerance_pct'), 0.5) / 100.0;
  amount_ok := abs(inv.amount - po.amount) <= po.amount * tol;
  over := grn_pct > 100;
  grn_ok := grn_pct >= 100 and not over;
  if amount_ok and grn_ok then
    update public.invoices_ap set state = 'matched', match_note = null where id = inv.id;
    update public.purchase_orders set state = 'closed' where id = po.id and state in ('open','partially_received');
    perform public.audit_write('invoice.matched','invoice_ap', inv.ref, jsonb_build_object('po', po.ref, 'amount', inv.amount));
    return jsonb_build_object('state','matched');
  else
    update public.invoices_ap set state = 'exception',
      match_note = case
        when over then format('Over-delivery: goods received %s%%', grn_pct)
        when not grn_ok then format('Goods received %s%% — awaiting balance', grn_pct)
        else format('Amount mismatch: invoice %s vs PO %s', inv.amount, po.amount) end
      where id = inv.id;
    perform public.audit_write('invoice.exception','invoice_ap', inv.ref,
      jsonb_build_object('po', po.ref, 'grnPct', grn_pct, 'invoice', inv.amount, 'poAmount', po.amount, 'over', over));
    -- route the exception by type (loophole #1 / §9.3)
    perform public.notify_role('finance', 3, 'match_exception',
      inv.ref || ' held — match exception',
      case when over then po.vendor_name || ': over-delivery ' || grn_pct || '%'
           when not grn_ok then po.vendor_name || ': goods only ' || grn_pct || '% received'
           else po.vendor_name || ': amount mismatch' end,
      'finance', inv.ref);
    return jsonb_build_object('state','exception');
  end if;
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
  -- loophole #4: an amended PO must be re-approved before an invoice is captured
  if po.needs_reapproval then raise exception 'PO % was amended and is awaiting re-approval', p_po_ref; end if;
  -- loophole #3: duplicate invoice guard — one live invoice per PO in this model
  if exists (select 1 from public.invoices_ap where po_id = po.id and state in ('captured','matched','paid')) then
    raise exception 'Possible duplicate: % already has a supplier invoice captured', p_po_ref;
  end if;
  v_ref := public.next_ref('INV');
  insert into public.invoices_ap(ref, entity_id, vendor_id, po_id, amount)
  values (v_ref, v_entity, po.vendor_id, po.id, p_amount) returning id into v_id;
  select bl.* into line from public.budget_lines bl
    join public.requisitions r on r.budget_code = bl.code where r.id = po.requisition_id;
  perform public.post_journal('Supplier invoice ' || v_ref || ' — ' || po.vendor_name, 'invoice_ap', v_ref,
    jsonb_build_array(
      jsonb_build_object('account', coalesce(line.account_code,'5000'), 'debit', p_amount),
      jsonb_build_object('account', '2000', 'credit', p_amount)));
  perform public.audit_write('invoice.captured','invoice_ap', v_ref, jsonb_build_object('po', p_po_ref, 'amount', p_amount));
  m := public.three_way_match(v_id);
  return jsonb_build_object('id', v_ref, 'po', p_po_ref, 'match', m->>'state');
end $$;

-- ---------- requisition submission notifies the approver (loophole #1) ----------
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
  update public.budget_lines set committed = committed + p_amount where code = p_code;
  v_status := case v_state when 'approved' then 'approved' when 'md_review' then 'md' else 'await' end;
  perform public.audit_write('requisition.submitted','requisition', v_ref,
    jsonb_build_object('item', p_item, 'amount', p_amount, 'code', p_code, 'budget', bc->>'chipTxt', 'routing', rt->>'label'));
  -- notify approvers when the requisition actually needs a decision
  if v_state in ('submitted','md_review') then
    perform public.notify_role('procurement', 3, 'req_approval',
      v_ref || ' awaiting your approval',
      p_item || ' — ' || public.fmt_kes(p_amount) || ' (' || (bc->>'chipTxt') || ')',
      'procurement', v_ref);
  end if;
  return jsonb_build_object('id', v_ref, 'item', p_item, 'amt', p_amount, 'code', p_code,
    'chip', bc->>'chip', 'chipTxt', bc->>'chipTxt', 'status', v_status,
    'routing', jsonb_build_object('label', rt->>'label', 'who', rt->>'who'));
end $$;

-- ---------- vendor bank-detail change → callback verification (loophole #2) ----------
create table if not exists public.vendor_bank_changes (
  id           uuid primary key default gen_random_uuid(),
  entity_id    uuid references public.entities(id),
  vendor_id    uuid not null references public.vendors(id),
  vendor_name  text not null,
  old_bank     text,
  new_bank     text not null,
  requested_by uuid,
  verified_by  uuid,
  callback_note text,
  state        text not null default 'pending' check (state in ('pending','verified','rejected')),
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);
alter table public.vendor_bank_changes enable row level security;
drop policy if exists "read for authenticated" on public.vendor_bank_changes;
create policy "read for authenticated" on public.vendor_bank_changes for select to authenticated using (true);

create or replace function public.request_vendor_bank_change(p_vendor_name text, p_new_bank text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v record; v_id uuid;
  v_entity uuid := (select id from public.entities where code = 'KE');
  v_actor uuid := (select id from public.app_users where auth_id = auth.uid());
begin
  perform public.assert_access('procurement', 2);
  if nullif(trim(coalesce(p_new_bank, '')), '') is null then raise exception 'New bank details are required'; end if;
  select * into v from public.vendors where name = p_vendor_name;
  if not found then raise exception 'Vendor % not found', p_vendor_name; end if;
  -- supersede any earlier pending request for this vendor
  update public.vendor_bank_changes set state = 'rejected', updated_at = now()
   where vendor_id = v.id and state = 'pending';
  insert into public.vendor_bank_changes(entity_id, vendor_id, vendor_name, old_bank, new_bank, requested_by)
  values (v_entity, v.id, v.name, v.bank, trim(p_new_bank), v_actor) returning id into v_id;
  perform public.audit_write('vendor.bank_change_requested','vendor', p_vendor_name,
    jsonb_build_object('old', v.bank, 'new', trim(p_new_bank)));
  -- security notification cannot be muted (§9.2): alert finance approvers to verify by callback
  perform public.notify_role('finance', 3, 'vendor_bank_change',
    'Bank-detail change requested — verify by callback',
    p_vendor_name || ': confirm the new account by phone using the number on file before approving.',
    'procurement', p_vendor_name);
  return jsonb_build_object('id', v_id, 'vendor', p_vendor_name, 'state', 'pending');
end $$;

create or replace function public.approve_vendor_bank_change(p_change_id uuid, p_callback_note text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare ch record;
  v_actor uuid := (select id from public.app_users where auth_id = auth.uid());
begin
  perform public.assert_access('finance', 3);
  select * into ch from public.vendor_bank_changes where id = p_change_id;
  if not found then raise exception 'Change request not found'; end if;
  if ch.state <> 'pending' then raise exception 'This request is already %', ch.state; end if;
  -- requester ≠ verifier is a named security control — enforced regardless of the SoD flag
  if v_actor is not null and v_actor = ch.requested_by then
    raise exception 'The person who requested the bank-detail change cannot verify it';
  end if;
  if nullif(trim(coalesce(p_callback_note, '')), '') is null then
    raise exception 'Record the callback confirmation (who you spoke to and the number called)';
  end if;
  update public.vendor_bank_changes
     set state = 'verified', verified_by = v_actor, callback_note = trim(p_callback_note), updated_at = now()
   where id = ch.id;
  update public.vendors set bank = ch.new_bank, updated_at = now() where id = ch.vendor_id;
  perform public.audit_write('vendor.bank_change_verified','vendor', ch.vendor_name,
    jsonb_build_object('new', ch.new_bank, 'callback', trim(p_callback_note)));
  return jsonb_build_object('id', ch.id, 'vendor', ch.vendor_name, 'state', 'verified');
end $$;

-- ---------- grants ----------
do $$
declare fn text;
begin
  foreach fn in array array[
    'set_app_config(text,jsonb)',
    'notify_role(text,int,text,text,text,text,text)',
    'amend_po(text,numeric,text,text)',
    'approve_po_amendment(text)',
    'submit_grn(text,text,int,text)',
    'three_way_match(uuid)',
    'capture_ap_invoice(text,numeric)',
    'submit_requisition(text,numeric,text)',
    'request_vendor_bank_change(text,text)',
    'approve_vendor_bank_change(uuid,text)']
  loop
    execute format('revoke execute on function public.%s from public, anon', fn);
    execute format('grant execute on function public.%s to authenticated', fn);
  end loop;
end $$;


-- ======== supabase/migrations/0040_coding_and_requisitions.sql ========
-- ============================================================
-- Jikoni Tool — UI Build Spec: Coding + full Requisition form
-- Build-priority items #1 (Settings → Coding) and #2 (the Requisitions form):
--   * upsert_cost_centre        — create/update a cost centre (a budget_line) from
--                                 Settings → Coding, the dropdown source for reqs/budgets
--   * requisitions gains qty / unit / unit_price / project_code / justification
--   * submit_requisition        — richer form + "Save as Draft" (no budget commit / routing)
--   * submit_requisition_final  — a draft moves to Submitted: budget commit + routing + notify
--   * withdraw_requisition      — requester pulls a pending req back to draft (releases budget),
--                                 or discards a draft
-- Idempotent: safe to re-run.
-- ============================================================

-- ---------- cost centres (Coding) ----------
create or replace function public.upsert_cost_centre(p_name text, p_budget numeric)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_entity uuid := (select id from public.entities where code = 'KE'); v_code text := trim(coalesce(p_name, ''));
begin
  perform public.assert_access('finance', 2);
  if v_code = '' then raise exception 'A cost-centre name is required'; end if;
  insert into public.budget_lines(entity_id, code, budget, account_code)
  values (v_entity, v_code, greatest(coalesce(p_budget, 0), 0), '5000')
  on conflict (code) do update set budget = excluded.budget, updated_at = now();
  perform public.audit_write('coding.cost_centre','budget_line', v_code, jsonb_build_object('budget', p_budget));
  return jsonb_build_object('code', v_code, 'budget', greatest(coalesce(p_budget, 0), 0));
end $$;

-- ---------- requisitions gain the full form's fields ----------
alter table public.requisitions add column if not exists qty numeric;
alter table public.requisitions add column if not exists unit text;
alter table public.requisitions add column if not exists unit_price numeric;
alter table public.requisitions add column if not exists project_code text;
alter table public.requisitions add column if not exists justification text;

-- withdraw sends a pending requisition back to draft — register those transitions
insert into public.record_transitions(record_type, from_state, to_state) values
  ('requisition','submitted','draft'),
  ('requisition','md_review','draft')
on conflict do nothing;

-- ---------- submit a requisition (full form; optional Save-as-Draft) ----------
drop function if exists public.submit_requisition(text,numeric,text);
create or replace function public.submit_requisition(
  p_item text, p_amount numeric, p_code text,
  p_qty numeric default 1, p_unit text default 'unit', p_unit_price numeric default null,
  p_project text default null, p_justification text default null, p_as_draft boolean default false)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  bc jsonb; rt jsonb; v_ref text; v_state text; v_status text;
  v_entity uuid := (select id from public.entities where code = 'KE');
  v_owner uuid := (select id from public.app_users where auth_id = auth.uid());
begin
  perform public.assert_access('procurement', 2);
  bc := public.budget_check(p_code, p_amount);          -- chip shown either way
  v_ref := public.next_ref('PR');
  if p_as_draft then
    insert into public.requisitions(ref, entity_id, owner_id, item, amount, budget_code,
      budget_chip, budget_chip_txt, state, qty, unit, unit_price, project_code, justification)
    values (v_ref, v_entity, v_owner, p_item, p_amount, p_code, bc->>'chip', bc->>'chipTxt', 'draft',
            p_qty, p_unit, p_unit_price, nullif(trim(coalesce(p_project,'')),''), nullif(trim(coalesce(p_justification,'')),''));
    perform public.audit_write('requisition.drafted','requisition', v_ref, jsonb_build_object('item', p_item, 'amount', p_amount));
    return jsonb_build_object('id', v_ref, 'item', p_item, 'amt', p_amount, 'code', p_code,
      'chip', bc->>'chip', 'chipTxt', bc->>'chipTxt', 'status', 'draft',
      'routing', jsonb_build_object('label', 'Draft', 'who', 'saved — submit when ready'));
  end if;
  rt := public.route_approval(p_amount);
  v_state := rt->>'resultState';
  insert into public.requisitions(ref, entity_id, owner_id, item, amount, budget_code,
    budget_chip, budget_chip_txt, state, qty, unit, unit_price, project_code, justification)
  values (v_ref, v_entity, v_owner, p_item, p_amount, p_code, bc->>'chip', bc->>'chipTxt', v_state,
          p_qty, p_unit, p_unit_price, nullif(trim(coalesce(p_project,'')),''), nullif(trim(coalesce(p_justification,'')),''));
  update public.budget_lines set committed = committed + p_amount where code = p_code;
  v_status := case v_state when 'approved' then 'approved' when 'md_review' then 'md' else 'await' end;
  perform public.audit_write('requisition.submitted','requisition', v_ref,
    jsonb_build_object('item', p_item, 'amount', p_amount, 'code', p_code, 'budget', bc->>'chipTxt', 'routing', rt->>'label'));
  if v_state in ('submitted','md_review') then
    perform public.notify_role('procurement', 3, 'req_approval',
      v_ref || ' awaiting your approval', p_item || ' — ' || public.fmt_kes(p_amount) || ' (' || (bc->>'chipTxt') || ')',
      'procurement', v_ref);
  end if;
  return jsonb_build_object('id', v_ref, 'item', p_item, 'amt', p_amount, 'code', p_code,
    'chip', bc->>'chip', 'chipTxt', bc->>'chipTxt', 'status', v_status,
    'routing', jsonb_build_object('label', rt->>'label', 'who', rt->>'who'));
end $$;

-- ---------- a draft moves into approval ----------
create or replace function public.submit_requisition_final(p_ref text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare r record; bc jsonb; rt jsonb; v_state text; v_status text;
begin
  perform public.assert_access('procurement', 2);
  select * into r from public.requisitions where ref = p_ref;
  if not found then raise exception 'Requisition % not found', p_ref; end if;
  if r.state <> 'draft' then raise exception '% is not a draft (state: %)', p_ref, r.state; end if;
  bc := public.budget_check(r.budget_code, r.amount);
  rt := public.route_approval(r.amount);
  v_state := rt->>'resultState';
  update public.requisitions set state = v_state, budget_chip = bc->>'chip', budget_chip_txt = bc->>'chipTxt', updated_at = now()
   where id = r.id;
  update public.budget_lines set committed = committed + r.amount where code = r.budget_code;
  v_status := case v_state when 'approved' then 'approved' when 'md_review' then 'md' else 'await' end;
  perform public.audit_write('requisition.submitted','requisition', p_ref, jsonb_build_object('from', 'draft', 'routing', rt->>'label'));
  if v_state in ('submitted','md_review') then
    perform public.notify_role('procurement', 3, 'req_approval',
      p_ref || ' awaiting your approval', r.item || ' — ' || public.fmt_kes(r.amount), 'procurement', p_ref);
  end if;
  return jsonb_build_object('id', p_ref, 'status', v_status);
end $$;

-- ---------- requester withdraws: pending → draft (release budget), or discard a draft ----------
create or replace function public.withdraw_requisition(p_ref text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare r record; v_me uuid := (select id from public.app_users where auth_id = auth.uid());
begin
  perform public.assert_access('procurement', 2);
  select * into r from public.requisitions where ref = p_ref;
  if not found then raise exception 'Requisition % not found', p_ref; end if;
  if v_me is not null and r.owner_id is not null and v_me <> r.owner_id then
    raise exception 'Only the requester can withdraw %', p_ref;
  end if;
  if r.state in ('submitted','md_review') then
    update public.requisitions set state = 'draft', updated_at = now() where id = r.id;
    update public.budget_lines set committed = greatest(committed - r.amount, 0) where code = r.budget_code;
    perform public.audit_write('requisition.withdrawn','requisition', p_ref, jsonb_build_object('to', 'draft'));
    return jsonb_build_object('id', p_ref, 'status', 'draft');
  elsif r.state = 'draft' then
    delete from public.requisitions where id = r.id;
    perform public.audit_write('requisition.discarded','requisition', p_ref, '{}'::jsonb);
    return jsonb_build_object('id', p_ref, 'status', 'discarded');
  else
    raise exception 'Only a draft or pending requisition can be withdrawn (state: %)', r.state;
  end if;
end $$;

-- ---------- grants ----------
do $$
declare fn text;
begin
  foreach fn in array array[
    'upsert_cost_centre(text,numeric)',
    'submit_requisition(text,numeric,text,numeric,text,numeric,text,text,boolean)',
    'submit_requisition_final(text)',
    'withdraw_requisition(text)']
  loop
    execute format('revoke execute on function public.%s from public, anon', fn);
    execute format('grant execute on function public.%s to authenticated', fn);
  end loop;
end $$;


-- ======== supabase/migrations/0041_qty_chain_payables_storage.sql ========
-- ============================================================
-- Jikoni Tool — UI Build Spec: qty-based chain + payables enrichment + storage
-- Single-line, quantity-based model (confirmed with Brian). Covers spec items:
--   #2 raise_po now carries an editable qty + unit price (from the requisition)
--   #3 GRN moves from % complete to quantity received against the PO's ordered qty,
--      with per-delivery over-delivery held (accept → PO amendment / reject the excess)
--   #1 capture_ap_invoice gains invoice number / date / currency / withholding tax and
--      a duplicate guard (vendor + invoice number + amount); adds an Approve-for-Payment
--      step (preparer ≠ approver); pay deducts WHT to a payable account
--   #5 a shared 'uploads' storage bucket for GRN photos, requisition/RFQ attachments, etc.
-- Idempotent: safe to re-run.
-- ============================================================

-- ---------- schema ----------
alter table public.purchase_orders   add column if not exists qty numeric;
alter table public.purchase_orders   add column if not exists unit_price numeric;
alter table public.goods_received_notes add column if not exists qty_received numeric;
alter table public.goods_received_notes add column if not exists over_delivery boolean not null default false;
alter table public.goods_received_notes add column if not exists photo_path text;

alter table public.invoices_ap add column if not exists invoice_number text;
alter table public.invoices_ap add column if not exists invoice_date date;
alter table public.invoices_ap add column if not exists currency text not null default 'KES';
alter table public.invoices_ap add column if not exists wht_applied boolean not null default false;
alter table public.invoices_ap add column if not exists wht_amount numeric not null default 0;
alter table public.invoices_ap add column if not exists captured_by uuid;
-- add the Approve-for-Payment state between matched and paid
alter table public.invoices_ap drop constraint if exists invoices_ap_state_check;
alter table public.invoices_ap add constraint invoices_ap_state_check
  check (state in ('captured','matched','exception','approved','paid'));
insert into public.record_transitions(record_type, from_state, to_state) values
  ('invoice_ap','matched','approved'), ('invoice_ap','approved','paid')
on conflict do nothing;

-- WHT payable account + rate config
insert into public.chart_of_accounts(entity_id, code, name, kind)
select (select id from public.entities where code = 'KE'), '2200', 'Withholding tax payable', 'liability'
on conflict (entity_id, code) do nothing;
insert into public.app_config(key, value) values ('wht_rate_pct', '5'::jsonb) on conflict (key) do nothing;

-- shared uploads bucket (public read; authenticated write)
insert into storage.buckets(id, name, public) values ('uploads','uploads', true) on conflict (id) do nothing;
drop policy if exists "uploads read" on storage.objects;
create policy "uploads read" on storage.objects for select using (bucket_id = 'uploads');
drop policy if exists "uploads write" on storage.objects;
create policy "uploads write" on storage.objects for insert to authenticated with check (bucket_id = 'uploads');
drop policy if exists "uploads update" on storage.objects;
create policy "uploads update" on storage.objects for update to authenticated using (bucket_id = 'uploads');

-- ---------- #2 raise PO with an editable line (qty + unit price) ----------
drop function if exists public.raise_po(text,text,text);
create or replace function public.raise_po(
  p_req_ref text, p_vendor_name text, p_delivery text,
  p_qty numeric default null, p_unit_price numeric default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  r record; v record; v_ref text; v_delivery text; v_qty numeric; v_price numeric; v_amount numeric;
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
  v_qty   := greatest(coalesce(p_qty, r.qty, 1), 0.0001);
  v_price := coalesce(p_unit_price, r.unit_price, r.amount / v_qty);
  v_amount := round(v_qty * v_price, 2);
  v_ref := public.next_ref('PO');
  v_delivery := coalesce(nullif(trim(coalesce(p_delivery, '')), ''), '—');
  insert into public.purchase_orders(ref, entity_id, owner_id, requisition_id, vendor_id, vendor_name, amount, delivery, qty, unit_price)
  values (v_ref, v_entity, v_owner, r.id, v.id, v.name, v_amount, v_delivery, v_qty, v_price);  -- sanctions gate fires here
  update public.requisitions set state = 'converted' where id = r.id;
  update public.vendors set open_pos = open_pos + 1 where id = v.id;
  perform public.audit_write('po.issued','po', v_ref,
    jsonb_build_object('requisition', p_req_ref, 'vendor', v.name, 'qty', v_qty, 'unitPrice', v_price, 'amount', v_amount));
  return jsonb_build_object('id', v_ref, 'vendor', v.name, 'amt', v_amount, 'delivery', v_delivery, 'qty', v_qty);
end $$;

-- ---------- #3 goods received by quantity, with over-delivery held ----------
drop function if exists public.submit_grn(text,text,int,text);
create or replace function public.submit_grn(
  p_po_ref text, p_qty_received numeric, p_note text default null,
  p_over_action text default null, p_photo_path text default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  po record; req_owner uuid; v_ref text; ordered numeric; existing numeric; remaining numeric;
  v_qty numeric; v_over boolean := false; v_pct int;
  v_entity uuid := (select id from public.entities where code = 'KE');
  v_receiver uuid := (select id from public.app_users where auth_id = auth.uid());
begin
  perform public.assert_access('procurement', 2);
  select * into po from public.purchase_orders where ref = p_po_ref;
  if not found then raise exception 'PO % not found', p_po_ref; end if;
  if po.state = 'closed' then raise exception 'PO % is closed', p_po_ref; end if;
  select owner_id into req_owner from public.requisitions where id = po.requisition_id;
  perform public.assert_sod('goods receipt (receiver ≠ requester)', req_owner);
  if coalesce(p_qty_received, 0) <= 0 then raise exception 'Enter the quantity received'; end if;
  ordered := coalesce(po.qty, 1);
  select coalesce(sum(qty_received), 0) into existing from public.goods_received_notes where po_id = po.id and state = 'received';
  remaining := ordered - existing;
  if remaining <= 0 then raise exception 'PO % is already fully received (%/%)', p_po_ref, existing, ordered; end if;
  v_qty := p_qty_received;
  if v_qty > remaining then
    if p_over_action = 'accept' then
      v_over := true;                                   -- record the excess but hold via a PO amendment
      update public.purchase_orders set needs_reapproval = true where id = po.id;
    elsif p_over_action = 'reject' then
      v_qty := remaining;                               -- take only what was ordered, turn the rest away
    else
      raise exception 'Over-delivery: % received but only % remain on % — accept (amend PO) or reject the excess', v_qty, remaining, p_po_ref;
    end if;
  end if;
  v_ref := public.next_ref('GRN');
  v_pct := least(round((existing + v_qty) / ordered * 100)::int, 100);
  insert into public.goods_received_notes(ref, entity_id, po_id, receiver_id, coverage, pct, qty_received, over_delivery, note, photo_path)
  values (v_ref, v_entity, po.id, v_receiver,
          case when (existing + v_qty) >= ordered then 'full' else 'partial' end,
          greatest(v_pct, 1), v_qty, v_over, p_note, p_photo_path);
  if po.state = 'open' and (existing + v_qty) < ordered then
    update public.purchase_orders set state = 'partially_received' where id = po.id;
  end if;
  perform public.audit_write('grn.received','grn', v_ref,
    jsonb_build_object('po', p_po_ref, 'qty', v_qty, 'ordered', ordered, 'over', v_over));
  return jsonb_build_object('id', v_ref, 'po', p_po_ref, 'received', existing + v_qty, 'ordered', ordered, 'over', v_over);
end $$;

-- ---------- three-way match on quantity ----------
create or replace function public.three_way_match(p_invoice_id uuid) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  inv record; po record; recv numeric; ordered numeric; tol numeric;
  amount_ok boolean; grn_ok boolean; over boolean;
begin
  select * into inv from public.invoices_ap where id = p_invoice_id;
  select * into po from public.purchase_orders where id = inv.po_id;
  ordered := coalesce(po.qty, 1);
  select coalesce(sum(qty_received), 0) into recv from public.goods_received_notes where po_id = po.id and state = 'received';
  tol := coalesce((select value::numeric from public.app_config where key = 'match_tolerance_pct'), 0.5) / 100.0;
  amount_ok := abs(inv.amount - po.amount) <= po.amount * tol;
  over := recv > ordered;
  grn_ok := recv >= ordered and not over;
  if amount_ok and grn_ok then
    update public.invoices_ap set state = 'matched', match_note = null where id = inv.id;
    update public.purchase_orders set state = 'closed' where id = po.id and state in ('open','partially_received');
    perform public.audit_write('invoice.matched','invoice_ap', inv.ref, jsonb_build_object('po', po.ref, 'amount', inv.amount));
    return jsonb_build_object('state','matched');
  else
    update public.invoices_ap set state = 'exception',
      match_note = case
        when over then format('Over-delivery: %s of %s received', recv, ordered)
        when recv < ordered then format('Goods received %s of %s — awaiting balance', recv, ordered)
        else format('Amount mismatch: invoice %s vs PO %s', inv.amount, po.amount) end
      where id = inv.id;
    perform public.audit_write('invoice.exception','invoice_ap', inv.ref,
      jsonb_build_object('po', po.ref, 'received', recv, 'ordered', ordered, 'invoice', inv.amount, 'poAmount', po.amount, 'over', over));
    perform public.notify_role('finance', 3, 'match_exception',
      inv.ref || ' held — match exception',
      case when over then po.vendor_name || ': over-delivery ' || recv || '/' || ordered
           when recv < ordered then po.vendor_name || ': received ' || recv || '/' || ordered
           else po.vendor_name || ': amount mismatch' end,
      'finance', inv.ref);
    return jsonb_build_object('state','exception');
  end if;
end $$;

-- ---------- #1 capture supplier invoice (number/date/currency/WHT + duplicate guard) ----------
drop function if exists public.capture_ap_invoice(text,numeric);
create or replace function public.capture_ap_invoice(
  p_po_ref text, p_amount numeric, p_invoice_number text default null,
  p_invoice_date date default null, p_currency text default 'KES', p_wht boolean default false)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  po record; v_ref text; v_id uuid; m jsonb; line record; dup text; v_wht numeric; v_rate numeric;
  v_entity uuid := (select id from public.entities where code = 'KE');
  v_actor uuid := (select id from public.app_users where auth_id = auth.uid());
  v_num text := nullif(trim(coalesce(p_invoice_number, '')), '');
begin
  perform public.assert_access('finance', 2);
  select * into po from public.purchase_orders where ref = p_po_ref;
  if not found then raise exception 'PO % not found', p_po_ref; end if;
  if po.needs_reapproval then raise exception 'PO % was amended and is awaiting re-approval', p_po_ref; end if;
  -- duplicate guard: same vendor + invoice number + amount already in the system
  if v_num is not null then
    select i.ref into dup from public.invoices_ap i
      where i.vendor_id = po.vendor_id and lower(i.invoice_number) = lower(v_num) and i.amount = p_amount
      limit 1;
    if dup is not null then raise exception 'Possible duplicate of % (same vendor, invoice number and amount)', dup; end if;
  end if;
  -- one live invoice per PO in this single-line model
  if exists (select 1 from public.invoices_ap where po_id = po.id and state in ('captured','matched','approved','paid')) then
    raise exception 'Possible duplicate: % already has a supplier invoice captured', p_po_ref;
  end if;
  v_rate := coalesce((select value::numeric from public.app_config where key = 'wht_rate_pct'), 5);
  v_wht := case when p_wht then round(p_amount * v_rate / 100.0, 2) else 0 end;
  v_ref := public.next_ref('INV');
  insert into public.invoices_ap(ref, entity_id, vendor_id, po_id, amount, invoice_number, invoice_date, currency, wht_applied, wht_amount, captured_by)
  values (v_ref, v_entity, po.vendor_id, po.id, p_amount, v_num, p_invoice_date, coalesce(nullif(p_currency,''),'KES'), p_wht, v_wht, v_actor)
  returning id into v_id;
  select bl.* into line from public.budget_lines bl
    join public.requisitions r on r.budget_code = bl.code where r.id = po.requisition_id;
  perform public.post_journal('Supplier invoice ' || v_ref || ' — ' || po.vendor_name, 'invoice_ap', v_ref,
    jsonb_build_array(
      jsonb_build_object('account', coalesce(line.account_code,'5000'), 'debit', p_amount),
      jsonb_build_object('account', '2000', 'credit', p_amount)));
  perform public.audit_write('invoice.captured','invoice_ap', v_ref,
    jsonb_build_object('po', p_po_ref, 'amount', p_amount, 'number', v_num, 'wht', v_wht));
  m := public.three_way_match(v_id);
  return jsonb_build_object('id', v_ref, 'po', p_po_ref, 'match', m->>'state', 'wht', v_wht);
end $$;

-- ---------- #1 approve for payment (preparer ≠ approver) ----------
create or replace function public.approve_ap_invoice(p_inv_ref text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare inv record; v_me uuid := (select id from public.app_users where auth_id = auth.uid());
begin
  perform public.assert_access('finance', 3);
  select * into inv from public.invoices_ap where ref = p_inv_ref;
  if not found then raise exception 'Invoice % not found', p_inv_ref; end if;
  if inv.state <> 'matched' then raise exception '% must be matched before approval (state: %)', p_inv_ref, inv.state; end if;
  if v_me is not null and inv.captured_by is not null and v_me = inv.captured_by then
    raise exception 'The person who captured % cannot approve it for payment', p_inv_ref;
  end if;
  update public.invoices_ap set state = 'approved' where id = inv.id;
  perform public.audit_write('invoice.approved','invoice_ap', p_inv_ref, jsonb_build_object('amount', inv.amount));
  return jsonb_build_object('id', p_inv_ref, 'state', 'approved');
end $$;

-- ---------- pay (requires approval; deducts WHT) ----------
create or replace function public.pay_invoice(p_inv_ref text, p_method text default 'bank')
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  inv record; po record; v_ref text; je text; bcode text; net numeric; lines jsonb;
  v_entity uuid := (select id from public.entities where code = 'KE');
begin
  perform public.assert_access('finance', 3);
  select * into inv from public.invoices_ap where ref = p_inv_ref;
  if not found then raise exception 'Invoice % not found', p_inv_ref; end if;
  if inv.state <> 'approved' then
    raise exception 'Approval required: % must be approved for payment first (state: %)', p_inv_ref, inv.state;
  end if;
  select * into po from public.purchase_orders where id = inv.po_id;
  net := inv.amount - coalesce(inv.wht_amount, 0);
  v_ref := public.next_ref('PAY');
  lines := jsonb_build_array(
    jsonb_build_object('account', '2000', 'debit', inv.amount),
    jsonb_build_object('account', '1000', 'credit', net));
  if coalesce(inv.wht_amount, 0) > 0 then
    lines := lines || jsonb_build_object('account', '2200', 'credit', inv.wht_amount);
  end if;
  je := public.post_journal('Payment ' || v_ref || ' — ' || po.vendor_name, 'payment', v_ref, lines);
  insert into public.payments(ref, entity_id, invoice_ap_id, method, amount, journal_ref)
  values (v_ref, v_entity, inv.id, p_method, net, je);
  if p_method = 'mpesa' then
    insert into public.mpesa_payments(payment_ref, shortcode, amount, state) values (v_ref, '174379', net, 'pending');
  end if;
  update public.invoices_ap set state = 'paid' where id = inv.id;
  update public.vendors set open_pos = greatest(open_pos - 1, 0) where id = inv.vendor_id;
  select budget_code into bcode from public.requisitions where id = po.requisition_id;
  if bcode is not null then
    update public.budget_lines set committed = greatest(committed - inv.amount, 0), actual = actual + inv.amount where code = bcode;
  end if;
  perform public.audit_write('payment.made','payment', v_ref,
    jsonb_build_object('invoice', p_inv_ref, 'method', p_method, 'net', net, 'wht', inv.wht_amount, 'journal', je));
  return jsonb_build_object('id', v_ref, 'invoice', p_inv_ref, 'journal', je, 'net', net);
end $$;

-- ---------- grants ----------
do $$
declare fn text;
begin
  foreach fn in array array[
    'raise_po(text,text,text,numeric,numeric)',
    'submit_grn(text,numeric,text,text,text)',
    'three_way_match(uuid)',
    'capture_ap_invoice(text,numeric,text,date,text,boolean)',
    'approve_ap_invoice(text)',
    'pay_invoice(text,text)']
  loop
    execute format('revoke execute on function public.%s from public, anon', fn);
    execute format('grant execute on function public.%s to authenticated', fn);
  end loop;
end $$;

-- ===================================================================
-- 0042_invited_stay_pending_until_signin.sql
-- Invited members stay "Pending sign-in" until they actually log in.
-- ===================================================================
create or replace function public.link_auth_user() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  update public.app_users set auth_id = new.id, updated_at = now()
  where email = new.email and auth_id is null;

  if new.last_sign_in_at is not null then
    update public.app_users set state = 'active', status = 'active', updated_at = now()
    where email = new.email and state = 'invited';
    update public.invites set state = 'accepted', updated_at = now()
    where email = new.email and state = 'sent';
  end if;
  return new;
end $$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert or update on auth.users
  for each row execute function public.link_auth_user();

alter table public.app_users disable trigger state_machine;
update public.app_users au
set state = 'invited', status = 'off', updated_at = now()
where au.state = 'active'
  and not exists (
    select 1 from auth.users u
    where u.email = au.email and u.last_sign_in_at is not null
  );
alter table public.app_users enable trigger state_machine;


-- ===================================================================
-- 0043_project_owner_location_assignment.sql
-- Project location, owner edit/delete, field-activity assignment notify.
-- ===================================================================
-- Projects & Programmes round: project location, owner-based edit/delete, and
-- field-activity assignment notifications.
--
--  * projects.location (free text) + projects.created_by (who added it)
--  * project_detail_json exposes location + a per-caller createdByMe flag
--    (true for the creator OR anyone with full/level-3 projects access)
--  * create_project captures location + created_by; create_project_from_eng
--    captures created_by
--  * new update_project / delete_project, gated to creator-or-full-access
--  * create_field_activity writes an in-app notification for staff assignees and
--    returns the project name + location so the client can email the assignee
-- Idempotent: create-or-replace / add-column-if-not-exists throughout.

-- ---------- schema ----------
alter table public.projects add column if not exists location   text;
alter table public.projects add column if not exists created_by uuid references public.app_users(id);

-- ---------- read model: expose location + createdByMe ----------
create or replace function public.project_detail_json(p_id uuid) returns jsonb
language sql stable security definer set search_path = public as $$
  select jsonb_build_object(
    'id', p.id, 'state', p.state,
    'funder', p.funder, 'status', p.status, 'budget', p.budget_txt, 'spent', p.spent_txt,
    'pct', p.pct, 'timeline', p.timeline, 'team', p.team, 'reporting', p.reporting, 'field', p.field,
    'budgetAmount', p.budget_amount,
    'spentAmount', coalesce((select sum(amount) from public.project_milestones
                             where project_id = p.id and status = 'done'), 0),
    'startDate', p.start_date, 'endDate', p.end_date,
    'location', p.location, 'docs', p.docs,
    'createdByMe', (
      (p.created_by is not null and p.created_by = (select id from public.app_users where auth_id = auth.uid()))
      or coalesce((select level from public.user_permissions
                   where email = lower(coalesce(nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'email', ''))
                     and module = 'projects'), 0) >= 3
    ),
    'milestones', coalesce((select jsonb_agg(jsonb_build_object('id', id, 't', title, 's', status,
                             'amount', amount, 'start', start_date, 'end', end_date) order by sort)
                            from public.project_milestones where project_id = p.id), '[]'::jsonb),
    'drawdowns',  coalesce((select jsonb_agg(jsonb_build_object('id', id, 't', title, 'v', amount_txt, 's', status) order by sort)
                            from public.project_drawdowns where project_id = p.id), '[]'::jsonb))
  from public.projects p where p.id = p_id
$$;

-- ---------- create: capture location + creator ----------
drop function if exists public.create_project(text,text,numeric,date,date,text,text);
create or replace function public.create_project(
  p_name text, p_funder text, p_budget_amount numeric,
  p_start_date date, p_end_date date, p_team text, p_status text, p_location text default null
) returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_entity uuid := (select id from public.entities where code = 'KE');
  v_timeline text;
  p record;
begin
  perform public.assert_access('projects', 2);
  if nullif(trim(coalesce(p_name, '')), '') is null then raise exception 'A project name is required'; end if;
  if exists (select 1 from public.projects where name = trim(p_name)) then
    raise exception 'A project named "%" already exists', trim(p_name);
  end if;
  v_timeline := case
    when p_start_date is not null and p_end_date is not null
      then to_char(p_start_date, 'Mon YYYY') || ' → ' || to_char(p_end_date, 'Mon YYYY')
    when p_start_date is not null then 'From ' || to_char(p_start_date, 'Mon YYYY')
    else '2026' end;
  insert into public.projects(entity_id, name, funder, status, budget_amount, budget_txt, spent_txt, pct,
                              start_date, end_date, timeline, team, location, created_by, is_extra, docs)
  values (v_entity, trim(p_name), nullif(trim(coalesce(p_funder, '')), ''),
          coalesce(nullif(trim(coalesce(p_status, '')), ''), 'Setup'),
          coalesce(p_budget_amount, 0), public.fmt_kes(coalesce(p_budget_amount, 0)), 'KES 0', '0%',
          p_start_date, p_end_date, v_timeline,
          nullif(trim(coalesce(p_team, '')), ''), nullif(trim(coalesce(p_location, '')), ''),
          (select id from public.app_users where auth_id = auth.uid()), true, '[]'::jsonb)
  returning * into p;
  perform public.audit_write('project.created', 'project', p.name,
    jsonb_build_object('funder', p_funder, 'budget', p_budget_amount, 'start', p_start_date,
                       'end', p_end_date, 'team', p_team, 'location', p_location));
  return jsonb_build_object('name', p.name, 'created', true, 'detail', public.project_detail_json(p.id));
end $$;

-- ---------- CRM-converted projects are owned by the converter ----------
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
    insert into public.projects(entity_id, name, funder, status, team, created_by, is_extra, docs)
    values (v_entity, v_name, e.name, 'Setup', e.owner_name,
            (select id from public.app_users where auth_id = auth.uid()), true,
            jsonb_build_array('Signed agreement (from ' || p_eng_ref || ')'))
    returning * into p;
    insert into public.project_milestones(project_id, title, status, sort) values
      (p.id, 'Project set up from won deal', 'done', 1),
      (p.id, 'Budget & funder agreement',    'now',  2),
      (p.id, 'Deployment',                   'todo', 3);
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
    'detail', public.project_detail_json(p.id));
end $$;

-- ---------- update a project (creator or full-access only) ----------
create or replace function public.update_project(
  p_id uuid, p_funder text, p_budget_amount numeric,
  p_start_date date, p_end_date date, p_team text, p_status text, p_location text default null
) returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_me uuid := (select id from public.app_users where auth_id = auth.uid());
  v_lvl int := coalesce((select level from public.user_permissions
                         where email = lower(coalesce(nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'email', ''))
                           and module = 'projects'), 0);
  v_owner uuid; v_name text; v_timeline text;
begin
  perform public.assert_access('projects', 2);
  select created_by, name into v_owner, v_name from public.projects where id = p_id;
  if v_name is null then raise exception 'Project not found'; end if;
  if (v_owner is distinct from v_me) and v_lvl < 3 then
    raise exception 'You can only edit projects you created';
  end if;
  v_timeline := case
    when p_start_date is not null and p_end_date is not null
      then to_char(p_start_date, 'Mon YYYY') || ' → ' || to_char(p_end_date, 'Mon YYYY')
    when p_start_date is not null then 'From ' || to_char(p_start_date, 'Mon YYYY')
    else '2026' end;
  update public.projects set
    funder        = nullif(trim(coalesce(p_funder, '')), ''),
    status        = coalesce(nullif(trim(coalesce(p_status, '')), ''), 'Setup'),
    budget_amount = coalesce(p_budget_amount, 0),
    budget_txt    = public.fmt_kes(coalesce(p_budget_amount, 0)),
    start_date    = p_start_date,
    end_date      = p_end_date,
    timeline      = v_timeline,
    team          = nullif(trim(coalesce(p_team, '')), ''),
    location      = nullif(trim(coalesce(p_location, '')), ''),
    updated_at    = now()
  where id = p_id;
  perform public.recompute_project_money(p_id);
  perform public.audit_write('project.updated', 'project', v_name,
    jsonb_build_object('funder', p_funder, 'budget', p_budget_amount, 'status', p_status, 'location', p_location));
  return public.project_payload(p_id);
end $$;

-- ---------- delete a project (creator or full-access only) ----------
create or replace function public.delete_project(p_id uuid)
returns void language plpgsql security definer set search_path = public as $$
declare
  v_me uuid := (select id from public.app_users where auth_id = auth.uid());
  v_lvl int := coalesce((select level from public.user_permissions
                         where email = lower(coalesce(nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'email', ''))
                           and module = 'projects'), 0);
  v_owner uuid; v_name text;
begin
  perform public.assert_access('projects', 2);
  select created_by, name into v_owner, v_name from public.projects where id = p_id;
  if v_name is null then raise exception 'Project not found'; end if;
  if (v_owner is distinct from v_me) and v_lvl < 3 then
    raise exception 'You can only delete projects you created';
  end if;
  perform public.audit_write('project.deleted', 'project', v_name, jsonb_build_object('id', p_id));
  delete from public.project_drawdowns  where project_id = p_id;
  delete from public.project_milestones where project_id = p_id;
  delete from public.field_activities   where project_id = p_id;
  delete from public.eng_project_links  where project_name = v_name;
  delete from public.projects           where id = p_id;
end $$;

-- ---------- assign a field activity: notify staff + return project/location ----------
create or replace function public.create_field_activity(
  p_project_id uuid, p_assignee text, p_phone text, p_email text,
  p_activity_on date default current_date, p_note text default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_id uuid; v_name text; v_location text;
  v_entity uuid := (select id from public.entities where code = 'KE');
  v_who text := coalesce((select name from public.app_users where auth_id = auth.uid()), 'A teammate');
  v_email text := lower(nullif(trim(coalesce(p_email, '')), ''));
begin
  perform public.assert_access('projects', 2);
  select name, location into v_name, v_location from public.projects where id = p_project_id;
  if v_name is null then raise exception 'Project not found'; end if;
  if nullif(trim(coalesce(p_assignee, '')), '') is null then raise exception 'An assignee is required'; end if;
  insert into public.field_activities(project_id, kind, county, note, activity_on, assignee, phone, email)
  values (p_project_id, 'assignment', null, nullif(trim(coalesce(p_note, '')), ''),
          coalesce(p_activity_on, current_date), trim(p_assignee),
          nullif(trim(coalesce(p_phone, '')), ''), nullif(trim(coalesce(p_email, '')), ''))
  returning id into v_id;
  -- in-app bell if the assignee is a Jikoni user (email itself is sent client-side)
  if v_email is not null and exists (select 1 from public.app_users where lower(email) = v_email) then
    insert into public.notifications(entity_id, recipient_email, kind, title, body, link_view, link_ref)
    values (v_entity, v_email, 'field_assignment',
            v_who || ' assigned you a field task',
            v_name || coalesce(' — ' || nullif(trim(coalesce(p_note, '')), ''), ' — field activity'),
            'projects', p_project_id::text);
  end if;
  perform public.audit_write('project.field_activity','project', p_project_id::text,
    jsonb_build_object('assignee', p_assignee, 'note', p_note));
  return jsonb_build_object('id', v_id, 'project', v_name, 'location', v_location, 'by', v_who);
end $$;

-- ---------- grants ----------
do $$
declare fn text;
begin
  foreach fn in array array[
    'create_project(text,text,numeric,date,date,text,text,text)',
    'update_project(uuid,text,numeric,date,date,text,text,text)',
    'delete_project(uuid)',
    'create_field_activity(uuid,text,text,text,date,text)']
  loop
    execute format('revoke execute on function public.%s from public, anon', fn);
    execute format('grant execute on function public.%s to authenticated', fn);
  end loop;
end $$;


-- ===================================================================
-- 0044_tasks_assign_and_subtasks.sql
-- My Week: personal vs assigned tasks + mini-tasks (subtasks).
-- ===================================================================
-- My Week tasks round: personal vs assigned tasks + mini-tasks (subtasks).
--
--  * tasks.assigned_by_id (who created it) + tasks.subtasks jsonb ([{text,done}])
--  * task_json(ref) — the frontend shape, reused by every task RPC
--  * create_task — owner = me (personal) or another user by email (assign → notify)
--  * add/toggle subtask + set_task_done — guarded to the owner or the assigner
--  * RLS read policy so the richer task list can be selected directly (writes via RPC)
-- Idempotent throughout. The old save_task stays in place, unused.

-- ---------- schema ----------
alter table public.tasks add column if not exists assigned_by_id uuid references public.app_users(id);
alter table public.tasks add column if not exists subtasks jsonb not null default '[]'::jsonb;

alter table public.tasks enable row level security;
drop policy if exists "read tasks for authenticated" on public.tasks;
create policy "read tasks for authenticated" on public.tasks for select to authenticated using (true);

-- ---------- read shape (id,t,s,o,p,pl,subtasks,ownerEmail,assignedBy) ----------
create or replace function public.task_json(p_ref text) returns jsonb
language sql stable security definer set search_path = public as $$
  select jsonb_build_object(
    'id', t.ref, 't', t.title, 's', t.sub, 'o', t.owner_name,
    'p', t.due_pill, 'pl', t.due_label,
    'subtasks', coalesce(t.subtasks, '[]'::jsonb),
    'ownerEmail', ow.email,
    'assignedBy', case when t.assigned_by_id is not null and t.assigned_by_id <> t.owner_id
                       then (select name from public.app_users where id = t.assigned_by_id) end)
  from public.tasks t left join public.app_users ow on ow.id = t.owner_id
  where t.ref = p_ref
$$;

-- ---------- create a task (personal, or assigned to another user) ----------
create or replace function public.create_task(
  p_title text, p_owner_email text default null, p_due_key text default 'week',
  p_link text default '', p_subtasks jsonb default '[]'::jsonb
) returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_ref text; v_pill text; v_label text; v_subs jsonb;
  v_entity uuid := (select id from public.entities where code = 'KE');
  v_me uuid := (select id from public.app_users where auth_id = auth.uid());
  v_my_email text; v_owner uuid; v_owner_name text; v_owner_email text;
begin
  if v_me is null then raise exception 'No user is linked to this login'; end if;
  if nullif(trim(coalesce(p_title, '')), '') is null then raise exception 'A task description is required'; end if;
  select email into v_my_email from public.app_users where id = v_me;
  if nullif(trim(coalesce(p_owner_email, '')), '') is null or lower(p_owner_email) = lower(v_my_email) then
    v_owner := v_me;
  else
    select id into v_owner from public.app_users where lower(email) = lower(trim(p_owner_email));
    if v_owner is null then raise exception 'No user with email %', p_owner_email; end if;
  end if;
  select name, email into v_owner_name, v_owner_email from public.app_users where id = v_owner;
  select case p_due_key when 'today' then 'today' when 'over' then 'over' else 'week' end,
         case p_due_key when 'today' then 'Today' when 'nweek' then 'Next week' when 'over' then 'Overdue' else 'This week' end
    into v_pill, v_label;
  -- normalise subtasks: accept ["a","b"] or [{"text":"a"}] → [{"text","done":false}]
  select coalesce(jsonb_agg(jsonb_build_object('text', txt, 'done', false)), '[]'::jsonb) into v_subs
  from (
    select case when jsonb_typeof(e) = 'string' then trim(e #>> '{}') else trim(coalesce(e ->> 'text', '')) end as txt
    from jsonb_array_elements(coalesce(p_subtasks, '[]'::jsonb)) e
  ) s where txt is not null and txt <> '';
  v_ref := public.next_ref('TSK');
  insert into public.tasks(ref, entity_id, owner_id, assigned_by_id, title, sub, owner_name, due_pill, due_label, subtasks)
  values (v_ref, v_entity, v_owner, v_me, trim(p_title), coalesce(p_link, ''), v_owner_name, v_pill, v_label, v_subs);
  -- assigned to someone else → in-app bell (email is sent client-side via /api/notify)
  if v_owner <> v_me then
    insert into public.notifications(entity_id, recipient_email, kind, title, body, link_view, link_ref)
    values (v_entity, lower(v_owner_email), 'task_assigned',
            (select name from public.app_users where id = v_me) || ' assigned you a task',
            trim(p_title), 'home', v_ref);
  end if;
  perform public.audit_write('task.created', 'task', v_ref,
    jsonb_build_object('title', p_title, 'owner', v_owner_name, 'due', v_label));
  return public.task_json(v_ref);
end $$;

-- ---------- subtask + completion mutations (owner or assigner only) ----------
create or replace function public.add_task_subtask(p_ref text, p_text text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_me uuid := (select id from public.app_users where auth_id = auth.uid()); t record;
begin
  select * into t from public.tasks where ref = p_ref;
  if not found then raise exception 'Task not found'; end if;
  if v_me is null or (t.owner_id <> v_me and coalesce(t.assigned_by_id, t.owner_id) <> v_me) then
    raise exception 'This is not your task';
  end if;
  if nullif(trim(coalesce(p_text, '')), '') is null then raise exception 'A sub-task is required'; end if;
  update public.tasks
    set subtasks = coalesce(subtasks, '[]'::jsonb) || jsonb_build_array(jsonb_build_object('text', trim(p_text), 'done', false)),
        updated_at = now()
    where ref = p_ref;
  return public.task_json(p_ref);
end $$;

create or replace function public.toggle_task_subtask(p_ref text, p_idx int)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_me uuid := (select id from public.app_users where auth_id = auth.uid()); t record; v_cur boolean;
begin
  select * into t from public.tasks where ref = p_ref;
  if not found then raise exception 'Task not found'; end if;
  if v_me is null or (t.owner_id <> v_me and coalesce(t.assigned_by_id, t.owner_id) <> v_me) then
    raise exception 'This is not your task';
  end if;
  if p_idx < 0 or p_idx >= jsonb_array_length(coalesce(t.subtasks, '[]'::jsonb)) then raise exception 'No such sub-task'; end if;
  v_cur := coalesce((t.subtasks -> p_idx ->> 'done')::boolean, false);
  update public.tasks
    set subtasks = jsonb_set(subtasks, array[p_idx::text, 'done'], to_jsonb(not v_cur)), updated_at = now()
    where ref = p_ref;
  return public.task_json(p_ref);
end $$;

create or replace function public.set_task_done(p_ref text, p_done boolean)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_me uuid := (select id from public.app_users where auth_id = auth.uid()); t record;
begin
  select * into t from public.tasks where ref = p_ref;
  if not found then raise exception 'Task not found'; end if;
  if v_me is null or (t.owner_id <> v_me and coalesce(t.assigned_by_id, t.owner_id) <> v_me) then
    raise exception 'This is not your task';
  end if;
  update public.tasks set state = case when p_done then 'done' else 'open' end, updated_at = now() where ref = p_ref;
  return public.task_json(p_ref);
end $$;

-- ---------- grants ----------
do $$
declare fn text;
begin
  foreach fn in array array[
    'create_task(text,text,text,text,jsonb)',
    'add_task_subtask(text,text)',
    'toggle_task_subtask(text,integer)',
    'set_task_done(text,boolean)']
  loop
    execute format('revoke execute on function public.%s from public, anon', fn);
    execute format('grant execute on function public.%s to authenticated', fn);
  end loop;
end $$;


-- ===================================================================
-- 0045_settings_config_keys.sql
-- Fully interactive Settings: expand set_app_config allowlist + seed defaults.
-- ===================================================================
-- Make the Settings page fully interactive: every control now persists to app_config.
-- Expand the set_app_config allowlist with the org / notification / approval / security /
-- integration keys the Settings UI writes, and seed sensible defaults. Idempotent.

create or replace function public.set_app_config(p_key text, p_value jsonb)
returns jsonb language plpgsql security definer set search_path = public as $$
begin
  perform public.assert_access('users', 2);
  if p_key not in (
    -- existing control-plane keys
    'match_tolerance_pct','po_amend_tolerance_pct','manual_journal_threshold',
    'reminder_hours','escalation_hours','enforce_sod','enforce_access',
    -- organisation profile
    'org_legal_name','primary_entity','base_currency','fiscal_year_start',
    -- notification preferences
    'notif_in_app','notif_email_digest','notif_sms_overdue','notif_stalled_eng',
    -- approval thresholds
    'approve_auto_below','single_approver_max','dual_approval_max','md_signoff_above',
    -- security & data
    'require_2fa','dataroom_mode',
    -- integrations (connected on/off)
    'integ_mpesa','integ_etims','integ_email','integ_sms','integ_claude','integ_ura'
  ) then
    raise exception 'Unknown setting: %', p_key;
  end if;
  insert into public.app_config(key, value, updated_at) values (p_key, p_value, now())
  on conflict (key) do update set value = excluded.value, updated_at = now();
  perform public.audit_write('config.updated','app_config', p_key, jsonb_build_object('value', p_value));
  return jsonb_build_object('key', p_key, 'value', p_value);
end $$;

-- seed defaults (only if absent, so we never stomp an admin's saved value)
insert into public.app_config(key, value) values
  ('org_legal_name',     '"Ignis Innovation Limited"'::jsonb),
  ('primary_entity',     '"Kenya"'::jsonb),
  ('base_currency',      '"KES"'::jsonb),
  ('fiscal_year_start',  '"January"'::jsonb),
  ('notif_in_app',       'true'::jsonb),
  ('notif_email_digest', 'true'::jsonb),
  ('notif_sms_overdue',  'false'::jsonb),
  ('notif_stalled_eng',  'true'::jsonb),
  ('approve_auto_below', '5000'::jsonb),
  ('single_approver_max','100000'::jsonb),
  ('dual_approval_max',  '500000'::jsonb),
  ('md_signoff_above',   '500000'::jsonb),
  ('require_2fa',        'true'::jsonb),
  ('dataroom_mode',      'false'::jsonb),
  ('integ_mpesa',        'true'::jsonb),
  ('integ_etims',        'true'::jsonb),
  ('integ_email',        'true'::jsonb),
  ('integ_sms',          'true'::jsonb),
  ('integ_claude',       'true'::jsonb),
  ('integ_ura',          'false'::jsonb)
on conflict (key) do nothing;


-- ===================================================================
-- 0046_settings_profile_integrations.sql
-- Self-service profile edit + OAuth/secret storage for real integrations.
-- ===================================================================
-- Settings overhaul: self-service profile edit, plus storage for real integrations
-- (Google OAuth tokens + a vaulted Anthropic key). Idempotent.

-- ---------- edit my own profile (name / role title / avatar colour) ----------
create or replace function public.update_my_profile(p_name text, p_role_title text, p_color text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_me uuid := (select id from public.app_users where auth_id = auth.uid());
begin
  if v_me is null then raise exception 'No user is linked to this login'; end if;
  if nullif(trim(coalesce(p_name, '')), '') is null then raise exception 'A name is required'; end if;
  update public.app_users set
    name       = trim(p_name),
    role_title = nullif(trim(coalesce(p_role_title, '')), ''),
    color      = nullif(trim(coalesce(p_color, '')), ''),
    updated_at = now()
  where id = v_me;
  perform public.audit_write('profile.updated', 'user', (select email from public.app_users where id = v_me),
    jsonb_build_object('name', p_name, 'role_title', p_role_title, 'color', p_color));
  return (select jsonb_build_object('email', email, 'name', name, 'roleTitle', role_title, 'color', color)
          from public.app_users where id = v_me);
end $$;

-- ---------- OAuth connections (Google: Gmail + Drive). Tokens never reach the client. ----------
create table if not exists public.oauth_connections (
  provider      text primary key,               -- 'google'
  account_email text,
  scopes        text,
  access_token  text,
  refresh_token text,
  expiry        timestamptz,
  connected_by  uuid references public.app_users(id),
  updated_at    timestamptz not null default now()
);
alter table public.oauth_connections enable row level security;   -- no client policy → locked; server uses service role

-- ---------- vaulted secrets (e.g. the Anthropic API key). Locked from the client. ----------
create table if not exists public.app_secrets (
  key        text primary key,
  value      text not null,
  updated_at timestamptz not null default now()
);
alter table public.app_secrets enable row level security;         -- no client policy → locked

-- ---------- which providers are connected (status only, never the tokens) ----------
create or replace function public.oauth_status()
returns jsonb language sql stable security definer set search_path = public as $$
  select jsonb_build_object(
    'google', (select jsonb_build_object('connected', true, 'email', account_email)
               from public.oauth_connections where provider = 'google'),
    'claude', (select jsonb_build_object('connected', true)
               from public.app_secrets where key = 'anthropic_api_key')
  )
$$;

-- ---------- store a vaulted secret (admins only) ----------
create or replace function public.set_secret(p_key text, p_value text)
returns jsonb language plpgsql security definer set search_path = public as $$
begin
  perform public.assert_access('users', 2);
  if p_key not in ('anthropic_api_key') then raise exception 'Unknown secret: %', p_key; end if;
  if nullif(trim(coalesce(p_value, '')), '') is null then raise exception 'A value is required'; end if;
  insert into public.app_secrets(key, value, updated_at) values (p_key, trim(p_value), now())
  on conflict (key) do update set value = excluded.value, updated_at = now();
  perform public.audit_write('secret.updated', 'app_secrets', p_key, '{}'::jsonb);
  return jsonb_build_object('key', p_key, 'connected', true);
end $$;

-- ---------- grants ----------
do $$
declare fn text;
begin
  foreach fn in array array[
    'update_my_profile(text,text,text)',
    'oauth_status()',
    'set_secret(text,text)']
  loop
    execute format('revoke execute on function public.%s from public, anon', fn);
    execute format('grant execute on function public.%s to authenticated', fn);
  end loop;
end $$;


-- ===================================================================
-- 0047_task_due_dates.sql
-- ===================================================================
-- Task due dates: let a task carry an explicit calendar date, not just a quick
-- "today / this week / next week" key. Elizabeth's review asked for real dates.
--
--  * tasks.due_date date — the concrete due date (nullable; back-compat with key-only tasks)
--  * task_json now returns 'due' (ISO date) so My Week can show it + flag overdue
--  * create_task gains p_due_date; when given it overrides the key and drives the
--    pill/label (Overdue / Today / Due DD Mon). When absent we still derive a
--    concrete date from the key so "due this week" filtering has something to read.
-- Idempotent throughout.

-- ---------- schema ----------
alter table public.tasks add column if not exists due_date date;

-- Backfill a concrete date for existing key-only tasks so filters have a value.
update public.tasks set due_date = case due_pill
    when 'today' then current_date
    when 'over'  then current_date - 1
    else (date_trunc('week', current_date) + interval '6 days')::date
  end
where due_date is null and state = 'open';

-- ---------- read shape (adds 'due') ----------
create or replace function public.task_json(p_ref text) returns jsonb
language sql stable security definer set search_path = public as $$
  select jsonb_build_object(
    'id', t.ref, 't', t.title, 's', t.sub, 'o', t.owner_name,
    'p', t.due_pill, 'pl', t.due_label,
    'due', to_char(t.due_date, 'YYYY-MM-DD'),
    'subtasks', coalesce(t.subtasks, '[]'::jsonb),
    'ownerEmail', ow.email,
    'assignedBy', case when t.assigned_by_id is not null and t.assigned_by_id <> t.owner_id
                       then (select name from public.app_users where id = t.assigned_by_id) end)
  from public.tasks t left join public.app_users ow on ow.id = t.owner_id
  where t.ref = p_ref
$$;

-- ---------- create a task (now with an optional explicit due date) ----------
-- Drop the old 5-arg signature so only the dated version remains.
drop function if exists public.create_task(text, text, text, text, jsonb);

create or replace function public.create_task(
  p_title text, p_owner_email text default null, p_due_key text default 'week',
  p_link text default '', p_subtasks jsonb default '[]'::jsonb, p_due_date date default null
) returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_ref text; v_pill text; v_label text; v_subs jsonb; v_due date;
  v_entity uuid := (select id from public.entities where code = 'KE');
  v_me uuid := (select id from public.app_users where auth_id = auth.uid());
  v_my_email text; v_owner uuid; v_owner_name text; v_owner_email text;
begin
  if v_me is null then raise exception 'No user is linked to this login'; end if;
  if nullif(trim(coalesce(p_title, '')), '') is null then raise exception 'A task description is required'; end if;
  select email into v_my_email from public.app_users where id = v_me;
  if nullif(trim(coalesce(p_owner_email, '')), '') is null or lower(p_owner_email) = lower(v_my_email) then
    v_owner := v_me;
  else
    select id into v_owner from public.app_users where lower(email) = lower(trim(p_owner_email));
    if v_owner is null then raise exception 'No user with email %', p_owner_email; end if;
  end if;
  select name, email into v_owner_name, v_owner_email from public.app_users where id = v_owner;

  if p_due_date is not null then
    -- explicit calendar date drives everything
    v_due := p_due_date;
    if    v_due <  current_date then v_pill := 'over';  v_label := 'Overdue · ' || to_char(v_due, 'DD Mon');
    elsif v_due =  current_date then v_pill := 'today'; v_label := 'Today';
    else                             v_pill := 'week';  v_label := 'Due ' || to_char(v_due, 'DD Mon');
    end if;
  else
    -- quick-key path: derive both the pill/label and a concrete date
    select case p_due_key when 'today' then 'today' when 'over' then 'over' else 'week' end,
           case p_due_key when 'today' then 'Today' when 'nweek' then 'Next week' when 'over' then 'Overdue' else 'This week' end
      into v_pill, v_label;
    v_due := case p_due_key
        when 'today' then current_date
        when 'nweek' then (date_trunc('week', current_date) + interval '13 days')::date
        else (date_trunc('week', current_date) + interval '6 days')::date
      end;
  end if;

  -- normalise subtasks: accept ["a","b"] or [{"text":"a"}] → [{"text","done":false}]
  select coalesce(jsonb_agg(jsonb_build_object('text', txt, 'done', false)), '[]'::jsonb) into v_subs
  from (
    select case when jsonb_typeof(e) = 'string' then trim(e #>> '{}') else trim(coalesce(e ->> 'text', '')) end as txt
    from jsonb_array_elements(coalesce(p_subtasks, '[]'::jsonb)) e
  ) s where txt is not null and txt <> '';
  v_ref := public.next_ref('TSK');
  insert into public.tasks(ref, entity_id, owner_id, assigned_by_id, title, sub, owner_name, due_pill, due_label, due_date, subtasks)
  values (v_ref, v_entity, v_owner, v_me, trim(p_title), coalesce(p_link, ''), v_owner_name, v_pill, v_label, v_due, v_subs);
  -- assigned to someone else → in-app bell (email is sent client-side via /api/notify)
  if v_owner <> v_me then
    insert into public.notifications(entity_id, recipient_email, kind, title, body, link_view, link_ref)
    values (v_entity, lower(v_owner_email), 'task_assigned',
            (select name from public.app_users where id = v_me) || ' assigned you a task',
            trim(p_title), 'home', v_ref);
  end if;
  perform public.audit_write('task.created', 'task', v_ref,
    jsonb_build_object('title', p_title, 'owner', v_owner_name, 'due', v_label));
  return public.task_json(v_ref);
end $$;

-- ---------- grants ----------
revoke execute on function public.create_task(text, text, text, text, jsonb, date) from public, anon;
grant execute on function public.create_task(text, text, text, text, jsonb, date) to authenticated;


-- ===================================================================
-- 0048_project_last_update.sql
-- ===================================================================
-- Expose each project's last-updated timestamp so the registry can show a
-- "Last update" column and the dashboard can flag projects with no recent
-- activity (Elizabeth's review: stronger project summaries + Needs Attention).
-- Only adds 'updatedAt' to the existing projection — everything else is 1:1
-- with 0043. Idempotent (create or replace).

create or replace function public.project_detail_json(p_id uuid) returns jsonb
language sql stable security definer set search_path = public as $$
  select jsonb_build_object(
    'id', p.id, 'state', p.state,
    'funder', p.funder, 'status', p.status, 'budget', p.budget_txt, 'spent', p.spent_txt,
    'pct', p.pct, 'timeline', p.timeline, 'team', p.team, 'reporting', p.reporting, 'field', p.field,
    'budgetAmount', p.budget_amount,
    'spentAmount', coalesce((select sum(amount) from public.project_milestones
                             where project_id = p.id and status = 'done'), 0),
    'startDate', p.start_date, 'endDate', p.end_date,
    'updatedAt', p.updated_at,
    'location', p.location, 'docs', p.docs,
    'createdByMe', (
      (p.created_by is not null and p.created_by = (select id from public.app_users where auth_id = auth.uid()))
      or coalesce((select level from public.user_permissions
                   where email = lower(coalesce(nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'email', ''))
                     and module = 'projects'), 0) >= 3
    ),
    'milestones', coalesce((select jsonb_agg(jsonb_build_object('id', id, 't', title, 's', status,
                             'amount', amount, 'start', start_date, 'end', end_date) order by sort)
                            from public.project_milestones where project_id = p.id), '[]'::jsonb),
    'drawdowns',  coalesce((select jsonb_agg(jsonb_build_object('id', id, 't', title, 'v', amount_txt, 's', status) order by sort)
                            from public.project_drawdowns where project_id = p.id), '[]'::jsonb))
  from public.projects p where p.id = p_id
$$;

-- ===================================================================
-- 0049_petty_cash_requests.sql
-- ===================================================================
-- Petty-cash requests: staff raise a request from the Staff Portal (item, amount,
-- date needed, reason). It routes to the Finance → Petty Cash tab where HR or
-- Finance approve or reject. The requester sees the decision and can edit or
-- withdraw their own request while it is still pending. Mirrors the leave
-- self-service flow (apply → decide, editable while pending). Idempotent.

-- ---------- schema ----------
create table if not exists public.petty_cash_requests (
  id             uuid primary key default gen_random_uuid(),
  ref            text unique not null,
  entity_id      uuid references public.entities(id),
  requester_id   uuid references public.app_users(id),
  requester_name text,
  item           text not null,
  amount         numeric(14,2) not null check (amount > 0),
  need_by        date,
  reason         text,
  state          text not null default 'pending' check (state in ('pending','approved','rejected','cancelled')),
  decided_by     uuid references public.app_users(id),
  decided_at     timestamptz,
  decision_note  text,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);

-- ref counter for PCR-001, PCR-002, … (next_ref requires the kind to exist)
insert into public.ref_counters(kind, prefix, n) values ('PCR', 'PCR-00', 0) on conflict (kind) do nothing;

alter table public.petty_cash_requests enable row level security;
drop policy if exists "read petty cash requests" on public.petty_cash_requests;
-- readable by any signed-in user (same model as leave_applications); the Staff
-- Portal only shows the caller's own rows, the Petty Cash tab shows the queue.
create policy "read petty cash requests" on public.petty_cash_requests for select to authenticated using (true);

-- ---------- frontend read shape ----------
create or replace function public.pcr_json(p_ref text) returns jsonb
language sql stable security definer set search_path = public as $$
  select jsonb_build_object(
    'id', r.ref, 'item', r.item, 'amount', r.amount,
    'needBy', to_char(r.need_by, 'YYYY-MM-DD'), 'reason', r.reason, 'state', r.state,
    'requester', rq.name, 'requesterEmail', rq.email,
    'decidedBy', dc.name, 'decidedAt', r.decided_at, 'note', r.decision_note,
    'createdAt', r.created_at)
  from public.petty_cash_requests r
  left join public.app_users rq on rq.id = r.requester_id
  left join public.app_users dc on dc.id = r.decided_by
  where r.ref = p_ref
$$;

-- true when the caller may decide petty-cash requests (HR or Finance, edit+).
create or replace function public.can_decide_petty() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.user_permissions
    where email = lower(coalesce(nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'email', ''))
      and module in ('hr', 'finance') and level >= 2
  )
$$;

-- ---------- submit (staff) ----------
create or replace function public.submit_petty_cash_request(
  p_item text, p_amount numeric, p_need_by date default null, p_reason text default null
) returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_ref text;
  v_entity uuid := (select id from public.entities where code = 'KE');
  v_me uuid := (select id from public.app_users where auth_id = auth.uid());
  v_name text; v_email text;
begin
  if v_me is null then raise exception 'No user is linked to this login'; end if;
  if nullif(trim(coalesce(p_item, '')), '') is null then raise exception 'What is the money for? An item is required'; end if;
  if coalesce(p_amount, 0) <= 0 then raise exception 'Enter an amount greater than zero'; end if;
  select name, email into v_name, v_email from public.app_users where id = v_me;
  v_ref := public.next_ref('PCR');
  insert into public.petty_cash_requests(ref, entity_id, requester_id, requester_name, item, amount, need_by, reason)
  values (v_ref, v_entity, v_me, v_name, trim(p_item), p_amount, p_need_by, nullif(trim(coalesce(p_reason, '')), ''));
  -- bell the approvers (HR + Finance, edit+)
  insert into public.notifications(entity_id, recipient_email, kind, title, body, link_view, link_ref)
  select v_entity, lower(u.email), 'petty_cash_request',
         v_name || ' requested petty cash',
         trim(p_item) || ' — KES ' || to_char(p_amount, 'FM999,999,990'), 'finance', v_ref
  from public.app_users u
  join public.user_permissions p on p.email = lower(u.email)
  where p.module in ('hr', 'finance') and p.level >= 2 and lower(u.email) <> lower(v_email);
  perform public.audit_write('petty_cash.requested', 'petty_cash_request', v_ref,
    jsonb_build_object('item', p_item, 'amount', p_amount));
  return public.pcr_json(v_ref);
end $$;

-- ---------- edit / withdraw (owner, while pending) ----------
create or replace function public.edit_petty_cash_request(
  p_ref text, p_item text, p_amount numeric, p_need_by date default null, p_reason text default null
) returns jsonb language plpgsql security definer set search_path = public as $$
declare v_me uuid := (select id from public.app_users where auth_id = auth.uid()); r record;
begin
  select * into r from public.petty_cash_requests where ref = p_ref;
  if not found then raise exception 'Request not found'; end if;
  if v_me is null or r.requester_id <> v_me then raise exception 'This is not your request'; end if;
  if r.state <> 'pending' then raise exception 'Only a pending request can be edited'; end if;
  if nullif(trim(coalesce(p_item, '')), '') is null then raise exception 'An item is required'; end if;
  if coalesce(p_amount, 0) <= 0 then raise exception 'Enter an amount greater than zero'; end if;
  update public.petty_cash_requests
    set item = trim(p_item), amount = p_amount, need_by = p_need_by,
        reason = nullif(trim(coalesce(p_reason, '')), ''), updated_at = now()
    where ref = p_ref;
  perform public.audit_write('petty_cash.edited', 'petty_cash_request', p_ref,
    jsonb_build_object('item', p_item, 'amount', p_amount));
  return public.pcr_json(p_ref);
end $$;

create or replace function public.delete_petty_cash_request(p_ref text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_me uuid := (select id from public.app_users where auth_id = auth.uid()); r record;
begin
  select * into r from public.petty_cash_requests where ref = p_ref;
  if not found then raise exception 'Request not found'; end if;
  if v_me is null or r.requester_id <> v_me then raise exception 'This is not your request'; end if;
  if r.state <> 'pending' then raise exception 'Only a pending request can be withdrawn'; end if;
  delete from public.petty_cash_requests where ref = p_ref;
  perform public.audit_write('petty_cash.withdrawn', 'petty_cash_request', p_ref, '{}'::jsonb);
  return jsonb_build_object('id', p_ref, 'deleted', true);
end $$;

-- ---------- decide (HR / Finance) ----------
create or replace function public.decide_petty_cash_request(p_ref text, p_approve boolean, p_note text default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_me uuid := (select id from public.app_users where auth_id = auth.uid());
  v_entity uuid := (select id from public.entities where code = 'KE');
  v_who text; r record;
begin
  if not public.can_decide_petty() then raise exception 'Only HR or Finance can decide petty-cash requests'; end if;
  select * into r from public.petty_cash_requests where ref = p_ref;
  if not found then raise exception 'Request not found'; end if;
  if r.state <> 'pending' then raise exception 'This request was already decided'; end if;
  if r.requester_id = v_me then raise exception 'You cannot decide your own request'; end if;
  update public.petty_cash_requests
    set state = case when p_approve then 'approved' else 'rejected' end,
        decided_by = v_me, decided_at = now(), decision_note = nullif(trim(coalesce(p_note, '')), ''), updated_at = now()
    where ref = p_ref;
  select name into v_who from public.app_users where id = v_me;
  -- tell the requester
  insert into public.notifications(entity_id, recipient_email, kind, title, body, link_view, link_ref)
  values (v_entity, lower((select email from public.app_users where id = r.requester_id)),
          'petty_cash_decided',
          'Petty cash ' || case when p_approve then 'approved' else 'rejected' end,
          r.item || ' — KES ' || to_char(r.amount, 'FM999,999,990') || case when p_note is not null and trim(p_note) <> '' then ' · ' || trim(p_note) else '' end,
          'staffportal', p_ref);
  perform public.audit_write(case when p_approve then 'petty_cash.approved' else 'petty_cash.rejected' end,
    'petty_cash_request', p_ref, jsonb_build_object('amount', r.amount, 'note', p_note));
  return public.pcr_json(p_ref);
end $$;

-- ---------- grants ----------
do $$
declare fn text;
begin
  foreach fn in array array[
    'submit_petty_cash_request(text,numeric,date,text)',
    'edit_petty_cash_request(text,text,numeric,date,text)',
    'delete_petty_cash_request(text)',
    'decide_petty_cash_request(text,boolean,text)',
    'can_decide_petty()',
    'pcr_json(text)']
  loop
    execute format('revoke execute on function public.%s from public, anon', fn);
    execute format('grant execute on function public.%s to authenticated', fn);
  end loop;
end $$;


-- ===================================================================
-- 0050_one_click_pay_invoice.sql
-- ===================================================================
-- One-click pay for supplier invoices: HR/Finance can mark an invoice paid in a
-- single click, without the separate "Approve for Payment" step. Posts the same
-- payment journal, records the payment, moves the budget line committed→actual
-- and decrements the vendor's open POs — exactly like pay_invoice, but it can be
-- called from any non-paid state (captured/matched/approved/exception).
--
-- NOTE: this deliberately relaxes the approve-then-pay segregation of duties, per
-- an explicit product decision. pay_invoice (the two-step control) is left intact
-- and still used elsewhere. Idempotent.

create or replace function public.mark_invoice_paid(p_inv_ref text, p_method text default 'bank')
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  inv record; po record; v_ref text; je text; bcode text; net numeric; lines jsonb;
  v_entity uuid := (select id from public.entities where code = 'KE');
begin
  perform public.assert_access('finance', 2);
  select * into inv from public.invoices_ap where ref = p_inv_ref;
  if not found then raise exception 'Invoice % not found', p_inv_ref; end if;
  if inv.state = 'paid' then raise exception 'Invoice % is already paid', p_inv_ref; end if;
  select * into po from public.purchase_orders where id = inv.po_id;
  net := inv.amount - coalesce(inv.wht_amount, 0);
  v_ref := public.next_ref('PAY');
  lines := jsonb_build_array(
    jsonb_build_object('account', '2000', 'debit', inv.amount),
    jsonb_build_object('account', '1000', 'credit', net));
  if coalesce(inv.wht_amount, 0) > 0 then
    lines := lines || jsonb_build_object('account', '2200', 'credit', inv.wht_amount);
  end if;
  je := public.post_journal('Payment ' || v_ref || ' — ' || po.vendor_name, 'payment', v_ref, lines);
  insert into public.payments(ref, entity_id, invoice_ap_id, method, amount, journal_ref)
  values (v_ref, v_entity, inv.id, p_method, net, je);
  update public.invoices_ap set state = 'paid' where id = inv.id;
  update public.vendors set open_pos = greatest(open_pos - 1, 0) where id = inv.vendor_id;
  select budget_code into bcode from public.requisitions where id = po.requisition_id;
  if bcode is not null then
    update public.budget_lines set committed = greatest(committed - inv.amount, 0), actual = actual + inv.amount where code = bcode;
  end if;
  perform public.audit_write('payment.made', 'payment', v_ref,
    jsonb_build_object('invoice', p_inv_ref, 'method', p_method, 'net', net, 'wht', inv.wht_amount, 'journal', je, 'oneClick', true));
  return jsonb_build_object('id', v_ref, 'invoice', p_inv_ref, 'journal', je, 'net', net);
end $$;

revoke execute on function public.mark_invoice_paid(text, text) from public, anon;
grant execute on function public.mark_invoice_paid(text, text) to authenticated;

-- ===================================================================
-- 0051_rename_wanjiku_email.sql
-- ===================================================================
-- ============================================================
-- 0051 — Rename the HR login wanjiku@ignis.africa → jwanjiku@ignis-innovation.com
-- The password hash lives on auth.users and is untouched by an email change, and
-- every HR record is keyed by app_users.id (not email), so the login and all data
-- (leave, payroll, exits, etc.) survive the rename. We update every place the
-- email itself is stored. Idempotent: the WHERE clauses no longer match on re-run.
-- ============================================================
do $$
declare old_email constant text := 'wanjiku@ignis.africa';
        new_email constant text := 'jwanjiku@ignis-innovation.com';
begin
  update auth.users            set email = new_email where email = old_email;
  update public.app_users      set email = new_email where email = old_email;
  update public.user_permissions set email = new_email where email = old_email;
  update public.invites        set email = new_email where email = old_email;
  update public.notifications  set recipient_email = new_email where recipient_email = old_email;
end $$;

-- ===================================================================
-- 0052_super_admin_role.sql
-- ===================================================================
-- ============================================================
-- 0052 — "Super Admin" role template
-- Full (level 3) access to every module. invite_user (0008) validates the role
-- key against public.role_templates, so this row is all the backend needs. A
-- super admin is detected client-side as users:3 (Users.tsx), which this grants.
-- The petty-cash two-stage flow (0053) treats users:3 as the Super-Admin approver.
-- Idempotent via on-conflict.
-- ============================================================
insert into public.role_templates(role_key, module, level)
select 'super', m, 3 from (values
  ('finance'),('procurement'),('inventory'),('hr'),('deploy'),('readiness'),
  ('raise'),('crm'),('projects'),('reports'),('compliance'),('dataroom'),
  ('settings'),('users')
) as t(m)
on conflict (role_key, module) do nothing;

-- ===================================================================
-- 0053_petty_cash_two_stage.sql
-- ===================================================================
-- ============================================================
-- 0053 — Petty-cash two-stage approval
-- A request now needs BOTH a Super Admin (users:3) AND an HR approver (hr>=2),
-- by two DIFFERENT people, in either order. Either one may reject. The request
-- stays 'pending' until both stages are stamped, then flips to 'approved'.
-- Reworks the schema + RPCs from 0049. Idempotent.
-- ============================================================

-- ---------- schema: per-stage stamps ----------
alter table public.petty_cash_requests add column if not exists super_approved_by uuid references public.app_users(id);
alter table public.petty_cash_requests add column if not exists super_approved_at timestamptz;
alter table public.petty_cash_requests add column if not exists hr_approved_by    uuid references public.app_users(id);
alter table public.petty_cash_requests add column if not exists hr_approved_at    timestamptz;

-- ---------- role helpers (by the caller's linked app_users email) ----------
-- Super-Admin approver = full (level 3) access to the users module.
create or replace function public.can_petty_super() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.user_permissions p
    join public.app_users u on lower(u.email) = p.email
    where u.auth_id = auth.uid() and p.module = 'users' and p.level >= 3
  )
$$;

-- HR approver = edit+ (level 2) access to the hr module.
create or replace function public.can_petty_hr() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.user_permissions p
    join public.app_users u on lower(u.email) = p.email
    where u.auth_id = auth.uid() and p.module = 'hr' and p.level >= 2
  )
$$;

-- May the caller see/act on the petty-cash queue at all? (Super Admin or HR)
create or replace function public.can_decide_petty() returns boolean
language sql stable security definer set search_path = public as $$
  select public.can_petty_super() or public.can_petty_hr()
$$;

-- ---------- frontend read shape (now carries both stage stamps) ----------
create or replace function public.pcr_json(p_ref text) returns jsonb
language sql stable security definer set search_path = public as $$
  select jsonb_build_object(
    'id', r.ref, 'item', r.item, 'amount', r.amount,
    'needBy', to_char(r.need_by, 'YYYY-MM-DD'), 'reason', r.reason, 'state', r.state,
    'requester', rq.name, 'requesterEmail', rq.email,
    'superApprovedBy', su.name, 'superApprovedAt', r.super_approved_at,
    'hrApprovedBy', hr.name, 'hrApprovedAt', r.hr_approved_at,
    'decidedBy', dc.name, 'decidedAt', r.decided_at, 'note', r.decision_note,
    'createdAt', r.created_at)
  from public.petty_cash_requests r
  left join public.app_users rq on rq.id = r.requester_id
  left join public.app_users su on su.id = r.super_approved_by
  left join public.app_users hr on hr.id = r.hr_approved_by
  left join public.app_users dc on dc.id = r.decided_by
  where r.ref = p_ref
$$;

-- ---------- submit (staff) — notify the Super Admins + HR approvers ----------
create or replace function public.submit_petty_cash_request(
  p_item text, p_amount numeric, p_need_by date default null, p_reason text default null
) returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_ref text;
  v_entity uuid := (select id from public.entities where code = 'KE');
  v_me uuid := (select id from public.app_users where auth_id = auth.uid());
  v_name text; v_email text;
begin
  if v_me is null then raise exception 'No user is linked to this login'; end if;
  if nullif(trim(coalesce(p_item, '')), '') is null then raise exception 'What is the money for? An item is required'; end if;
  if coalesce(p_amount, 0) <= 0 then raise exception 'Enter an amount greater than zero'; end if;
  select name, email into v_name, v_email from public.app_users where id = v_me;
  v_ref := public.next_ref('PCR');
  insert into public.petty_cash_requests(ref, entity_id, requester_id, requester_name, item, amount, need_by, reason)
  values (v_ref, v_entity, v_me, v_name, trim(p_item), p_amount, p_need_by, nullif(trim(coalesce(p_reason, '')), ''));
  -- bell the approvers (Super Admin users:3, or HR hr>=2)
  insert into public.notifications(entity_id, recipient_email, kind, title, body, link_view, link_ref)
  select v_entity, lower(u.email), 'petty_cash_request',
         v_name || ' requested petty cash',
         trim(p_item) || ' — KES ' || to_char(p_amount, 'FM999,999,990'), 'finance', v_ref
  from public.app_users u
  join public.user_permissions p on p.email = lower(u.email)
  where ((p.module = 'users' and p.level >= 3) or (p.module = 'hr' and p.level >= 2))
    and lower(u.email) <> lower(v_email);
  perform public.audit_write('petty_cash.requested', 'petty_cash_request', v_ref,
    jsonb_build_object('item', p_item, 'amount', p_amount));
  return public.pcr_json(v_ref);
end $$;

-- ---------- decide (Super Admin + HR, two distinct people, either order) ----------
create or replace function public.decide_petty_cash_request(p_ref text, p_approve boolean, p_note text default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_me uuid := (select id from public.app_users where auth_id = auth.uid());
  v_entity uuid := (select id from public.entities where code = 'KE');
  v_is_super boolean := public.can_petty_super();
  v_is_hr boolean := public.can_petty_hr();
  v_who text; r record;
  v_stage text;            -- 'super' | 'hr' — the stage this call fills
  v_both boolean := false; -- true once both stages are stamped
begin
  if not (v_is_super or v_is_hr) then
    raise exception 'Only a Super Admin or HR can decide petty-cash requests';
  end if;
  select * into r from public.petty_cash_requests where ref = p_ref;
  if not found then raise exception 'Request not found'; end if;
  if r.state <> 'pending' then raise exception 'This request was already decided'; end if;
  if r.requester_id = v_me then raise exception 'You cannot decide your own request'; end if;
  select name into v_who from public.app_users where id = v_me;

  -- rejection ends it immediately, whatever stage we are at
  if not p_approve then
    update public.petty_cash_requests
      set state = 'rejected', decided_by = v_me, decided_at = now(),
          decision_note = nullif(trim(coalesce(p_note, '')), ''), updated_at = now()
      where ref = p_ref;
    insert into public.notifications(entity_id, recipient_email, kind, title, body, link_view, link_ref)
    values (v_entity, lower((select email from public.app_users where id = r.requester_id)),
            'petty_cash_decided', 'Petty cash rejected',
            r.item || ' — KES ' || to_char(r.amount, 'FM999,999,990') ||
              case when p_note is not null and trim(p_note) <> '' then ' · ' || trim(p_note) else '' end,
            'staffportal', p_ref);
    perform public.audit_write('petty_cash.rejected', 'petty_cash_request', p_ref,
      jsonb_build_object('amount', r.amount, 'note', p_note));
    return public.pcr_json(p_ref);
  end if;

  -- approval: fill whichever stage the caller is eligible for and hasn't filled.
  -- The two stages must be two different people.
  if v_is_super and r.super_approved_by is null and coalesce(r.hr_approved_by, '00000000-0000-0000-0000-000000000000') <> v_me then
    v_stage := 'super';
  elsif v_is_hr and r.hr_approved_by is null and coalesce(r.super_approved_by, '00000000-0000-0000-0000-000000000000') <> v_me then
    v_stage := 'hr';
  else
    raise exception 'Nothing left for you to approve on this request (each stage needs a different person)';
  end if;

  if v_stage = 'super' then
    update public.petty_cash_requests set super_approved_by = v_me, super_approved_at = now(), updated_at = now() where ref = p_ref;
    v_both := r.hr_approved_by is not null;
  else
    update public.petty_cash_requests set hr_approved_by = v_me, hr_approved_at = now(), updated_at = now() where ref = p_ref;
    v_both := r.super_approved_by is not null;
  end if;

  if v_both then
    -- second (final) approval → fully approved
    update public.petty_cash_requests
      set state = 'approved', decided_by = v_me, decided_at = now(),
          decision_note = nullif(trim(coalesce(p_note, '')), ''), updated_at = now()
      where ref = p_ref;
    insert into public.notifications(entity_id, recipient_email, kind, title, body, link_view, link_ref)
    values (v_entity, lower((select email from public.app_users where id = r.requester_id)),
            'petty_cash_decided', 'Petty cash approved',
            r.item || ' — KES ' || to_char(r.amount, 'FM999,999,990'), 'staffportal', p_ref);
    perform public.audit_write('petty_cash.approved', 'petty_cash_request', p_ref,
      jsonb_build_object('amount', r.amount));
  else
    -- first approval → still pending; bell the other approver group
    insert into public.notifications(entity_id, recipient_email, kind, title, body, link_view, link_ref)
    select v_entity, lower(u.email), 'petty_cash_request',
           'Petty cash awaiting your approval',
           r.requester_name || ' · ' || r.item || ' — KES ' || to_char(r.amount, 'FM999,999,990'), 'finance', p_ref
    from public.app_users u
    join public.user_permissions p on p.email = lower(u.email)
    where lower(u.email) <> lower(v_who)
      and case when v_stage = 'super' then (p.module = 'hr' and p.level >= 2)
                                       else (p.module = 'users' and p.level >= 3) end;
    perform public.audit_write('petty_cash.stage_approved', 'petty_cash_request', p_ref,
      jsonb_build_object('stage', v_stage, 'amount', r.amount));
  end if;

  return public.pcr_json(p_ref);
end $$;

-- ---------- grants (re-assert for the replaced functions) ----------
do $$
declare fn text;
begin
  foreach fn in array array[
    'submit_petty_cash_request(text,numeric,date,text)',
    'decide_petty_cash_request(text,boolean,text)',
    'can_decide_petty()',
    'can_petty_super()',
    'can_petty_hr()',
    'pcr_json(text)']
  loop
    execute format('revoke execute on function public.%s from public, anon', fn);
    execute format('grant execute on function public.%s to authenticated', fn);
  end loop;
end $$;

-- ===================================================================
-- 0054_leave_approval_notify.sql
-- ===================================================================
-- ============================================================
-- 0054 — Leave approval: email the employee + bell every user
-- On approval we broadcast a bell notification to ALL users ("<name> is on leave
-- until <end>") and return the applicant's name/email/dates so the client can
-- send the approval email via /api/notify. Behaviour on reject is unchanged.
-- Idempotent (create or replace).
-- ============================================================
create or replace function public.decide_leave(p_ref text, p_approve boolean, p_note text default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  l record;
  v_me uuid := (select id from public.app_users where auth_id = auth.uid());
  v_year int;
  v_entity uuid := (select id from public.entities where code = 'KE');
  v_name text; v_email text;
begin
  perform public.assert_access('hr', 2);
  select * into l from public.leave_applications where ref = p_ref;
  if not found then raise exception 'Leave application % not found', p_ref; end if;
  perform public.assert_sod('leave approval (applicant ≠ approver)', l.app_user_id);
  select name, email into v_name, v_email from public.app_users where id = l.app_user_id;
  v_year := extract(year from l.from_date)::int;
  if p_approve then
    update public.leave_applications set state = 'approved', approver_id = v_me where id = l.id;
    update public.leave_balances set reserved = reserved - l.days, used = used + l.days
    where app_user_id = l.app_user_id and kind = l.kind and year = v_year;
    -- bell EVERY user: <name> is on leave until <end>
    insert into public.notifications(entity_id, recipient_email, kind, title, body, link_view, link_ref)
    select v_entity, lower(u.email), 'leave',
           v_name || ' is on leave',
           v_name || ' is on leave until ' || to_char(l.to_date, 'DD Mon YYYY'),
           'hr', p_ref
    from public.app_users u
    where u.email is not null;
  else
    update public.leave_applications set state = 'rejected', approver_id = v_me, reason = coalesce(p_note, reason) where id = l.id;
    update public.leave_balances set reserved = reserved - l.days
    where app_user_id = l.app_user_id and kind = l.kind and year = v_year;
  end if;
  perform public.audit_write(case when p_approve then 'leave.approved' else 'leave.rejected' end, 'leave', p_ref,
    jsonb_build_object('days', l.days, 'note', p_note));
  return jsonb_build_object(
    'id', p_ref,
    'state', case when p_approve then 'approved' else 'rejected' end,
    'who', v_name, 'email', v_email,
    'from', to_char(l.from_date, 'DD Mon YYYY'), 'to', to_char(l.to_date, 'DD Mon YYYY'));
end $$;

-- ===================================================================
-- 0055_cleanup_test_data.sql
-- ===================================================================
-- ============================================================
-- 0055 — Remove test/demo data
--   (a) four pending users (bmwangi, eooro, wmungai, dnderitu @ignis-innovation.com)
--   (b) "Kimani" test rows across Finance & Procurement
--   (c) the "Testing item" petty-cash row
--   (d) all Partnerships-CRM rows (partners, opportunities, engagements)
-- These rows were created through the app on the live DB, so they are matched by
-- value. All statements are idempotent (re-running is a no-op).
-- ============================================================

-- ---------- (a) delete four pending users ----------
do $$
declare doomed constant text[] := array[
  'bmwangi@ignis-innovation.com','eooro@ignis-innovation.com',
  'wmungai@ignis-innovation.com','dnderitu@ignis-innovation.com'];
  ids uuid[];
begin
  select array_agg(id) into ids from public.app_users where lower(email) = any(doomed);
  if ids is not null then
    -- person-specific HR rows → delete
    delete from public.payroll_items     where app_user_id = any(ids);
    delete from public.leave_balances     where app_user_id = any(ids);
    delete from public.leave_applications where app_user_id = any(ids);
    delete from public.appraisals         where app_user_id = any(ids);
    delete from public.certifications     where app_user_id = any(ids);
    delete from public.staff_feedback     where author_id   = any(ids);
    delete from public.staff_exits        where app_user_id = any(ids);
    delete from public.staff_files        where app_user_id = any(ids);
    delete from public.petty_cash_requests where requester_id = any(ids);

    -- actor / owner references on business records → null out
    update public.appraisals          set reviewer_id      = null where reviewer_id      = any(ids);
    update public.leave_applications  set approver_id      = null where approver_id      = any(ids);
    update public.payroll_runs        set prepared_by      = null where prepared_by      = any(ids);
    update public.payroll_runs        set approved_by      = null where approved_by      = any(ids);
    update public.dispatches          set created_by       = null where created_by       = any(ids);
    update public.documents           set owner_id         = null where owner_id         = any(ids);
    update public.goods_received_notes set receiver_id     = null where receiver_id      = any(ids);
    update public.invites             set invited_by       = null where invited_by       = any(ids);
    update public.purchase_orders     set owner_id         = null where owner_id         = any(ids);
    update public.requisitions        set owner_id         = null where owner_id         = any(ids);
    update public.sales_invoices      set owner_id         = null where owner_id         = any(ids);
    update public.sanctions_checks    set checked_by       = null where checked_by       = any(ids);
    update public.stock_movements     set created_by       = null where created_by       = any(ids);
    update public.tasks               set owner_id         = null where owner_id         = any(ids);
    update public.tasks               set assigned_by_id   = null where assigned_by_id   = any(ids);
    update public.projects            set created_by       = null where created_by       = any(ids);
    update public.vendor_screenings   set screened_by      = null where screened_by      = any(ids);
    update public.vendors             set owner_id         = null where owner_id         = any(ids);
    update public.petty_cash_requests set decided_by        = null where decided_by        = any(ids);
    update public.petty_cash_requests set super_approved_by = null where super_approved_by = any(ids);
    update public.petty_cash_requests set hr_approved_by    = null where hr_approved_by    = any(ids);
  end if;

  -- email-keyed rows + the members + their auth logins
  delete from public.user_permissions where lower(email) = any(doomed);
  delete from public.invites          where lower(email) = any(doomed);
  delete from public.app_users        where lower(email) = any(doomed);
  delete from auth.users              where lower(email) = any(doomed);
end $$;

-- ---------- (b) "Kimani" test rows across Finance & Procurement ----------
do $$
declare kv uuid[];  -- vendor ids named like Kimani
begin
  select array_agg(id) into kv from public.vendors where name ilike '%kimani%';
  -- unwind the procure-to-pay chain in dependency order
  delete from public.payments where invoice_ap_id in (
    select id from public.invoices_ap where vendor_id = any(coalesce(kv, '{}'))
       or po_id in (select id from public.purchase_orders where vendor_name ilike '%kimani%'));
  delete from public.invoices_ap where vendor_id = any(coalesce(kv, '{}'))
     or po_id in (select id from public.purchase_orders where vendor_name ilike '%kimani%');
  delete from public.goods_received_notes where po_id in (
    select id from public.purchase_orders where vendor_id = any(coalesce(kv, '{}')) or vendor_name ilike '%kimani%');
  delete from public.purchase_orders where vendor_id = any(coalesce(kv, '{}')) or vendor_name ilike '%kimani%'
     or requisition_id in (select id from public.requisitions where item ilike '%kimani%');
  delete from public.requisitions where item ilike '%kimani%';
  -- other tables that reference the vendor (no cascade) must clear first
  delete from public.sanctions_checks   where vendor_id = any(coalesce(kv, '{}'));
  delete from public.vendor_bank_changes where vendor_id = any(coalesce(kv, '{}'));
  delete from public.contracts          where vendor_id = any(coalesce(kv, '{}'));
  delete from public.vendor_screenings  where vendor_id = any(coalesce(kv, '{}'));
  delete from public.vendors where name ilike '%kimani%';
  -- order-to-cash + GL + petty cash text mentions
  delete from public.sales_invoices where customer ilike '%kimani%' or description ilike '%kimani%';
  delete from public.journal_entries where memo ilike '%kimani%';   -- journal_lines cascade
  delete from public.petty_cash_requests where item ilike '%kimani%' or requester_name ilike '%kimani%';
end $$;

-- ---------- (c) the "Testing item" petty-cash row ----------
delete from public.petty_cash_requests where lower(item) like '%testing item%';

-- ---------- (d) wipe all Partnerships-CRM data (Partner registry + engagements) ----------
delete from public.eng_project_links;                 -- FK to engagements(ref), no cascade
delete from public.engagements;                       -- notes / partners-links / docs cascade
delete from public.opportunities;
delete from public.partners;
delete from public.notifications where kind like 'engagement%' or link_view = 'crm';

-- ---------- (e) inventory test items (SKU-101 "test I", SKU-102 "Test 2", etc.) ----------
do $$
declare si uuid[];   -- test stock-item ids
begin
  select array_agg(id) into si from public.stock_items
    where sku in ('SKU-101','SKU-102') or name ~* '^test\M';   -- name starts with "test"
  if si is not null then
    -- drop any open auto-requisition raised for these items
    delete from public.requisitions where ref in (
      select auto_req_ref from public.stock_items where id = any(si) and auto_req_ref is not null);
    -- the movement ledger is append-only (trigger blocks deletes) — disable it briefly
    alter table public.stock_movements disable trigger ledger_no_edit;
    delete from public.stock_movements where item_id = any(si);
    alter table public.stock_movements enable trigger ledger_no_edit;
    delete from public.stock_levels where item_id = any(si);
    delete from public.stock_items where id = any(si);
  end if;
end $$;

-- ===================================================================
-- 0056_clear_stale_activity.sql
-- ===================================================================
-- ============================================================
-- 0056 — Clear the last of the demo/test activity so the app is a true clean slate
--   * all notifications (every row is test data from the demo period — they were
--     driving the stale "recent activity" feed on Home: kimani match exception,
--     PR-209 approval, "Testing item" petty cash, TSK-213 task)
--   * PR-209 "steam repair" requisition (its PO/invoice were already removed)
--   * TSK-213 "Share excel sheet…" task
--   * reset budget-line commitments/actuals (no live transactions remain)
-- Idempotent; on a fresh rebuild these tables are empty so it is a no-op.
-- ============================================================
delete from public.notifications;
delete from public.requisitions;                 -- only PR-209 remained, a test row
delete from public.tasks;                         -- only TSK-213 remained, a test row
update public.budget_lines set committed = 0, actual = 0 where committed <> 0 or actual <> 0;

-- ===================================================================
-- 0057_admin_not_super.sql
-- ===================================================================
-- ============================================================
-- 0057 — Make "Admin" distinct from "Super Admin", and demote Brian to Admin
-- Previously the admin and super templates were identical (both users:3), so an
-- Admin was indistinguishable from a Super Admin. Admin now gets users:2 — full
-- access to every module and can invite/manage members, but is NOT a super admin
-- (no access grant/revoke drawer, not a petty-cash first approver — those need
-- users:3). Then re-point brian55mwangi@gmail.com to the Admin role.
-- Idempotent.
-- ============================================================

-- 1) admin template: users edit (2), not full (3)
update public.role_templates set level = 2 where role_key = 'admin' and module = 'users';

-- 2) Brian → Admin: set the role label and re-seed his grants from the admin
--    template (full everywhere, users:2). This drops his stray users:3 super grant.
update public.app_users set role_key = 'admin' where lower(email) = 'brian55mwangi@gmail.com';
delete from public.user_permissions where email = 'brian55mwangi@gmail.com';
insert into public.user_permissions(email, module, level)
  select 'brian55mwangi@gmail.com', module, level from public.role_templates where role_key = 'admin'
on conflict (email, module) do update set level = excluded.level;


-- ===================================================================
-- 0058_weekly_reports.sql
-- ===================================================================
-- ============================================================
-- 0058 — Weekly reports
-- Each staff member submits, from the Staff Portal, a short weekly report:
-- what they did, blockers, and next week's plan. Reports land in a new
-- "Weekly Reports" section under HR, visible to HR (hr>=1) and Super Admins
-- (users:3), who can Acknowledge them. One report per person per ISO week
-- (Monday-anchored); re-submitting the same week updates it. Idempotent.
--
-- Companion: api/weekly-reminder.js emails + bells anyone who hasn't submitted
-- for the current week (Vercel cron, Friday morning).
-- ============================================================

-- ---------- ref counter ----------
insert into public.ref_counters(kind, prefix, n) values ('WR', 'WR-00', 0) on conflict (kind) do nothing;

-- ---------- schema ----------
create table if not exists public.weekly_reports (
  id           uuid primary key default gen_random_uuid(),
  ref          text unique not null,
  entity_id    uuid references public.entities(id),
  author_id    uuid not null references public.app_users(id),
  author_name  text not null,
  week_start   date not null,                    -- Monday of the report's ISO week
  did          text not null,
  blockers     text,
  next_week    text,
  state        text not null default 'submitted', -- 'submitted' | 'acknowledged'
  reviewed_by  uuid references public.app_users(id),
  reviewed_at  timestamptz,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);
create unique index if not exists weekly_reports_author_week_uk
  on public.weekly_reports(author_id, week_start);

-- ---------- who may see every report? (HR hr>=1 OR Super Admin users:3) ----------
create or replace function public.can_view_reports() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.user_permissions p
    join public.app_users u on lower(u.email) = p.email
    where u.auth_id = auth.uid()
      and ((p.module = 'hr' and p.level >= 1) or (p.module = 'users' and p.level >= 3))
  )
$$;

-- ---------- RLS: own rows for everyone, all rows for reviewers; writes via RPC ----------
alter table public.weekly_reports enable row level security;
drop policy if exists "read own or reviewer weekly_reports" on public.weekly_reports;
create policy "read own or reviewer weekly_reports" on public.weekly_reports
  for select to authenticated
  using (
    author_id = (select id from public.app_users where auth_id = auth.uid())
    or public.can_view_reports()
  );

-- ---------- frontend read shape ----------
create or replace function public.wr_json(p_ref text) returns jsonb
language sql stable security definer set search_path = public as $$
  select jsonb_build_object(
    'id', r.ref, 'ref', r.ref,
    'author', a.name, 'authorEmail', a.email,
    'weekStart', to_char(r.week_start, 'YYYY-MM-DD'),
    'did', r.did, 'blockers', r.blockers, 'nextWeek', r.next_week,
    'state', r.state,
    'reviewedBy', rv.name, 'reviewedAt', r.reviewed_at,
    'createdAt', r.created_at)
  from public.weekly_reports r
  join public.app_users a on a.id = r.author_id
  left join public.app_users rv on rv.id = r.reviewed_by
  where r.ref = p_ref
$$;

-- ---------- submit (staff) — upsert this week's report, bell the reviewers ----------
create or replace function public.submit_weekly_report(
  p_did text, p_blockers text default null, p_next_week text default null
) returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_me uuid := (select id from public.app_users where auth_id = auth.uid());
  v_entity uuid := (select id from public.entities where code = 'KE');
  v_week date := date_trunc('week', now())::date;
  v_name text; v_email text; v_ref text; v_existing text;
begin
  if v_me is null then raise exception 'No user is linked to this login'; end if;
  if nullif(trim(coalesce(p_did, '')), '') is null then
    raise exception 'Tell us what you did this week';
  end if;
  select name, email into v_name, v_email from public.app_users where id = v_me;

  select ref into v_existing from public.weekly_reports where author_id = v_me and week_start = v_week;
  if v_existing is not null then
    update public.weekly_reports
      set did = trim(p_did),
          blockers = nullif(trim(coalesce(p_blockers, '')), ''),
          next_week = nullif(trim(coalesce(p_next_week, '')), ''),
          state = 'submitted', reviewed_by = null, reviewed_at = null, updated_at = now()
      where ref = v_existing;
    v_ref := v_existing;
  else
    v_ref := public.next_ref('WR');
    insert into public.weekly_reports(ref, entity_id, author_id, author_name, week_start, did, blockers, next_week)
    values (v_ref, v_entity, v_me, v_name, v_week, trim(p_did),
            nullif(trim(coalesce(p_blockers, '')), ''), nullif(trim(coalesce(p_next_week, '')), ''));
  end if;

  -- bell the reviewers (HR hr>=1, or Super Admin users:3)
  insert into public.notifications(entity_id, recipient_email, kind, title, body, link_view, link_ref)
  select v_entity, lower(u.email), 'weekly_report',
         v_name || ' submitted a weekly report',
         'Week of ' || to_char(v_week, 'DD Mon YYYY'), 'hr', v_ref
  from public.app_users u
  join public.user_permissions p on p.email = lower(u.email)
  where ((p.module = 'hr' and p.level >= 1) or (p.module = 'users' and p.level >= 3))
    and lower(u.email) <> lower(v_email);

  perform public.audit_write('weekly_report.submitted', 'weekly_report', v_ref,
    jsonb_build_object('week', v_week));
  return public.wr_json(v_ref);
end $$;

-- ---------- acknowledge (HR / Super Admin) ----------
create or replace function public.acknowledge_weekly_report(p_ref text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_me uuid := (select id from public.app_users where auth_id = auth.uid());
  r record;
begin
  if not public.can_view_reports() then
    raise exception 'Only HR or a Super Admin can acknowledge weekly reports';
  end if;
  select * into r from public.weekly_reports where ref = p_ref;
  if not found then raise exception 'Report not found'; end if;
  update public.weekly_reports
    set state = 'acknowledged', reviewed_by = v_me, reviewed_at = now(), updated_at = now()
    where ref = p_ref;
  perform public.audit_write('weekly_report.acknowledged', 'weekly_report', p_ref, '{}'::jsonb);
  return public.wr_json(p_ref);
end $$;

-- ---------- grants ----------
do $$
declare fn text;
begin
  foreach fn in array array[
    'can_view_reports()',
    'wr_json(text)',
    'submit_weekly_report(text,text,text)',
    'acknowledge_weekly_report(text)']
  loop
    execute format('revoke execute on function public.%s from public, anon', fn);
    execute format('grant execute on function public.%s to authenticated', fn);
  end loop;
end $$;


-- ============================================================
-- 0059 — Restrict the Admin role: hide Human Resources, view-only Compliance
-- HR holds payroll, salaries and personal records, so an Admin (Brian, Elizabeth,
-- Wilson) should not see it — only Super Admin does. Compliance was previously
-- absent from the admin template (None); Admins should be able to read it (View).
-- Updates the template and re-syncs every existing admin's live grants. Idempotent.
-- ============================================================

-- 1) admin template: HR none, Compliance view
update public.role_templates set level = 0 where role_key = 'admin' and module = 'hr';
update public.role_templates set level = 1 where role_key = 'admin' and module = 'compliance';
insert into public.role_templates(role_key, module, level)
  select 'admin', 'compliance', 1
  where not exists (select 1 from public.role_templates where role_key = 'admin' and module = 'compliance');

-- 2) re-sync existing admins' grants to the new template values
insert into public.user_permissions(email, module, level)
  select au.email, 'hr', 0 from public.app_users au where au.role_key = 'admin'
on conflict (email, module) do update set level = excluded.level;
insert into public.user_permissions(email, module, level)
  select au.email, 'compliance', 1 from public.app_users au where au.role_key = 'admin'
on conflict (email, module) do update set level = excluded.level;


-- ============================================================
-- 0060 — Petty-cash: Super Admin approves FIRST, then HR
-- Previously the two approvals (Super Admin users:3 + HR hr>=2) could happen in
-- either order. Now the order is strict: the Super Admin must sign off first, and
-- only then can HR give the second approval that releases the funds. Still two
-- different people; either may reject at any point. Idempotent (replaces the RPC).
-- ============================================================

create or replace function public.decide_petty_cash_request(p_ref text, p_approve boolean, p_note text default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_me uuid := (select id from public.app_users where auth_id = auth.uid());
  v_entity uuid := (select id from public.entities where code = 'KE');
  v_is_super boolean := public.can_petty_super();
  v_is_hr boolean := public.can_petty_hr();
  v_who text; r record;
  v_stage text;            -- 'super' | 'hr' — the stage this call fills
  v_both boolean := false; -- true once both stages are stamped
begin
  if not (v_is_super or v_is_hr) then
    raise exception 'Only a Super Admin or HR can decide petty-cash requests';
  end if;
  select * into r from public.petty_cash_requests where ref = p_ref;
  if not found then raise exception 'Request not found'; end if;
  if r.state <> 'pending' then raise exception 'This request was already decided'; end if;
  if r.requester_id = v_me then raise exception 'You cannot decide your own request'; end if;
  select name into v_who from public.app_users where id = v_me;

  -- rejection ends it immediately, whatever stage we are at
  if not p_approve then
    update public.petty_cash_requests
      set state = 'rejected', decided_by = v_me, decided_at = now(),
          decision_note = nullif(trim(coalesce(p_note, '')), ''), updated_at = now()
      where ref = p_ref;
    insert into public.notifications(entity_id, recipient_email, kind, title, body, link_view, link_ref)
    values (v_entity, lower((select email from public.app_users where id = r.requester_id)),
            'petty_cash_decided', 'Petty cash rejected',
            r.item || ' — KES ' || to_char(r.amount, 'FM999,999,990') ||
              case when p_note is not null and trim(p_note) <> '' then ' · ' || trim(p_note) else '' end,
            'staffportal', p_ref);
    perform public.audit_write('petty_cash.rejected', 'petty_cash_request', p_ref,
      jsonb_build_object('amount', r.amount, 'note', p_note));
    return public.pcr_json(p_ref);
  end if;

  -- approval, strict order: Super Admin first, then HR. The two stages must be two
  -- different people, so HR is blocked until a (different) Super Admin has signed off.
  if v_is_super and r.super_approved_by is null then
    v_stage := 'super';
  elsif v_is_hr and r.super_approved_by is null then
    raise exception 'The Super Admin must approve this request first';
  elsif v_is_hr and r.hr_approved_by is null and r.super_approved_by <> v_me then
    v_stage := 'hr';
  elsif v_is_hr and r.hr_approved_by is null and r.super_approved_by = v_me then
    raise exception 'You approved as Super Admin — a different person must give the HR sign-off';
  else
    raise exception 'Nothing left for you to approve on this request';
  end if;

  if v_stage = 'super' then
    update public.petty_cash_requests set super_approved_by = v_me, super_approved_at = now(), updated_at = now() where ref = p_ref;
    v_both := r.hr_approved_by is not null;
  else
    update public.petty_cash_requests set hr_approved_by = v_me, hr_approved_at = now(), updated_at = now() where ref = p_ref;
    v_both := r.super_approved_by is not null;
  end if;

  if v_both then
    -- second (final) approval → fully approved
    update public.petty_cash_requests
      set state = 'approved', decided_by = v_me, decided_at = now(),
          decision_note = nullif(trim(coalesce(p_note, '')), ''), updated_at = now()
      where ref = p_ref;
    insert into public.notifications(entity_id, recipient_email, kind, title, body, link_view, link_ref)
    values (v_entity, lower((select email from public.app_users where id = r.requester_id)),
            'petty_cash_decided', 'Petty cash approved',
            r.item || ' — KES ' || to_char(r.amount, 'FM999,999,990'), 'staffportal', p_ref);
    perform public.audit_write('petty_cash.approved', 'petty_cash_request', p_ref,
      jsonb_build_object('amount', r.amount));
  else
    -- first approval (Super Admin) → still pending; bell the HR approvers to sign off
    insert into public.notifications(entity_id, recipient_email, kind, title, body, link_view, link_ref)
    select v_entity, lower(u.email), 'petty_cash_request',
           'Petty cash awaiting your approval',
           r.requester_name || ' · ' || r.item || ' — KES ' || to_char(r.amount, 'FM999,999,990'), 'finance', p_ref
    from public.app_users u
    join public.user_permissions p on p.email = lower(u.email)
    where lower(u.email) <> lower(v_who)
      and p.module = 'hr' and p.level >= 2;
    perform public.audit_write('petty_cash.stage_approved', 'petty_cash_request', p_ref,
      jsonb_build_object('stage', v_stage, 'amount', r.amount));
  end if;

  return public.pcr_json(p_ref);
end $$;


-- ============================================================
-- 0061 — "Sub Admin" role, and assign jwanjiku + brian55 to it
-- Sub Admin = Admin-tier access, but ALSO sees and edits the two areas a plain
-- Admin cannot: Human Resources (edit) and Compliance & Governance (edit). Not a
-- super admin (users:2). Retires the old one-person HR/Employee toggle — HR access
-- is now this real role. Idempotent.
-- ============================================================

-- 1) (re)build the 'sub' role template: every module Full, except HR/Compliance/Users at Edit
delete from public.role_templates where role_key = 'sub';
insert into public.role_templates(role_key, module, level)
select 'sub', m.module,
       case when m.module in ('hr', 'compliance', 'users') then 2 else 3 end
from (select distinct module from public.role_templates) m;

-- 2) move the two people onto the Sub Admin role and reseed their live grants
update public.app_users
  set role_key = 'sub'
  where lower(email) in ('jwanjiku@ignis-innovation.com', 'brian55mwangi@gmail.com');

delete from public.user_permissions
  where lower(email) in ('jwanjiku@ignis-innovation.com', 'brian55mwangi@gmail.com');
insert into public.user_permissions(email, module, level)
  select lower(au.email), rt.module, rt.level
  from public.app_users au
  join public.role_templates rt on rt.role_key = 'sub'
  where lower(au.email) in ('jwanjiku@ignis-innovation.com', 'brian55mwangi@gmail.com')
on conflict (email, module) do update set level = excluded.level;


-- ============================================================
-- 0062 — Sub Admin: Human Resources at Full (not just Edit)
-- Sub Admins should also run the HR approvals — approving leave, running/approving
-- payroll and finalising exits — which are Full-level (3) actions. Compliance stays
-- Edit (2). Idempotent.
-- ============================================================

update public.role_templates set level = 3 where role_key = 'sub' and module = 'hr';

update public.user_permissions set level = 3
  where module = 'hr'
    and email in (select lower(email) from public.app_users where role_key = 'sub');


-- ============================================================
-- 0063 — Admin loses User Management (users:0)
-- A plain Admin can no longer see User Management or invite members — inviting is now
-- Super Admin (users:3) or a Sub Admin in HR mode only. Admin keeps its broad
-- operational access; HR stays hidden and Compliance stays view-only. Idempotent.
-- ============================================================

update public.role_templates set level = 0 where role_key = 'admin' and module = 'users';

update public.user_permissions set level = 0
  where module = 'users'
    and email in (select lower(email) from public.app_users where role_key = 'admin');


-- ============================================================
-- 0064 — Contracts can carry an uploaded document
-- Policies and company documents already attach a file (compliance-docs bucket). This
-- adds the same to the contracts registry: a nullable doc path, an add_contract that
-- accepts it, and bootstrap()'s contracts feed returns it so the app can render a
-- download link. bootstrap() is recreated verbatim from 0023 with only 'doc' added to
-- the contracts object (0023 is the last migration to define it). Idempotent.
-- ============================================================

alter table public.contracts add column if not exists doc text;

-- add_contract now takes p_doc (nullable). Same body as 0023 plus the doc column.
create or replace function public.add_contract(
  p_counterparty text, p_kind text, p_title text, p_detail text, p_expires_on date,
  p_doc text default null
) returns jsonb language plpgsql security definer set search_path = public as $$
declare v_entity uuid := (select id from public.entities where code = 'KE');
begin
  perform public.assert_access('compliance', 2);
  if p_kind not in ('vendor','funder','customer','partner') then
    raise exception 'Contract kind must be vendor, funder, customer or partner';
  end if;
  insert into public.contracts(entity_id, counterparty, kind, title, detail, expires_on,
                               doc, vendor_id, state)
  values (v_entity, p_counterparty, p_kind, p_title, nullif(p_detail,''), p_expires_on,
          p_doc, (select id from public.vendors where name = p_counterparty), 'active')
  on conflict (counterparty, title) do update set
    detail = coalesce(excluded.detail, public.contracts.detail),
    expires_on = excluded.expires_on,
    doc = coalesce(excluded.doc, public.contracts.doc),
    updated_at = now();
  perform public.audit_write('contract.added', 'contract', p_title,
    jsonb_build_object('counterparty', p_counterparty, 'kind', p_kind, 'expiresOn', p_expires_on));
  return jsonb_build_object('counterparty', p_counterparty, 'title', p_title);
end $$;

-- grant the new add_contract signature to authenticated (mirror 0023)
do $$
begin
  execute 'revoke execute on function public.add_contract(text,text,text,text,date,text) from public, anon';
  execute 'grant execute on function public.add_contract(text,text,text,text,date,text) to authenticated';
end $$;

-- bootstrap(): recreated verbatim from 0023, with 'doc', doc added to the contracts object
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
    'projects', coalesce((select jsonb_object_agg(name, public.project_detail_json(id))
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
      from public.budget_lines), '{}'::jsonb),
    'inventory', jsonb_build_object(
      'items', coalesce((select jsonb_agg(jsonb_build_object(
          'sku', i.sku, 'name', i.name, 'category', i.category, 'unit', i.unit,
          'unitCost', i.unit_cost, 'reorderLevel', i.reorder_level,
          'onHand', coalesce((select sum(qty) from public.stock_levels where item_id = i.id), 0),
          'autoReq', i.auto_req_ref) order by i.sku)
        from public.stock_items i where i.state = 'active'), '[]'::jsonb),
      'locations', coalesce((select jsonb_agg(name order by name) from public.stock_locations where state='active'), '[]'::jsonb),
      'movements', coalesce((select jsonb_agg(jsonb_build_object(
          'when', to_char(m.created_at, 'DD Mon HH24:MI'), 'sku', i.sku, 'type', m.movement_type,
          'qty', m.qty, 'from', fl.name, 'to', tl.name, 'source', m.source_ref, 'note', m.note) order by m.created_at desc)
        from (select * from public.stock_movements order by created_at desc limit 40) m
        join public.stock_items i on i.id = m.item_id
        left join public.stock_locations fl on fl.id = m.from_location
        left join public.stock_locations tl on tl.id = m.to_location), '[]'::jsonb),
      'dispatches', coalesce((select jsonb_agg(jsonb_build_object(
          'id', ref, 'project', project_name, 'destination', destination, 'lines', lines, 'state', state)
          order by created_at desc)
        from public.dispatches), '[]'::jsonb),
      'assets', coalesce((select jsonb_agg(jsonb_build_object(
          'id', ref, 'name', name, 'category', category, 'cost', cost, 'accumDep', accum_dep,
          'nbv', cost - accum_dep, 'acquired', to_char(acquired_on, 'Mon YYYY'), 'state', state)
          order by ref)
        from public.assets), '[]'::jsonb)),
    -- ---- CRM forms data ----
    'engagements', jsonb_build_object(
      'up', coalesce((select jsonb_agg(jsonb_build_object(
          'id', ref, 'n', name, 'st', stage, 'o', owner_name, 'pl', pill, 'plt', pill_txt)
          order by created_at desc)
        from public.engagements where pipeline = 'up' and state = 'active'), '[]'::jsonb),
      'down', coalesce((select jsonb_agg(jsonb_build_object(
          'id', ref, 'n', name, 'st', stage, 'o', owner_name, 'pl', pill, 'plt', pill_txt)
          order by created_at desc)
        from public.engagements where pipeline = 'down' and state = 'active'), '[]'::jsonb)),
    'partners', coalesce((select jsonb_agg(jsonb_build_object(
        'id', id, 'name', name, 'type', type, 'country', country,
        'ownerName', owner_name, 'status', status, 'statusCls', status_cls)
        order by created_at desc)
      from public.partners where state = 'active'), '[]'::jsonb),
    'opportunities', coalesce((select jsonb_agg(jsonb_build_object(
        'id', id, 'name', name, 'type', type, 'deadline', deadline,
        'linkedTo', linked_to, 'status', status, 'statusCls', status_cls)
        order by created_at desc)
      from public.opportunities where state = 'active'), '[]'::jsonb),
    'crmDropdowns', coalesce((select jsonb_object_agg(cat, vals) from (
        select category as cat, jsonb_agg(value order by sort) as vals
        from public.crm_dropdown_options where active group by category) q), '{}'::jsonb),
    'teamNames', coalesce((select jsonb_agg(name order by name) from public.app_users where state = 'active'), '[]'::jsonb),
    -- ---- Compliance & Governance ----
    'compliance', jsonb_build_object(
      'policies', coalesce((select jsonb_agg(jsonb_build_object(
          'code', code, 'title', title, 'version', 'v' || version, 'effectiveFrom', effective_from,
          'doc', doc, 'state', state,
          'statusCls', case
            when state = 'superseded' then 'week'
            when state = 'draft' then 'today'
            when effective_from is not null and effective_from < (now() - interval '1 year')::date then 'today'
            else 'done' end,
          'statusTxt', case
            when state = 'superseded' then 'Superseded'
            when state = 'draft' then 'Draft'
            when effective_from is not null and effective_from < (now() - interval '1 year')::date then 'Review due'
            else 'Current' end)
          order by code)
        from public.policies where state <> 'superseded'), '[]'::jsonb),
      'companyDocuments', coalesce((select jsonb_agg(jsonb_build_object(
          'name', name, 'kind', kind, 'doc', doc,
          'expiry', case when expires_on is null then '—' else to_char(expires_on, 'DD Mon YYYY') end,
          'statusCls', case
            when expires_on is null then 'done'
            when expires_on < now()::date then 'over'
            when expires_on < (now() + interval '60 days')::date then 'today'
            when expires_on < (now() + interval '6 months')::date then 'week'
            else 'done' end,
          'statusTxt', case
            when expires_on is null then 'On file'
            when expires_on < now()::date then 'Expired'
            when expires_on < (now() + interval '60 days')::date then 'Renew soon'
            when expires_on < (now() + interval '6 months')::date then 'Upcoming'
            else 'Valid' end)
          order by expires_on nulls first, name)
        from public.company_documents where state = 'active'), '[]'::jsonb),
      'obligations', coalesce((select jsonb_agg(jsonb_build_object(
          'obligation', obligation, 'authority', authority, 'dueRule', due_rule,
          'nextDue', next_due, 'when', to_char(next_due, 'DD Mon'), 'state', state, 'ownerModule', owner_module,
          'statusCls', case
            when state = 'overdue' or next_due < now()::date then 'over'
            when next_due < (now() + interval '10 days')::date then 'today'
            else 'week' end,
          'statusTxt', case
            when state = 'overdue' or next_due < now()::date then 'Overdue'
            when next_due < (now() + interval '10 days')::date then 'Due soon'
            when next_due < (date_trunc('month', now()) + interval '1 month')::date then 'This month'
            else 'Upcoming' end)
          order by next_due)
        from public.compliance_obligations), '[]'::jsonb),
      'risks', coalesce((select jsonb_agg(jsonb_build_object(
          'ref', ref, 'risk', risk, 'category', category, 'owner', owner_name,
          'likelihood', likelihood, 'impact', impact, 'score', likelihood * impact,
          'mitigation', mitigation, 'state', state,
          'statusCls', case when likelihood * impact >= 12 then 'over'
                            when likelihood * impact >= 6 then 'today' else 'week' end,
          'statusTxt', case when likelihood * impact >= 12 then 'High'
                            when likelihood * impact >= 6 then 'Medium' else 'Low' end)
          order by likelihood * impact desc, ref)
        from public.risks where state <> 'closed'), '[]'::jsonb),
      'contracts', coalesce((select jsonb_agg(jsonb_build_object(
          'counterparty', counterparty, 'kind', kind, 'title', title, 'detail', detail,
          'expiry', case when expires_on is null then '—' else to_char(expires_on, 'DD Mon YYYY') end,
          'state', state, 'doc', doc,
          'statusCls', case state when 'active' then 'done' when 'renew_soon' then 'today'
                                  when 'expired' then 'over' else 'week' end,
          'statusTxt', case state when 'active' then 'Active' when 'renew_soon' then 'Renew soon'
                                  when 'expired' then 'Expired' else 'Terminated' end)
          order by expires_on nulls last, counterparty)
        from public.contracts where state <> 'terminated'), '[]'::jsonb))
  );
end $$;


-- ============================================================
-- 0065 — Proforma invoices (Order-to-cash: the offer before the sale)
-- A proforma is a priced quote to a customer. It posts nothing to the ledger and
-- carries no VAT liability until the customer ACCEPTS it — acceptance converts it into
-- a real tax invoice (reusing submit_sales_invoice, so eTIMS + GL fire exactly as for
-- any sales invoice). Proformas can also be declined (reason kept for conversion
-- analysis) or expire on their own past the valid-to date. Idempotent.
-- ============================================================

-- ---------- tables ----------
create table if not exists public.proformas (
  id             uuid primary key default gen_random_uuid(),
  ref            text not null unique,
  entity_id      uuid references public.entities(id),
  customer       text not null,
  org_id         text,                                   -- CRM partner id when picked (free text otherwise)
  owner_name     text,                                   -- "raised by" (display)
  issued_on      date not null default current_date,
  valid_to       date,
  terms          text,
  lead_time      text,
  notes          text,
  currency       text not null default 'KES',
  state          text not null default 'issued' check (state in ('issued','accepted','declined','expired')),
  decline_reason text,
  invoice_ref    text references public.sales_invoices(ref),
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);

create table if not exists public.proforma_lines (
  id           uuid primary key default gen_random_uuid(),
  proforma_id  uuid not null references public.proformas(id) on delete cascade,
  description  text not null,
  qty          numeric not null default 1 check (qty > 0),
  unit_price   numeric not null default 0 check (unit_price >= 0),
  sort         int not null default 0
);
create index if not exists proforma_lines_proforma_idx on public.proforma_lines(proforma_id);

-- RLS: read for signed-in users; writes only through the definer RPCs below
alter table public.proformas       enable row level security;
alter table public.proforma_lines  enable row level security;
do $$
begin
  drop policy if exists "proformas read"      on public.proformas;
  drop policy if exists "proforma_lines read" on public.proforma_lines;
  create policy "proformas read"      on public.proformas      for select to authenticated using (true);
  create policy "proforma_lines read" on public.proforma_lines for select to authenticated using (true);
end $$;

-- PF ref counter → PF-0042, PF-0043, … (matches SI-style formatting)
insert into public.ref_counters(kind, prefix, n) values ('PF', 'PF-00', 41)
  on conflict (kind) do nothing;

-- ---------- create_proforma: register the offer (no ledger impact) ----------
create or replace function public.create_proforma(
  p_customer text, p_org_id text, p_owner text, p_valid_to date,
  p_terms text, p_lead text, p_notes text, p_lines jsonb
) returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_entity uuid := (select id from public.entities where code = 'KE');
  v_ref text; v_id uuid; ln jsonb; i int := 0; v_lines int := 0;
begin
  perform public.assert_access('finance', 2);
  if coalesce(trim(p_customer), '') = '' then raise exception 'A proforma needs a customer'; end if;
  v_ref := public.next_ref('PF');
  insert into public.proformas(ref, entity_id, customer, org_id, owner_name, valid_to,
                               terms, lead_time, notes)
  values (v_ref, v_entity, p_customer, nullif(p_org_id,''), nullif(p_owner,''), p_valid_to,
          nullif(p_terms,''), nullif(p_lead,''), nullif(p_notes,''))
  returning id into v_id;
  for ln in select * from jsonb_array_elements(coalesce(p_lines, '[]'::jsonb)) loop
    if coalesce(trim(ln->>'d'), '') <> '' then
      insert into public.proforma_lines(proforma_id, description, qty, unit_price, sort)
      values (v_id, ln->>'d', greatest(coalesce((ln->>'q')::numeric, 1), 1),
              coalesce((ln->>'p')::numeric, 0), i);
      v_lines := v_lines + 1;
    end if;
    i := i + 1;
  end loop;
  if v_lines = 0 then raise exception 'A proforma needs at least one line item'; end if;
  perform public.audit_write('proforma.created', 'proforma', v_ref,
    jsonb_build_object('customer', p_customer, 'lines', v_lines));
  return jsonb_build_object('ref', v_ref);
end $$;

-- ---------- accept_proforma: convert the offer into a real tax invoice ----------
create or replace function public.accept_proforma(p_ref text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare p record; v_sub numeric; v_inv jsonb; v_si text;
begin
  perform public.assert_access('finance', 2);
  select * into p from public.proformas where ref = p_ref;
  if not found then raise exception 'Unknown proforma: %', p_ref; end if;
  if p.state <> 'issued' then raise exception 'Only an issued proforma can be accepted (this one is %)', p.state; end if;
  select coalesce(sum(qty * unit_price), 0) into v_sub from public.proforma_lines where proforma_id = p.id;
  if v_sub <= 0 then raise exception 'Proforma % has no priced lines to invoice', p_ref; end if;
  -- reuse the sales-invoice path: files eTIMS + posts the balanced journal
  v_inv := public.submit_sales_invoice(p.customer, 'Proforma ' || p_ref || ' accepted', v_sub, 'week30');
  v_si := v_inv->>'id';
  update public.proformas set state = 'accepted', invoice_ref = v_si, updated_at = now() where id = p.id;
  perform public.audit_write('proforma.accepted', 'proforma', p_ref,
    jsonb_build_object('invoice', v_si, 'net', v_sub));
  return jsonb_build_object('ref', p_ref, 'invoice', v_si);
end $$;

-- ---------- decline_proforma: record the loss + reason (no ledger impact) ----------
create or replace function public.decline_proforma(p_ref text, p_reason text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare p record;
begin
  perform public.assert_access('finance', 2);
  select * into p from public.proformas where ref = p_ref;
  if not found then raise exception 'Unknown proforma: %', p_ref; end if;
  if p.state <> 'issued' then raise exception 'Only an issued proforma can be declined (this one is %)', p.state; end if;
  update public.proformas set state = 'declined',
    decline_reason = nullif(trim(p_reason), ''), updated_at = now() where id = p.id;
  perform public.audit_write('proforma.declined', 'proforma', p_ref,
    jsonb_build_object('reason', p_reason));
  return jsonb_build_object('ref', p_ref);
end $$;

-- grants: create RPCs are authenticated-only
do $$
declare fn text;
begin
  foreach fn in array array[
    'create_proforma(text,text,text,date,text,text,text,jsonb)',
    'accept_proforma(text)',
    'decline_proforma(text,text)']
  loop
    execute format('revoke execute on function public.%s from public, anon', fn);
    execute format('grant execute on function public.%s to authenticated', fn);
  end loop;
end $$;

-- ============================================================
-- bootstrap(): recreated verbatim from 0064, adding the 'proformas' feed.
-- (0064 is the previous definition; only the proformas key is new.)
-- ============================================================
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
    'proformas', coalesce((select jsonb_agg(jsonb_build_object(
        'ref', ref, 'customer', customer, 'orgId', org_id, 'owner', owner_name,
        'issued', to_char(issued_on, 'DD Mon YYYY'),
        'validTo', case when valid_to is null then '—' else to_char(valid_to, 'DD Mon YYYY') end,
        'validRaw', valid_to, 'terms', terms, 'lead', lead_time, 'notes', notes,
        'currency', currency, 'state', state, 'declineReason', decline_reason, 'invoiceRef', invoice_ref,
        'lines', coalesce((select jsonb_agg(jsonb_build_object('d', description, 'q', qty, 'p', unit_price) order by sort)
                  from public.proforma_lines where proforma_id = pf.id), '[]'::jsonb),
        'subtotal', coalesce((select sum(qty * unit_price) from public.proforma_lines where proforma_id = pf.id), 0),
        -- display status: an issued proforma past its valid-to reads as lapsed
        'statusCls', case
            when state = 'accepted' then 'done'
            when state = 'declined' then 'over'
            when state = 'expired' then 'week'
            when valid_to is not null and valid_to < current_date then 'week'
            else 'today' end,
        'statusTxt', case
            when state = 'accepted' then 'Accepted'
            when state = 'declined' then 'Declined'
            when state = 'expired' then 'Expired'
            when valid_to is not null and valid_to < current_date then 'Lapsed'
            else 'Awaiting' end)
        order by created_at desc)
      from public.proformas pf), '[]'::jsonb),
    'perms', coalesce((select jsonb_object_agg(email, mods) from (
        select email, jsonb_object_agg(module, level) as mods
        from public.user_permissions group by email) q), '{}'::jsonb),
    'projects', coalesce((select jsonb_object_agg(name, public.project_detail_json(id))
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
      from public.budget_lines), '{}'::jsonb),
    'inventory', jsonb_build_object(
      'items', coalesce((select jsonb_agg(jsonb_build_object(
          'sku', i.sku, 'name', i.name, 'category', i.category, 'unit', i.unit,
          'unitCost', i.unit_cost, 'reorderLevel', i.reorder_level,
          'onHand', coalesce((select sum(qty) from public.stock_levels where item_id = i.id), 0),
          'autoReq', i.auto_req_ref) order by i.sku)
        from public.stock_items i where i.state = 'active'), '[]'::jsonb),
      'locations', coalesce((select jsonb_agg(name order by name) from public.stock_locations where state='active'), '[]'::jsonb),
      'movements', coalesce((select jsonb_agg(jsonb_build_object(
          'when', to_char(m.created_at, 'DD Mon HH24:MI'), 'sku', i.sku, 'type', m.movement_type,
          'qty', m.qty, 'from', fl.name, 'to', tl.name, 'source', m.source_ref, 'note', m.note) order by m.created_at desc)
        from (select * from public.stock_movements order by created_at desc limit 40) m
        join public.stock_items i on i.id = m.item_id
        left join public.stock_locations fl on fl.id = m.from_location
        left join public.stock_locations tl on tl.id = m.to_location), '[]'::jsonb),
      'dispatches', coalesce((select jsonb_agg(jsonb_build_object(
          'id', ref, 'project', project_name, 'destination', destination, 'lines', lines, 'state', state)
          order by created_at desc)
        from public.dispatches), '[]'::jsonb),
      'assets', coalesce((select jsonb_agg(jsonb_build_object(
          'id', ref, 'name', name, 'category', category, 'cost', cost, 'accumDep', accum_dep,
          'nbv', cost - accum_dep, 'acquired', to_char(acquired_on, 'Mon YYYY'), 'state', state)
          order by ref)
        from public.assets), '[]'::jsonb)),
    -- ---- CRM forms data ----
    'engagements', jsonb_build_object(
      'up', coalesce((select jsonb_agg(jsonb_build_object(
          'id', ref, 'n', name, 'st', stage, 'o', owner_name, 'pl', pill, 'plt', pill_txt)
          order by created_at desc)
        from public.engagements where pipeline = 'up' and state = 'active'), '[]'::jsonb),
      'down', coalesce((select jsonb_agg(jsonb_build_object(
          'id', ref, 'n', name, 'st', stage, 'o', owner_name, 'pl', pill, 'plt', pill_txt)
          order by created_at desc)
        from public.engagements where pipeline = 'down' and state = 'active'), '[]'::jsonb)),
    'partners', coalesce((select jsonb_agg(jsonb_build_object(
        'id', id, 'name', name, 'type', type, 'country', country,
        'ownerName', owner_name, 'status', status, 'statusCls', status_cls)
        order by created_at desc)
      from public.partners where state = 'active'), '[]'::jsonb),
    'opportunities', coalesce((select jsonb_agg(jsonb_build_object(
        'id', id, 'name', name, 'type', type, 'deadline', deadline,
        'linkedTo', linked_to, 'status', status, 'statusCls', status_cls)
        order by created_at desc)
      from public.opportunities where state = 'active'), '[]'::jsonb),
    'crmDropdowns', coalesce((select jsonb_object_agg(cat, vals) from (
        select category as cat, jsonb_agg(value order by sort) as vals
        from public.crm_dropdown_options where active group by category) q), '{}'::jsonb),
    'teamNames', coalesce((select jsonb_agg(name order by name) from public.app_users where state = 'active'), '[]'::jsonb),
    -- ---- Compliance & Governance ----
    'compliance', jsonb_build_object(
      'policies', coalesce((select jsonb_agg(jsonb_build_object(
          'code', code, 'title', title, 'version', 'v' || version, 'effectiveFrom', effective_from,
          'doc', doc, 'state', state,
          'statusCls', case
            when state = 'superseded' then 'week'
            when state = 'draft' then 'today'
            when effective_from is not null and effective_from < (now() - interval '1 year')::date then 'today'
            else 'done' end,
          'statusTxt', case
            when state = 'superseded' then 'Superseded'
            when state = 'draft' then 'Draft'
            when effective_from is not null and effective_from < (now() - interval '1 year')::date then 'Review due'
            else 'Current' end)
          order by code)
        from public.policies where state <> 'superseded'), '[]'::jsonb),
      'companyDocuments', coalesce((select jsonb_agg(jsonb_build_object(
          'name', name, 'kind', kind, 'doc', doc,
          'expiry', case when expires_on is null then '—' else to_char(expires_on, 'DD Mon YYYY') end,
          'statusCls', case
            when expires_on is null then 'done'
            when expires_on < now()::date then 'over'
            when expires_on < (now() + interval '60 days')::date then 'today'
            when expires_on < (now() + interval '6 months')::date then 'week'
            else 'done' end,
          'statusTxt', case
            when expires_on is null then 'On file'
            when expires_on < now()::date then 'Expired'
            when expires_on < (now() + interval '60 days')::date then 'Renew soon'
            when expires_on < (now() + interval '6 months')::date then 'Upcoming'
            else 'Valid' end)
          order by expires_on nulls first, name)
        from public.company_documents where state = 'active'), '[]'::jsonb),
      'obligations', coalesce((select jsonb_agg(jsonb_build_object(
          'obligation', obligation, 'authority', authority, 'dueRule', due_rule,
          'nextDue', next_due, 'when', to_char(next_due, 'DD Mon'), 'state', state, 'ownerModule', owner_module,
          'statusCls', case
            when state = 'overdue' or next_due < now()::date then 'over'
            when next_due < (now() + interval '10 days')::date then 'today'
            else 'week' end,
          'statusTxt', case
            when state = 'overdue' or next_due < now()::date then 'Overdue'
            when next_due < (now() + interval '10 days')::date then 'Due soon'
            when next_due < (date_trunc('month', now()) + interval '1 month')::date then 'This month'
            else 'Upcoming' end)
          order by next_due)
        from public.compliance_obligations), '[]'::jsonb),
      'risks', coalesce((select jsonb_agg(jsonb_build_object(
          'ref', ref, 'risk', risk, 'category', category, 'owner', owner_name,
          'likelihood', likelihood, 'impact', impact, 'score', likelihood * impact,
          'mitigation', mitigation, 'state', state,
          'statusCls', case when likelihood * impact >= 12 then 'over'
                            when likelihood * impact >= 6 then 'today' else 'week' end,
          'statusTxt', case when likelihood * impact >= 12 then 'High'
                            when likelihood * impact >= 6 then 'Medium' else 'Low' end)
          order by likelihood * impact desc, ref)
        from public.risks where state <> 'closed'), '[]'::jsonb),
      'contracts', coalesce((select jsonb_agg(jsonb_build_object(
          'counterparty', counterparty, 'kind', kind, 'title', title, 'detail', detail,
          'expiry', case when expires_on is null then '—' else to_char(expires_on, 'DD Mon YYYY') end,
          'state', state, 'doc', doc,
          'statusCls', case state when 'active' then 'done' when 'renew_soon' then 'today'
                                  when 'expired' then 'over' else 'week' end,
          'statusTxt', case state when 'active' then 'Active' when 'renew_soon' then 'Renew soon'
                                  when 'expired' then 'Expired' else 'Terminated' end)
          order by expires_on nulls last, counterparty)
        from public.contracts where state <> 'terminated'), '[]'::jsonb))
  );
end $$;


-- ============================================================
-- 0066 — Petty-cash: single approval, routed by who raised it
-- Replaces the two-stage (Super Admin THEN HR) flow with one approval whose approver
-- depends on the requester:
--   * a regular employee's request  → HR approves it
--   * HR's own request (hr>=2)       → a Super Admin approves it
--   * a Super Admin's own request    → auto-approved on submit (no second person)
-- The route is stamped on the row (approver_role) at submit time, and only the matching
-- role can decide it. Notifications go to the routed approver only (not both roles).
-- Reuses can_petty_super()/can_petty_hr() (0053). Idempotent.
-- ============================================================

alter table public.petty_cash_requests add column if not exists approver_role text;  -- 'hr' | 'super' | 'auto'

-- read shape now also carries the route
create or replace function public.pcr_json(p_ref text) returns jsonb
language sql stable security definer set search_path = public as $$
  select jsonb_build_object(
    'id', r.ref, 'item', r.item, 'amount', r.amount,
    'needBy', to_char(r.need_by, 'YYYY-MM-DD'), 'reason', r.reason, 'state', r.state,
    'requester', rq.name, 'requesterEmail', rq.email, 'approverRole', r.approver_role,
    'superApprovedBy', su.name, 'superApprovedAt', r.super_approved_at,
    'hrApprovedBy', hr.name, 'hrApprovedAt', r.hr_approved_at,
    'decidedBy', dc.name, 'decidedAt', r.decided_at, 'note', r.decision_note,
    'createdAt', r.created_at)
  from public.petty_cash_requests r
  left join public.app_users rq on rq.id = r.requester_id
  left join public.app_users su on su.id = r.super_approved_by
  left join public.app_users hr on hr.id = r.hr_approved_by
  left join public.app_users dc on dc.id = r.decided_by
  where r.ref = p_ref
$$;

-- ---------- submit (staff): route by the requester's own role ----------
create or replace function public.submit_petty_cash_request(
  p_item text, p_amount numeric, p_need_by date default null, p_reason text default null
) returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_ref text;
  v_entity uuid := (select id from public.entities where code = 'KE');
  v_me uuid := (select id from public.app_users where auth_id = auth.uid());
  v_name text; v_email text;
  v_is_super boolean; v_is_hr boolean;
  v_role text; v_mod text; v_lvl int; v_emails jsonb;
begin
  if v_me is null then raise exception 'No user is linked to this login'; end if;
  if nullif(trim(coalesce(p_item, '')), '') is null then raise exception 'What is the money for? An item is required'; end if;
  if coalesce(p_amount, 0) <= 0 then raise exception 'Enter an amount greater than zero'; end if;
  select name, email into v_name, v_email from public.app_users where id = v_me;

  -- the requester's OWN role decides where this goes
  v_is_super := exists (select 1 from public.user_permissions p where p.email = lower(v_email) and p.module = 'users' and p.level >= 3);
  v_is_hr    := exists (select 1 from public.user_permissions p where p.email = lower(v_email) and p.module = 'hr'    and p.level >= 2);

  v_ref := public.next_ref('PCR');

  -- a Super Admin's own petty cash is auto-approved on submit (they can't need a second person)
  if v_is_super then
    insert into public.petty_cash_requests(ref, entity_id, requester_id, requester_name, item, amount, need_by, reason,
                                            approver_role, state, decided_by, decided_at, decision_note)
    values (v_ref, v_entity, v_me, v_name, trim(p_item), p_amount, p_need_by, nullif(trim(coalesce(p_reason, '')), ''),
            'auto', 'approved', v_me, now(), 'Auto-approved — raised by a Super Admin');
    perform public.audit_write('petty_cash.requested', 'petty_cash_request', v_ref,
      jsonb_build_object('item', p_item, 'amount', p_amount, 'autoApproved', true));
    perform public.audit_write('petty_cash.approved', 'petty_cash_request', v_ref,
      jsonb_build_object('amount', p_amount, 'auto', true));
    return public.pcr_json(v_ref) || jsonb_build_object('autoApproved', true, 'approverRole', 'auto', 'approverEmails', '[]'::jsonb);
  end if;

  v_role := case when v_is_hr then 'super' else 'hr' end;   -- HR's own → Super Admin; everyone else → HR
  v_mod  := case when v_role = 'super' then 'users' else 'hr' end;
  v_lvl  := case when v_role = 'super' then 3 else 2 end;

  insert into public.petty_cash_requests(ref, entity_id, requester_id, requester_name, item, amount, need_by, reason, approver_role)
  values (v_ref, v_entity, v_me, v_name, trim(p_item), p_amount, p_need_by, nullif(trim(coalesce(p_reason, '')), ''), v_role);

  -- bell the routed approver(s) only, and collect their emails for the app to send
  insert into public.notifications(entity_id, recipient_email, kind, title, body, link_view, link_ref)
  select v_entity, lower(u.email), 'petty_cash_request',
         v_name || ' requested petty cash',
         trim(p_item) || ' — KES ' || to_char(p_amount, 'FM999,999,990'), 'finance', v_ref
  from public.app_users u
  join public.user_permissions p on p.email = lower(u.email)
  where p.module = v_mod and p.level >= v_lvl and lower(u.email) <> lower(v_email);

  select coalesce(jsonb_agg(distinct lower(u.email)), '[]'::jsonb) into v_emails
  from public.app_users u
  join public.user_permissions p on p.email = lower(u.email)
  where p.module = v_mod and p.level >= v_lvl and lower(u.email) <> lower(v_email);

  perform public.audit_write('petty_cash.requested', 'petty_cash_request', v_ref,
    jsonb_build_object('item', p_item, 'amount', p_amount, 'route', v_role));
  return public.pcr_json(v_ref) || jsonb_build_object('approverRole', v_role, 'approverEmails', v_emails);
end $$;

-- ---------- decide (single approval by the routed role) ----------
create or replace function public.decide_petty_cash_request(p_ref text, p_approve boolean, p_note text default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_me uuid := (select id from public.app_users where auth_id = auth.uid());
  v_entity uuid := (select id from public.entities where code = 'KE');
  v_is_super boolean := public.can_petty_super();
  v_is_hr boolean := public.can_petty_hr();
  r record; v_ok boolean;
begin
  if not (v_is_super or v_is_hr) then
    raise exception 'Only a Super Admin or HR can decide petty-cash requests';
  end if;
  select * into r from public.petty_cash_requests where ref = p_ref;
  if not found then raise exception 'Request not found'; end if;
  if r.state <> 'pending' then raise exception 'This request was already decided'; end if;
  if r.requester_id = v_me then raise exception 'You cannot decide your own request'; end if;

  -- the caller must hold the role this request was routed to
  v_ok := case
    when r.approver_role = 'super' then v_is_super
    when r.approver_role = 'hr' then v_is_hr
    else (v_is_super or v_is_hr)   -- legacy rows with no stamped route
  end;
  if not v_ok then
    raise exception '%', case when r.approver_role = 'super'
      then 'This request is awaiting Super Admin approval'
      else 'This request is awaiting HR approval' end;
  end if;

  update public.petty_cash_requests
    set state = case when p_approve then 'approved' else 'rejected' end,
        decided_by = v_me, decided_at = now(),
        decision_note = nullif(trim(coalesce(p_note, '')), ''), updated_at = now()
    where ref = p_ref;

  -- tell the requester (bell); the app also emails them
  insert into public.notifications(entity_id, recipient_email, kind, title, body, link_view, link_ref)
  values (v_entity, lower((select email from public.app_users where id = r.requester_id)),
          'petty_cash_decided',
          case when p_approve then 'Petty cash approved' else 'Petty cash rejected' end,
          r.item || ' — KES ' || to_char(r.amount, 'FM999,999,990') ||
            case when p_note is not null and trim(p_note) <> '' then ' · ' || trim(p_note) else '' end,
          'staffportal', p_ref);
  perform public.audit_write(case when p_approve then 'petty_cash.approved' else 'petty_cash.rejected' end,
    'petty_cash_request', p_ref, jsonb_build_object('amount', r.amount, 'note', p_note));

  return public.pcr_json(p_ref);
end $$;

-- backfill any existing pending rows with their route (requester with hr>=2 → super, else hr)
update public.petty_cash_requests t set approver_role = case
  when exists (select 1 from public.app_users u join public.user_permissions p on p.email = lower(u.email)
               where u.id = t.requester_id and p.module = 'hr' and p.level >= 2) then 'super'
  else 'hr' end
where t.state = 'pending' and t.approver_role is null;


-- ============================================================
-- 0067 — Petty-cash: attach an invoice/receipt to an approved request
-- Once a request is approved, the requester OR a petty-cash approver (Super Admin
-- users:3 / HR hr>=2 — the Sub Admin holds HR-full) may attach an invoice from the
-- shared 'uploads' bucket. Whoever acts first attaches it; either may remove it and
-- re-attach. The stored value is the object path in the 'uploads' bucket (public).
-- Extends the read shape from 0066 with 'invoicePath'. Idempotent.
-- ============================================================

alter table public.petty_cash_requests add column if not exists invoice_path text;

-- read shape now also carries the attached invoice path (mirrors 0066 + invoicePath)
create or replace function public.pcr_json(p_ref text) returns jsonb
language sql stable security definer set search_path = public as $$
  select jsonb_build_object(
    'id', r.ref, 'item', r.item, 'amount', r.amount,
    'needBy', to_char(r.need_by, 'YYYY-MM-DD'), 'reason', r.reason, 'state', r.state,
    'requester', rq.name, 'requesterEmail', rq.email, 'approverRole', r.approver_role,
    'superApprovedBy', su.name, 'superApprovedAt', r.super_approved_at,
    'hrApprovedBy', hr.name, 'hrApprovedAt', r.hr_approved_at,
    'decidedBy', dc.name, 'decidedAt', r.decided_at, 'note', r.decision_note,
    'invoicePath', r.invoice_path,
    'createdAt', r.created_at)
  from public.petty_cash_requests r
  left join public.app_users rq on rq.id = r.requester_id
  left join public.app_users su on su.id = r.super_approved_by
  left join public.app_users hr on hr.id = r.hr_approved_by
  left join public.app_users dc on dc.id = r.decided_by
  where r.ref = p_ref
$$;

-- ---------- attach an invoice (requester or a petty-cash approver) ----------
create or replace function public.attach_petty_cash_invoice(p_ref text, p_path text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_me uuid := (select id from public.app_users where auth_id = auth.uid());
  r record;
begin
  if v_me is null then raise exception 'No user is linked to this login'; end if;
  if nullif(trim(coalesce(p_path, '')), '') is null then raise exception 'No file was provided'; end if;
  select * into r from public.petty_cash_requests where ref = p_ref;
  if not found then raise exception 'Request not found'; end if;
  if not (r.requester_id = v_me or public.can_petty_super() or public.can_petty_hr()) then
    raise exception 'Only the requester or a petty-cash approver can attach an invoice';
  end if;
  if r.state <> 'approved' then
    raise exception 'You can only attach an invoice to an approved request';
  end if;
  update public.petty_cash_requests set invoice_path = p_path, updated_at = now() where ref = p_ref;
  perform public.audit_write('petty_cash.invoice_attached', 'petty_cash_request', p_ref,
    jsonb_build_object('path', p_path));
  return public.pcr_json(p_ref);
end $$;

-- ---------- remove the attached invoice (same permission set) ----------
create or replace function public.remove_petty_cash_invoice(p_ref text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_me uuid := (select id from public.app_users where auth_id = auth.uid());
  r record;
begin
  if v_me is null then raise exception 'No user is linked to this login'; end if;
  select * into r from public.petty_cash_requests where ref = p_ref;
  if not found then raise exception 'Request not found'; end if;
  if not (r.requester_id = v_me or public.can_petty_super() or public.can_petty_hr()) then
    raise exception 'Only the requester or a petty-cash approver can remove an invoice';
  end if;
  update public.petty_cash_requests set invoice_path = null, updated_at = now() where ref = p_ref;
  perform public.audit_write('petty_cash.invoice_removed', 'petty_cash_request', p_ref, '{}'::jsonb);
  return public.pcr_json(p_ref);
end $$;

-- ---------- grants ----------
do $$
declare fn text;
begin
  foreach fn in array array[
    'pcr_json(text)',
    'attach_petty_cash_invoice(text,text)',
    'remove_petty_cash_invoice(text)']
  loop
    execute format('revoke execute on function public.%s from public, anon', fn);
    execute format('grant execute on function public.%s to authenticated', fn);
  end loop;
end $$;


-- ============================================================
-- 0068 — Weekly reports: optional file attachment
-- A staff member may attach one file (any format) to their weekly report from the
-- shared 'uploads' bucket. The path is carried on the row and returned by wr_json.
-- submit_weekly_report gains a 4th arg (p_attachment); re-submitting replaces the
-- report and its attachment (pass null to clear). Extends 0058. Idempotent.
-- ============================================================

alter table public.weekly_reports add column if not exists attachment_path text;

-- read shape now also carries the attachment path
create or replace function public.wr_json(p_ref text) returns jsonb
language sql stable security definer set search_path = public as $$
  select jsonb_build_object(
    'id', r.ref, 'ref', r.ref,
    'author', a.name, 'authorEmail', a.email,
    'weekStart', to_char(r.week_start, 'YYYY-MM-DD'),
    'did', r.did, 'blockers', r.blockers, 'nextWeek', r.next_week,
    'state', r.state,
    'attachmentPath', r.attachment_path,
    'reviewedBy', rv.name, 'reviewedAt', r.reviewed_at,
    'createdAt', r.created_at)
  from public.weekly_reports r
  join public.app_users a on a.id = r.author_id
  left join public.app_users rv on rv.id = r.reviewed_by
  where r.ref = p_ref
$$;

-- drop the old 3-arg version so the new 4-arg signature is unambiguous
drop function if exists public.submit_weekly_report(text, text, text);

-- ---------- submit (staff) — upsert this week's report, now with an attachment ----------
create or replace function public.submit_weekly_report(
  p_did text, p_blockers text default null, p_next_week text default null, p_attachment text default null
) returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_me uuid := (select id from public.app_users where auth_id = auth.uid());
  v_entity uuid := (select id from public.entities where code = 'KE');
  v_week date := date_trunc('week', now())::date;
  v_name text; v_email text; v_ref text; v_existing text;
begin
  if v_me is null then raise exception 'No user is linked to this login'; end if;
  if nullif(trim(coalesce(p_did, '')), '') is null then
    raise exception 'Tell us what you did this week';
  end if;
  select name, email into v_name, v_email from public.app_users where id = v_me;

  select ref into v_existing from public.weekly_reports where author_id = v_me and week_start = v_week;
  if v_existing is not null then
    update public.weekly_reports
      set did = trim(p_did),
          blockers = nullif(trim(coalesce(p_blockers, '')), ''),
          next_week = nullif(trim(coalesce(p_next_week, '')), ''),
          attachment_path = nullif(trim(coalesce(p_attachment, '')), ''),
          state = 'submitted', reviewed_by = null, reviewed_at = null, updated_at = now()
      where ref = v_existing;
    v_ref := v_existing;
  else
    v_ref := public.next_ref('WR');
    insert into public.weekly_reports(ref, entity_id, author_id, author_name, week_start, did, blockers, next_week, attachment_path)
    values (v_ref, v_entity, v_me, v_name, v_week, trim(p_did),
            nullif(trim(coalesce(p_blockers, '')), ''), nullif(trim(coalesce(p_next_week, '')), ''),
            nullif(trim(coalesce(p_attachment, '')), ''));
  end if;

  -- bell the reviewers (HR hr>=1, or Super Admin users:3)
  insert into public.notifications(entity_id, recipient_email, kind, title, body, link_view, link_ref)
  select v_entity, lower(u.email), 'weekly_report',
         v_name || ' submitted a weekly report',
         'Week of ' || to_char(v_week, 'DD Mon YYYY'), 'hr', v_ref
  from public.app_users u
  join public.user_permissions p on p.email = lower(u.email)
  where ((p.module = 'hr' and p.level >= 1) or (p.module = 'users' and p.level >= 3))
    and lower(u.email) <> lower(v_email);

  perform public.audit_write('weekly_report.submitted', 'weekly_report', v_ref,
    jsonb_build_object('week', v_week));
  return public.wr_json(v_ref);
end $$;

-- ---------- grants ----------
do $$
declare fn text;
begin
  foreach fn in array array[
    'wr_json(text)',
    'submit_weekly_report(text,text,text,text)']
  loop
    execute format('revoke execute on function public.%s from public, anon', fn);
    execute format('grant execute on function public.%s to authenticated', fn);
  end loop;
end $$;
