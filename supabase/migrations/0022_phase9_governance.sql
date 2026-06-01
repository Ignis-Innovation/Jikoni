-- ============================================================================
-- 0022_phase9_governance.sql — PHASE 9 Governance, Compliance & Diligence (§9A-9F)
-- ============================================================================

create table public.contracts (
  id uuid primary key default gen_random_uuid(),
  code text unique,
  type text, counterparty_party_id uuid references public.parties(id),
  start_date date, end_date date, value_minor bigint default 0,
  document_id uuid references public.documents(id), status text not null default 'active',
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
  created_by uuid references public.users(id), updated_by uuid references public.users(id), deleted_at timestamptz
);
create table public.compliance_obligations (
  id uuid primary key default gen_random_uuid(),
  name text not null, authority text, frequency text, next_due date,
  owner_user_id uuid references public.users(id), status text not null default 'pending',
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
  created_by uuid references public.users(id), updated_by uuid references public.users(id), deleted_at timestamptz
);
create table public.policies (
  id uuid primary key default gen_random_uuid(),
  title text not null, category text, current_version int default 1,
  document_id uuid references public.documents(id), status text not null default 'active',
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
  created_by uuid references public.users(id), updated_by uuid references public.users(id), deleted_at timestamptz
);
create table public.policy_versions (
  id uuid primary key default gen_random_uuid(),
  policy_id uuid references public.policies(id) on delete cascade,
  version int, document_id uuid references public.documents(id), created_at timestamptz not null default now()
);
create table public.risks (
  id uuid primary key default gen_random_uuid(),
  description text not null, likelihood int check (likelihood between 1 and 5),
  impact int check (impact between 1 and 5),
  score int generated always as (likelihood * impact) stored,
  owner_user_id uuid references public.users(id), mitigation text, status text not null default 'open',
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
  created_by uuid references public.users(id), updated_by uuid references public.users(id), deleted_at timestamptz
);
create table public.board_members (
  id uuid primary key default gen_random_uuid(),
  party_id uuid references public.parties(id), role text, appointed_date date,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
  created_by uuid references public.users(id), updated_by uuid references public.users(id), deleted_at timestamptz
);
create table public.board_meetings (
  id uuid primary key default gen_random_uuid(),
  meeting_date date, minutes_document_id uuid references public.documents(id), notes text,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
  created_by uuid references public.users(id), updated_by uuid references public.users(id), deleted_at timestamptz
);
create table public.resolutions (
  id uuid primary key default gen_random_uuid(),
  meeting_id uuid references public.board_meetings(id), title text, outcome text,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
  created_by uuid references public.users(id), updated_by uuid references public.users(id), deleted_at timestamptz
);
create table public.shareholding (
  id uuid primary key default gen_random_uuid(),
  party_id uuid references public.parties(id), shares bigint, pct numeric(6,3),
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
  created_by uuid references public.users(id), updated_by uuid references public.users(id), deleted_at timestamptz
);
create table public.dataroom_shares (
  id uuid primary key default gen_random_uuid(),
  name text, document_ids jsonb default '[]'::jsonb,
  shared_with_party_id uuid references public.parties(id),
  expires_at timestamptz, created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid references public.users(id), updated_by uuid references public.users(id), deleted_at timestamptz
);

do $$
declare t text;
declare tbls text[] := array['contracts','compliance_obligations','policies','policy_versions','risks','board_members','board_meetings','resolutions','shareholding','dataroom_shares'];
begin
  perform public.seed_module_permissions('governance','Governance');
  foreach t in array tbls loop
    perform public.apply_standard_triggers(t);
    perform public.apply_module_rls(t,'governance');
  end loop;
  perform public.apply_code_default('contracts','CTR');
end $$;
