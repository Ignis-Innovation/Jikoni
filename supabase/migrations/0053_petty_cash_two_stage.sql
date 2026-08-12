-- ============================================================
-- 0053 — Petty-cash two-stage approval
-- A request now needs BOTH a Super Admin (users:3) AND an HR approver (hr>=2),
-- by two DIFFERENT people, in either order. Either one may reject. The request
-- stays 'pending' until both stages are stamped, then flips to 'approved'.
-- Reworks the schema + RPCs from 0049. Idempotent.
-- ============================================================

-- ---------- schema: per-stage stamps ----------
alter table public.petty_cash_requests add column if not exists super_approved_by uuid references public.app_users(id);
alter table public.petty_cash_requests add column if not exists super_approved_at timestamptz;
alter table public.petty_cash_requests add column if not exists hr_approved_by    uuid references public.app_users(id);
alter table public.petty_cash_requests add column if not exists hr_approved_at    timestamptz;

-- ---------- role helpers (by the caller's linked app_users email) ----------
-- Super-Admin approver = full (level 3) access to the users module.
create or replace function public.can_petty_super() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.user_permissions p
    join public.app_users u on lower(u.email) = p.email
    where u.auth_id = auth.uid() and p.module = 'users' and p.level >= 3
  )
$$;

-- HR approver = edit+ (level 2) access to the hr module.
create or replace function public.can_petty_hr() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.user_permissions p
    join public.app_users u on lower(u.email) = p.email
    where u.auth_id = auth.uid() and p.module = 'hr' and p.level >= 2
  )
$$;

-- May the caller see/act on the petty-cash queue at all? (Super Admin or HR)
create or replace function public.can_decide_petty() returns boolean
language sql stable security definer set search_path = public as $$
  select public.can_petty_super() or public.can_petty_hr()
$$;

