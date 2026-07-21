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
