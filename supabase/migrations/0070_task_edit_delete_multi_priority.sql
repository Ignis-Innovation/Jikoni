-- ============================================================
-- 0070 — Tasks: priority, multiple assignees, edit, delete, completion notify
--
--  * tasks.priority text ('low'|'normal'|'high')
--  * tasks.assignees jsonb — full list [{name,email}] incl. the primary owner, so a
--    task can be shared by several people (one shared row, one completion). owner_id/
--    owner_name stay as the *primary* assignee to keep existing chips/filters working.
--  * task_json now returns state, priority, assignees
--  * create_task takes p_owner_emails jsonb (list) + p_priority; bells every assignee
--  * update_task — edit title / link / due / priority / assignees (assigner or assignee)
--  * delete_task — assigner (creator) or the primary owner
--  * set_task_done — guard widened to any assignee; on completion it bells the assigner
--    and returns a rich object so the client can email "<who> completed the task: …"
--  * add/toggle subtask guards widened to any assignee too
-- Extends 0044 + 0047. Idempotent throughout.
-- ============================================================

-- ---------- schema ----------
alter table public.tasks add column if not exists priority text not null default 'normal';
alter table public.tasks add column if not exists assignees jsonb not null default '[]'::jsonb;

-- Backfill assignees for existing single-owner rows so the new read shape is populated.
update public.tasks t
  set assignees = jsonb_build_array(jsonb_build_object('name', t.owner_name, 'email', ow.email))
  from public.app_users ow
  where ow.id = t.owner_id and (t.assignees is null or t.assignees = '[]'::jsonb);

-- ---------- read shape (adds state, priority, assignees) ----------
create or replace function public.task_json(p_ref text) returns jsonb
language sql stable security definer set search_path = public as $$
  select jsonb_build_object(
    'id', t.ref, 't', t.title, 's', t.sub, 'o', t.owner_name,
    'p', t.due_pill, 'pl', t.due_label,
    'due', to_char(t.due_date, 'YYYY-MM-DD'),
    'state', t.state, 'priority', t.priority,
    'assignees', coalesce(t.assignees, '[]'::jsonb),
    'subtasks', coalesce(t.subtasks, '[]'::jsonb),
    'ownerEmail', ow.email,
    'assignedBy', case when t.assigned_by_id is not null and t.assigned_by_id <> t.owner_id
                       then (select name from public.app_users where id = t.assigned_by_id) end)
  from public.tasks t left join public.app_users ow on ow.id = t.owner_id
  where t.ref = p_ref
$$;

-- ---------- shared helpers ----------
-- pill + label + concrete date from an explicit date or a quick-key
create or replace function public.task_due(p_due_key text, p_due_date date,
  out o_pill text, out o_label text, out o_due date)
language plpgsql immutable as $$
begin
  if p_due_date is not null then
    o_due := p_due_date;
    if    o_due <  current_date then o_pill := 'over';  o_label := 'Overdue · ' || to_char(o_due, 'DD Mon');
    elsif o_due =  current_date then o_pill := 'today'; o_label := 'Today';
    else                             o_pill := 'week';  o_label := 'Due ' || to_char(o_due, 'DD Mon');
    end if;
  else
    o_pill  := case p_due_key when 'today' then 'today' when 'over' then 'over' else 'week' end;
    o_label := case p_due_key when 'today' then 'Today' when 'nweek' then 'Next week' when 'over' then 'Overdue' else 'This week' end;
    o_due   := case p_due_key when 'today' then current_date
                              when 'nweek' then (date_trunc('week', current_date) + interval '13 days')::date
                              else (date_trunc('week', current_date) + interval '6 days')::date end;
  end if;
end $$;

