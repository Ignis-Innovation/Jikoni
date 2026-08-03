-- ============================================================
-- Jikoni Tool — Finance & Procurement PRD v2: control-gap fixes
-- Closes the loopholes called out in the v2 PRD (backend-enforced + testable):
--   #2 vendor bank-detail change → callback verification before it takes effect
--   #3 duplicate supplier-invoice check on capture
--   #4 PO amendment → re-approval when the change exceeds tolerance
--   #5 three-way-match tolerance + PO-amend tolerance are configurable (app_config)
--   #6 over-delivery on a GRN is held, not silently accepted
--   #1 notifications fire on approvals + exceptions (notify_role helper)
-- Plus set_app_config so Settings can edit the rules. Idempotent: safe to re-run.
-- ============================================================

-- ---------- configurable rules ----------
insert into public.app_config(key, value) values
  ('match_tolerance_pct', '0.5'::jsonb),
  ('po_amend_tolerance_pct', '5'::jsonb),
  ('manual_journal_threshold', '100000'::jsonb),
  ('reminder_hours', '24'::jsonb),
  ('escalation_hours', '72'::jsonb)
on conflict (key) do nothing;

-- admin setter for the Settings screen
create or replace function public.set_app_config(p_key text, p_value jsonb)
returns jsonb language plpgsql security definer set search_path = public as $$
begin
  perform public.assert_access('users', 2);
  if p_key not in ('match_tolerance_pct','po_amend_tolerance_pct','manual_journal_threshold',
                   'reminder_hours','escalation_hours','enforce_sod','enforce_access') then
    raise exception 'Unknown setting: %', p_key;
  end if;
  insert into public.app_config(key, value, updated_at) values (p_key, p_value, now())
  on conflict (key) do update set value = excluded.value, updated_at = now();
  perform public.audit_write('config.updated','app_config', p_key, jsonb_build_object('value', p_value));
  return jsonb_build_object('key', p_key, 'value', p_value);
end $$;

-- ---------- notifications: fan a notification out to everyone holding a role ----------
create or replace function public.notify_role(
  p_module text, p_min_level int, p_kind text, p_title text, p_body text,
  p_link_view text, p_link_ref text
) returns void language plpgsql security definer set search_path = public as $$
declare v_entity uuid := (select id from public.entities where code = 'KE');
begin
  insert into public.notifications(entity_id, recipient_email, kind, title, body, link_view, link_ref)
  select v_entity, up.email, p_kind, p_title, p_body, p_link_view, p_link_ref
  from public.user_permissions up
  where up.module = p_module and up.level >= p_min_level;
end $$;

