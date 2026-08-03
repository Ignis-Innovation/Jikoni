-- ============================================================
-- Jikoni Tool — Projects money model + CRM tagging/notifications
-- Backend for the Projects & Programmes + Partnerships CRM feature round:
--   * projects.budget_amount / start_date / end_date  — numeric budget + timeline
--   * project_milestones.amount / start_date / end_date — money + dates per milestone
--   * project_drawdowns.milestone_id                   — completing a milestone auto-
--                                                        creates a Received drawdown
--   * create_project             — numeric budget + start/end dates
--   * add_project_milestone      — amount + dates; total may not exceed the budget
--   * set_milestone_status       — done → auto-drawdown + recompute spent; reopen removes
--   * create_field_activity      — assign someone (name/phone/email) to a site
--   * partners.contact_name/email/phone + create_partner
--   * create_engagement + p_tagged_email — in-app notification for a tagged teammate
--   * notifications table + mark_notifications_seen — drives the bell + CRM badge
-- Contact fields, field activities and notifications are folded into the client read
-- model in loadFromDb (like dispatch receipts / asset assignments), so bootstrap()
-- stays untouched. Idempotent: safe to re-run.
-- ============================================================

-- ---------- new columns ----------
alter table public.projects add column if not exists budget_amount numeric not null default 0;
alter table public.projects add column if not exists start_date date;
alter table public.projects add column if not exists end_date date;

alter table public.project_milestones add column if not exists amount numeric not null default 0;
alter table public.project_milestones add column if not exists start_date date;
alter table public.project_milestones add column if not exists end_date date;

alter table public.project_drawdowns add column if not exists milestone_id uuid
  references public.project_milestones(id) on delete cascade;

alter table public.field_activities add column if not exists assignee text;
alter table public.field_activities add column if not exists phone text;
alter table public.field_activities add column if not exists email text;
alter table public.field_activities drop constraint if exists field_activities_kind_check;
alter table public.field_activities add constraint field_activities_kind_check
  check (kind in ('site_visit','install','readiness_assessment','assignment'));

alter table public.partners add column if not exists contact_name text;
alter table public.partners add column if not exists email text;
alter table public.partners add column if not exists phone text;

-- ---------- notifications (drives the topbar bell + CRM badge) ----------
create table if not exists public.notifications (
  id           uuid primary key default gen_random_uuid(),
  entity_id    uuid references public.entities(id),
  recipient_email text not null,
  kind         text not null,
  title        text not null,
  body         text,
  link_view    text,
  link_ref     text,
  seen         boolean not null default false,
  created_at   timestamptz not null default now()
);
create index if not exists notifications_recipient_idx on public.notifications(recipient_email, seen);

alter table public.notifications enable row level security;
drop policy if exists "own notifications read" on public.notifications;
create policy "own notifications read" on public.notifications for select to authenticated
  using (recipient_email = lower(coalesce(nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'email', '')));
drop policy if exists "own notifications update" on public.notifications;
create policy "own notifications update" on public.notifications for update to authenticated
  using (recipient_email = lower(coalesce(nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'email', '')));

-- ---------- money helpers ----------
create or replace function public.fmt_kes(p numeric) returns text
language sql immutable as $$ select 'KES ' || to_char(coalesce(p, 0), 'FM999,999,999,990') $$;

-- Recompute a project's displayed spend + burn % from its completed milestones.
create or replace function public.recompute_project_money(p_id uuid) returns void
language plpgsql security definer set search_path = public as $$
declare v_spent numeric; v_budget numeric;
begin
  select coalesce(sum(amount), 0) into v_spent
    from public.project_milestones where project_id = p_id and status = 'done';
  select budget_amount into v_budget from public.projects where id = p_id;
  update public.projects
     set spent_txt  = public.fmt_kes(v_spent),
         pct        = case when coalesce(v_budget, 0) > 0
                           then round(v_spent / v_budget * 100)::text || '%' else '0%' end,
         updated_at = now()
   where id = p_id;
