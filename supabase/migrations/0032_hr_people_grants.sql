-- ============================================================================
-- 0032_hr_people_grants.sql — give HR ownership of the People module so HR can
-- view employees/leave and approve leave applications. Idempotent.
-- ============================================================================

insert into public.role_permissions (role_id, permission_id)
select r.id, p.id from public.roles r
join public.permissions p on p.module = 'people' and p.action in ('view', 'create', 'edit', 'delete')
where r.key = 'hr'
on conflict do nothing;
