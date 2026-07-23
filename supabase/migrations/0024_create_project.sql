-- ============================================================
-- Jikoni — Projects & Programmes: standalone "Add project"
-- Projects could previously only be created by converting a won CRM engagement
-- (create_project_from_eng). This adds a direct create path so a user can add a
-- project from the module itself. Mirrors create_project_from_eng: inserts an
-- is_extra project, seeds three starter milestones, audit-logs, and returns the
-- {name, detail} payload the frontend store already consumes.
-- Idempotent: safe to re-run.
-- ============================================================

create or replace function public.create_project(
  p_name text, p_funder text, p_budget_txt text, p_timeline text, p_team text, p_status text
) returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_entity uuid := (select id from public.entities where code = 'KE');
  p record;
begin
  perform public.assert_access('projects', 2);
  if nullif(trim(coalesce(p_name, '')), '') is null then
    raise exception 'A project name is required';
  end if;
  if exists (select 1 from public.projects where name = trim(p_name)) then
    raise exception 'A project named "%" already exists', trim(p_name);
  end if;
  insert into public.projects(entity_id, name, funder, status, budget_txt, timeline, team, is_extra, docs)
  values (v_entity, trim(p_name), nullif(trim(coalesce(p_funder, '')), ''),
          coalesce(nullif(trim(coalesce(p_status, '')), ''), 'Setup'),
          coalesce(nullif(trim(coalesce(p_budget_txt, '')), ''), 'TBD'),
          coalesce(nullif(trim(coalesce(p_timeline, '')), ''), '2026'),
          nullif(trim(coalesce(p_team, '')), ''), true, '[]'::jsonb)
  returning * into p;
  -- Bare project: no placeholder milestones/drawdowns, so a fresh project stays
  -- out of the Milestones/Grants/Budgets aggregates until it has real data. The
  -- user fills those in from the project drawer.
  perform public.audit_write('project.created', 'project', p.name,
    jsonb_build_object('funder', p_funder, 'budget', p_budget_txt, 'team', p_team));
  return jsonb_build_object('name', p.name, 'created', true,
    'detail', public.project_detail_json(p.id));
end $$;

revoke execute on function public.create_project(text,text,text,text,text,text) from public, anon;
grant execute on function public.create_project(text,text,text,text,text,text) to authenticated;
