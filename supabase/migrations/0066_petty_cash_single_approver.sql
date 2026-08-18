-- ============================================================
-- 0066 — Petty-cash: single approval, routed by who raised it
-- Replaces the two-stage (Super Admin THEN HR) flow with one approval whose approver
-- depends on the requester:
--   * a regular employee's request  → HR approves it
--   * HR's own request (hr>=2)       → a Super Admin approves it
--   * a Super Admin's own request    → auto-approved on submit (no second person)
-- The route is stamped on the row (approver_role) at submit time, and only the matching
-- role can decide it. Notifications go to the routed approver only (not both roles).
-- Reuses can_petty_super()/can_petty_hr() (0053). Idempotent.
-- ============================================================

alter table public.petty_cash_requests add column if not exists approver_role text;  -- 'hr' | 'super' | 'auto'

-- read shape now also carries the route
create or replace function public.pcr_json(p_ref text) returns jsonb
language sql stable security definer set search_path = public as $$
  select jsonb_build_object(
    'id', r.ref, 'item', r.item, 'amount', r.amount,
    'needBy', to_char(r.need_by, 'YYYY-MM-DD'), 'reason', r.reason, 'state', r.state,
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

-- ---------- submit (staff): route by the requester's own role ----------
create or replace function public.submit_petty_cash_request(
  p_item text, p_amount numeric, p_need_by date default null, p_reason text default null
) returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_ref text;
  v_entity uuid := (select id from public.entities where code = 'KE');
  v_me uuid := (select id from public.app_users where auth_id = auth.uid());
  v_name text; v_email text;
  v_is_super boolean; v_is_hr boolean;
  v_role text; v_mod text; v_lvl int; v_emails jsonb;
begin
  if v_me is null then raise exception 'No user is linked to this login'; end if;
  if nullif(trim(coalesce(p_item, '')), '') is null then raise exception 'What is the money for? An item is required'; end if;
  if coalesce(p_amount, 0) <= 0 then raise exception 'Enter an amount greater than zero'; end if;
  select name, email into v_name, v_email from public.app_users where id = v_me;

  -- the requester's OWN role decides where this goes
  v_is_super := exists (select 1 from public.user_permissions p where p.email = lower(v_email) and p.module = 'users' and p.level >= 3);
  v_is_hr    := exists (select 1 from public.user_permissions p where p.email = lower(v_email) and p.module = 'hr'    and p.level >= 2);

  v_ref := public.next_ref('PCR');

  -- a Super Admin's own petty cash is auto-approved on submit (they can't need a second person)
  if v_is_super then
    insert into public.petty_cash_requests(ref, entity_id, requester_id, requester_name, item, amount, need_by, reason,
                                            approver_role, state, decided_by, decided_at, decision_note)
    values (v_ref, v_entity, v_me, v_name, trim(p_item), p_amount, p_need_by, nullif(trim(coalesce(p_reason, '')), ''),
            'auto', 'approved', v_me, now(), 'Auto-approved — raised by a Super Admin');
    perform public.audit_write('petty_cash.requested', 'petty_cash_request', v_ref,
      jsonb_build_object('item', p_item, 'amount', p_amount, 'autoApproved', true));
    perform public.audit_write('petty_cash.approved', 'petty_cash_request', v_ref,
      jsonb_build_object('amount', p_amount, 'auto', true));
    return public.pcr_json(v_ref) || jsonb_build_object('autoApproved', true, 'approverRole', 'auto', 'approverEmails', '[]'::jsonb);
  end if;

  v_role := case when v_is_hr then 'super' else 'hr' end;   -- HR's own → Super Admin; everyone else → HR
  v_mod  := case when v_role = 'super' then 'users' else 'hr' end;
  v_lvl  := case when v_role = 'super' then 3 else 2 end;

  insert into public.petty_cash_requests(ref, entity_id, requester_id, requester_name, item, amount, need_by, reason, approver_role)
  values (v_ref, v_entity, v_me, v_name, trim(p_item), p_amount, p_need_by, nullif(trim(coalesce(p_reason, '')), ''), v_role);

  -- bell the routed approver(s) only, and collect their emails for the app to send
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
    jsonb_build_object('item', p_item, 'amount', p_amount, 'route', v_role));
  return public.pcr_json(v_ref) || jsonb_build_object('approverRole', v_role, 'approverEmails', v_emails);
end $$;

-- ---------- decide (single approval by the routed role) ----------
create or replace function public.decide_petty_cash_request(p_ref text, p_approve boolean, p_note text default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_me uuid := (select id from public.app_users where auth_id = auth.uid());
  v_entity uuid := (select id from public.entities where code = 'KE');
  v_is_super boolean := public.can_petty_super();
  v_is_hr boolean := public.can_petty_hr();
  r record; v_ok boolean;
begin
  if not (v_is_super or v_is_hr) then
    raise exception 'Only a Super Admin or HR can decide petty-cash requests';
  end if;
  select * into r from public.petty_cash_requests where ref = p_ref;
  if not found then raise exception 'Request not found'; end if;
  if r.state <> 'pending' then raise exception 'This request was already decided'; end if;
  if r.requester_id = v_me then raise exception 'You cannot decide your own request'; end if;

  -- the caller must hold the role this request was routed to
  v_ok := case
    when r.approver_role = 'super' then v_is_super
    when r.approver_role = 'hr' then v_is_hr
    else (v_is_super or v_is_hr)   -- legacy rows with no stamped route
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

  -- tell the requester (bell); the app also emails them
  insert into public.notifications(entity_id, recipient_email, kind, title, body, link_view, link_ref)
  values (v_entity, lower((select email from public.app_users where id = r.requester_id)),
          'petty_cash_decided',
          case when p_approve then 'Petty cash approved' else 'Petty cash rejected' end,
          r.item || ' — KES ' || to_char(r.amount, 'FM999,999,990') ||
            case when p_note is not null and trim(p_note) <> '' then ' · ' || trim(p_note) else '' end,
          'staffportal', p_ref);
  perform public.audit_write(case when p_approve then 'petty_cash.approved' else 'petty_cash.rejected' end,
    'petty_cash_request', p_ref, jsonb_build_object('amount', r.amount, 'note', p_note));

  return public.pcr_json(p_ref);
end $$;

-- backfill any existing pending rows with their route (requester with hr>=2 → super, else hr)
update public.petty_cash_requests t set approver_role = case
  when exists (select 1 from public.app_users u join public.user_permissions p on p.email = lower(u.email)
               where u.id = t.requester_id and p.module = 'hr' and p.level >= 2) then 'super'
  else 'hr' end
where t.state = 'pending' and t.approver_role is null;
