-- ============================================================
-- 0061 — "Sub Admin" role, and assign jwanjiku + brian55 to it
-- Sub Admin = Admin-tier access, but ALSO sees and edits the two areas a plain
-- Admin cannot: Human Resources (edit) and Compliance & Governance (edit). Not a
-- super admin (users:2). Retires the old one-person HR/Employee toggle — HR access
-- is now this real role. Idempotent.
-- ============================================================

-- 1) (re)build the 'sub' role template: every module Full, except HR/Compliance/Users at Edit
delete from public.role_templates where role_key = 'sub';
insert into public.role_templates(role_key, module, level)
select 'sub', m.module,
       case when m.module in ('hr', 'compliance', 'users') then 2 else 3 end
from (select distinct module from public.role_templates) m;

-- 2) move the two people onto the Sub Admin role and reseed their live grants
update public.app_users
  set role_key = 'sub'
  where lower(email) in ('jwanjiku@ignis-innovation.com', 'brian55mwangi@gmail.com');

delete from public.user_permissions
  where lower(email) in ('jwanjiku@ignis-innovation.com', 'brian55mwangi@gmail.com');
insert into public.user_permissions(email, module, level)
  select lower(au.email), rt.module, rt.level
  from public.app_users au
  join public.role_templates rt on rt.role_key = 'sub'
  where lower(au.email) in ('jwanjiku@ignis-innovation.com', 'brian55mwangi@gmail.com')
on conflict (email, module) do update set level = excluded.level;
