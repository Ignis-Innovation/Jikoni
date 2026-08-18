-- ============================================================
-- 0063 — Admin loses User Management (users:0)
-- A plain Admin can no longer see User Management or invite members — inviting is now
-- Super Admin (users:3) or a Sub Admin in HR mode only. Admin keeps its broad
-- operational access; HR stays hidden and Compliance stays view-only. Idempotent.
-- ============================================================

update public.role_templates set level = 0 where role_key = 'admin' and module = 'users';

update public.user_permissions set level = 0
  where module = 'users'
    and email in (select lower(email) from public.app_users where role_key = 'admin');