-- resolve a jsonb array of emails → assignees [{name,email}] (dedup, first = primary)
create or replace function public.task_assignees_of(p_emails jsonb)
returns jsonb language sql stable set search_path = public as $$
  select coalesce(jsonb_agg(jsonb_build_object('name', u.name, 'email', u.email) order by ord), '[]'::jsonb)
  from (
    select distinct on (lower(em)) lower(em) as em, ord
    from jsonb_array_elements_text(coalesce(p_emails, '[]'::jsonb)) with ordinality as t(em, ord)
    where nullif(trim(em), '') is not null
    order by lower(em), ord
  ) d
  join public.app_users u on lower(u.email) = d.em
$$;

-- ---------- create a task (personal, or shared by several assignees) ----------
drop function if exists public.create_task(text, text, text, text, jsonb, date);

create or replace function public.create_task(
  p_title text, p_owner_emails jsonb default '[]'::jsonb, p_due_key text default 'week',
  p_link text default '', p_subtasks jsonb default '[]'::jsonb, p_due_date date default null,
  p_priority text default 'normal'
) returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_ref text; v_pill text; v_label text; v_subs jsonb; v_due date;
  v_entity uuid := (select id from public.entities where code = 'KE');
  v_me uuid := (select id from public.app_users where auth_id = auth.uid());
  v_my_email text; v_my_name text;
  v_assignees jsonb; v_primary_email text; v_owner uuid; v_owner_name text;
  v_prio text := case when lower(coalesce(p_priority,'')) in ('low','high') then lower(p_priority) else 'normal' end;
  a jsonb;
