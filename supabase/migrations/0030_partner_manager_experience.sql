-- ============================================================================
-- 0030_partner_manager_experience.sql — engagement title, CRM/leave grants,
-- leave-type seed. Idempotent: safe to re-run.
-- ============================================================================

-- 1. Free-text engagement name (the "engagement name" a manager types).
alter table public.engagements add column if not exists title text;

-- 2. HR can view the CRM pipeline/engagements, so partner-created rows are
--    visible across the org (admin & sales_manager already have crm).
insert into public.role_permissions (role_id, permission_id)
select r.id, p.id from public.roles r
join public.permissions p on p.module = 'crm' and p.action = 'view'
where r.key = 'hr'
on conflict do nothing;

-- 3. Partner Manager can file leave (people view/create/edit). Their nav only
--    surfaces Leave Application from the People area (see ROLE_NAV).
insert into public.role_permissions (role_id, permission_id)
select r.id, p.id from public.roles r
join public.permissions p on p.module = 'people' and p.action in ('view', 'create', 'edit')
where r.key = 'partner_manager'
on conflict do nothing;

-- 4. Partner Manager no longer needs procurement (not in their nav).
delete from public.role_permissions rp
using public.roles r, public.permissions p
where rp.role_id = r.id and rp.permission_id = p.id
  and r.key = 'partner_manager' and p.module = 'procurement';

-- 5. Seed baseline leave types so the Leave Application form is usable.
insert into public.leave_types (name, annual_days, accrual)
select v.name, v.days, 'annual'
from (values ('Annual', 21), ('Sick', 14), ('Compassionate', 5)) as v(name, days)
where not exists (select 1 from public.leave_types lt where lt.name = v.name and lt.deleted_at is null);
