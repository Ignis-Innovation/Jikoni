-- My Week tasks round: personal vs assigned tasks + mini-tasks (subtasks).
--
--  * tasks.assigned_by_id (who created it) + tasks.subtasks jsonb ([{text,done}])
--  * task_json(ref) — the frontend shape, reused by every task RPC
--  * create_task — owner = me (personal) or another user by email (assign → notify)
--  * add/toggle subtask + set_task_done — guarded to the owner or the assigner
--  * RLS read policy so the richer task list can be selected directly (writes via RPC)
-- Idempotent throughout. The old save_task stays in place, unused.

-- ---------- schema ----------
alter table public.tasks add column if not exists assigned_by_id uuid references public.app_users(id);
alter table public.tasks add column if not exists subtasks jsonb not null default '[]'::jsonb;

alter table public.tasks enable row level security;
drop policy if exists "read tasks for authenticated" on public.tasks;
create policy "read tasks for authenticated" on public.tasks for select to authenticated using (true);

-- ---------- read shape (id,t,s,o,p,pl,subtasks,ownerEmail,assignedBy) ----------
create or replace function public.task_json(p_ref text) returns jsonb
language sql stable security definer set search_path = public as $$
  select jsonb_build_object(
    'id', t.ref, 't', t.title, 's', t.sub, 'o', t.owner_name,
    'p', t.due_pill, 'pl', t.due_label,
    'subtasks', coalesce(t.subtasks, '[]'::jsonb),
    'ownerEmail', ow.email,
    'assignedBy', case when t.assigned_by_id is not null and t.assigned_by_id <> t.owner_id
                       then (select name from public.app_users where id = t.assigned_by_id) end)
  from public.tasks t left join public.app_users ow on ow.id = t.owner_id
  where t.ref = p_ref
$$;

-- ---------- create a task (personal, or assigned to another user) ----------
create or replace function public.create_task(
  p_title text, p_owner_email text default null, p_due_key text default 'week',
  p_link text default '', p_subtasks jsonb default '[]'::jsonb
) returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_ref text; v_pill text; v_label text; v_subs jsonb;
  v_entity uuid := (select id from public.entities where code = 'KE');
  v_me uuid := (select id from public.app_users where auth_id = auth.uid());
  v_my_email text; v_owner uuid; v_owner_name text; v_owner_email text;
begin
  if v_me is null then raise exception 'No user is linked to this login'; end if;
  if nullif(trim(coalesce(p_title, '')), '') is null then raise exception 'A task description is required'; end if;
  select email into v_my_email from public.app_users where id = v_me;
  if nullif(trim(coalesce(p_owner_email, '')), '') is null or lower(p_owner_email) = lower(v_my_email) then
    v_owner := v_me;
  else
    select id into v_owner from public.app_users where lower(email) = lower(trim(p_owner_email));
    if v_owner is null then raise exception 'No user with email %', p_owner_email; end if;
  end if;
  select name, email into v_owner_name, v_owner_email from public.app_users where id = v_owner;
  select case p_due_key when 'today' then 'today' when 'over' then 'over' else 'week' end,
         case p_due_key when 'today' then 'Today' when 'nweek' then 'Next week' when 'over' then 'Overdue' else 'This week' end
    into v_pill, v_label;
  -- normalise subtasks: accept ["a","b"] or [{"text":"a"}] → [{"text","done":false}]
  select coalesce(jsonb_agg(jsonb_build_object('text', txt, 'done', false)), '[]'::jsonb) into v_subs
  from (
    select case when jsonb_typeof(e) = 'string' then trim(e #>> '{}') else trim(coalesce(e ->> 'text', '')) end as txt
    from jsonb_array_elements(coalesce(p_subtasks, '[]'::jsonb)) e
  ) s where txt is not null and txt <> '';
  v_ref := public.next_ref('TSK');
  insert into public.tasks(ref, entity_id, owner_id, assigned_by_id, title, sub, owner_name, due_pill, due_label, subtasks)
  values (v_ref, v_entity, v_owner, v_me, trim(p_title), coalesce(p_link, ''), v_owner_name, v_pill, v_label, v_subs);
  -- assigned to someone else → in-app bell (email is sent client-side via /api/notify)
  if v_owner <> v_me then
    insert into public.notifications(entity_id, recipient_email, kind, title, body, link_view, link_ref)
    values (v_entity, lower(v_owner_email), 'task_assigned',
            (select name from public.app_users where id = v_me) || ' assigned you a task',
            trim(p_title), 'home', v_ref);
  end if;
  perform public.audit_write('task.created', 'task', v_ref,
    jsonb_build_object('title', p_title, 'owner', v_owner_name, 'due', v_label));
  return public.task_json(v_ref);
end $$;

-- ---------- subtask + completion mutations (owner or assigner only) ----------
create or replace function public.add_task_subtask(p_ref text, p_text text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_me uuid := (select id from public.app_users where auth_id = auth.uid()); t record;
begin
  select * into t from public.tasks where ref = p_ref;
  if not found then raise exception 'Task not found'; end if;
  if v_me is null or (t.owner_id <> v_me and coalesce(t.assigned_by_id, t.owner_id) <> v_me) then
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
declare v_me uuid := (select id from public.app_users where auth_id = auth.uid()); t record; v_cur boolean;
begin
  select * into t from public.tasks where ref = p_ref;
  if not found then raise exception 'Task not found'; end if;
  if v_me is null or (t.owner_id <> v_me and coalesce(t.assigned_by_id, t.owner_id) <> v_me) then
    raise exception 'This is not your task';
  end if;
  if p_idx < 0 or p_idx >= jsonb_array_length(coalesce(t.subtasks, '[]'::jsonb)) then raise exception 'No such sub-task'; end if;
  v_cur := coalesce((t.subtasks -> p_idx ->> 'done')::boolean, false);
  update public.tasks
    set subtasks = jsonb_set(subtasks, array[p_idx::text, 'done'], to_jsonb(not v_cur)), updated_at = now()
    where ref = p_ref;
  return public.task_json(p_ref);
end $$;

create or replace function public.set_task_done(p_ref text, p_done boolean)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_me uuid := (select id from public.app_users where auth_id = auth.uid()); t record;
begin
  select * into t from public.tasks where ref = p_ref;
  if not found then raise exception 'Task not found'; end if;
  if v_me is null or (t.owner_id <> v_me and coalesce(t.assigned_by_id, t.owner_id) <> v_me) then
    raise exception 'This is not your task';
  end if;
  update public.tasks set state = case when p_done then 'done' else 'open' end, updated_at = now() where ref = p_ref;
  return public.task_json(p_ref);
end $$;

-- ---------- grants ----------
do $$
declare fn text;
begin
  foreach fn in array array[
    'create_task(text,text,text,text,jsonb)',
    'add_task_subtask(text,text)',
    'toggle_task_subtask(text,integer)',
    'set_task_done(text,boolean)']
  loop
    execute format('revoke execute on function public.%s from public, anon', fn);
    execute format('grant execute on function public.%s to authenticated', fn);
  end loop;
end $$;
