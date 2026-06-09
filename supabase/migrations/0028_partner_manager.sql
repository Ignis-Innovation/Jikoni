-- ============================================================================
-- 0028_partner_manager.sql — grant the Partner Manager role its module access.
-- Runs after every module's permissions are seeded (procurement 0015, crm 0020),
-- so the keys it references already exist. Idempotent: safe to re-run.
--
-- Partner Manager works across partners/parties, the CRM pipeline, and
-- procurement. They get view/create/edit on each (no destructive delete).
-- Nav visibility follows automatically: AppLayout filters nav by hasModule(),
-- and RLS grants the matching data access via has_permission().
-- ============================================================================

insert into public.role_permissions (role_id, permission_id)
select r.id, p.id
from public.roles r
join public.permissions p
  on p.module in ('parties', 'crm', 'procurement')
 and p.action in ('view', 'create', 'edit')
where r.key = 'partner_manager'
on conflict do nothing;
