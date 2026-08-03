-- ============================================================
-- Jikoni Tool — UI Build Spec: Coding + full Requisition form
-- Build-priority items #1 (Settings → Coding) and #2 (the Requisitions form):
--   * upsert_cost_centre        — create/update a cost centre (a budget_line) from
--                                 Settings → Coding, the dropdown source for reqs/budgets
--   * requisitions gains qty / unit / unit_price / project_code / justification
--   * submit_requisition        — richer form + "Save as Draft" (no budget commit / routing)
--   * submit_requisition_final  — a draft moves to Submitted: budget commit + routing + notify
--   * withdraw_requisition      — requester pulls a pending req back to draft (releases budget),
--                                 or discards a draft
-- Idempotent: safe to re-run.
-- ============================================================

-- ---------- cost centres (Coding) ----------
create or replace function public.upsert_cost_centre(p_name text, p_budget numeric)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_entity uuid := (select id from public.entities where code = 'KE'); v_code text := trim(coalesce(p_name, ''));
begin
  perform public.assert_access('finance', 2);
  if v_code = '' then raise exception 'A cost-centre name is required'; end if;
  insert into public.budget_lines(entity_id, code, budget, account_code)
  values (v_entity, v_code, greatest(coalesce(p_budget, 0), 0), '5000')
  on conflict (code) do update set budget = excluded.budget, updated_at = now();
  perform public.audit_write('coding.cost_centre','budget_line', v_code, jsonb_build_object('budget', p_budget));
  return jsonb_build_object('code', v_code, 'budget', greatest(coalesce(p_budget, 0), 0));
end $$;

-- ---------- requisitions gain the full form's fields ----------
alter table public.requisitions add column if not exists qty numeric;
alter table public.requisitions add column if not exists unit text;
alter table public.requisitions add column if not exists unit_price numeric;
alter table public.requisitions add column if not exists project_code text;
alter table public.requisitions add column if not exists justification text;

-- withdraw sends a pending requisition back to draft — register those transitions
insert into public.record_transitions(record_type, from_state, to_state) values
  ('requisition','submitted','draft'),
  ('requisition','md_review','draft')
on conflict do nothing;

-- ---------- submit a requisition (full form; optional Save-as-Draft) ----------
drop function if exists public.submit_requisition(text,numeric,text);
create or replace function public.submit_requisition(
  p_item text, p_amount numeric, p_code text,
  p_qty numeric default 1, p_unit text default 'unit', p_unit_price numeric default null,
  p_project text default null, p_justification text default null, p_as_draft boolean default false)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  bc jsonb; rt jsonb; v_ref text; v_state text; v_status text;
  v_entity uuid := (select id from public.entities where code = 'KE');
  v_owner uuid := (select id from public.app_users where auth_id = auth.uid());
begin
  perform public.assert_access('procurement', 2);
  bc := public.budget_check(p_code, p_amount);          -- chip shown either way
  v_ref := public.next_ref('PR');
  if p_as_draft then
    insert into public.requisitions(ref, entity_id, owner_id, item, amount, budget_code,
      budget_chip, budget_chip_txt, state, qty, unit, unit_price, project_code, justification)
    values (v_ref, v_entity, v_owner, p_item, p_amount, p_code, bc->>'chip', bc->>'chipTxt', 'draft',
            p_qty, p_unit, p_unit_price, nullif(trim(coalesce(p_project,'')),''), nullif(trim(coalesce(p_justification,'')),''));
    perform public.audit_write('requisition.drafted','requisition', v_ref, jsonb_build_object('item', p_item, 'amount', p_amount));
    return jsonb_build_object('id', v_ref, 'item', p_item, 'amt', p_amount, 'code', p_code,
      'chip', bc->>'chip', 'chipTxt', bc->>'chipTxt', 'status', 'draft',
      'routing', jsonb_build_object('label', 'Draft', 'who', 'saved — submit when ready'));
  end if;
  rt := public.route_approval(p_amount);
  v_state := rt->>'resultState';
  insert into public.requisitions(ref, entity_id, owner_id, item, amount, budget_code,
    budget_chip, budget_chip_txt, state, qty, unit, unit_price, project_code, justification)
  values (v_ref, v_entity, v_owner, p_item, p_amount, p_code, bc->>'chip', bc->>'chipTxt', v_state,
          p_qty, p_unit, p_unit_price, nullif(trim(coalesce(p_project,'')),''), nullif(trim(coalesce(p_justification,'')),''));
  update public.budget_lines set committed = committed + p_amount where code = p_code;
  v_status := case v_state when 'approved' then 'approved' when 'md_review' then 'md' else 'await' end;
  perform public.audit_write('requisition.submitted','requisition', v_ref,
    jsonb_build_object('item', p_item, 'amount', p_amount, 'code', p_code, 'budget', bc->>'chipTxt', 'routing', rt->>'label'));
  if v_state in ('submitted','md_review') then
    perform public.notify_role('procurement', 3, 'req_approval',
      v_ref || ' awaiting your approval', p_item || ' — ' || public.fmt_kes(p_amount) || ' (' || (bc->>'chipTxt') || ')',
      'procurement', v_ref);
  end if;
  return jsonb_build_object('id', v_ref, 'item', p_item, 'amt', p_amount, 'code', p_code,
    'chip', bc->>'chip', 'chipTxt', bc->>'chipTxt', 'status', v_status,
    'routing', jsonb_build_object('label', rt->>'label', 'who', rt->>'who'));
