-- ============================================================================
-- 0029_sales_manager.sql — grant the Sales Manager role its module access.
-- Runs after every module's permissions are seeded (procurement 0015,
-- revenue 0016, crm 0020), so the keys it references already exist.
-- Idempotent: safe to re-run.
--
-- Sales Manager works across revenue, the CRM pipeline, parties, and
-- procurement: view/create/edit on each (no destructive delete). Nav visibility
-- follows automatically via hasModule()/has_permission().
-- ============================================================================

insert into public.role_permissions (role_id, permission_id)
select r.id, p.id
from public.roles r
join public.permissions p
  on p.module in ('revenue', 'crm', 'parties', 'procurement')
 and p.action in ('view', 'create', 'edit')
where r.key = 'sales_manager'
on conflict do nothing;
