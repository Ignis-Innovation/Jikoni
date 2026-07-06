-- ============================================================
-- Jikoni Master PRD — Phase 2a: Inventory (net-new module)
-- stock ledger (typed movements, never edited), dispatches,
-- asset register with depreciation posting to GL, and the
-- reorder-below-threshold loop feeding back into Procure-to-Pay.
-- Idempotent: safe to re-run.
-- ============================================================

-- ---------- master data ----------
create table if not exists public.stock_locations (
  id         uuid primary key default gen_random_uuid(),
  entity_id  uuid references public.entities(id),
  name       text not null unique,
  kind       text not null default 'store' check (kind in ('store','site','transit')),
  state      text not null default 'active',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.stock_items (
  id            uuid primary key default gen_random_uuid(),
  entity_id     uuid references public.entities(id),
  sku           text not null unique,
  name          text not null,
  category      text,
  unit          text not null default 'unit',
  unit_cost     numeric not null default 0,
  reorder_level numeric not null default 0,
  reorder_qty   numeric not null default 0,
  budget_code   text references public.budget_lines(code),  -- coding for the auto-requisition
  auto_req_ref  text,                                       -- open auto-raised PR, cleared on restock
  state         text not null default 'active' check (state in ('active','discontinued')),
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

-- current quantity per item/location — maintained only by the movement RPCs
create table if not exists public.stock_levels (
  item_id     uuid not null references public.stock_items(id),
  location_id uuid not null references public.stock_locations(id),
  qty         numeric not null default 0,
  primary key (item_id, location_id)
);

-- ---------- the ledger: typed, append-only, never edited ----------
create table if not exists public.stock_movements (
  id            uuid primary key default gen_random_uuid(),
  entity_id     uuid references public.entities(id),
  item_id       uuid not null references public.stock_items(id),
  movement_type text not null check (movement_type in ('receipt','issue','transfer','adjustment')),
  qty           numeric not null,                 -- signed for adjustment, positive otherwise
  unit_cost     numeric,
  from_location uuid references public.stock_locations(id),
  to_location   uuid references public.stock_locations(id),
  source_type   text,                             -- 'grn' | 'dispatch' | 'manual' | 'count'
  source_ref    text,
  note          text,
  created_by    uuid references public.app_users(id),
  created_at    timestamptz not null default now()
);

create or replace function public.stock_ledger_immutable() returns trigger
language plpgsql as $$
begin
  raise exception 'stock_movements is a ledger — append only, post a correcting movement instead';
end $$;

drop trigger if exists ledger_no_edit on public.stock_movements;
create trigger ledger_no_edit
  before update or delete on public.stock_movements
  for each row execute function public.stock_ledger_immutable();

-- ---------- dispatches (linked to project / deployment) ----------
create table if not exists public.dispatches (
  id           uuid primary key default gen_random_uuid(),
  ref          text not null unique,
  entity_id    uuid references public.entities(id),
  project_name text references public.projects(name),
  destination  text not null,
  lines        jsonb not null default '[]'::jsonb,   -- [{sku, name, qty}]
  note         text,
  state        text not null default 'dispatched' check (state in ('draft','dispatched','delivered','cancelled')),
  created_by   uuid references public.app_users(id),
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);

-- ---------- asset register (straight-line depreciation → GL) ----------
create table if not exists public.assets (
  id            uuid primary key default gen_random_uuid(),
  ref           text not null unique,
  entity_id     uuid references public.entities(id),
  name          text not null,
  category      text,
  cost          numeric not null check (cost > 0),
  salvage       numeric not null default 0,
  life_months   int not null check (life_months > 0),
  acquired_on   date not null,
  accum_dep     numeric not null default 0,
  location_id   uuid references public.stock_locations(id),
  state         text not null default 'active' check (state in ('active','disposed')),
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

create table if not exists public.asset_depreciations (
  id        uuid primary key default gen_random_uuid(),
  asset_id  uuid not null references public.assets(id),
  period    text not null,                    -- 'YYYY-MM'
  amount    numeric not null,
  journal_ref text,
  created_at timestamptz not null default now(),
  unique (asset_id, period)
);

-- ---------- state machine + COA + counters ----------
insert into public.record_transitions(record_type, from_state, to_state) values
  ('dispatch','draft','dispatched'),
  ('dispatch','dispatched','delivered'),
  ('dispatch','draft','cancelled'),
  ('stock_item','active','discontinued'),
  ('asset','active','disposed')
on conflict do nothing;

do $$
declare r record;
begin
  for r in select * from (values
    ('dispatches','dispatch'), ('stock_items','stock_item'), ('assets','asset')
  ) as t(tbl, rtype)
  loop
    execute format('drop trigger if exists state_machine on public.%I', r.tbl);
    execute format('create trigger state_machine before update of state on public.%I
                    for each row execute function public.enforce_state_machine(%L)', r.tbl, r.rtype);
  end loop;
end $$;

with ke as (select id from public.entities where code = 'KE')
insert into public.chart_of_accounts(entity_id, code, name, kind)
select ke.id, v.* from ke, (values
  ('1250', 'Accumulated depreciation', 'asset'),
  ('1300', 'Fixed assets',             'asset'),
  ('5150', 'Depreciation expense',     'expense')
) as v(code, name, kind)
on conflict (entity_id, code) do nothing;

insert into public.ref_counters(kind, prefix, n) values
  ('DSP', 'DSP-', 100),
  ('AST', 'AST-', 100),
  ('MOV', 'MOV-', 1000)
on conflict (kind) do nothing;

-- ============================================================
-- Movement engine — one internal function keeps levels + ledger in step
-- ============================================================
create or replace function public.post_movement(
  p_item uuid, p_type text, p_qty numeric, p_unit_cost numeric,
  p_from uuid, p_to uuid, p_source_type text, p_source_ref text, p_note text
) returns void language plpgsql security definer set search_path = public as $$
declare
  v_entity uuid := (select id from public.entities where code = 'KE');
  v_actor uuid := (select id from public.app_users where auth_id = auth.uid());
  v_left numeric;
begin
  if p_type in ('receipt','issue','transfer') and p_qty <= 0 then
    raise exception 'Quantity must be positive for %', p_type;
  end if;
  insert into public.stock_movements(entity_id, item_id, movement_type, qty, unit_cost,
                                     from_location, to_location, source_type, source_ref, note, created_by)
  values (v_entity, p_item, p_type, p_qty, p_unit_cost, p_from, p_to, p_source_type, p_source_ref, p_note, v_actor);

  if p_from is not null then
    update public.stock_levels set qty = qty - abs(p_qty)
    where item_id = p_item and location_id = p_from
    returning qty into v_left;
    if v_left is null then
      raise exception 'No stock of this item at the source location';
    end if;
    if v_left < 0 then
      raise exception 'Insufficient stock at source location (short by %)', abs(v_left);
    end if;
  end if;
  if p_to is not null then
    insert into public.stock_levels(item_id, location_id, qty) values (p_item, p_to, abs(p_qty))
    on conflict (item_id, location_id) do update set qty = public.stock_levels.qty + abs(p_qty);
  end if;
  if p_type = 'adjustment' and p_from is null and p_to is null then
    raise exception 'Adjustment needs a location';
  end if;
end $$;

-- Reorder loop: below threshold → auto-raise a pre-filled requisition (back into B1)
create or replace function public.check_reorder(p_item uuid) returns text
language plpgsql security definer set search_path = public as $$
declare
  it record; on_hand numeric; req jsonb;
begin
  select * into it from public.stock_items where id = p_item;
  select coalesce(sum(qty), 0) into on_hand from public.stock_levels where item_id = p_item;
  if it.state = 'active' and it.reorder_level > 0 and on_hand < it.reorder_level
     and it.auto_req_ref is null and it.budget_code is not null and it.reorder_qty > 0 then
    req := public.submit_requisition(
      format('Restock %s — %s %s (auto: below reorder level %s, on hand %s)',
             it.name, it.reorder_qty, it.unit, it.reorder_level, on_hand),
      it.reorder_qty * it.unit_cost, it.budget_code);
    update public.stock_items set auto_req_ref = req->>'id' where id = p_item;
    perform public.audit_write('inventory.reorder_triggered','stock_item', it.sku,
      jsonb_build_object('onHand', on_hand, 'reorderLevel', it.reorder_level, 'requisition', req->>'id'));
    return req->>'id';
  end if;
  -- restocked above threshold → the loop is closed, allow future auto-reqs
  if on_hand >= it.reorder_level and it.auto_req_ref is not null then
    update public.stock_items set auto_req_ref = null where id = p_item;
  end if;
  return null;
end $$;

-- ============================================================
-- RPCs
-- ============================================================
create or replace function public.receive_stock(p_sku text, p_location text, p_qty numeric, p_unit_cost numeric default null, p_grn_ref text default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare it record; loc record;
begin
  perform public.assert_access('inventory', 2);
  select * into it from public.stock_items where sku = p_sku;
  if not found then raise exception 'Unknown stock item: %', p_sku; end if;
  select * into loc from public.stock_locations where name = p_location;
  if not found then raise exception 'Unknown location: %', p_location; end if;
  if p_grn_ref is not null and not exists (select 1 from public.goods_received_notes where ref = p_grn_ref) then
    raise exception 'Document chain: GRN % does not exist', p_grn_ref;
  end if;
  perform public.post_movement(it.id, 'receipt', p_qty, coalesce(p_unit_cost, it.unit_cost),
                               null, loc.id, case when p_grn_ref is null then 'manual' else 'grn' end, p_grn_ref, null);
  perform public.check_reorder(it.id);
  perform public.audit_write('inventory.received','stock_item', p_sku,
    jsonb_build_object('qty', p_qty, 'location', p_location, 'grn', p_grn_ref));
  return jsonb_build_object('sku', p_sku, 'onHand', (select sum(qty) from public.stock_levels where item_id = it.id));
end $$;

create or replace function public.issue_stock(p_sku text, p_location text, p_qty numeric, p_reason text default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare it record; loc record; auto text;
begin
  perform public.assert_access('inventory', 2);
  select * into it from public.stock_items where sku = p_sku;
  if not found then raise exception 'Unknown stock item: %', p_sku; end if;
  select * into loc from public.stock_locations where name = p_location;
  if not found then raise exception 'Unknown location: %', p_location; end if;
  perform public.post_movement(it.id, 'issue', p_qty, it.unit_cost, loc.id, null, 'manual', null, p_reason);
  auto := public.check_reorder(it.id);
  perform public.audit_write('inventory.issued','stock_item', p_sku,
    jsonb_build_object('qty', p_qty, 'location', p_location, 'reason', p_reason, 'autoRequisition', auto));
  return jsonb_build_object('sku', p_sku,
    'onHand', (select coalesce(sum(qty),0) from public.stock_levels where item_id = it.id),
    'autoRequisition', auto);
end $$;

create or replace function public.transfer_stock(p_sku text, p_from text, p_to text, p_qty numeric)
returns jsonb language plpgsql security definer set search_path = public as $$
declare it record; f uuid; t uuid;
begin
  perform public.assert_access('inventory', 2);
  select * into it from public.stock_items where sku = p_sku;
  if not found then raise exception 'Unknown stock item: %', p_sku; end if;
  select id into f from public.stock_locations where name = p_from;
  select id into t from public.stock_locations where name = p_to;
  if f is null or t is null then raise exception 'Unknown location'; end if;
  perform public.post_movement(it.id, 'transfer', p_qty, it.unit_cost, f, t, 'manual', null, null);
  perform public.audit_write('inventory.transferred','stock_item', p_sku,
    jsonb_build_object('qty', p_qty, 'from', p_from, 'to', p_to));
  return jsonb_build_object('sku', p_sku, 'from', p_from, 'to', p_to, 'qty', p_qty);
end $$;

create or replace function public.adjust_stock(p_sku text, p_location text, p_new_qty numeric, p_reason text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare it record; loc record; cur numeric; delta numeric;
begin
  perform public.assert_access('inventory', 3);   -- corrections need full access
  if coalesce(trim(p_reason), '') = '' then raise exception 'Adjustment requires a reason'; end if;
  select * into it from public.stock_items where sku = p_sku;
  if not found then raise exception 'Unknown stock item: %', p_sku; end if;
  select * into loc from public.stock_locations where name = p_location;
  if not found then raise exception 'Unknown location: %', p_location; end if;
  select coalesce(qty, 0) into cur from public.stock_levels where item_id = it.id and location_id = loc.id;
  cur := coalesce(cur, 0);
  delta := p_new_qty - cur;
  if delta = 0 then return jsonb_build_object('sku', p_sku, 'onHand', cur, 'delta', 0); end if;
  insert into public.stock_movements(entity_id, item_id, movement_type, qty, unit_cost,
                                     from_location, to_location, source_type, source_ref, note, created_by)
  values ((select id from public.entities where code='KE'), it.id, 'adjustment', delta, it.unit_cost,
          case when delta < 0 then loc.id end, case when delta > 0 then loc.id end, 'count', null, p_reason,
          (select id from public.app_users where auth_id = auth.uid()));
  insert into public.stock_levels(item_id, location_id, qty) values (it.id, loc.id, p_new_qty)
  on conflict (item_id, location_id) do update set qty = excluded.qty;
  perform public.check_reorder(it.id);
  perform public.audit_write('inventory.adjusted','stock_item', p_sku,
    jsonb_build_object('location', p_location, 'from', cur, 'to', p_new_qty, 'reason', p_reason));
  return jsonb_build_object('sku', p_sku, 'onHand', (select sum(qty) from public.stock_levels where item_id = it.id), 'delta', delta);
end $$;

create or replace function public.create_dispatch(p_project text, p_destination text, p_lines jsonb, p_note text default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_ref text; l jsonb; it record; store uuid;
  v_entity uuid := (select id from public.entities where code = 'KE');
  v_actor uuid := (select id from public.app_users where auth_id = auth.uid());
  enriched jsonb := '[]'::jsonb;
begin
  perform public.assert_access('inventory', 2);
  if p_project is not null and not exists (select 1 from public.projects where name = p_project) then
    raise exception 'Unknown project: %', p_project;
  end if;
  select id into store from public.stock_locations where kind = 'store' order by created_at limit 1;
  v_ref := public.next_ref('DSP');
  for l in select * from jsonb_array_elements(p_lines) loop
    select * into it from public.stock_items where sku = l->>'sku';
    if not found then raise exception 'Unknown stock item: %', l->>'sku'; end if;
    perform public.post_movement(it.id, 'issue', (l->>'qty')::numeric, it.unit_cost,
                                 store, null, 'dispatch', v_ref, p_destination);
    perform public.check_reorder(it.id);
    enriched := enriched || jsonb_build_object('sku', it.sku, 'name', it.name, 'qty', (l->>'qty')::numeric);
  end loop;
  insert into public.dispatches(ref, entity_id, project_name, destination, lines, note, created_by)
  values (v_ref, v_entity, p_project, p_destination, enriched, p_note, v_actor);
  perform public.audit_write('dispatch.created','dispatch', v_ref,
    jsonb_build_object('project', p_project, 'destination', p_destination, 'lines', enriched));
  return jsonb_build_object('id', v_ref, 'project', p_project, 'destination', p_destination, 'lines', enriched);
end $$;

create or replace function public.register_asset(p_name text, p_category text, p_cost numeric, p_life_months int, p_acquired date, p_salvage numeric default 0)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_ref text;
  v_entity uuid := (select id from public.entities where code = 'KE');
begin
  perform public.assert_access('inventory', 2);
  v_ref := public.next_ref('AST');
  insert into public.assets(ref, entity_id, name, category, cost, salvage, life_months, acquired_on)
  values (v_ref, v_entity, p_name, p_category, p_cost, p_salvage, p_life_months, p_acquired);
  perform public.audit_write('asset.registered','asset', v_ref,
    jsonb_build_object('name', p_name, 'cost', p_cost, 'lifeMonths', p_life_months));
  return jsonb_build_object('id', v_ref, 'name', p_name, 'cost', p_cost);
end $$;

-- Monthly depreciation run: one balanced journal per period per asset
create or replace function public.run_depreciation(p_period text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare a record; amt numeric; je text; total numeric := 0; n int := 0;
begin
  perform public.assert_access('finance', 3);
  if p_period !~ '^\d{4}-\d{2}$' then raise exception 'Period must be YYYY-MM'; end if;
  for a in select * from public.assets where state = 'active' loop
    amt := round((a.cost - a.salvage) / a.life_months, 2);
    if a.accum_dep + amt > a.cost - a.salvage then
      amt := (a.cost - a.salvage) - a.accum_dep;   -- final period truncates
    end if;
    if amt <= 0 then continue; end if;
    if exists (select 1 from public.asset_depreciations where asset_id = a.id and period = p_period) then
      continue;   -- already run for this period
    end if;
    je := public.post_journal(format('Depreciation %s — %s', p_period, a.name), 'asset', a.ref,
      jsonb_build_array(
        jsonb_build_object('account', '5150', 'debit', amt),
        jsonb_build_object('account', '1250', 'credit', amt)));
    insert into public.asset_depreciations(asset_id, period, amount, journal_ref) values (a.id, p_period, amt, je);
    update public.assets set accum_dep = accum_dep + amt where id = a.id;
    total := total + amt; n := n + 1;
  end loop;
  perform public.audit_write('depreciation.run','asset', p_period,
    jsonb_build_object('assets', n, 'total', total));
  return jsonb_build_object('period', p_period, 'assets', n, 'total', total);
end $$;

-- ---------- seed: locations + starter items (demo continuity with the views) ----------
with ke as (select id from public.entities where code = 'KE')
insert into public.stock_locations(entity_id, name, kind)
select ke.id, v.* from ke, (values
  ('Nairobi central store', 'store'),
  ('Makueni site store',    'site'),
  ('Kiambu site store',     'site')
) as v(name, kind)
on conflict (name) do nothing;

with ke as (select id from public.entities where code = 'KE')
insert into public.stock_items(entity_id, sku, name, category, unit, unit_cost, reorder_level, reorder_qty, budget_code)
select ke.id, v.* from ke, (values
  ('CKR-40',   'Institutional cooker — 40L',   'Cookstoves',  'unit', 58000, 10, 20, 'Deployment'),
  ('CKR-100',  'Institutional cooker — 100L',  'Cookstoves',  'unit', 96000, 6,  12, 'Deployment'),
  ('SPR-KIT',  'Cooker spares kit',            'Spares',      'kit',  7100,  15, 20, 'Operations'),
  ('CYL-13',   'LPG cylinder — 13kg',          'Fuel',        'unit', 3200,  30, 60, 'Deployment'),
  ('SEN-TMP',  'Temperature sensor (MRV)',     'MRV',         'unit', 1850,  25, 50, 'Field / MRV')
) as v(sku, name, category, unit, unit_cost, reorder_level, reorder_qty, budget_code)
on conflict (sku) do nothing;

-- opening balances (only on first run — levels empty)
do $$
declare store uuid;
begin
  select id into store from public.stock_locations where name = 'Nairobi central store';
  if not exists (select 1 from public.stock_levels) then
    insert into public.stock_levels(item_id, location_id, qty)
    select i.id, store, v.qty from public.stock_items i
    join (values ('CKR-40', 24), ('CKR-100', 9), ('SPR-KIT', 31), ('CYL-13', 74), ('SEN-TMP', 58)) as v(sku, qty)
      on v.sku = i.sku;
    insert into public.stock_movements(entity_id, item_id, movement_type, qty, unit_cost, to_location, source_type, note)
    select (select id from public.entities where code='KE'), i.id, 'receipt', l.qty, i.unit_cost, store, 'count', 'Opening balance'
    from public.stock_levels l join public.stock_items i on i.id = l.item_id;
  end if;
end $$;

-- a couple of assets so the register isn't empty
with ke as (select id from public.entities where code = 'KE')
insert into public.assets(ref, entity_id, name, category, cost, salvage, life_months, acquired_on)
select v.ref, ke.id, v.name, v.category, v.cost, v.salvage, v.life, v.acq::date from ke, (values
  ('AST-097', 'Toyota Hilux — field vehicle', 'Vehicles',  4800000, 800000, 96, '2025-03-01'),
  ('AST-098', 'Workshop tooling set',         'Equipment',  640000,      0, 60, '2025-06-01'),
  ('AST-099', 'Office laptops (×6)',          'IT',         720000,      0, 36, '2026-01-01')
) as v(ref, name, category, cost, salvage, life, acq)
on conflict (ref) do nothing;

-- ---------- RLS + grants ----------
do $$
declare t text;
begin
  foreach t in array array['stock_locations','stock_items','stock_levels','stock_movements',
                           'dispatches','assets','asset_depreciations']
  loop
    execute format('alter table public.%I enable row level security', t);
    execute format('drop policy if exists "read for authenticated" on public.%I', t);
    execute format('create policy "read for authenticated" on public.%I for select to authenticated using (true)', t);
  end loop;
end $$;

do $$
declare fn text;
begin
  foreach fn in array array[
    'receive_stock(text,text,numeric,numeric,text)','issue_stock(text,text,numeric,text)',
    'transfer_stock(text,text,text,numeric)','adjust_stock(text,text,numeric,text)',
    'create_dispatch(text,text,jsonb,text)','register_asset(text,text,numeric,int,date,numeric)',
    'run_depreciation(text)']
  loop
    execute format('revoke execute on function public.%s from public, anon', fn);
    execute format('grant execute on function public.%s to authenticated', fn);
  end loop;
  -- internal engines: not callable from the client at all
  revoke execute on function public.post_movement(uuid,text,numeric,numeric,uuid,uuid,text,text,text) from public, anon, authenticated;
  revoke execute on function public.check_reorder(uuid) from public, anon, authenticated;
end $$;