end $$;

-- ---------- project read-model json (now carries money + dates) ----------
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
    'docs', p.docs,
    'milestones', coalesce((select jsonb_agg(jsonb_build_object(
                              'id', id, 't', title, 's', status,
                              'amount', amount, 'start', start_date, 'end', end_date) order by sort)
                            from public.project_milestones where project_id = p.id), '[]'::jsonb),
    'drawdowns',  coalesce((select jsonb_agg(jsonb_build_object(
                              'id', id, 't', title, 'v', amount_txt, 's', status) order by sort)
                            from public.project_drawdowns where project_id = p.id), '[]'::jsonb))
  from public.projects p where p.id = p_id
$$;

-- ---------- create a project (numeric budget + start/end dates) ----------
drop function if exists public.create_project(text,text,text,text,text,text);
create or replace function public.create_project(
  p_name text, p_funder text, p_budget_amount numeric,
  p_start_date date, p_end_date date, p_team text, p_status text
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
                              start_date, end_date, timeline, team, is_extra, docs)
  values (v_entity, trim(p_name), nullif(trim(coalesce(p_funder, '')), ''),
          coalesce(nullif(trim(coalesce(p_status, '')), ''), 'Setup'),
          coalesce(p_budget_amount, 0), public.fmt_kes(coalesce(p_budget_amount, 0)), 'KES 0', '0%',
          p_start_date, p_end_date, v_timeline,
          nullif(trim(coalesce(p_team, '')), ''), true, '[]'::jsonb)
  returning * into p;
  perform public.audit_write('project.created', 'project', p.name,
    jsonb_build_object('funder', p_funder, 'budget', p_budget_amount, 'start', p_start_date, 'end', p_end_date, 'team', p_team));
  return jsonb_build_object('name', p.name, 'created', true, 'detail', public.project_detail_json(p.id));
end $$;

-- ---------- add a milestone (amount + dates; total may not exceed budget) ----------
drop function if exists public.add_project_milestone(uuid,text,text);
create or replace function public.add_project_milestone(
  p_project_id uuid, p_title text, p_amount numeric default 0,
  p_start_date date default null, p_end_date date default null, p_status text default 'todo')
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_sort int; v_budget numeric; v_used numeric;
begin
  perform public.assert_access('projects', 2);
  if nullif(trim(coalesce(p_title, '')), '') is null then raise exception 'A milestone title is required'; end if;
  if p_status not in ('done','now','todo') then raise exception 'Invalid milestone status %', p_status; end if;
  if coalesce(p_amount, 0) < 0 then raise exception 'Milestone amount cannot be negative'; end if;
  select budget_amount into v_budget from public.projects where id = p_project_id;
  if v_budget is null then raise exception 'Project not found'; end if;
  select coalesce(sum(amount), 0) into v_used from public.project_milestones where project_id = p_project_id;
  if v_used + coalesce(p_amount, 0) > v_budget then
    raise exception 'Milestones would total % which exceeds the project budget of %',
      public.fmt_kes(v_used + coalesce(p_amount, 0)), public.fmt_kes(v_budget);
  end if;
  select coalesce(max(sort), 0) + 1 into v_sort from public.project_milestones where project_id = p_project_id;
  insert into public.project_milestones(project_id, title, status, sort, amount, start_date, end_date)
  values (p_project_id, trim(p_title), p_status, v_sort, coalesce(p_amount, 0), p_start_date, p_end_date);
  perform public.recompute_project_money(p_project_id);
  perform public.audit_write('project.milestone_added','project', p_project_id::text,
    jsonb_build_object('title', p_title, 'amount', p_amount, 'status', p_status));
  return public.project_payload(p_project_id);
end $$;

