-- ============================================================================
-- 0008_approvals.sql — Phase 1G Approvals Engine (PRD §1G)
-- One configurable approval system reused by every module. No module builds
-- its own approval logic.
-- ============================================================================

create table public.approval_chains (
  id          uuid primary key default gen_random_uuid(),
  name        text not null,
  module      text not null,
  entity_type text not null,
  conditions  jsonb not null default '{}'::jsonb,  -- {amount_min, amount_max, type, department_id}
  active      boolean not null default true,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  created_by  uuid references public.users(id),
  updated_by  uuid references public.users(id),
  deleted_at  timestamptz
);

create table public.approval_steps (
  id               uuid primary key default gen_random_uuid(),
  chain_id         uuid not null references public.approval_chains(id) on delete cascade,
  step_no          int not null,
  approver_role_id uuid references public.roles(id),
  approver_user_id uuid references public.users(id),
  min_amount       bigint,
  max_amount       bigint,
  unique (chain_id, step_no)
);

create table public.approval_requests (
  id           uuid primary key default gen_random_uuid(),
  entity_type  text not null,
  entity_id    uuid not null,
  chain_id     uuid references public.approval_chains(id),
  current_step int not null default 1,
  status       text not null default 'pending'
                 check (status in ('pending','approved','rejected','changes_requested')),
  requested_by uuid references public.users(id),
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  created_by   uuid references public.users(id),
  updated_by   uuid references public.users(id),
  deleted_at   timestamptz
);

create index on public.approval_requests(entity_type, entity_id);
create index on public.approval_requests(status);

create table public.approval_actions (
  id             uuid primary key default gen_random_uuid(),
  request_id     uuid not null references public.approval_requests(id) on delete cascade,
  step_no        int not null,
  actor_user_id  uuid references public.users(id),
  action         text not null check (action in ('approve','reject','request_changes')),
  comment        text,
  created_at     timestamptz not null default now()
);
