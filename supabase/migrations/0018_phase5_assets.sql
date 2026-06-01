-- ============================================================================
-- 0018_phase5_assets.sql — PHASE 5 Asset & Inventory (PRD §5A-5E)
-- ============================================================================

create table public.assets (
  id uuid primary key default gen_random_uuid(),
  code text unique,
  name text not null,
  category_id uuid references public.categories(id),
  serial_no text,
  location_id uuid references public.locations(id),
  custodian_user_id uuid references public.users(id),
  purchase_po_id uuid references public.purchase_orders(id),
  cost_minor bigint default 0,
  depreciation_method text default 'straight_line',
  useful_life_months int,
  nbv_minor bigint default 0,
  qr_code text,
  status text not null default 'in_store',
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
  created_by uuid references public.users(id), updated_by uuid references public.users(id), deleted_at timestamptz
);
create table public.asset_events (
  id uuid primary key default gen_random_uuid(),
  asset_id uuid not null references public.assets(id) on delete cascade,
  type text check (type in ('acquired','deployed','maintained','transferred','disposed')),
  event_date date default now(),
  from_location_id uuid references public.locations(id),
  to_location_id uuid references public.locations(id),
  notes text,
  approval_request_id uuid references public.approval_requests(id),
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
  created_by uuid references public.users(id), updated_by uuid references public.users(id), deleted_at timestamptz
);

create table public.stock_items (
  id uuid primary key default gen_random_uuid(),
  name text not null, uom_code text references public.units_of_measure(code),
  reorder_point numeric(14,3) default 0, category_id uuid references public.categories(id),
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
  created_by uuid references public.users(id), updated_by uuid references public.users(id), deleted_at timestamptz
);
create table public.stock_levels (
  id uuid primary key default gen_random_uuid(),
  item_id uuid references public.stock_items(id), location_id uuid references public.locations(id),
  qty numeric(14,3) default 0, unique(item_id, location_id)
);
create table public.stock_movements (
  id uuid primary key default gen_random_uuid(),
  item_id uuid references public.stock_items(id),
  from_location_id uuid references public.locations(id),
  to_location_id uuid references public.locations(id),
  qty numeric(14,3), type text, ref text,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
  created_by uuid references public.users(id), updated_by uuid references public.users(id), deleted_at timestamptz
);

create table public.maintenance_schedules (
  id uuid primary key default gen_random_uuid(),
  asset_id uuid references public.assets(id), frequency text, next_due date,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
  created_by uuid references public.users(id), updated_by uuid references public.users(id), deleted_at timestamptz
);
create table public.work_orders (
  id uuid primary key default gen_random_uuid(),
  code text unique,
  asset_id uuid references public.assets(id), type text, status text not null default 'open',
  assignee_user_id uuid references public.users(id), parts jsonb default '[]'::jsonb,
  approval_request_id uuid references public.approval_requests(id),
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
  created_by uuid references public.users(id), updated_by uuid references public.users(id), deleted_at timestamptz
);

create table public.deployments (
  id uuid primary key default gen_random_uuid(),
  asset_id uuid references public.assets(id),
  institution_id uuid references public.institutions(id),
  deployed_date date default now(), condition text, status text not null default 'active',
  field_officer_id uuid references public.users(id), photo_document_id uuid references public.documents(id),
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
  created_by uuid references public.users(id), updated_by uuid references public.users(id), deleted_at timestamptz
);

do $$
declare t text;
declare tbls text[] := array['assets','asset_events','stock_items','stock_levels','stock_movements','maintenance_schedules','work_orders','deployments'];
begin
  perform public.seed_module_permissions('assets','Assets & Inventory');
  foreach t in array tbls loop
    perform public.apply_standard_triggers(t);
    perform public.apply_module_rls(t,'assets');
  end loop;
  perform public.apply_code_default('assets','AST');
  perform public.apply_code_default('work_orders','WO');
end $$;