-- ---------- complete a milestone → recognise its amount as a drawdown ----------
create or replace function public.set_milestone_status(p_milestone_id uuid, p_status text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_project uuid; v_title text; v_amount numeric; v_sort int;
begin
  perform public.assert_access('projects', 2);
  if p_status not in ('done','now','todo') then raise exception 'Invalid milestone status %', p_status; end if;
  update public.project_milestones set status = p_status where id = p_milestone_id
    returning project_id, title, amount into v_project, v_title, v_amount;
  if v_project is null then raise exception 'Milestone not found'; end if;
  if p_status = 'done' then
    -- recognise the milestone amount as a Received drawdown (one per milestone)
    if not exists (select 1 from public.project_drawdowns where milestone_id = p_milestone_id) then
      select coalesce(max(sort), 0) + 1 into v_sort from public.project_drawdowns where project_id = v_project;
      insert into public.project_drawdowns(project_id, title, amount_txt, status, sort, milestone_id)
      values (v_project, v_title, public.fmt_kes(v_amount), 'Received', v_sort, p_milestone_id);
    end if;
  else
    -- reopened → pull the auto-created drawdown back out
    delete from public.project_drawdowns where milestone_id = p_milestone_id;
  end if;
  perform public.recompute_project_money(v_project);
  perform public.audit_write('project.milestone_status','project', v_project::text,
    jsonb_build_object('milestone', p_milestone_id, 'status', p_status));
  return public.project_payload(v_project);
end $$;

-- ---------- assign someone to a field activity ----------
create or replace function public.create_field_activity(
  p_project_id uuid, p_assignee text, p_phone text, p_email text,
  p_activity_on date default current_date, p_note text default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_id uuid;
begin
  perform public.assert_access('projects', 2);
  if not exists (select 1 from public.projects where id = p_project_id) then raise exception 'Project not found'; end if;
  if nullif(trim(coalesce(p_assignee, '')), '') is null then raise exception 'An assignee is required'; end if;
  insert into public.field_activities(project_id, kind, county, note, activity_on, assignee, phone, email)
  values (p_project_id, 'assignment', null, nullif(trim(coalesce(p_note, '')), ''),
          coalesce(p_activity_on, current_date), trim(p_assignee),
          nullif(trim(coalesce(p_phone, '')), ''), nullif(trim(coalesce(p_email, '')), ''))
  returning id into v_id;
  perform public.audit_write('project.field_activity','project', p_project_id::text,
    jsonb_build_object('assignee', p_assignee, 'note', p_note));
  return jsonb_build_object('id', v_id);
end $$;

-- ---------- create a partner (now captures a contact person) ----------
drop function if exists public.create_partner(text,text,text,text,text);
create or replace function public.create_partner(
  p_name text, p_type text, p_country text, p_owner_name text, p_status text,
  p_contact_name text default null, p_email text default null, p_phone text default null
) returns jsonb language plpgsql security definer set search_path = public as $$
declare v_entity uuid := (select id from public.entities where code = 'KE'); v_cls text; v_id uuid;
begin
  perform public.assert_access('crm', 2);
  v_cls := case p_status
    when 'Active'        then 'done'
    when 'Ready to fund' then 'done'
    when 'Holding'       then 'over'
    when 'Negotiation'   then 'today'
    when 'Materials'     then 'today'
    when 'Contracting'   then 'today'
    else 'week' end;
  insert into public.partners(entity_id, name, type, country, owner_name, status, status_cls,
                              contact_name, email, phone)
  values (v_entity, p_name, p_type, p_country, p_owner_name, p_status, v_cls,
          nullif(trim(coalesce(p_contact_name, '')), ''), nullif(trim(coalesce(p_email, '')), ''),
          nullif(trim(coalesce(p_phone, '')), ''))
  returning id into v_id;
  perform public.audit_write('partner.created', 'partner', p_name,
    jsonb_build_object('type', p_type, 'country', p_country, 'owner', p_owner_name,
                       'status', p_status, 'contact', p_contact_name, 'email', p_email));
  return jsonb_build_object(
    'id', v_id, 'name', p_name, 'type', p_type, 'country', p_country,
    'ownerName', p_owner_name, 'status', p_status, 'statusCls', v_cls,
    'contactName', p_contact_name, 'email', p_email, 'phone', p_phone);
end $$;

-- ---------- create an engagement (optionally tag a teammate) ----------
drop function if exists public.create_engagement(text,text,text,text,text,text);
create or replace function public.create_engagement(
  p_name text, p_stage text, p_owner_name text, p_pipeline text,
  p_next_action text default null, p_due_key text default 'week', p_tagged_email text default null
) returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_ref text; v_pill text; v_pill_txt text; v_stage text; v_id uuid; v_who text;
  v_note text := nullif(trim(coalesce(p_next_action, '')), '');
  v_tag  text := lower(nullif(trim(coalesce(p_tagged_email, '')), ''));
  v_entity uuid := (select id from public.entities where code = 'KE');
begin
  perform public.assert_access('crm', 2);
  v_ref := public.next_ref(case when p_pipeline = 'down' then 'DST' else 'ENG' end);
  v_stage := coalesce(nullif(trim(coalesce(p_stage, '')), ''),
                      case when p_pipeline = 'down' then 'Identification' else 'Discovery' end);
  select case p_due_key when 'today' then 'today' when 'over' then 'over' else 'week' end,
         case p_due_key when 'today' then 'Today' when 'over' then 'Overdue' when 'nweek' then 'Next week' else 'This week' end
    into v_pill, v_pill_txt;
  insert into public.engagements(ref, entity_id, name, stage, owner_name, pill, pill_txt, pipeline)
  values (v_ref, v_entity, p_name, v_stage, p_owner_name, v_pill, v_pill_txt, p_pipeline)
  returning id into v_id;
  v_who := coalesce((select name from public.app_users where auth_id = auth.uid()), p_owner_name);
  if v_note is not null then
    insert into public.engagement_updates(engagement_id, channel, who, note, happened)
    values (v_id, 'Note', v_who, v_note, 'Today');
  end if;
  -- tag a teammate → in-app notification (email is sent client-side via /api/notify)
  if v_tag is not null and exists (select 1 from public.app_users where email = v_tag) then
    insert into public.notifications(entity_id, recipient_email, kind, title, body, link_view, link_ref)
    values (v_entity, v_tag, 'eng_tag',
            v_who || ' tagged you on ' || v_ref,
            p_name || ' — ' || v_stage, 'crm', v_ref);
  end if;
  perform public.audit_write('engagement.created', 'engagement', v_ref,
    jsonb_build_object('name', p_name, 'stage', v_stage, 'owner', p_owner_name,
                       'pipeline', p_pipeline, 'note', v_note, 'tagged', v_tag));
  return jsonb_build_object(
    'id', v_ref, 'n', p_name, 'st', v_stage, 'o', p_owner_name,
    'pl', v_pill, 'plt', v_pill_txt, 'pipeline', p_pipeline, 'taggedEmail', v_tag);
end $$;

-- ---------- mark my notifications read ----------
create or replace function public.mark_notifications_seen(p_ids uuid[] default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_email text := lower(coalesce(nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'email', ''));
  v_n int;
begin
  update public.notifications set seen = true
   where recipient_email = v_email and seen = false and (p_ids is null or id = any(p_ids));
  get diagnostics v_n = row_count;
  return jsonb_build_object('seen', v_n);
end $$;

-- ---------- grants ----------
do $$
declare fn text;
begin
  foreach fn in array array[
    'create_project(text,text,numeric,date,date,text,text)',
    'add_project_milestone(uuid,text,numeric,date,date,text)',
    'set_milestone_status(uuid,text)',
    'create_field_activity(uuid,text,text,text,date,text)',
    'create_partner(text,text,text,text,text,text,text,text)',
    'create_engagement(text,text,text,text,text,text,text)',
    'mark_notifications_seen(uuid[])']
  loop
    execute format('revoke execute on function public.%s from public, anon', fn);
    execute format('grant execute on function public.%s to authenticated', fn);
  end loop;
end $$;
