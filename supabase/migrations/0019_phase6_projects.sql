-- ============================================================================
-- 0019_phase6_projects.sql — PHASE 6 Project & Programme Management (PRD §6A-6F)
-- Extends spine projects; project procurement reuses Phase 2 (filtered by project_id).
-- ============================================================================

create table public.project_details (
  project_id uuid primary key references public.projects(id) on delete cascade,
  funder_party_id uuid references public.parties(id),
  total_budget_minor bigint default 0, currency_code text not null default 'KES',
  manager_user_id uuid references public.users(id), status text not null default 'active',
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
  created_by uuid references public.users(id), updated_by uuid references public.users(id), deleted_at timestamptz
);
create table public.project_team (
  id uuid primary key default gen_random_uuid(),
  project_id uuid references public.projects(id) on delete cascade,
  user_id uuid references public.users(id), role text, unique(project_id, user_id)
);
create table public.project_budgets (
  id uuid primary key default gen_random_uuid(),
  project_id uuid references public.projects(id) on delete cascade,
  cost_center_id uuid references public.cost_centers(id),
  line text, budget_minor bigint default 0,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
  created_by uuid references public.users(id), updated_by uuid references public.users(id), deleted_at timestamptz
);
create table public.milestones (
  id uuid primary key default gen_random_uuid(),
  project_id uuid references public.projects(id) on delete cascade,
  name text not null, due_date date, status text not null default 'pending',
  deliverable_document_id uuid references public.documents(id),
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
  created_by uuid references public.users(id), updated_by uuid references public.users(id), deleted_at timestamptz
);
create table public.funder_reports (
  id uuid primary key default gen_random_uuid(),
  project_id uuid references public.projects(id) on delete cascade,
  period text, status text not null default 'pending', submitted_date date,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
  created_by uuid references public.users(id), updated_by uuid references public.users(id), deleted_at timestamptz
);
create table public.grants (
  id uuid primary key default gen_random_uuid(),
  funder_party_id uuid references public.parties(id),
  project_id uuid references public.projects(id),
  agreement_document_id uuid references public.documents(id),
  total_minor bigint default 0, currency_code text not null default 'KES',
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
  created_by uuid references public.users(id), updated_by uuid references public.users(id), deleted_at timestamptz
);
create table public.drawdowns (
  id uuid primary key default gen_random_uuid(),
  grant_id uuid references public.grants(id) on delete cascade,
  tranche text, amount_minor bigint default 0, due_date date, status text not null default 'scheduled'
);
create table public.field_activities (
  id uuid primary key default gen_random_uuid(),
  project_id uuid references public.projects(id),
  institution_id uuid references public.institutions(id),
  type text, activity_date date default now(), officer_user_id uuid references public.users(id),
  notes text, geo_lat double precision, geo_lng double precision, photos jsonb default '[]'::jsonb,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
  created_by uuid references public.users(id), updated_by uuid references public.users(id), deleted_at timestamptz
);

do $$
declare t text;
declare tbls text[] := array['project_details','project_team','project_budgets','milestones','funder_reports','grants','drawdowns','field_activities'];
begin
  perform public.seed_module_permissions('projects','Projects');
  foreach t in array tbls loop
    perform public.apply_standard_triggers(t);
    perform public.apply_module_rls(t,'projects');
  end loop;
end $$;
