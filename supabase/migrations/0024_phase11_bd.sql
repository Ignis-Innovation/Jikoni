-- ============================================================================
-- 0024_phase11_bd.sql — PHASE 11 Business Development Intelligence (§11A-11F)
-- Scans the whole spine (single-query, enabled by one-CRM design) to draft concepts.
-- ============================================================================

create table public.concepts (
  id uuid primary key default gen_random_uuid(),
  code text unique,
  opportunity_id uuid references public.opportunities(id),
  title text, status text not null default 'draft',  -- draft|review|submitted|won|lost
  assigned_to uuid references public.users(id),
  document_id uuid references public.documents(id),
  checklist jsonb default '[]'::jsonb,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
  created_by uuid references public.users(id), updated_by uuid references public.users(id), deleted_at timestamptz
);
create table public.capability_snapshots (
  id uuid primary key default gen_random_uuid(),
  opportunity_id uuid references public.opportunities(id),
  concept_id uuid references public.concepts(id),
  snapshot jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

do $$
declare t text;
declare tbls text[] := array['concepts','capability_snapshots'];
begin
  perform public.seed_module_permissions('bd','Business Development');
  insert into public.role_permissions(role_id, permission_id)
  select r.id, p.id from public.roles r join public.permissions p on p.module='bd'
  where r.key='bd' on conflict do nothing;
  foreach t in array tbls loop
    perform public.apply_standard_triggers(t);
    perform public.apply_module_rls(t,'bd');
  end loop;
  perform public.apply_code_default('concepts','CPT');
end $$;