begin
  if v_me is null then raise exception 'No user is linked to this login'; end if;
  if nullif(trim(coalesce(p_title, '')), '') is null then raise exception 'A task description is required'; end if;
  select email, name into v_my_email, v_my_name from public.app_users where id = v_me;

  v_assignees := public.task_assignees_of(p_owner_emails);
  if v_assignees is null or jsonb_array_length(v_assignees) = 0 then
    -- personal task: owner is me
    v_assignees := jsonb_build_array(jsonb_build_object('name', v_my_name, 'email', v_my_email));
  end if;
  v_primary_email := v_assignees -> 0 ->> 'email';
  select id, name into v_owner, v_owner_name from public.app_users where lower(email) = lower(v_primary_email);

  select o_pill, o_label, o_due into v_pill, v_label, v_due from public.task_due(p_due_key, p_due_date);

  -- normalise subtasks: accept ["a","b"] or [{"text":"a"}] → [{"text","done":false}]
  select coalesce(jsonb_agg(jsonb_build_object('text', txt, 'done', false)), '[]'::jsonb) into v_subs
  from (
    select case when jsonb_typeof(e) = 'string' then trim(e #>> '{}') else trim(coalesce(e ->> 'text', '')) end as txt
    from jsonb_array_elements(coalesce(p_subtasks, '[]'::jsonb)) e
  ) s where txt is not null and txt <> '';

  v_ref := public.next_ref('TSK');
  insert into public.tasks(ref, entity_id, owner_id, assigned_by_id, title, sub, owner_name, due_pill, due_label, due_date, subtasks, priority, assignees)
  values (v_ref, v_entity, v_owner, v_me, trim(p_title), coalesce(p_link, ''), v_owner_name, v_pill, v_label, v_due, v_subs, v_prio, v_assignees);

  -- bell every assignee other than me (email is sent client-side via /api/notify)
  for a in select * from jsonb_array_elements(v_assignees) loop
    if lower(a ->> 'email') <> lower(v_my_email) then
      insert into public.notifications(entity_id, recipient_email, kind, title, body, link_view, link_ref)
      values (v_entity, lower(a ->> 'email'), 'task_assigned',
              v_my_name || ' assigned you a task', trim(p_title), 'home', v_ref);
    end if;
  end loop;

  perform public.audit_write('task.created', 'task', v_ref,
    jsonb_build_object('title', p_title, 'owner', v_owner_name, 'due', v_label, 'assignees', v_assignees));
  return public.task_json(v_ref);
end $$;

-- ---------- edit a task (assigner or any assignee) ----------
create or replace function public.update_task(
  p_ref text, p_title text, p_link text default '', p_due_key text default 'week',
  p_due_date date default null, p_priority text default 'normal',
  p_owner_emails jsonb default null
) returns jsonb language plpgsql security definer set search_path = public as $$
declare
  t record; v_me uuid := (select id from public.app_users where auth_id = auth.uid());
  v_my_email text := (select lower(email) from public.app_users where auth_id = auth.uid());
  v_pill text; v_label text; v_due date; v_assignees jsonb; v_primary_email text;
  v_owner uuid; v_owner_name text;
  v_prio text := case when lower(coalesce(p_priority,'')) in ('low','high') then lower(p_priority) else 'normal' end;
begin
  select * into t from public.tasks where ref = p_ref;
  if not found then raise exception 'Task not found'; end if;
  if v_me is null or (coalesce(t.assigned_by_id, t.owner_id) <> v_me and t.owner_id <> v_me
       and not exists (select 1 from jsonb_array_elements(coalesce(t.assignees, '[]'::jsonb)) e where lower(e ->> 'email') = v_my_email)) then
    raise exception 'This is not your task';
  end if;
  if nullif(trim(coalesce(p_title, '')), '') is null then raise exception 'A task description is required'; end if;

  select o_pill, o_label, o_due into v_pill, v_label, v_due from public.task_due(p_due_key, p_due_date);

  -- re-sync assignees only when a list is passed; otherwise keep the current ones
  if p_owner_emails is not null then
    v_assignees := public.task_assignees_of(p_owner_emails);
    if v_assignees is null or jsonb_array_length(v_assignees) = 0 then
      v_assignees := t.assignees;   -- refuse to leave a task with nobody on it
    end if;
  else
    v_assignees := t.assignees;
  end if;
  v_primary_email := v_assignees -> 0 ->> 'email';
  select id, name into v_owner, v_owner_name from public.app_users where lower(email) = lower(v_primary_email);

  update public.tasks
    set title = trim(p_title), sub = coalesce(p_link, ''),
        due_pill = v_pill, due_label = v_label, due_date = v_due,
        priority = v_prio, assignees = v_assignees,
        owner_id = coalesce(v_owner, owner_id), owner_name = coalesce(v_owner_name, owner_name),
        updated_at = now()
    where ref = p_ref;

  perform public.audit_write('task.updated', 'task', p_ref,
    jsonb_build_object('title', p_title, 'due', v_label, 'priority', v_prio));
  return public.task_json(p_ref);
end $$;

-- ---------- delete a task (assigner/creator or the primary owner) ----------
create or replace function public.delete_task(p_ref text)
returns void language plpgsql security definer set search_path = public as $$
declare t record; v_me uuid := (select id from public.app_users where auth_id = auth.uid());
begin
  select * into t from public.tasks where ref = p_ref;
  if not found then raise exception 'Task not found'; end if;
  if v_me is null or (coalesce(t.assigned_by_id, t.owner_id) <> v_me and t.owner_id <> v_me) then
    raise exception 'Only the person who created or owns this task can delete it';
  end if;
  delete from public.tasks where ref = p_ref;
  perform public.audit_write('task.deleted', 'task', p_ref, jsonb_build_object('title', t.title));
end $$;

-- ---------- subtask + completion mutations (owner, assigner, or any assignee) ----------
create or replace function public.add_task_subtask(p_ref text, p_text text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_me uuid := (select id from public.app_users where auth_id = auth.uid());
        v_my_email text := (select lower(email) from public.app_users where auth_id = auth.uid()); t record;
begin
  select * into t from public.tasks where ref = p_ref;
  if not found then raise exception 'Task not found'; end if;
  if v_me is null or (coalesce(t.assigned_by_id, t.owner_id) <> v_me and t.owner_id <> v_me
       and not exists (select 1 from jsonb_array_elements(coalesce(t.assignees, '[]'::jsonb)) e where lower(e ->> 'email') = v_my_email)) then
    raise exception 'This is not your task';
  end if;
  if nullif(trim(coalesce(p_text, '')), '') is null then raise exception 'A sub-task is required'; end if;
  update public.tasks
    set subtasks = coalesce(subtasks, '[]'::jsonb) || jsonb_build_array(jsonb_build_object('text', trim(p_text), 'done', false)),
        updated_at = now()
    where ref = p_ref;
  return public.task_json(p_ref);
end $$;

create or replace function public.toggle_task_subtask(p_ref text, p_idx int)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_me uuid := (select id from public.app_users where auth_id = auth.uid());
        v_my_email text := (select lower(email) from public.app_users where auth_id = auth.uid()); t record; v_cur boolean;
begin
  select * into t from public.tasks where ref = p_ref;
  if not found then raise exception 'Task not found'; end if;
  if v_me is null or (coalesce(t.assigned_by_id, t.owner_id) <> v_me and t.owner_id <> v_me
       and not exists (select 1 from jsonb_array_elements(coalesce(t.assignees, '[]'::jsonb)) e where lower(e ->> 'email') = v_my_email)) then
    raise exception 'This is not your task';
  end if;
  if p_idx < 0 or p_idx >= jsonb_array_length(coalesce(t.subtasks, '[]'::jsonb)) then raise exception 'No such sub-task'; end if;
  v_cur := coalesce((t.subtasks -> p_idx ->> 'done')::boolean, false);
  update public.tasks
    set subtasks = jsonb_set(subtasks, array[p_idx::text, 'done'], to_jsonb(not v_cur)), updated_at = now()
    where ref = p_ref;
  return public.task_json(p_ref);
end $$;

-- set_task_done: complete/reopen; on completion bell the assigner + return email fields
create or replace function public.set_task_done(p_ref text, p_done boolean)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  t record; v_me uuid := (select id from public.app_users where auth_id = auth.uid());
  v_my_email text := (select lower(email) from public.app_users where auth_id = auth.uid());
  v_my_name text := (select name from public.app_users where auth_id = auth.uid());
  v_assigner uuid; v_assigner_email text; v_assigner_name text; v_notify boolean := false;
begin
  select * into t from public.tasks where ref = p_ref;
  if not found then raise exception 'Task not found'; end if;
  if v_me is null or (coalesce(t.assigned_by_id, t.owner_id) <> v_me and t.owner_id <> v_me
       and not exists (select 1 from jsonb_array_elements(coalesce(t.assignees, '[]'::jsonb)) e where lower(e ->> 'email') = v_my_email)) then
    raise exception 'This is not your task';
  end if;
  update public.tasks set state = case when p_done then 'done' else 'open' end, updated_at = now() where ref = p_ref;

  v_assigner := coalesce(t.assigned_by_id, t.owner_id);
  select email, name into v_assigner_email, v_assigner_name from public.app_users where id = v_assigner;
  v_notify := p_done and v_assigner is not null and v_assigner <> v_me;

  if v_notify then
    insert into public.notifications(entity_id, recipient_email, kind, title, body, link_view, link_ref)
    values (t.entity_id, lower(v_assigner_email), 'task_done',
            v_my_name || ' completed a task', t.title, 'home', p_ref);
  end if;

  return jsonb_build_object(
    'task', public.task_json(p_ref),
    'assignerEmail', case when v_notify then v_assigner_email end,
    'assignerName', v_assigner_name,
    'completedBy', v_my_name,
    'title', t.title);
end $$;

-- ---------- grants ----------
do $$
declare fn text;
begin
  foreach fn in array array[
    'task_due(text,date)',
    'task_assignees_of(jsonb)',
    'create_task(text,jsonb,text,text,jsonb,date,text)',
    'update_task(text,text,text,text,date,text,jsonb)',
    'delete_task(text)',
    'add_task_subtask(text,text)',
    'toggle_task_subtask(text,integer)',
    'set_task_done(text,boolean)']
  loop
    execute format('revoke execute on function public.%s from public, anon', fn);
    execute format('grant execute on function public.%s to authenticated', fn);
  end loop;
end $$;
