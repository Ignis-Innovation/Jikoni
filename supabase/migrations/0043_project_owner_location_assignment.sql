-- Projects & Programmes round: project location, owner-based edit/delete, and
-- field-activity assignment notifications.
--
--  * projects.location (free text) + projects.created_by (who added it)
--  * project_detail_json exposes location + a per-caller createdByMe flag
--    (true for the creator OR anyone with full/level-3 projects access)
--  * create_project captures location + created_by; create_project_from_eng
--    captures created_by
--  * new update_project / delete_project, gated to creator-or-full-access
--  * create_field_activity writes an in-app notification for staff assignees and
--    returns the project name + location so the client can email the assignee
-- Idempotent: create-or-replace / add-column-if-not-exists throughout.

-- ---------- schema ----------
alter table public.projects add column if not exists location   text;
alter table public.projects add column if not exists created_by uuid references public.app_users(id);

-- ---------- read model: expose location + createdByMe ----------
create or replace function public.project_detail_json(p_id uuid) returns jsonb
language sql stable security definer set search_path = public as $$
  select jsonb_build_object(
    'id', p.id, 'state', p.state,
    'funder', p.funder, 'status', p.status, 'budget', p.budget_txt, 'spent', p.spent_txt,
    'pct', p.pct, 'timeline', p.timeline, 'team', p.team, 'reporting', p.reporting, 'field', p.field,
    'budgetAmount', p.budget_amount,
    'spentAmount', coalesce((select sum(amount) from public.project_milestones
                             where project_id = p.id and status = 'done'), 0),
    'startDate', p.start_date, 'endDate', p.end_date,
    'location', p.location, 'docs', p.docs,
    'createdByMe', (
      (p.created_by is not null and p.created_by = (select id from public.app_users where auth_id = auth.uid()))
      or coalesce((select level from public.user_permissions
                   where email = lower(coalesce(nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'email', ''))
                     and module = 'projects'), 0) >= 3
    ),
    'milestones', coalesce((select jsonb_agg(jsonb_build_object('id', id, 't', title, 's', status,
                             'amount', amount, 'start', start_date, 'end', end_date) order by sort)
                            from public.project_milestones where project_id = p.id), '[]'::jsonb),
    'drawdowns',  coalesce((select jsonb_agg(jsonb_build_object('id', id, 't', title, 'v', amount_txt, 's', status) order by sort)
                            from public.project_drawdowns where project_id = p.id), '[]'::jsonb))
  from public.projects p where p.id = p_id
$$;

-- ---------- create: capture location + creator ----------
drop function if exists public.create_project(text,text,numeric,date,date,text,text);
create or replace function public.create_project(
  p_name text, p_funder text, p_budget_amount numeric,
  p_start_date date, p_end_date date, p_team text, p_status text, p_location text default null
) returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_entity uuid := (select id from public.entities where code = 'KE');
  v_timeline text;
  p record;
begin
  perform public.assert_access('projects', 2);
  if nullif(trim(coalesce(p_name, '')), '') is null then raise exception 'A project name is required'; end if;
  if exists (select 1 from public.projects where name = trim(p_name)) then
    raise exception 'A project named "%" already exists', trim(p_name);
  end if;
  v_timeline := case
    when p_start_date is not null and p_end_date is not null
      then to_char(p_start_date, 'Mon YYYY') || ' → ' || to_char(p_end_date, 'Mon YYYY')
    when p_start_date is not null then 'From ' || to_char(p_start_date, 'Mon YYYY')
    else '2026' end;
  insert into public.projects(entity_id, name, funder, status, budget_amount, budget_txt, spent_txt, pct,
                              start_date, end_date, timeline, team, location, created_by, is_extra, docs)
  values (v_entity, trim(p_name), nullif(trim(coalesce(p_funder, '')), ''),
          coalesce(nullif(trim(coalesce(p_status, '')), ''), 'Setup'),
          coalesce(p_budget_amount, 0), public.fmt_kes(coalesce(p_budget_amount, 0)), 'KES 0', '0%',
          p_start_date, p_end_date, v_timeline,
          nullif(trim(coalesce(p_team, '')), ''), nullif(trim(coalesce(p_location, '')), ''),
          (select id from public.app_users where auth_id = auth.uid()), true, '[]'::jsonb)
  returning * into p;
  perform public.audit_write('project.created', 'project', p.name,
    jsonb_build_object('funder', p_funder, 'budget', p_budget_amount, 'start', p_start_date,
                       'end', p_end_date, 'team', p_team, 'location', p_location));
  return jsonb_build_object('name', p.name, 'created', true, 'detail', public.project_detail_json(p.id));
