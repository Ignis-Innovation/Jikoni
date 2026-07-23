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

-- ref counters — seeds hardcode FB-016..018 and EXT-003/004, so start past them
insert into public.ref_counters(kind, prefix, n) values ('FB', 'FB-0', 18) on conflict (kind) do nothing;
insert into public.ref_counters(kind, prefix, n) values ('EXT', 'EXT-00', 4) on conflict (kind) do nothing;
update public.ref_counters set n = greatest(n, 18) where kind = 'FB';
update public.ref_counters set n = greatest(n, 4) where kind = 'EXT';

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
