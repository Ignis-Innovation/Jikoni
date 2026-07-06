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
