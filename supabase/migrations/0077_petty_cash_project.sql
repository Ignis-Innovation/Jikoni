-- ============================================================
-- 0077 — Petty cash → project: tie a request to a project, and on approval
-- accrue the amount into that project's actuals (spentAmount / Spent).
-- Adds project_code to petty_cash_requests, threads it through submit, exposes it
-- in the read shape, and — when a request is approved — records a project_expense
-- (which recompute_project_money folds into the project's spend). Idempotent:
-- pcr_accrue() no-ops if there's no project or the amount was already recorded.
-- ============================================================

alter table public.petty_cash_requests add column if not exists project_code text;

-- read shape now carries the tied project (name)
create or replace function public.pcr_json(p_ref text) returns jsonb
language sql stable security definer set search_path = public as $$
  select jsonb_build_object(
    'id', r.ref, 'item', r.item, 'amount', r.amount,
    'needBy', to_char(r.need_by, 'YYYY-MM-DD'), 'reason', r.reason, 'state', r.state,
    'project', r.project_code,
    'requester', rq.name, 'requesterEmail', rq.email, 'approverRole', r.approver_role,
    'superApprovedBy', su.name, 'superApprovedAt', r.super_approved_at,
    'hrApprovedBy', hr.name, 'hrApprovedAt', r.hr_approved_at,
    'decidedBy', dc.name, 'decidedAt', r.decided_at, 'note', r.decision_note,
    'createdAt', r.created_at)
  from public.petty_cash_requests r
  left join public.app_users rq on rq.id = r.requester_id
  left join public.app_users su on su.id = r.super_approved_by
  left join public.app_users hr on hr.id = r.hr_approved_by
  left join public.app_users dc on dc.id = r.decided_by
  where r.ref = p_ref
$$;

-- Accrue an APPROVED petty-cash request into its project's actuals. Records one
-- project_expense keyed by the request ref (idempotent), then recomputes spend.
create or replace function public.pcr_accrue(p_ref text) returns void
language plpgsql security definer set search_path = public as $$
declare r record; v_project uuid;
begin
  select * into r from public.petty_cash_requests where ref = p_ref;
  if not found or r.state <> 'approved' or nullif(trim(coalesce(r.project_code, '')), '') is null then return; end if;
  select id into v_project from public.projects where name = r.project_code;
  if v_project is null then return; end if;
  if exists (select 1 from public.project_expenses where project_id = v_project and description like 'Petty cash ' || p_ref || ' %') then return; end if;
  insert into public.project_expenses(project_id, description, amount, spent_on, added_by)
  values (v_project, 'Petty cash ' || p_ref || ' — ' || r.item, r.amount,
          coalesce(r.decided_at::date, current_date), coalesce(r.requester_name, 'Petty cash'));
  perform public.recompute_project_money(v_project);
end $$;

-- ---------- submit (staff): now accepts an optional project ----------
drop function if exists public.submit_petty_cash_request(text, numeric, date, text);
create or replace function public.submit_petty_cash_request(
  p_item text, p_amount numeric, p_need_by date default null, p_reason text default null, p_project_code text default null
) returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_ref text;
  v_entity uuid := (select id from public.entities where code = 'KE');
  v_me uuid := (select id from public.app_users where auth_id = auth.uid());
  v_name text; v_email text;
  v_is_super boolean; v_is_hr boolean;
  v_role text; v_mod text; v_lvl int; v_emails jsonb;
  v_project text := nullif(trim(coalesce(p_project_code, '')), '');
begin
  if v_me is null then raise exception 'No user is linked to this login'; end if;
  if nullif(trim(coalesce(p_item, '')), '') is null then raise exception 'What is the money for? An item is required'; end if;
  if coalesce(p_amount, 0) <= 0 then raise exception 'Enter an amount greater than zero'; end if;
  select name, email into v_name, v_email from public.app_users where id = v_me;

  v_is_super := exists (select 1 from public.user_permissions p where p.email = lower(v_email) and p.module = 'users' and p.level >= 3);
  v_is_hr    := exists (select 1 from public.user_permissions p where p.email = lower(v_email) and p.module = 'hr'    and p.level >= 2);

  v_ref := public.next_ref('PCR');

  -- a Super Admin's own petty cash is auto-approved on submit → accrue immediately
  if v_is_super then
    insert into public.petty_cash_requests(ref, entity_id, requester_id, requester_name, item, amount, need_by, reason,
                                            project_code, approver_role, state, decided_by, decided_at, decision_note)
    values (v_ref, v_entity, v_me, v_name, trim(p_item), p_amount, p_need_by, nullif(trim(coalesce(p_reason, '')), ''),
            v_project, 'auto', 'approved', v_me, now(), 'Auto-approved — raised by a Super Admin');
    perform public.audit_write('petty_cash.requested', 'petty_cash_request', v_ref,
      jsonb_build_object('item', p_item, 'amount', p_amount, 'autoApproved', true, 'project', v_project));
    perform public.audit_write('petty_cash.approved', 'petty_cash_request', v_ref,
      jsonb_build_object('amount', p_amount, 'auto', true));
    perform public.pcr_accrue(v_ref);
    return public.pcr_json(v_ref) || jsonb_build_object('autoApproved', true, 'approverRole', 'auto', 'approverEmails', '[]'::jsonb);
  end if;

  v_role := case when v_is_hr then 'super' else 'hr' end;
  v_mod  := case when v_role = 'super' then 'users' else 'hr' end;
  v_lvl  := case when v_role = 'super' then 3 else 2 end;

  insert into public.petty_cash_requests(ref, entity_id, requester_id, requester_name, item, amount, need_by, reason, project_code, approver_role)
  values (v_ref, v_entity, v_me, v_name, trim(p_item), p_amount, p_need_by, nullif(trim(coalesce(p_reason, '')), ''), v_project, v_role);

  insert into public.notifications(entity_id, recipient_email, kind, title, body, link_view, link_ref)
  select v_entity, lower(u.email), 'petty_cash_request',
         v_name || ' requested petty cash',
         trim(p_item) || ' — KES ' || to_char(p_amount, 'FM999,999,990'), 'finance', v_ref
  from public.app_users u
  join public.user_permissions p on p.email = lower(u.email)
  where p.module = v_mod and p.level >= v_lvl and lower(u.email) <> lower(v_email);

  select coalesce(jsonb_agg(distinct lower(u.email)), '[]'::jsonb) into v_emails
  from public.app_users u
  join public.user_permissions p on p.email = lower(u.email)
  where p.module = v_mod and p.level >= v_lvl and lower(u.email) <> lower(v_email);

  perform public.audit_write('petty_cash.requested', 'petty_cash_request', v_ref,
    jsonb_build_object('item', p_item, 'amount', p_amount, 'route', v_role, 'project', v_project));
  return public.pcr_json(v_ref) || jsonb_build_object('approverRole', v_role, 'approverEmails', v_emails);
end $$;

-- ---------- edit (staff): allow changing the tied project while pending ----------
drop function if exists public.edit_petty_cash_request(text, text, numeric, date, text);
create or replace function public.edit_petty_cash_request(
  p_ref text, p_item text, p_amount numeric, p_need_by date default null, p_reason text default null, p_project_code text default null
) returns jsonb language plpgsql security definer set search_path = public as $$
declare v_me uuid := (select id from public.app_users where auth_id = auth.uid()); r record;
begin
  select * into r from public.petty_cash_requests where ref = p_ref;
  if not found then raise exception 'Request not found'; end if;
  if r.requester_id <> v_me then raise exception 'You can only edit your own request'; end if;
  if r.state <> 'pending' then raise exception 'This request was already decided'; end if;
  if nullif(trim(coalesce(p_item, '')), '') is null then raise exception 'An item is required'; end if;
  if coalesce(p_amount, 0) <= 0 then raise exception 'Enter an amount greater than zero'; end if;
  update public.petty_cash_requests
    set item = trim(p_item), amount = p_amount, need_by = p_need_by,
        reason = nullif(trim(coalesce(p_reason, '')), ''),
        project_code = nullif(trim(coalesce(p_project_code, '')), ''), updated_at = now()
    where ref = p_ref;
  perform public.audit_write('petty_cash.edited', 'petty_cash_request', p_ref,
    jsonb_build_object('item', p_item, 'amount', p_amount, 'project', p_project_code));
  return public.pcr_json(p_ref);
end $$;

-- ---------- decide: on approval, accrue to the project ----------
create or replace function public.decide_petty_cash_request(p_ref text, p_approve boolean, p_note text default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_me uuid := (select id from public.app_users where auth_id = auth.uid());
  v_entity uuid := (select id from public.entities where code = 'KE');
  v_is_super boolean := public.can_petty_super();
  v_is_hr boolean := public.can_petty_hr();
  r record; v_ok boolean;
begin
  if not (v_is_super or v_is_hr) then raise exception 'Only a Super Admin or HR can decide petty-cash requests'; end if;
  select * into r from public.petty_cash_requests where ref = p_ref;
  if not found then raise exception 'Request not found'; end if;
  if r.state <> 'pending' then raise exception 'This request was already decided'; end if;
  if r.requester_id = v_me then raise exception 'You cannot decide your own request'; end if;

  v_ok := case
    when r.approver_role = 'super' then v_is_super
    when r.approver_role = 'hr' then v_is_hr
    else (v_is_super or v_is_hr)
  end;
  if not v_ok then
    raise exception '%', case when r.approver_role = 'super'
      then 'This request is awaiting Super Admin approval'
      else 'This request is awaiting HR approval' end;
  end if;

  update public.petty_cash_requests
    set state = case when p_approve then 'approved' else 'rejected' end,
        decided_by = v_me, decided_at = now(),
        decision_note = nullif(trim(coalesce(p_note, '')), ''), updated_at = now()
    where ref = p_ref;

  if p_approve then perform public.pcr_accrue(p_ref); end if;   -- accrue into the tied project

  insert into public.notifications(entity_id, recipient_email, kind, title, body, link_view, link_ref)
  values (v_entity, lower((select email from public.app_users where id = r.requester_id)),
          'petty_cash_decided',
          case when p_approve then 'Petty cash approved' else 'Petty cash rejected' end,
          r.item || ' — KES ' || to_char(r.amount, 'FM999,999,990') ||
            case when p_note is not null and trim(p_note) <> '' then ' · ' || trim(p_note) else '' end,
          'staffportal', p_ref);
  perform public.audit_write(case when p_approve then 'petty_cash.approved' else 'petty_cash.rejected' end,
    'petty_cash_request', p_ref, jsonb_build_object('amount', r.amount, 'note', p_note, 'project', r.project_code));

  return public.pcr_json(p_ref);
end $$;

revoke execute on function public.submit_petty_cash_request(text,numeric,date,text,text) from public, anon;
grant  execute on function public.submit_petty_cash_request(text,numeric,date,text,text) to authenticated;
revoke execute on function public.edit_petty_cash_request(text,text,numeric,date,text,text) from public, anon;
grant  execute on function public.edit_petty_cash_request(text,text,numeric,date,text,text) to authenticated;
revoke execute on function public.pcr_accrue(text) from public, anon;
grant  execute on function public.pcr_accrue(text) to authenticated, service_role;
