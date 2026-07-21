-- ============================================================
-- Jikoni Master PRD — Phase 3: interactive Projects & Programmes
-- The projects module was read-only. This adds the write RPCs the project
-- drawer needs to manage a project end-to-end: milestones, drawdowns, field
-- activity and status. Each RPC checks projects-edit access, audits, and
-- returns the refreshed single-project detail so the UI can upsert without a
-- full reload. project_detail_json is extended to expose row ids + state.
-- Idempotent: safe to re-run.
-- ============================================================

-- ---------- expose ids + state so the UI can target rows ----------
create or replace function public.project_detail_json(p_id uuid) returns jsonb
language sql stable security definer set search_path = public as $$
  select jsonb_build_object(
    'id', p.id, 'state', p.state,
    'funder', p.funder, 'status', p.status, 'budget', p.budget_txt, 'spent', p.spent_txt,
    'pct', p.pct, 'timeline', p.timeline, 'team', p.team, 'reporting', p.reporting, 'field', p.field,
    'docs', p.docs,
    'milestones', coalesce((select jsonb_agg(jsonb_build_object('id', id, 't', title, 's', status) order by sort)
                            from public.project_milestones where project_id = p.id), '[]'::jsonb),
    'drawdowns',  coalesce((select jsonb_agg(jsonb_build_object('id', id, 't', title, 'v', amount_txt, 's', status) order by sort)
                            from public.project_drawdowns where project_id = p.id), '[]'::jsonb))
  from public.projects p where p.id = p_id
$$;

-- helper: { name, detail } payload for a project by id
create or replace function public.project_payload(p_id uuid) returns jsonb
language sql stable security definer set search_path = public as $$
  select jsonb_build_object('name', name, 'detail', public.project_detail_json(id))
  from public.projects where id = p_id
$$;

-- ---------- milestones ----------
create or replace function public.add_project_milestone(
  p_project_id uuid, p_title text, p_status text default 'todo')
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_sort int;
begin
  perform public.assert_access('projects', 2);
  if nullif(trim(coalesce(p_title, '')), '') is null then raise exception 'A milestone title is required'; end if;
  if p_status not in ('done','now','todo') then raise exception 'Invalid milestone status %', p_status; end if;
  if not exists (select 1 from public.projects where id = p_project_id) then raise exception 'Project not found'; end if;
  select coalesce(max(sort), 0) + 1 into v_sort from public.project_milestones where project_id = p_project_id;
  insert into public.project_milestones(project_id, title, status, sort)
  values (p_project_id, trim(p_title), p_status, v_sort);
  perform public.audit_write('project.milestone_added','project', p_project_id::text,
    jsonb_build_object('title', p_title, 'status', p_status));
  return public.project_payload(p_project_id);
end $$;

