-- ============================================================
-- 0052 — "Super Admin" role template
-- Full (level 3) access to every module. invite_user (0008) validates the role
-- key against public.role_templates, so this row is all the backend needs. A
-- super admin is detected client-side as users:3 (Users.tsx), which this grants.
-- The petty-cash two-stage flow (0053) treats users:3 as the Super-Admin approver.
-- Idempotent via on-conflict.
-- ============================================================
insert into public.role_templates(role_key, module, level)
select 'super', m, 3 from (values
  ('finance'),('procurement'),('inventory'),('hr'),('deploy'),('readiness'),
  ('raise'),('crm'),('projects'),('reports'),('compliance'),('dataroom'),
  ('settings'),('users')
) as t(m)
on conflict (role_key, module) do nothing;
