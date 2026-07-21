-- ============================================================
-- 0010 · Leave overlap guard
-- A new or edited request may not overlap any of the applicant's
-- own pending or approved leave — you can't be on leave twice.
-- Rejected / cancelled requests don't block the dates.
-- ============================================================

create or replace function public.apply_leave(p_kind text, p_from date, p_to date, p_reason text default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_me uuid := (select id from public.app_users where auth_id = auth.uid());
  v_days numeric; v_ref text; bal record; clash record;
  v_year int := extract(year from p_from)::int;
  v_entity uuid := (select id from public.entities where code = 'KE');
begin
  if v_me is null then raise exception 'No staff record for this login'; end if;
  if p_to < p_from then raise exception 'End date is before start date'; end if;
  v_days := (p_to - p_from) + 1;

  select ref, from_date, to_date, state into clash
  from public.leave_applications
  where app_user_id = v_me and state in ('pending','approved')
    and from_date <= p_to and to_date >= p_from
  limit 1;
  if found then
    if clash.state = 'approved' then
      raise exception 'You are already booked on leave from % to %. Please choose dates outside that range.',
        to_char(clash.from_date, 'DD Mon'), to_char(clash.to_date, 'DD Mon');
    else
      raise exception 'You already have a pending request covering % to %. Edit or delete it under My leave requests instead.',
        to_char(clash.from_date, 'DD Mon'), to_char(clash.to_date, 'DD Mon');
    end if;
  end if;

  select * into bal from public.leave_balances where app_user_id = v_me and kind = p_kind and year = v_year;
  if not found then raise exception 'No % leave balance for %', p_kind, v_year; end if;
  if v_days > bal.entitled - bal.used - bal.reserved then
    raise exception 'Insufficient balance: % days requested, % available', v_days, bal.entitled - bal.used - bal.reserved;
  end if;
  v_ref := public.next_ref('LV');
  insert into public.leave_applications(ref, entity_id, app_user_id, kind, from_date, to_date, days, reason)
  values (v_ref, v_entity, v_me, p_kind, p_from, p_to, v_days, p_reason);
  update public.leave_balances set reserved = reserved + v_days
  where app_user_id = v_me and kind = p_kind and year = v_year;
  perform public.audit_write('leave.applied','leave', v_ref,
    jsonb_build_object('kind', p_kind, 'from', p_from, 'to', p_to, 'days', v_days));
  return jsonb_build_object('id', v_ref, 'days', v_days, 'state', 'pending');
end $$;

create or replace function public.update_leave(p_ref text, p_kind text, p_from date, p_to date, p_reason text default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_me uuid := (select id from public.app_users where auth_id = auth.uid());
  l record; bal record; clash record; v_days numeric;
begin
  if v_me is null then raise exception 'No staff record for this login'; end if;
  select * into l from public.leave_applications where ref = p_ref;
  if not found then raise exception 'Leave application % not found', p_ref; end if;
  if l.app_user_id <> v_me then raise exception 'You can only edit your own leave request'; end if;
  if l.state <> 'pending' then raise exception 'Only pending requests can be edited — % is already %', p_ref, l.state; end if;
  if p_to < p_from then raise exception 'End date is before start date'; end if;
  v_days := (p_to - p_from) + 1;

  select ref, from_date, to_date, state into clash
  from public.leave_applications
  where app_user_id = v_me and id <> l.id and state in ('pending','approved')
    and from_date <= p_to and to_date >= p_from
  limit 1;
  if found then
    if clash.state = 'approved' then
      raise exception 'You are already booked on leave from % to %. Please choose dates outside that range.',
        to_char(clash.from_date, 'DD Mon'), to_char(clash.to_date, 'DD Mon');
    else
      raise exception 'You already have a pending request covering % to %. Edit or delete it under My leave requests instead.',
        to_char(clash.from_date, 'DD Mon'), to_char(clash.to_date, 'DD Mon');
    end if;
  end if;

  -- release the old hold, then take the new one (kind/year may have changed)
  update public.leave_balances set reserved = reserved - l.days
  where app_user_id = v_me and kind = l.kind and year = extract(year from l.from_date)::int;

  select * into bal from public.leave_balances
  where app_user_id = v_me and kind = p_kind and year = extract(year from p_from)::int;
  if not found then raise exception 'No % leave balance for %', p_kind, extract(year from p_from)::int; end if;
  if v_days > bal.entitled - bal.used - bal.reserved then
    raise exception 'Insufficient balance: % days requested, % available', v_days, bal.entitled - bal.used - bal.reserved;
  end if;
  update public.leave_balances set reserved = reserved + v_days
  where app_user_id = v_me and kind = p_kind and year = extract(year from p_from)::int;

  update public.leave_applications
  set kind = p_kind, from_date = p_from, to_date = p_to, days = v_days,
      reason = coalesce(p_reason, reason), updated_at = now()
  where id = l.id;

  perform public.audit_write('leave.updated','leave', p_ref,
    jsonb_build_object('kind', p_kind, 'from', p_from, 'to', p_to, 'days', v_days));
  return jsonb_build_object('id', p_ref, 'days', v_days, 'state', 'pending');
end $$;
