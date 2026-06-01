-- ============================================================================
-- 0003_org_model.sql — Phase 1B Organization Model (PRD §1B)
-- Shared structure every module tags data against. Referenced by ID, never copied.
-- ============================================================================

create table public.institutions (
  id         uuid primary key default gen_random_uuid(),
  name       text not null,
  type       text,
  parent_id  uuid references public.institutions(id),
  status     text not null default 'active',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid references public.users(id),
  updated_by uuid references public.users(id),
  deleted_at timestamptz
);

create table public.departments (
  id           uuid primary key default gen_random_uuid(),
  name         text not null,
  parent_id    uuid references public.departments(id),
  head_user_id uuid references public.users(id),
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  created_by   uuid references public.users(id),
  updated_by   uuid references public.users(id),
  deleted_at   timestamptz
);

-- Base projects table (extended in Phase 6).
create table public.projects (
  id              uuid primary key default gen_random_uuid(),
  code            text unique not null,
  name            text not null,
  funder_party_id uuid,                       -- -> parties.id (added in 0005)
  status          text not null default 'active',
  start_date      date,
  end_date        date,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  created_by      uuid references public.users(id),
  updated_by      uuid references public.users(id),
  deleted_at      timestamptz
);

create table public.locations (
  id         uuid primary key default gen_random_uuid(),
  name       text not null,
  type       text check (type in ('office','site','warehouse')),
  geo_lat    double precision,
  geo_lng    double precision,
  address    text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid references public.users(id),
  updated_by uuid references public.users(id),
  deleted_at timestamptz
);

create table public.cost_centers (
  id            uuid primary key default gen_random_uuid(),
  code          text unique not null,
  name          text not null,
  department_id uuid references public.departments(id),
  project_id    uuid references public.projects(id),
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  created_by    uuid references public.users(id),
  updated_by    uuid references public.users(id),
  deleted_at    timestamptz
);
