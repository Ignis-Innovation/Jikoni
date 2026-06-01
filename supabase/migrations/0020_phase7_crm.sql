-- ============================================================================
-- 0020_phase7_crm.sql — PHASE 7 Partnerships, Pipeline & CRM (PRD §7A-7J)
-- ONE CRM module, two views (upstream/downstream). Built on spine parties.
-- ============================================================================

create table public.partner_profiles (
  party_id uuid primary key references public.parties(id) on delete cascade,
  relationship_types text[] default '{}',  -- funder|investor|ta|government|convener|institution|distributor|epc|manufacturer
  tier text, owner_user_id uuid references public.users(id),
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
  created_by uuid references public.users(id), updated_by uuid references public.users(id), deleted_at timestamptz
);

create table public.engagements (
  id uuid primary key default gen_random_uuid(),
  code text unique,
  partner_party_id uuid references public.parties(id),
  stage text, priority text, owner_user_id uuid references public.users(id),
  status text not null default 'active', next_action text, due_by date,
  view text not null default 'upstream' check (view in ('upstream','downstream')),
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
  created_by uuid references public.users(id), updated_by uuid references public.users(id), deleted_at timestamptz
);
create index on public.engagements(view);
create index on public.engagements(owner_user_id);

create table public.engagement_updates (
  id uuid primary key default gen_random_uuid(),
  engagement_id uuid not null references public.engagements(id) on delete cascade,
  update_date date default now(), channel text, summary text, logged_by uuid references public.users(id),
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
  created_by uuid references public.users(id), updated_by uuid references public.users(id), deleted_at timestamptz
);
create table public.action_items (
  id uuid primary key default gen_random_uuid(),
  engagement_id uuid references public.engagements(id) on delete cascade,
  description text not null, owner_user_id uuid references public.users(id),
  due_date date, status text not null default 'open',
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
  created_by uuid references public.users(id), updated_by uuid references public.users(id), deleted_at timestamptz
);

create table public.institution_pipeline (
  id uuid primary key default gen_random_uuid(),
  institution_id uuid references public.institutions(id),
  tier text, status text, eoi_stage text, owner_user_id uuid references public.users(id),
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
  created_by uuid references public.users(id), updated_by uuid references public.users(id), deleted_at timestamptz
);
create table public.eois (
  id uuid primary key default gen_random_uuid(),
  institution_id uuid references public.institutions(id),
  submitted_date date, status text not null default 'received',
  converted_to_so_id uuid references public.sales_orders(id),
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
  created_by uuid references public.users(id), updated_by uuid references public.users(id), deleted_at timestamptz
);
create table public.opportunities (
  id uuid primary key default gen_random_uuid(),
  title text not null, funder_party_id uuid references public.parties(id),
  type text, deadline date, status text not null default 'open', source_url text,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
  created_by uuid references public.users(id), updated_by uuid references public.users(id), deleted_at timestamptz
);

do $$
declare t text;
declare tbls text[] := array['partner_profiles','engagements','engagement_updates','action_items','institution_pipeline','eois','opportunities'];
begin
  perform public.seed_module_permissions('crm','CRM');
  -- BD role gets CRM access too.
  insert into public.role_permissions(role_id, permission_id)
  select r.id, p.id from public.roles r join public.permissions p on p.module='crm'
  where r.key='bd' on conflict do nothing;
  foreach t in array tbls loop
    perform public.apply_standard_triggers(t);
    perform public.apply_module_rls(t,'crm');
  end loop;
  perform public.apply_code_default('engagements','ENG');
end $$;
