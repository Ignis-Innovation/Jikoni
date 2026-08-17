-- ============================================================
-- 0059 — Restrict the Admin role: hide Human Resources, view-only Compliance
-- HR holds payroll, salaries and personal records, so an Admin (Brian, Elizabeth,
-- Wilson) should not see it — only Super Admin does. Compliance was previously
-- absent from the admin template (None); Admins should be able to read it (View).
-- Updates the template and re-syncs every existing admin's live grants. Idempotent.
-- ============================================================

-- 1) admin template: HR none, Compliance view
update public.role_templates set level = 0 where role_key = 'admin' and module = 'hr';
update public.role_templates set level = 1 where role_key = 'admin' and module = 'compliance';
insert into public.role_templates(role_key, module, level)
  select 'admin', 'compliance', 1
  where not exists (select 1 from public.role_templates where role_key = 'admin' and module = 'compliance');

-- 2) re-sync existing admins' grants to the new template values
insert into public.user_permissions(email, module, level)
  select au.email, 'hr', 0 from public.app_users au where au.role_key = 'admin'
on conflict (email, module) do update set level = excluded.level;
insert into public.user_permissions(email, module, level)
  select au.email, 'compliance', 1 from public.app_users au where au.role_key = 'admin'
on conflict (email, module) do update set level = excluded.level;
