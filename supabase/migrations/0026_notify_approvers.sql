-- ============================================================================
-- 0026_notify_approvers.sql — fan a notification to everyone who can approve.
-- Used by submitForApproval so a submitted record reaches approvers' My Week.
-- SECURITY DEFINER because notifications has no direct insert policy (spine svc).
-- ============================================================================

create or replace function public.notify_approvers(
  p_type text, p_title text, p_body text default null, p_link text default null
) returns int language plpgsql security definer set search_path = public as $$
declare n int;
begin
  insert into public.notifications(user_id, channel, type, title, body, link, status)
  select distinct ur.user_id, 'in_app', p_type, p_title, p_body, p_link, 'sent'
  from public.user_roles ur
  join public.role_permissions rp on rp.role_id = ur.role_id
  join public.permissions p on p.id = rp.permission_id
  where p.key = 'approvals.act';
  get diagnostics n = row_count;
  return n;
end;
$$;
