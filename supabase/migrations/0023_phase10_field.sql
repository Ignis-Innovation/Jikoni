-- ============================================================================
-- 0023_phase10_field.sql — PHASE 10 Field & Mobile (PRD §10A-10D)
-- Mobile (PWA) reuses GRN/deployment/field-activity tables. New: portals + tickets.
-- ============================================================================

create table public.support_tickets (
  id uuid primary key default gen_random_uuid(),
  code text unique,
  institution_id uuid references public.institutions(id),
  subject text not null, body text, status text not null default 'open',
  priority text not null default 'normal', raised_by uuid references public.users(id),
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
  created_by uuid references public.users(id), updated_by uuid references public.users(id), deleted_at timestamptz
);
create table public.ticket_comments (
  id uuid primary key default gen_random_uuid(),
  ticket_id uuid references public.support_tickets(id) on delete cascade,
  author_user_id uuid references public.users(id), body text, created_at timestamptz not null default now()
);

do $$
declare t text;
declare tbls text[] := array['support_tickets','ticket_comments'];
begin
  perform public.seed_module_permissions('field','Field & Portals');
  -- field_officer role gets field + assets access.
  insert into public.role_permissions(role_id, permission_id)
  select r.id, p.id from public.roles r join public.permissions p on p.module in ('field','assets')
  where r.key='field_officer' on conflict do nothing;
  foreach t in array tbls loop
    perform public.apply_standard_triggers(t);
    perform public.apply_module_rls(t,'field');
  end loop;
  perform public.apply_code_default('support_tickets','TKT');
end $$;

-- Public impact view (PRD §10D) — whitelisted metrics only, readable without auth.
create or replace view public.public_impact_metrics as
  select type, value, period from public.impact_metrics
  where public_visible = true and deleted_at is null;
