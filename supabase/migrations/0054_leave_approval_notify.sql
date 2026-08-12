-- ============================================================
-- 0054 — Leave approval: email the employee + bell every user
-- On approval we broadcast a bell notification to ALL users ("<name> is on leave
-- until <end>") and return the applicant's name/email/dates so the client can
-- send the approval email via /api/notify. Behaviour on reject is unchanged.
-- Idempotent (create or replace).
-- ============================================================
create or replace function public.decide_leave(p_ref text, p_approve boolean, p_note text default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  l record;
  v_me uuid := (select id from public.app_users where auth_id = auth.uid());
  v_year int;
  v_entity uuid := (select id from public.entities where code = 'KE');
  v_name text; v_email text;
begin
  perform public.assert_access('hr', 2);
  select * into l from public.leave_applications where ref = p_ref;
  if not found then raise exception 'Leave application % not found', p_ref; end if;
  perform public.assert_sod('leave approval (applicant ≠ approver)', l.app_user_id);
  select name, email into v_name, v_email from public.app_users where id = l.app_user_id;
  v_year := extract(year from l.from_date)::int;
  if p_approve then
    update public.leave_applications set state = 'approved', approver_id = v_me where id = l.id;
    update public.leave_balances set reserved = reserved - l.days, used = used + l.days
    where app_user_id = l.app_user_id and kind = l.kind and year = v_year;
    -- bell EVERY user: <name> is on leave until <end>
    insert into public.notifications(entity_id, recipient_email, kind, title, body, link_view, link_ref)
    select v_entity, lower(u.email), 'leave',
           v_name || ' is on leave',
           v_name || ' is on leave until ' || to_char(l.to_date, 'DD Mon YYYY'),
           'hr', p_ref
    from public.app_users u
    where u.email is not null;
  else
    update public.leave_applications set state = 'rejected', approver_id = v_me, reason = coalesce(p_note, reason) where id = l.id;
    update public.leave_balances set reserved = reserved - l.days
    where app_user_id = l.app_user_id and kind = l.kind and year = v_year;
  end if;
  perform public.audit_write(case when p_approve then 'leave.approved' else 'leave.rejected' end, 'leave', p_ref,
    jsonb_build_object('days', l.days, 'note', p_note));
  return jsonb_build_object(
    'id', p_ref,
    'state', case when p_approve then 'approved' else 'rejected' end,
    'who', v_name, 'email', v_email,
    'from', to_char(l.from_date, 'DD Mon YYYY'), 'to', to_char(l.to_date, 'DD Mon YYYY'));
end $$;