-- ---------- frontend read shape (now carries both stage stamps) ----------
create or replace function public.pcr_json(p_ref text) returns jsonb
language sql stable security definer set search_path = public as $$
  select jsonb_build_object(
    'id', r.ref, 'item', r.item, 'amount', r.amount,
    'needBy', to_char(r.need_by, 'YYYY-MM-DD'), 'reason', r.reason, 'state', r.state,
    'requester', rq.name, 'requesterEmail', rq.email,
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

-- ---------- submit (staff) — notify the Super Admins + HR approvers ----------
create or replace function public.submit_petty_cash_request(
  p_item text, p_amount numeric, p_need_by date default null, p_reason text default null
) returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_ref text;
  v_entity uuid := (select id from public.entities where code = 'KE');
  v_me uuid := (select id from public.app_users where auth_id = auth.uid());
  v_name text; v_email text;
begin
  if v_me is null then raise exception 'No user is linked to this login'; end if;
  if nullif(trim(coalesce(p_item, '')), '') is null then raise exception 'What is the money for? An item is required'; end if;
  if coalesce(p_amount, 0) <= 0 then raise exception 'Enter an amount greater than zero'; end if;
  select name, email into v_name, v_email from public.app_users where id = v_me;
  v_ref := public.next_ref('PCR');
  insert into public.petty_cash_requests(ref, entity_id, requester_id, requester_name, item, amount, need_by, reason)
  values (v_ref, v_entity, v_me, v_name, trim(p_item), p_amount, p_need_by, nullif(trim(coalesce(p_reason, '')), ''));
  -- bell the approvers (Super Admin users:3, or HR hr>=2)
  insert into public.notifications(entity_id, recipient_email, kind, title, body, link_view, link_ref)
  select v_entity, lower(u.email), 'petty_cash_request',
         v_name || ' requested petty cash',
         trim(p_item) || ' — KES ' || to_char(p_amount, 'FM999,999,990'), 'finance', v_ref
  from public.app_users u
  join public.user_permissions p on p.email = lower(u.email)
  where ((p.module = 'users' and p.level >= 3) or (p.module = 'hr' and p.level >= 2))
    and lower(u.email) <> lower(v_email);
  perform public.audit_write('petty_cash.requested', 'petty_cash_request', v_ref,
    jsonb_build_object('item', p_item, 'amount', p_amount));
  return public.pcr_json(v_ref);
end $$;

-- ---------- decide (Super Admin + HR, two distinct people, either order) ----------
create or replace function public.decide_petty_cash_request(p_ref text, p_approve boolean, p_note text default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_me uuid := (select id from public.app_users where auth_id = auth.uid());
  v_entity uuid := (select id from public.entities where code = 'KE');
  v_is_super boolean := public.can_petty_super();
  v_is_hr boolean := public.can_petty_hr();
  v_who text; r record;
  v_stage text;            -- 'super' | 'hr' — the stage this call fills
  v_both boolean := false; -- true once both stages are stamped
begin
  if not (v_is_super or v_is_hr) then
    raise exception 'Only a Super Admin or HR can decide petty-cash requests';
  end if;
  select * into r from public.petty_cash_requests where ref = p_ref;
  if not found then raise exception 'Request not found'; end if;
  if r.state <> 'pending' then raise exception 'This request was already decided'; end if;
  if r.requester_id = v_me then raise exception 'You cannot decide your own request'; end if;
  select name into v_who from public.app_users where id = v_me;

  -- rejection ends it immediately, whatever stage we are at
  if not p_approve then
    update public.petty_cash_requests
      set state = 'rejected', decided_by = v_me, decided_at = now(),
          decision_note = nullif(trim(coalesce(p_note, '')), ''), updated_at = now()
      where ref = p_ref;
    insert into public.notifications(entity_id, recipient_email, kind, title, body, link_view, link_ref)
    values (v_entity, lower((select email from public.app_users where id = r.requester_id)),
            'petty_cash_decided', 'Petty cash rejected',
            r.item || ' — KES ' || to_char(r.amount, 'FM999,999,990') ||
              case when p_note is not null and trim(p_note) <> '' then ' · ' || trim(p_note) else '' end,
            'staffportal', p_ref);
    perform public.audit_write('petty_cash.rejected', 'petty_cash_request', p_ref,
      jsonb_build_object('amount', r.amount, 'note', p_note));
    return public.pcr_json(p_ref);
  end if;

  -- approval: fill whichever stage the caller is eligible for and hasn't filled.
  -- The two stages must be two different people.
  if v_is_super and r.super_approved_by is null and coalesce(r.hr_approved_by, '00000000-0000-0000-0000-000000000000') <> v_me then
    v_stage := 'super';
  elsif v_is_hr and r.hr_approved_by is null and coalesce(r.super_approved_by, '00000000-0000-0000-0000-000000000000') <> v_me then
    v_stage := 'hr';
  else
    raise exception 'Nothing left for you to approve on this request (each stage needs a different person)';
  end if;

  if v_stage = 'super' then
    update public.petty_cash_requests set super_approved_by = v_me, super_approved_at = now(), updated_at = now() where ref = p_ref;
    v_both := r.hr_approved_by is not null;
  else
    update public.petty_cash_requests set hr_approved_by = v_me, hr_approved_at = now(), updated_at = now() where ref = p_ref;
    v_both := r.super_approved_by is not null;
  end if;

  if v_both then
    -- second (final) approval → fully approved
    update public.petty_cash_requests
      set state = 'approved', decided_by = v_me, decided_at = now(),
          decision_note = nullif(trim(coalesce(p_note, '')), ''), updated_at = now()
      where ref = p_ref;
    insert into public.notifications(entity_id, recipient_email, kind, title, body, link_view, link_ref)
    values (v_entity, lower((select email from public.app_users where id = r.requester_id)),
            'petty_cash_decided', 'Petty cash approved',
            r.item || ' — KES ' || to_char(r.amount, 'FM999,999,990'), 'staffportal', p_ref);
    perform public.audit_write('petty_cash.approved', 'petty_cash_request', p_ref,
      jsonb_build_object('amount', r.amount));
  else
    -- first approval → still pending; bell the other approver group
    insert into public.notifications(entity_id, recipient_email, kind, title, body, link_view, link_ref)
    select v_entity, lower(u.email), 'petty_cash_request',
           'Petty cash awaiting your approval',
           r.requester_name || ' · ' || r.item || ' — KES ' || to_char(r.amount, 'FM999,999,990'), 'finance', p_ref
    from public.app_users u
    join public.user_permissions p on p.email = lower(u.email)
    where lower(u.email) <> lower(v_who)
      and case when v_stage = 'super' then (p.module = 'hr' and p.level >= 2)
                                       else (p.module = 'users' and p.level >= 3) end;
    perform public.audit_write('petty_cash.stage_approved', 'petty_cash_request', p_ref,
      jsonb_build_object('stage', v_stage, 'amount', r.amount));
  end if;

  return public.pcr_json(p_ref);
end $$;

-- ---------- grants (re-assert for the replaced functions) ----------
do $$
declare fn text;
begin
  foreach fn in array array[
    'submit_petty_cash_request(text,numeric,date,text)',
    'decide_petty_cash_request(text,boolean,text)',
    'can_decide_petty()',
    'can_petty_super()',
    'can_petty_hr()',
    'pcr_json(text)']
  loop
    execute format('revoke execute on function public.%s from public, anon', fn);
    execute format('grant execute on function public.%s to authenticated', fn);
  end loop;
end $$;
