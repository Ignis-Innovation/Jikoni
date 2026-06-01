-- ============================================================================
-- 0021_phase8_intelligence.sql — PHASE 8 Intelligence & Reporting (PRD §8B-8H)
-- Home Dashboard (8A) is already live and stores nothing of its own.
-- ============================================================================

create table public.kpis (
  id uuid primary key default gen_random_uuid(),
  name text not null, formula text, target numeric, module_source text,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
  created_by uuid references public.users(id), updated_by uuid references public.users(id), deleted_at timestamptz
);
create table public.kpi_values (
  id uuid primary key default gen_random_uuid(),
  kpi_id uuid references public.kpis(id) on delete cascade,
  period text, value numeric
);
create table public.impact_metrics (
  id uuid primary key default gen_random_uuid(),
  type text not null, value numeric, period text,
  project_id uuid references public.projects(id), public_visible boolean not null default false,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
  created_by uuid references public.users(id), updated_by uuid references public.users(id), deleted_at timestamptz
);
create table public.alert_rules (
  id uuid primary key default gen_random_uuid(),
  name text not null, condition jsonb default '{}'::jsonb, channel text default 'in_app',
  recipients jsonb default '[]'::jsonb, active boolean not null default true,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
  created_by uuid references public.users(id), updated_by uuid references public.users(id), deleted_at timestamptz
);

do $$
declare t text;
declare tbls text[] := array['kpis','kpi_values','impact_metrics','alert_rules'];
begin
  perform public.seed_module_permissions('intelligence','Intelligence');
  foreach t in array tbls loop
    perform public.apply_standard_triggers(t);
    perform public.apply_module_rls(t,'intelligence');
  end loop;
end $$;