-- ---------- PO amendment (loophole #4) ----------
alter table public.purchase_orders add column if not exists needs_reapproval boolean not null default false;

create or replace function public.amend_po(
  p_po_ref text, p_new_amount numeric, p_new_delivery text default null, p_reason text default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  po record; bcode text; tol numeric; delta_pct numeric; v_reapp boolean;
begin
  perform public.assert_access('procurement', 2);
  select * into po from public.purchase_orders where ref = p_po_ref;
  if not found then raise exception 'PO % not found', p_po_ref; end if;
  if po.state in ('closed','cancelled') then raise exception 'PO % is % and cannot be amended', p_po_ref, po.state; end if;
  if coalesce(p_new_amount, 0) <= 0 then raise exception 'A new amount is required'; end if;
  tol := coalesce((select value::numeric from public.app_config where key = 'po_amend_tolerance_pct'), 5);
  delta_pct := case when po.amount > 0 then abs(p_new_amount - po.amount) / po.amount * 100 else 100 end;
  v_reapp := delta_pct > tol;
  -- move the budget commitment by the delta on the coded line
  select budget_code into bcode from public.requisitions where id = po.requisition_id;
  if bcode is not null then
    update public.budget_lines set committed = greatest(committed + (p_new_amount - po.amount), 0) where code = bcode;
  end if;
  update public.purchase_orders
     set amount = p_new_amount,
         delivery = coalesce(nullif(trim(coalesce(p_new_delivery, '')), ''), delivery),
         needs_reapproval = v_reapp, updated_at = now()
   where id = po.id;
  perform public.audit_write('po.amended','po', p_po_ref,
    jsonb_build_object('from', po.amount, 'to', p_new_amount, 'deltaPct', round(delta_pct, 1), 'reason', p_reason, 'reapproval', v_reapp));
  if v_reapp then
    perform public.notify_role('procurement', 3, 'po_amend',
      p_po_ref || ' amended — needs re-approval',
      po.vendor_name || ': ' || public.fmt_kes(po.amount) || ' → ' || public.fmt_kes(p_new_amount) || ' (' || round(delta_pct, 1) || '%)',
      'procurement', p_po_ref);
  end if;
  return jsonb_build_object('id', p_po_ref, 'amount', p_new_amount, 'reapproval', v_reapp, 'deltaPct', round(delta_pct, 1));
end $$;

create or replace function public.approve_po_amendment(p_po_ref text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare po record;
begin
  perform public.assert_access('procurement', 3);
  select * into po from public.purchase_orders where ref = p_po_ref;
  if not found then raise exception 'PO % not found', p_po_ref; end if;
  update public.purchase_orders set needs_reapproval = false, updated_at = now() where id = po.id;
  perform public.audit_write('po.amendment_approved','po', p_po_ref, jsonb_build_object('amount', po.amount));
  return jsonb_build_object('id', p_po_ref, 'reapproval', false);
end $$;

-- ---------- goods received: hold over-delivery (loophole #6) ----------
create or replace function public.submit_grn(p_po_ref text, p_coverage text, p_pct int, p_note text default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  po record; req_owner uuid; v_ref text; existing int; added int; total_pct int;
  v_entity uuid := (select id from public.entities where code = 'KE');
  v_receiver uuid := (select id from public.app_users where auth_id = auth.uid());
begin
  perform public.assert_access('procurement', 2);
  select * into po from public.purchase_orders where ref = p_po_ref;
  if not found then raise exception 'PO % not found', p_po_ref; end if;
  if po.state = 'closed' then raise exception 'PO % is closed', p_po_ref; end if;
  select owner_id into req_owner from public.requisitions where id = po.requisition_id;
  perform public.assert_sod('goods receipt (receiver ≠ requester)', req_owner);
  select coalesce(sum(pct), 0) into existing from public.goods_received_notes where po_id = po.id and state = 'received';
  if existing >= 100 then raise exception 'PO % is already fully received', p_po_ref; end if;
  added := case when p_coverage = 'full' then 100 - existing else least(greatest(p_pct, 1), 99) end;
  -- over-delivery is held, not silently accepted: a partial that exceeds the balance is blocked
  if existing + added > 100 then
    raise exception 'Over-delivery: PO % already has % of 100 received — amend the PO to receive more', p_po_ref, existing;
  end if;
  v_ref := public.next_ref('GRN');
  insert into public.goods_received_notes(ref, entity_id, po_id, receiver_id, coverage, pct, note)
  values (v_ref, v_entity, po.id, v_receiver,
          case when p_coverage = 'full' then 'full' else 'partial' end, added, p_note);
  select coalesce(sum(pct), 0) into total_pct from public.goods_received_notes where po_id = po.id and state = 'received';
  if po.state = 'open' and total_pct < 100 then
    update public.purchase_orders set state = 'partially_received' where id = po.id;
  end if;
  perform public.audit_write('grn.received','grn', v_ref,
    jsonb_build_object('po', p_po_ref, 'coverage', p_coverage, 'pct', added));
  return jsonb_build_object('id', v_ref, 'po', p_po_ref, 'totalPct', least(total_pct, 100));
end $$;

-- ---------- payables: duplicate check + amendment gate + configurable tolerance ----------
create or replace function public.three_way_match(p_invoice_id uuid) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  inv record; po record; grn_pct int; tol numeric;
  amount_ok boolean; grn_ok boolean; over boolean;
begin
  select * into inv from public.invoices_ap where id = p_invoice_id;
  select * into po from public.purchase_orders where id = inv.po_id;
  select coalesce(sum(pct), 0) into grn_pct from public.goods_received_notes where po_id = po.id and state = 'received';
  tol := coalesce((select value::numeric from public.app_config where key = 'match_tolerance_pct'), 0.5) / 100.0;
  amount_ok := abs(inv.amount - po.amount) <= po.amount * tol;
  over := grn_pct > 100;
  grn_ok := grn_pct >= 100 and not over;
  if amount_ok and grn_ok then
    update public.invoices_ap set state = 'matched', match_note = null where id = inv.id;
    update public.purchase_orders set state = 'closed' where id = po.id and state in ('open','partially_received');
    perform public.audit_write('invoice.matched','invoice_ap', inv.ref, jsonb_build_object('po', po.ref, 'amount', inv.amount));
    return jsonb_build_object('state','matched');
  else
    update public.invoices_ap set state = 'exception',
      match_note = case
        when over then format('Over-delivery: goods received %s%%', grn_pct)
        when not grn_ok then format('Goods received %s%% — awaiting balance', grn_pct)
        else format('Amount mismatch: invoice %s vs PO %s', inv.amount, po.amount) end
      where id = inv.id;
    perform public.audit_write('invoice.exception','invoice_ap', inv.ref,
      jsonb_build_object('po', po.ref, 'grnPct', grn_pct, 'invoice', inv.amount, 'poAmount', po.amount, 'over', over));
    -- route the exception by type (loophole #1 / §9.3)
    perform public.notify_role('finance', 3, 'match_exception',
      inv.ref || ' held — match exception',
      case when over then po.vendor_name || ': over-delivery ' || grn_pct || '%'
           when not grn_ok then po.vendor_name || ': goods only ' || grn_pct || '% received'
           else po.vendor_name || ': amount mismatch' end,
      'finance', inv.ref);
    return jsonb_build_object('state','exception');
  end if;
end $$;

create or replace function public.capture_ap_invoice(p_po_ref text, p_amount numeric)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  po record; v_ref text; v_id uuid; m jsonb; line record;
  v_entity uuid := (select id from public.entities where code = 'KE');
begin
  perform public.assert_access('finance', 2);
  select * into po from public.purchase_orders where ref = p_po_ref;
  if not found then raise exception 'PO % not found', p_po_ref; end if;
  -- loophole #4: an amended PO must be re-approved before an invoice is captured
  if po.needs_reapproval then raise exception 'PO % was amended and is awaiting re-approval', p_po_ref; end if;
  -- loophole #3: duplicate invoice guard — one live invoice per PO in this model
  if exists (select 1 from public.invoices_ap where po_id = po.id and state in ('captured','matched','paid')) then
    raise exception 'Possible duplicate: % already has a supplier invoice captured', p_po_ref;
  end if;
  v_ref := public.next_ref('INV');
  insert into public.invoices_ap(ref, entity_id, vendor_id, po_id, amount)
  values (v_ref, v_entity, po.vendor_id, po.id, p_amount) returning id into v_id;
  select bl.* into line from public.budget_lines bl
    join public.requisitions r on r.budget_code = bl.code where r.id = po.requisition_id;
  perform public.post_journal('Supplier invoice ' || v_ref || ' — ' || po.vendor_name, 'invoice_ap', v_ref,
    jsonb_build_array(
      jsonb_build_object('account', coalesce(line.account_code,'5000'), 'debit', p_amount),
      jsonb_build_object('account', '2000', 'credit', p_amount)));
  perform public.audit_write('invoice.captured','invoice_ap', v_ref, jsonb_build_object('po', p_po_ref, 'amount', p_amount));
  m := public.three_way_match(v_id);
  return jsonb_build_object('id', v_ref, 'po', p_po_ref, 'match', m->>'state');
end $$;

-- ---------- requisition submission notifies the approver (loophole #1) ----------
create or replace function public.submit_requisition(p_item text, p_amount numeric, p_code text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  bc jsonb; rt jsonb; v_ref text; v_state text; v_status text;
  v_entity uuid := (select id from public.entities where code = 'KE');
  v_owner uuid := (select id from public.app_users where auth_id = auth.uid());
begin
  perform public.assert_access('procurement', 2);
  bc := public.budget_check(p_code, p_amount);
  rt := public.route_approval(p_amount);
  v_state := rt->>'resultState';
  v_ref := public.next_ref('PR');
  insert into public.requisitions(ref, entity_id, owner_id, item, amount, budget_code, budget_chip, budget_chip_txt, state)
  values (v_ref, v_entity, v_owner, p_item, p_amount, p_code, bc->>'chip', bc->>'chipTxt', v_state);
  update public.budget_lines set committed = committed + p_amount where code = p_code;
  v_status := case v_state when 'approved' then 'approved' when 'md_review' then 'md' else 'await' end;
  perform public.audit_write('requisition.submitted','requisition', v_ref,
    jsonb_build_object('item', p_item, 'amount', p_amount, 'code', p_code, 'budget', bc->>'chipTxt', 'routing', rt->>'label'));
  -- notify approvers when the requisition actually needs a decision
  if v_state in ('submitted','md_review') then
    perform public.notify_role('procurement', 3, 'req_approval',
      v_ref || ' awaiting your approval',
      p_item || ' — ' || public.fmt_kes(p_amount) || ' (' || (bc->>'chipTxt') || ')',
      'procurement', v_ref);
  end if;
  return jsonb_build_object('id', v_ref, 'item', p_item, 'amt', p_amount, 'code', p_code,
    'chip', bc->>'chip', 'chipTxt', bc->>'chipTxt', 'status', v_status,
    'routing', jsonb_build_object('label', rt->>'label', 'who', rt->>'who'));
end $$;

-- ---------- vendor bank-detail change → callback verification (loophole #2) ----------
create table if not exists public.vendor_bank_changes (
  id           uuid primary key default gen_random_uuid(),
  entity_id    uuid references public.entities(id),
  vendor_id    uuid not null references public.vendors(id),
  vendor_name  text not null,
  old_bank     text,
  new_bank     text not null,
  requested_by uuid,
  verified_by  uuid,
  callback_note text,
  state        text not null default 'pending' check (state in ('pending','verified','rejected')),
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);
alter table public.vendor_bank_changes enable row level security;
drop policy if exists "read for authenticated" on public.vendor_bank_changes;
create policy "read for authenticated" on public.vendor_bank_changes for select to authenticated using (true);

create or replace function public.request_vendor_bank_change(p_vendor_name text, p_new_bank text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v record; v_id uuid;
  v_entity uuid := (select id from public.entities where code = 'KE');
  v_actor uuid := (select id from public.app_users where auth_id = auth.uid());
begin
  perform public.assert_access('procurement', 2);
  if nullif(trim(coalesce(p_new_bank, '')), '') is null then raise exception 'New bank details are required'; end if;
  select * into v from public.vendors where name = p_vendor_name;
  if not found then raise exception 'Vendor % not found', p_vendor_name; end if;
  -- supersede any earlier pending request for this vendor
  update public.vendor_bank_changes set state = 'rejected', updated_at = now()
   where vendor_id = v.id and state = 'pending';
  insert into public.vendor_bank_changes(entity_id, vendor_id, vendor_name, old_bank, new_bank, requested_by)
  values (v_entity, v.id, v.name, v.bank, trim(p_new_bank), v_actor) returning id into v_id;
  perform public.audit_write('vendor.bank_change_requested','vendor', p_vendor_name,
    jsonb_build_object('old', v.bank, 'new', trim(p_new_bank)));
  -- security notification cannot be muted (§9.2): alert finance approvers to verify by callback
  perform public.notify_role('finance', 3, 'vendor_bank_change',
    'Bank-detail change requested — verify by callback',
    p_vendor_name || ': confirm the new account by phone using the number on file before approving.',
    'procurement', p_vendor_name);
  return jsonb_build_object('id', v_id, 'vendor', p_vendor_name, 'state', 'pending');
end $$;

create or replace function public.approve_vendor_bank_change(p_change_id uuid, p_callback_note text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare ch record;
  v_actor uuid := (select id from public.app_users where auth_id = auth.uid());
begin
  perform public.assert_access('finance', 3);
  select * into ch from public.vendor_bank_changes where id = p_change_id;
  if not found then raise exception 'Change request not found'; end if;
  if ch.state <> 'pending' then raise exception 'This request is already %', ch.state; end if;
  -- requester ≠ verifier is a named security control — enforced regardless of the SoD flag
  if v_actor is not null and v_actor = ch.requested_by then
    raise exception 'The person who requested the bank-detail change cannot verify it';
  end if;
  if nullif(trim(coalesce(p_callback_note, '')), '') is null then
    raise exception 'Record the callback confirmation (who you spoke to and the number called)';
  end if;
  update public.vendor_bank_changes
     set state = 'verified', verified_by = v_actor, callback_note = trim(p_callback_note), updated_at = now()
   where id = ch.id;
  update public.vendors set bank = ch.new_bank, updated_at = now() where id = ch.vendor_id;
  perform public.audit_write('vendor.bank_change_verified','vendor', ch.vendor_name,
    jsonb_build_object('new', ch.new_bank, 'callback', trim(p_callback_note)));
  return jsonb_build_object('id', ch.id, 'vendor', ch.vendor_name, 'state', 'verified');
end $$;

-- ---------- grants ----------
do $$
declare fn text;
begin
  foreach fn in array array[
    'set_app_config(text,jsonb)',
    'notify_role(text,int,text,text,text,text,text)',
    'amend_po(text,numeric,text,text)',
    'approve_po_amendment(text)',
    'submit_grn(text,text,int,text)',
    'three_way_match(uuid)',
    'capture_ap_invoice(text,numeric)',
    'submit_requisition(text,numeric,text)',
    'request_vendor_bank_change(text,text)',
    'approve_vendor_bank_change(uuid,text)']
  loop
    execute format('revoke execute on function public.%s from public, anon', fn);
    execute format('grant execute on function public.%s to authenticated', fn);
  end loop;
end $$;
