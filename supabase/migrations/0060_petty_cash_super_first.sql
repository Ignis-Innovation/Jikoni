-- ============================================================
-- 0060 — Petty-cash: Super Admin approves FIRST, then HR
-- Previously the two approvals (Super Admin users:3 + HR hr>=2) could happen in
-- either order. Now the order is strict: the Super Admin must sign off first, and
-- only then can HR give the second approval that releases the funds. Still two
-- different people; either may reject at any point. Idempotent (replaces the RPC).
-- ============================================================

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

  -- approval, strict order: Super Admin first, then HR. The two stages must be two
  -- different people, so HR is blocked until a (different) Super Admin has signed off.
  if v_is_super and r.super_approved_by is null then
    v_stage := 'super';
  elsif v_is_hr and r.super_approved_by is null then
    raise exception 'The Super Admin must approve this request first';
  elsif v_is_hr and r.hr_approved_by is null and r.super_approved_by <> v_me then
    v_stage := 'hr';
  elsif v_is_hr and r.hr_approved_by is null and r.super_approved_by = v_me then
    raise exception 'You approved as Super Admin — a different person must give the HR sign-off';
  else
    raise exception 'Nothing left for you to approve on this request';
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
    -- first approval (Super Admin) → still pending; bell the HR approvers to sign off
    insert into public.notifications(entity_id, recipient_email, kind, title, body, link_view, link_ref)
    select v_entity, lower(u.email), 'petty_cash_request',
           'Petty cash awaiting your approval',
           r.requester_name || ' · ' || r.item || ' — KES ' || to_char(r.amount, 'FM999,999,990'), 'finance', p_ref
    from public.app_users u
    join public.user_permissions p on p.email = lower(u.email)
    where lower(u.email) <> lower(v_who)
      and p.module = 'hr' and p.level >= 2;
    perform public.audit_write('petty_cash.stage_approved', 'petty_cash_request', p_ref,
      jsonb_build_object('stage', v_stage, 'amount', r.amount));
  end if;

  return public.pcr_json(p_ref);
end $$;
