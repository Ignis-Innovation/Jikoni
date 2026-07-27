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