create or replace function public.set_milestone_status(p_milestone_id uuid, p_status text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_project uuid;
begin
  perform public.assert_access('projects', 2);
  if p_status not in ('done','now','todo') then raise exception 'Invalid milestone status %', p_status; end if;
  update public.project_milestones set status = p_status where id = p_milestone_id returning project_id into v_project;
  if v_project is null then raise exception 'Milestone not found'; end if;
  perform public.audit_write('project.milestone_status','project', v_project::text,
    jsonb_build_object('milestone', p_milestone_id, 'status', p_status));
  return public.project_payload(v_project);
end $$;

-- ---------- drawdowns ----------
create or replace function public.add_project_drawdown(
  p_project_id uuid, p_title text, p_amount_txt text, p_status text default 'Requested')
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_sort int;
begin
  perform public.assert_access('projects', 2);
  if nullif(trim(coalesce(p_title, '')), '') is null then raise exception 'A drawdown title is required'; end if;
  if nullif(trim(coalesce(p_amount_txt, '')), '') is null then raise exception 'An amount is required'; end if;
  if p_status not in ('Requested','Received','On schedule','Cancelled') then raise exception 'Invalid drawdown status %', p_status; end if;
  if not exists (select 1 from public.projects where id = p_project_id) then raise exception 'Project not found'; end if;
  select coalesce(max(sort), 0) + 1 into v_sort from public.project_drawdowns where project_id = p_project_id;
  insert into public.project_drawdowns(project_id, title, amount_txt, status, sort)
  values (p_project_id, trim(p_title), trim(p_amount_txt), p_status, v_sort);
  perform public.audit_write('project.drawdown_added','project', p_project_id::text,
    jsonb_build_object('title', p_title, 'amount', p_amount_txt, 'status', p_status));
  return public.project_payload(p_project_id);
end $$;

create or replace function public.set_drawdown_status(p_drawdown_id uuid, p_status text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_project uuid;
begin
  perform public.assert_access('projects', 2);
  if p_status not in ('Requested','Received','On schedule','Cancelled') then raise exception 'Invalid drawdown status %', p_status; end if;
  update public.project_drawdowns set status = p_status where id = p_drawdown_id returning project_id into v_project;
  if v_project is null then raise exception 'Drawdown not found'; end if;
  perform public.audit_write('project.drawdown_status','project', v_project::text,
    jsonb_build_object('drawdown', p_drawdown_id, 'status', p_status));
  return public.project_payload(v_project);
end $$;

-- ---------- field activity (also refreshes the project's field summary string) ----------
create or replace function public.log_field_activity(
  p_project_id uuid, p_kind text, p_county text default null, p_note text default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_visits int; v_installs int; v_assess int; v_parts text[]; v_summary text;
begin
  perform public.assert_access('projects', 2);
  if p_kind not in ('site_visit','install','readiness_assessment') then raise exception 'Invalid activity kind %', p_kind; end if;
  if not exists (select 1 from public.projects where id = p_project_id) then raise exception 'Project not found'; end if;

  insert into public.field_activities(project_id, kind, county, note)
  values (p_project_id, p_kind, nullif(trim(coalesce(p_county,'')), ''), nullif(trim(coalesce(p_note,'')), ''));

  -- recompute the display summary on projects.field
  select count(*) filter (where kind = 'site_visit'),
         count(*) filter (where kind = 'install'),
         count(*) filter (where kind = 'readiness_assessment')
    into v_visits, v_installs, v_assess
  from public.field_activities where project_id = p_project_id;

  v_parts := array[]::text[];
  if v_visits  > 0 then v_parts := v_parts || (v_visits  || ' site visit'  || case when v_visits  = 1 then '' else 's' end); end if;
  if v_installs> 0 then v_parts := v_parts || (v_installs|| ' install'     || case when v_installs= 1 then '' else 's' end); end if;
  if v_assess  > 0 then v_parts := v_parts || (v_assess  || ' assessment'  || case when v_assess  = 1 then '' else 's' end); end if;
  v_summary := array_to_string(v_parts, ' · ') || ' logged';

  update public.projects set field = v_summary, updated_at = now() where id = p_project_id;
  perform public.audit_write('project.field_activity','project', p_project_id::text,
    jsonb_build_object('kind', p_kind, 'county', p_county));
  return public.project_payload(p_project_id);
end $$;

-- ---------- project status / state ----------
create or replace function public.set_project_state(p_project_id uuid, p_new_state text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_old text; v_status text;
begin
  perform public.assert_access('projects', 2);
  select state into v_old from public.projects where id = p_project_id;
  if v_old is null then raise exception 'Project not found'; end if;
  perform public.assert_transition('project', v_old, p_new_state);
  v_status := case p_new_state
    when 'active' then 'Active' when 'reporting' then 'Reporting'
    when 'closed' then 'Closed' else 'Setup' end;
  update public.projects set state = p_new_state, status = v_status, updated_at = now() where id = p_project_id;
  perform public.audit_write('project.state','project', p_project_id::text,
    jsonb_build_object('from', v_old, 'to', p_new_state));
  return public.project_payload(p_project_id);
end $$;

-- ---------- grants: authenticated only, never public/anon ----------
do $$
begin
  revoke execute on function
    public.add_project_milestone(uuid, text, text),
    public.set_milestone_status(uuid, text),
    public.add_project_drawdown(uuid, text, text, text),
    public.set_drawdown_status(uuid, text),
    public.log_field_activity(uuid, text, text, text),
    public.set_project_state(uuid, text)
  from public, anon;
  grant execute on function
    public.add_project_milestone(uuid, text, text),
    public.set_milestone_status(uuid, text),
    public.add_project_drawdown(uuid, text, text, text),
    public.set_drawdown_status(uuid, text),
    public.log_field_activity(uuid, text, text, text),
    public.set_project_state(uuid, text)
  to authenticated;
end $$;
