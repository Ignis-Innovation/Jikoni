-- ============================================================
-- 0009 · Leave self-service — edit / delete your own request
-- The applicant can change or withdraw a request only while it
-- is still pending (before HR decides). The reserved-days hold
-- moves with the edit and is released on delete. Audited.
-- ============================================================

create or replace function public.update_leave(p_ref text, p_kind text, p_from date, p_to date, p_reason text default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_me uuid := (select id from public.app_users where auth_id = auth.uid());
  l record; bal record; v_days numeric;
begin
  if v_me is null then raise exception 'No staff record for this login'; end if;
  select * into l from public.leave_applications where ref = p_ref;
  if not found then raise exception 'Leave application % not found', p_ref; end if;
  if l.app_user_id <> v_me then raise exception 'You can only edit your own leave request'; end if;
  if l.state <> 'pending' then raise exception 'Only pending requests can be edited — % is already %', p_ref, l.state; end if;
  if p_to < p_from then raise exception 'End date is before start date'; end if;
  v_days := (p_to - p_from) + 1;

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

create or replace function public.delete_leave(p_ref text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_me uuid := (select id from public.app_users where auth_id = auth.uid());
  l record;
begin
  if v_me is null then raise exception 'No staff record for this login'; end if;
  select * into l from public.leave_applications where ref = p_ref;
  if not found then raise exception 'Leave application % not found', p_ref; end if;
  if l.app_user_id <> v_me then raise exception 'You can only delete your own leave request'; end if;
  if l.state <> 'pending' then raise exception 'Only pending requests can be deleted — % is already %', p_ref, l.state; end if;

  update public.leave_balances set reserved = reserved - l.days
  where app_user_id = v_me and kind = l.kind and year = extract(year from l.from_date)::int;
  delete from public.leave_applications where id = l.id;

  perform public.audit_write('leave.deleted','leave', p_ref,
    jsonb_build_object('kind', l.kind, 'from', l.from_date, 'to', l.to_date, 'days', l.days));
  return jsonb_build_object('id', p_ref, 'state', 'deleted');
end $$;

do $$
declare fn text;
begin
  foreach fn in array array['update_leave(text,text,date,date,text)','delete_leave(text)']
  loop
    execute format('revoke execute on function public.%s from public, anon', fn);
    execute format('grant execute on function public.%s to authenticated', fn);
  end loop;
end $$;
