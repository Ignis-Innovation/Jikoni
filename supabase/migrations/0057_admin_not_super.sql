-- ============================================================
-- 0057 — Make "Admin" distinct from "Super Admin", and demote Brian to Admin
-- Previously the admin and super templates were identical (both users:3), so an
-- Admin was indistinguishable from a Super Admin. Admin now gets users:2 — full
-- access to every module and can invite/manage members, but is NOT a super admin
-- (no access grant/revoke drawer, not a petty-cash first approver — those need
-- users:3). Then re-point brian55mwangi@gmail.com to the Admin role.
-- Idempotent.
-- ============================================================

-- 1) admin template: users edit (2), not full (3)
update public.role_templates set level = 2 where role_key = 'admin' and module = 'users';

-- 2) Brian → Admin: set the role label and re-seed his grants from the admin
--    template (full everywhere, users:2). This drops his stray users:3 super grant.
update public.app_users set role_key = 'admin' where lower(email) = 'brian55mwangi@gmail.com';
delete from public.user_permissions where email = 'brian55mwangi@gmail.com';
insert into public.user_permissions(email, module, level)
  select 'brian55mwangi@gmail.com', module, level from public.role_templates where role_key = 'admin'
on conflict (email, module) do update set level = excluded.level;