end $$;

-- ---------- CRM-converted projects are owned by the converter ----------
create or replace function public.create_project_from_eng(p_eng_ref text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  e record; v_name text; p record;
  v_entity uuid := (select id from public.entities where code = 'KE');
  created boolean := false;
begin
  perform public.assert_access('projects', 2);
  select * into e from public.engagements where ref = p_eng_ref;
  if not found then raise exception 'Engagement % not found', p_eng_ref; end if;
  v_name := regexp_replace(e.name, ' \(.*\)', '') || ' — deployment';
  select * into p from public.projects where name = v_name;
  if not found then
    insert into public.projects(entity_id, name, funder, status, team, created_by, is_extra, docs)
    values (v_entity, v_name, e.name, 'Setup', e.owner_name,
            (select id from public.app_users where auth_id = auth.uid()), true,
            jsonb_build_array('Signed agreement (from ' || p_eng_ref || ')'))
    returning * into p;
    insert into public.project_milestones(project_id, title, status, sort) values
      (p.id, 'Project set up from won deal', 'done', 1),
      (p.id, 'Budget & funder agreement',    'now',  2),
      (p.id, 'Deployment',                   'todo', 3);
    insert into public.eng_project_links(eng_ref, project_name, is_primary)
    values (p_eng_ref, v_name, true)
    on conflict (eng_ref) do update set project_name = excluded.project_name;
    if e.state = 'active' then
      update public.engagements set state = 'won' where id = e.id;
    end if;
    created := true;
    perform public.audit_write('project.created_from_eng','project', v_name,
      jsonb_build_object('engagement', p_eng_ref, 'funder', e.name));
  end if;
  return jsonb_build_object('name', v_name, 'funder', e.name, 'created', created,
    'detail', public.project_detail_json(p.id));
end $$;

-- ---------- update a project (creator or full-access only) ----------
create or replace function public.update_project(
  p_id uuid, p_funder text, p_budget_amount numeric,
  p_start_date date, p_end_date date, p_team text, p_status text, p_location text default null
) returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_me uuid := (select id from public.app_users where auth_id = auth.uid());
  v_lvl int := coalesce((select level from public.user_permissions
                         where email = lower(coalesce(nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'email', ''))
                           and module = 'projects'), 0);
  v_owner uuid; v_name text; v_timeline text;
begin
  perform public.assert_access('projects', 2);
  select created_by, name into v_owner, v_name from public.projects where id = p_id;
  if v_name is null then raise exception 'Project not found'; end if;
  if (v_owner is distinct from v_me) and v_lvl < 3 then
    raise exception 'You can only edit projects you created';
  end if;
  v_timeline := case
    when p_start_date is not null and p_end_date is not null
      then to_char(p_start_date, 'Mon YYYY') || ' → ' || to_char(p_end_date, 'Mon YYYY')
    when p_start_date is not null then 'From ' || to_char(p_start_date, 'Mon YYYY')
    else '2026' end;
  update public.projects set
    funder        = nullif(trim(coalesce(p_funder, '')), ''),
    status        = coalesce(nullif(trim(coalesce(p_status, '')), ''), 'Setup'),
    budget_amount = coalesce(p_budget_amount, 0),
    budget_txt    = public.fmt_kes(coalesce(p_budget_amount, 0)),
    start_date    = p_start_date,
    end_date      = p_end_date,
    timeline      = v_timeline,
    team          = nullif(trim(coalesce(p_team, '')), ''),
    location      = nullif(trim(coalesce(p_location, '')), ''),
    updated_at    = now()
  where id = p_id;
  perform public.recompute_project_money(p_id);
  perform public.audit_write('project.updated', 'project', v_name,
    jsonb_build_object('funder', p_funder, 'budget', p_budget_amount, 'status', p_status, 'location', p_location));
  return public.project_payload(p_id);
end $$;

-- ---------- delete a project (creator or full-access only) ----------
create or replace function public.delete_project(p_id uuid)
returns void language plpgsql security definer set search_path = public as $$
declare
  v_me uuid := (select id from public.app_users where auth_id = auth.uid());
  v_lvl int := coalesce((select level from public.user_permissions
                         where email = lower(coalesce(nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'email', ''))
                           and module = 'projects'), 0);
  v_owner uuid; v_name text;
begin
  perform public.assert_access('projects', 2);
  select created_by, name into v_owner, v_name from public.projects where id = p_id;
  if v_name is null then raise exception 'Project not found'; end if;
  if (v_owner is distinct from v_me) and v_lvl < 3 then
    raise exception 'You can only delete projects you created';
  end if;
  perform public.audit_write('project.deleted', 'project', v_name, jsonb_build_object('id', p_id));
  delete from public.project_drawdowns  where project_id = p_id;
  delete from public.project_milestones where project_id = p_id;
  delete from public.field_activities   where project_id = p_id;
  delete from public.eng_project_links  where project_name = v_name;
  delete from public.projects           where id = p_id;
end $$;

-- ---------- assign a field activity: notify staff + return project/location ----------
create or replace function public.create_field_activity(
  p_project_id uuid, p_assignee text, p_phone text, p_email text,
  p_activity_on date default current_date, p_note text default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_id uuid; v_name text; v_location text;
  v_entity uuid := (select id from public.entities where code = 'KE');
  v_who text := coalesce((select name from public.app_users where auth_id = auth.uid()), 'A teammate');
  v_email text := lower(nullif(trim(coalesce(p_email, '')), ''));
begin
  perform public.assert_access('projects', 2);
  select name, location into v_name, v_location from public.projects where id = p_project_id;
  if v_name is null then raise exception 'Project not found'; end if;
  if nullif(trim(coalesce(p_assignee, '')), '') is null then raise exception 'An assignee is required'; end if;
  insert into public.field_activities(project_id, kind, county, note, activity_on, assignee, phone, email)
  values (p_project_id, 'assignment', null, nullif(trim(coalesce(p_note, '')), ''),
          coalesce(p_activity_on, current_date), trim(p_assignee),
          nullif(trim(coalesce(p_phone, '')), ''), nullif(trim(coalesce(p_email, '')), ''))
  returning id into v_id;
  -- in-app bell if the assignee is a Jikoni user (email itself is sent client-side)
  if v_email is not null and exists (select 1 from public.app_users where lower(email) = v_email) then
    insert into public.notifications(entity_id, recipient_email, kind, title, body, link_view, link_ref)
    values (v_entity, v_email, 'field_assignment',
            v_who || ' assigned you a field task',
            v_name || coalesce(' — ' || nullif(trim(coalesce(p_note, '')), ''), ' — field activity'),
            'projects', p_project_id::text);
  end if;
  perform public.audit_write('project.field_activity','project', p_project_id::text,
    jsonb_build_object('assignee', p_assignee, 'note', p_note));
  return jsonb_build_object('id', v_id, 'project', v_name, 'location', v_location, 'by', v_who);
end $$;

-- ---------- grants ----------
do $$
declare fn text;
begin
  foreach fn in array array[
    'create_project(text,text,numeric,date,date,text,text,text)',
    'update_project(uuid,text,numeric,date,date,text,text,text)',
    'delete_project(uuid)',
    'create_field_activity(uuid,text,text,text,date,text)']
  loop
    execute format('revoke execute on function public.%s from public, anon', fn);
    execute format('grant execute on function public.%s to authenticated', fn);
  end loop;
end $$;
