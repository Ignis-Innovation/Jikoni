-- ============================================================================
-- 0013_seed.sql — baseline roles, permissions, reference data, storage bucket
-- Idempotent: safe to re-run.
-- ============================================================================

-- ---- Roles (PRD §1.2) ------------------------------------------------------
insert into public.roles (key, name, description, is_system) values
  ('super_admin',     'Super Admin',     'Everything, incl. user/role management and config', true),
  ('admin',           'Admin',           'All modules, no destructive config',                 true),
  ('finance',         'Finance',         'CoA, payables, receivables, payments, reports',      true),
  ('procurement',     'Procurement',     'Vendors, requisitions, POs, GRNs',                   true),
  ('hr',              'HR',              'People Ops modules',                                 true),
  ('project_manager', 'Project Manager', 'Projects, budgets, milestones',                      true),
  ('bd',              'Business Dev',    'CRM, opportunities, BD intelligence',                true),
  ('field_officer',   'Field Officer',   'Mobile/field modules, asset deployment',             true),
  ('viewer',          'Viewer',          'Read-only across permitted modules',                 true)
on conflict (key) do nothing;

-- ---- Permissions -----------------------------------------------------------
insert into public.permissions (key, module, action, description) values
  ('identity.users.view',   'identity', 'view',   'View users'),
  ('identity.users.create', 'identity', 'create', 'Invite users'),
  ('identity.users.edit',   'identity', 'edit',   'Edit users'),
  ('identity.users.delete', 'identity', 'delete', 'Deactivate users'),
  ('identity.roles.view',   'identity', 'view',   'View roles'),
  ('identity.roles.create', 'identity', 'create', 'Create roles'),
  ('identity.roles.edit',   'identity', 'edit',   'Edit roles'),
  ('org.view',     'org', 'view',   'View org model'),
  ('org.create',   'org', 'create', 'Create org records'),
  ('org.edit',     'org', 'edit',   'Edit org records'),
  ('org.delete',   'org', 'delete', 'Delete org records'),
  ('coa.view',     'coa', 'view',   'View chart of accounts'),
  ('coa.edit',     'coa', 'edit',   'Edit chart of accounts'),
  ('parties.view',   'parties', 'view',   'View parties'),
  ('parties.create', 'parties', 'create', 'Create parties'),
  ('parties.edit',   'parties', 'edit',   'Edit parties'),
  ('parties.delete', 'parties', 'delete', 'Delete parties'),
  ('documents.view',   'documents', 'view',   'View documents'),
  ('documents.create', 'documents', 'create', 'Upload documents'),
  ('documents.delete', 'documents', 'delete', 'Delete documents'),
  ('approvals.view',      'approvals', 'view',      'View approvals'),
  ('approvals.configure', 'approvals', 'configure', 'Configure approval chains'),
  ('approvals.act',       'approvals', 'act',       'Act on approval requests'),
  ('refdata.manage', 'refdata', 'manage', 'Manage reference data'),
  ('audit.view',     'audit',   'view',   'View audit log')
on conflict (key) do nothing;

-- ---- Grant super_admin every permission ------------------------------------
insert into public.role_permissions (role_id, permission_id)
select r.id, p.id
from public.roles r cross join public.permissions p
where r.key = 'super_admin'
on conflict do nothing;

-- ---- admin: everything except role editing & destructive config ------------
insert into public.role_permissions (role_id, permission_id)
select r.id, p.id
from public.roles r join public.permissions p on p.key in (
  'identity.users.view','identity.users.create','identity.users.edit','identity.roles.view',
  'org.view','org.create','org.edit','coa.view','coa.edit',
  'parties.view','parties.create','parties.edit',
  'documents.view','documents.create','documents.delete',
  'approvals.view','approvals.configure','approvals.act','refdata.manage','audit.view'
)
where r.key = 'admin'
on conflict do nothing;

-- ---- finance ---------------------------------------------------------------
insert into public.role_permissions (role_id, permission_id)
select r.id, p.id
from public.roles r join public.permissions p on p.key in (
  'coa.view','coa.edit','parties.view','documents.view','documents.create',
  'approvals.view','approvals.act','org.view'
)
where r.key = 'finance'
on conflict do nothing;

-- ---- procurement -----------------------------------------------------------
insert into public.role_permissions (role_id, permission_id)
select r.id, p.id
from public.roles r join public.permissions p on p.key in (
  'parties.view','parties.create','parties.edit','documents.view','documents.create',
  'approvals.view','org.view'
)
where r.key = 'procurement'
on conflict do nothing;

-- ---- viewer: read-only across permitted areas ------------------------------
insert into public.role_permissions (role_id, permission_id)
select r.id, p.id
from public.roles r join public.permissions p on p.action = 'view'
where r.key = 'viewer'
on conflict do nothing;

-- ---- Reference data --------------------------------------------------------
insert into public.currencies (code, name, symbol, decimal_places) values
  ('KES','Kenyan Shilling','KSh',2),
  ('USD','US Dollar','$',2),
  ('EUR','Euro','€',2),
  ('GBP','Pound Sterling','£',2)
on conflict (code) do nothing;

insert into public.tax_codes (code, name, rate_pct, kra_code, active) values
  ('VAT16','VAT 16%',16.000,'A',true),
  ('VAT0','Zero Rated',0.000,'B',true),
  ('EXEMPT','Exempt',0.000,'E',true)
on conflict (code) do nothing;

insert into public.units_of_measure (code, name) values
  ('EA','Each'),('BOX','Box'),('KG','Kilogram'),('L','Litre'),
  ('M','Metre'),('HR','Hour'),('DAY','Day'),('SET','Set')
on conflict (code) do nothing;

insert into public.categories (domain, name) values
  ('expense','Utilities'),('expense','Office Supplies'),('expense','Travel'),
  ('asset','Cookers'),('asset','IT Equipment'),('asset','Furniture'),
  ('product','Services'),('product','Goods')
on conflict do nothing;

-- ---- Storage bucket for Documents service ----------------------------------
insert into storage.buckets (id, name, public)
values ('documents','documents', false)
on conflict (id) do nothing;
