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

