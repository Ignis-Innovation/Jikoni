-- Task due dates: let a task carry an explicit calendar date, not just a quick
-- "today / this week / next week" key. Elizabeth's review asked for real dates.
--
--  * tasks.due_date date — the concrete due date (nullable; back-compat with key-only tasks)
--  * task_json now returns 'due' (ISO date) so My Week can show it + flag overdue
--  * create_task gains p_due_date; when given it overrides the key and drives the
--    pill/label (Overdue / Today / Due DD Mon). When absent we still derive a
--    concrete date from the key so "due this week" filtering has something to read.
-- Idempotent throughout.

-- ---------- schema ----------
alter table public.tasks add column if not exists due_date date;

-- Backfill a concrete date for existing key-only tasks so filters have a value.
update public.tasks set due_date = case due_pill
    when 'today' then current_date
    when 'over'  then current_date - 1
    else (date_trunc('week', current_date) + interval '6 days')::date
  end
where due_date is null and state = 'open';

-- ---------- read shape (adds 'due') ----------
create or replace function public.task_json(p_ref text) returns jsonb
language sql stable security definer set search_path = public as $$
  select jsonb_build_object(
    'id', t.ref, 't', t.title, 's', t.sub, 'o', t.owner_name,
    'p', t.due_pill, 'pl', t.due_label,
    'due', to_char(t.due_date, 'YYYY-MM-DD'),
    'subtasks', coalesce(t.subtasks, '[]'::jsonb),
    'ownerEmail', ow.email,
    'assignedBy', case when t.assigned_by_id is not null and t.assigned_by_id <> t.owner_id
                       then (select name from public.app_users where id = t.assigned_by_id) end)
  from public.tasks t left join public.app_users ow on ow.id = t.owner_id
  where t.ref = p_ref
$$;

-- ---------- create a task (now with an optional explicit due date) ----------
-- Drop the old 5-arg signature so only the dated version remains.
drop function if exists public.create_task(text, text, text, text, jsonb);

create or replace function public.create_task(
  p_title text, p_owner_email text default null, p_due_key text default 'week',
  p_link text default '', p_subtasks jsonb default '[]'::jsonb, p_due_date date default null
) returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_ref text; v_pill text; v_label text; v_subs jsonb; v_due date;
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

  if p_due_date is not null then
    -- explicit calendar date drives everything
    v_due := p_due_date;
    if    v_due <  current_date then v_pill := 'over';  v_label := 'Overdue · ' || to_char(v_due, 'DD Mon');
    elsif v_due =  current_date then v_pill := 'today'; v_label := 'Today';
    else                             v_pill := 'week';  v_label := 'Due ' || to_char(v_due, 'DD Mon');
    end if;
  else
    -- quick-key path: derive both the pill/label and a concrete date
    select case p_due_key when 'today' then 'today' when 'over' then 'over' else 'week' end,
           case p_due_key when 'today' then 'Today' when 'nweek' then 'Next week' when 'over' then 'Overdue' else 'This week' end
      into v_pill, v_label;
    v_due := case p_due_key
        when 'today' then current_date
        when 'nweek' then (date_trunc('week', current_date) + interval '13 days')::date
        else (date_trunc('week', current_date) + interval '6 days')::date
      end;
  end if;

  -- normalise subtasks: accept ["a","b"] or [{"text":"a"}] → [{"text","done":false}]
  select coalesce(jsonb_agg(jsonb_build_object('text', txt, 'done', false)), '[]'::jsonb) into v_subs
  from (
    select case when jsonb_typeof(e) = 'string' then trim(e #>> '{}') else trim(coalesce(e ->> 'text', '')) end as txt
    from jsonb_array_elements(coalesce(p_subtasks, '[]'::jsonb)) e
  ) s where txt is not null and txt <> '';
  v_ref := public.next_ref('TSK');
  insert into public.tasks(ref, entity_id, owner_id, assigned_by_id, title, sub, owner_name, due_pill, due_label, due_date, subtasks)
  values (v_ref, v_entity, v_owner, v_me, trim(p_title), coalesce(p_link, ''), v_owner_name, v_pill, v_label, v_due, v_subs);
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

-- ---------- grants ----------
revoke execute on function public.create_task(text, text, text, text, jsonb, date) from public, anon;
grant execute on function public.create_task(text, text, text, text, jsonb, date) to authenticated;
