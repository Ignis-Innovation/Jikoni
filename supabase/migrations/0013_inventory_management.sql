-- ============================================================
-- Jikoni Master PRD — Phase 2a follow-up: Inventory management RPCs
-- Fills the gaps that left the Inventory & Assets screens read-only:
--   * create_stock_item   — register a new SKU (levels stay empty until a receipt)
--   * update_stock_item    — edit reorder level / reorder qty / unit cost
--   * set_dispatch_state   — advance a dispatch (dispatched → delivered, → cancelled)
--   * dispose_asset        — retire an asset (active → disposed)
-- Movement posting, transfers, adjustments, asset registration and depreciation
-- already exist in 0004; these four are the only net-new server functions.
-- The dispatch/asset/stock_item state machines (0004:117-136) validate the
-- transitions, so the state RPCs just update the column.
-- Idempotent: safe to re-run.
-- ============================================================

-- SKU counter — used when the caller doesn't supply a code (the form no longer asks for one)
insert into public.ref_counters(kind, prefix, n) values ('SKU', 'SKU-', 100)
on conflict (kind) do nothing;

-- ---------- new SKU (code auto-generated when not supplied) ----------
create or replace function public.create_stock_item(
  p_sku text default null, p_name text default null, p_category text default null, p_unit text default 'unit',
  p_unit_cost numeric default 0, p_reorder_level numeric default 0,
  p_reorder_qty numeric default 0, p_budget_code text default null
) returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_entity uuid := (select id from public.entities where code = 'KE');
  v_code text := nullif(trim(coalesce(p_budget_code, '')), '');
  v_sku  text := nullif(trim(coalesce(p_sku, '')), '');
begin
  perform public.assert_access('inventory', 2);
  if nullif(trim(coalesce(p_name,'')),'') is null then raise exception 'A stock item needs a name'; end if;
  if v_sku is null then v_sku := public.next_ref('SKU'); end if;   -- auto-generate a code
  if exists (select 1 from public.stock_items where sku = v_sku) then
    raise exception 'A stock item with SKU % already exists', v_sku;
  end if;
  if v_code is not null and not exists (select 1 from public.budget_lines where code = v_code) then
    raise exception 'Unknown budget code: %', v_code;
  end if;
  insert into public.stock_items(entity_id, sku, name, category, unit, unit_cost, reorder_level, reorder_qty, budget_code)
  values (v_entity, v_sku, p_name, nullif(trim(coalesce(p_category,'')),''), coalesce(nullif(trim(p_unit),''),'unit'),
          coalesce(p_unit_cost,0), coalesce(p_reorder_level,0), coalesce(p_reorder_qty,0), v_code);
  perform public.audit_write('inventory.item_created', 'stock_item', v_sku,
    jsonb_build_object('name', p_name, 'category', p_category, 'unitCost', p_unit_cost,
                       'reorderLevel', p_reorder_level, 'budgetCode', v_code));
  -- shape matches bootstrap().inventory.items so the caller can reload
  return jsonb_build_object('sku', v_sku, 'name', p_name, 'category', p_category, 'unit', p_unit,
    'unitCost', coalesce(p_unit_cost,0), 'reorderLevel', coalesce(p_reorder_level,0), 'onHand', 0, 'autoReq', null);
end $$;

-- ---------- edit reorder policy / cost ----------
create or replace function public.update_stock_item(
  p_sku text, p_reorder_level numeric, p_reorder_qty numeric, p_unit_cost numeric
) returns jsonb language plpgsql security definer set search_path = public as $$
declare it record;
begin
  perform public.assert_access('inventory', 2);
  select * into it from public.stock_items where sku = p_sku;
  if not found then raise exception 'Unknown stock item: %', p_sku; end if;
  update public.stock_items
     set reorder_level = coalesce(p_reorder_level, reorder_level),
         reorder_qty   = coalesce(p_reorder_qty, reorder_qty),
         unit_cost     = coalesce(p_unit_cost, unit_cost),
         updated_at    = now()
   where sku = p_sku;
  perform public.audit_write('inventory.item_updated', 'stock_item', p_sku,
    jsonb_build_object(
      'reorderLevel', jsonb_build_object('from', it.reorder_level, 'to', coalesce(p_reorder_level, it.reorder_level)),
      'reorderQty',   jsonb_build_object('from', it.reorder_qty,   'to', coalesce(p_reorder_qty, it.reorder_qty)),
      'unitCost',     jsonb_build_object('from', it.unit_cost,     'to', coalesce(p_unit_cost, it.unit_cost))));
  return jsonb_build_object('sku', p_sku,
    'reorderLevel', coalesce(p_reorder_level, it.reorder_level),
    'unitCost', coalesce(p_unit_cost, it.unit_cost));
end $$;

-- ---------- advance a dispatch (state machine enforces the transition) ----------
create or replace function public.set_dispatch_state(p_ref text, p_state text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare d record;
begin
  perform public.assert_access('inventory', 2);
  select * into d from public.dispatches where ref = p_ref;
  if not found then raise exception 'Unknown dispatch: %', p_ref; end if;
  update public.dispatches set state = p_state, updated_at = now() where ref = p_ref;
  perform public.audit_write('dispatch.state_changed', 'dispatch', p_ref,
    jsonb_build_object('from', d.state, 'to', p_state));
  return jsonb_build_object('id', p_ref, 'state', p_state);
end $$;

-- ---------- retire an asset (active → disposed) ----------
create or replace function public.dispose_asset(p_ref text, p_reason text default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare a record;
begin
  perform public.assert_access('inventory', 2);
  select * into a from public.assets where ref = p_ref;
  if not found then raise exception 'Unknown asset: %', p_ref; end if;
  if a.state = 'disposed' then raise exception 'Asset % is already disposed', p_ref; end if;
  update public.assets set state = 'disposed', updated_at = now() where ref = p_ref;
  perform public.audit_write('asset.disposed', 'asset', p_ref,
    jsonb_build_object('name', a.name, 'nbv', a.cost - a.accum_dep, 'reason', nullif(trim(coalesce(p_reason,'')),'')));
  return jsonb_build_object('id', p_ref, 'state', 'disposed');
end $$;

-- ---------- grants: authenticated only, never public/anon ----------
do $$
declare fn text;
begin
  foreach fn in array array[
    'create_stock_item(text,text,text,text,numeric,numeric,numeric,text)',
    'update_stock_item(text,numeric,numeric,numeric)',
    'set_dispatch_state(text,text)',
    'dispose_asset(text,text)']
  loop
    execute format('revoke execute on function public.%s from public, anon', fn);
    execute format('grant execute on function public.%s to authenticated', fn);
  end loop;
end $$;