end $$;

-- ---------- a draft moves into approval ----------
create or replace function public.submit_requisition_final(p_ref text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare r record; bc jsonb; rt jsonb; v_state text; v_status text;
begin
  perform public.assert_access('procurement', 2);
  select * into r from public.requisitions where ref = p_ref;
  if not found then raise exception 'Requisition % not found', p_ref; end if;
  if r.state <> 'draft' then raise exception '% is not a draft (state: %)', p_ref, r.state; end if;
  bc := public.budget_check(r.budget_code, r.amount);
  rt := public.route_approval(r.amount);
  v_state := rt->>'resultState';
  update public.requisitions set state = v_state, budget_chip = bc->>'chip', budget_chip_txt = bc->>'chipTxt', updated_at = now()
   where id = r.id;
  update public.budget_lines set committed = committed + r.amount where code = r.budget_code;
  v_status := case v_state when 'approved' then 'approved' when 'md_review' then 'md' else 'await' end;
  perform public.audit_write('requisition.submitted','requisition', p_ref, jsonb_build_object('from', 'draft', 'routing', rt->>'label'));
  if v_state in ('submitted','md_review') then
    perform public.notify_role('procurement', 3, 'req_approval',
      p_ref || ' awaiting your approval', r.item || ' — ' || public.fmt_kes(r.amount), 'procurement', p_ref);
  end if;
  return jsonb_build_object('id', p_ref, 'status', v_status);
end $$;

-- ---------- requester withdraws: pending → draft (release budget), or discard a draft ----------
create or replace function public.withdraw_requisition(p_ref text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare r record; v_me uuid := (select id from public.app_users where auth_id = auth.uid());
begin
  perform public.assert_access('procurement', 2);
  select * into r from public.requisitions where ref = p_ref;
  if not found then raise exception 'Requisition % not found', p_ref; end if;
  if v_me is not null and r.owner_id is not null and v_me <> r.owner_id then
    raise exception 'Only the requester can withdraw %', p_ref;
  end if;
  if r.state in ('submitted','md_review') then
    update public.requisitions set state = 'draft', updated_at = now() where id = r.id;
    update public.budget_lines set committed = greatest(committed - r.amount, 0) where code = r.budget_code;
    perform public.audit_write('requisition.withdrawn','requisition', p_ref, jsonb_build_object('to', 'draft'));
    return jsonb_build_object('id', p_ref, 'status', 'draft');
  elsif r.state = 'draft' then
    delete from public.requisitions where id = r.id;
    perform public.audit_write('requisition.discarded','requisition', p_ref, '{}'::jsonb);
    return jsonb_build_object('id', p_ref, 'status', 'discarded');
  else
    raise exception 'Only a draft or pending requisition can be withdrawn (state: %)', r.state;
  end if;
end $$;

-- ---------- grants ----------
do $$
declare fn text;
begin
  foreach fn in array array[
    'upsert_cost_centre(text,numeric)',
    'submit_requisition(text,numeric,text,numeric,text,numeric,text,text,boolean)',
    'submit_requisition_final(text)',
    'withdraw_requisition(text)']
  loop
    execute format('revoke execute on function public.%s from public, anon', fn);
    execute format('grant execute on function public.%s to authenticated', fn);
  end loop;
end $$;
