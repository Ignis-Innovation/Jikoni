-- ============================================================
-- Jikoni Tool — UI Build Spec: qty-based chain + payables enrichment + storage
-- Single-line, quantity-based model (confirmed with Brian). Covers spec items:
--   #2 raise_po now carries an editable qty + unit price (from the requisition)
--   #3 GRN moves from % complete to quantity received against the PO's ordered qty,
--      with per-delivery over-delivery held (accept → PO amendment / reject the excess)
--   #1 capture_ap_invoice gains invoice number / date / currency / withholding tax and
--      a duplicate guard (vendor + invoice number + amount); adds an Approve-for-Payment
--      step (preparer ≠ approver); pay deducts WHT to a payable account
--   #5 a shared 'uploads' storage bucket for GRN photos, requisition/RFQ attachments, etc.
-- Idempotent: safe to re-run.
-- ============================================================

-- ---------- schema ----------
alter table public.purchase_orders   add column if not exists qty numeric;
alter table public.purchase_orders   add column if not exists unit_price numeric;
alter table public.goods_received_notes add column if not exists qty_received numeric;
alter table public.goods_received_notes add column if not exists over_delivery boolean not null default false;
alter table public.goods_received_notes add column if not exists photo_path text;

alter table public.invoices_ap add column if not exists invoice_number text;
alter table public.invoices_ap add column if not exists invoice_date date;
alter table public.invoices_ap add column if not exists currency text not null default 'KES';
alter table public.invoices_ap add column if not exists wht_applied boolean not null default false;
alter table public.invoices_ap add column if not exists wht_amount numeric not null default 0;
alter table public.invoices_ap add column if not exists captured_by uuid;
-- add the Approve-for-Payment state between matched and paid
alter table public.invoices_ap drop constraint if exists invoices_ap_state_check;
alter table public.invoices_ap add constraint invoices_ap_state_check
  check (state in ('captured','matched','exception','approved','paid'));
insert into public.record_transitions(record_type, from_state, to_state) values
  ('invoice_ap','matched','approved'), ('invoice_ap','approved','paid')
on conflict do nothing;

-- WHT payable account + rate config
insert into public.chart_of_accounts(entity_id, code, name, kind)
select (select id from public.entities where code = 'KE'), '2200', 'Withholding tax payable', 'liability'
on conflict (entity_id, code) do nothing;
insert into public.app_config(key, value) values ('wht_rate_pct', '5'::jsonb) on conflict (key) do nothing;

-- shared uploads bucket (public read; authenticated write)
insert into storage.buckets(id, name, public) values ('uploads','uploads', true) on conflict (id) do nothing;
drop policy if exists "uploads read" on storage.objects;
create policy "uploads read" on storage.objects for select using (bucket_id = 'uploads');
drop policy if exists "uploads write" on storage.objects;
create policy "uploads write" on storage.objects for insert to authenticated with check (bucket_id = 'uploads');
drop policy if exists "uploads update" on storage.objects;
create policy "uploads update" on storage.objects for update to authenticated using (bucket_id = 'uploads');

-- ---------- #2 raise PO with an editable line (qty + unit price) ----------
drop function if exists public.raise_po(text,text,text);
create or replace function public.raise_po(
  p_req_ref text, p_vendor_name text, p_delivery text,
  p_qty numeric default null, p_unit_price numeric default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  r record; v record; v_ref text; v_delivery text; v_qty numeric; v_price numeric; v_amount numeric;
  v_entity uuid := (select id from public.entities where code = 'KE');
  v_owner uuid := (select id from public.app_users where auth_id = auth.uid());
begin
  perform public.assert_access('procurement', 2);
  select * into r from public.requisitions where ref = p_req_ref;
  if not found then raise exception 'Requisition % not found', p_req_ref; end if;
  if r.state <> 'approved' then
    raise exception 'Document chain: % must be approved before a PO can exist (state: %)', p_req_ref, r.state;
  end if;
  select * into v from public.vendors where name = p_vendor_name;
  if not found then raise exception 'Vendor % is not registered', p_vendor_name; end if;
  v_qty   := greatest(coalesce(p_qty, r.qty, 1), 0.0001);
  v_price := coalesce(p_unit_price, r.unit_price, r.amount / v_qty);
  v_amount := round(v_qty * v_price, 2);
  v_ref := public.next_ref('PO');
  v_delivery := coalesce(nullif(trim(coalesce(p_delivery, '')), ''), '—');
  insert into public.purchase_orders(ref, entity_id, owner_id, requisition_id, vendor_id, vendor_name, amount, delivery, qty, unit_price)
  values (v_ref, v_entity, v_owner, r.id, v.id, v.name, v_amount, v_delivery, v_qty, v_price);  -- sanctions gate fires here
  update public.requisitions set state = 'converted' where id = r.id;
  update public.vendors set open_pos = open_pos + 1 where id = v.id;
  perform public.audit_write('po.issued','po', v_ref,
    jsonb_build_object('requisition', p_req_ref, 'vendor', v.name, 'qty', v_qty, 'unitPrice', v_price, 'amount', v_amount));
  return jsonb_build_object('id', v_ref, 'vendor', v.name, 'amt', v_amount, 'delivery', v_delivery, 'qty', v_qty);
end $$;

-- ---------- #3 goods received by quantity, with over-delivery held ----------
drop function if exists public.submit_grn(text,text,int,text);
create or replace function public.submit_grn(
  p_po_ref text, p_qty_received numeric, p_note text default null,
  p_over_action text default null, p_photo_path text default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  po record; req_owner uuid; v_ref text; ordered numeric; existing numeric; remaining numeric;
  v_qty numeric; v_over boolean := false; v_pct int;
  v_entity uuid := (select id from public.entities where code = 'KE');
  v_receiver uuid := (select id from public.app_users where auth_id = auth.uid());
begin
  perform public.assert_access('procurement', 2);
  select * into po from public.purchase_orders where ref = p_po_ref;
  if not found then raise exception 'PO % not found', p_po_ref; end if;
  if po.state = 'closed' then raise exception 'PO % is closed', p_po_ref; end if;
  select owner_id into req_owner from public.requisitions where id = po.requisition_id;
  perform public.assert_sod('goods receipt (receiver ≠ requester)', req_owner);
  if coalesce(p_qty_received, 0) <= 0 then raise exception 'Enter the quantity received'; end if;
  ordered := coalesce(po.qty, 1);
  select coalesce(sum(qty_received), 0) into existing from public.goods_received_notes where po_id = po.id and state = 'received';
  remaining := ordered - existing;
  if remaining <= 0 then raise exception 'PO % is already fully received (%/%)', p_po_ref, existing, ordered; end if;
  v_qty := p_qty_received;
  if v_qty > remaining then
    if p_over_action = 'accept' then
      v_over := true;                                   -- record the excess but hold via a PO amendment
      update public.purchase_orders set needs_reapproval = true where id = po.id;
    elsif p_over_action = 'reject' then
      v_qty := remaining;                               -- take only what was ordered, turn the rest away
    else
      raise exception 'Over-delivery: % received but only % remain on % — accept (amend PO) or reject the excess', v_qty, remaining, p_po_ref;
    end if;
  end if;
  v_ref := public.next_ref('GRN');
  v_pct := least(round((existing + v_qty) / ordered * 100)::int, 100);
  insert into public.goods_received_notes(ref, entity_id, po_id, receiver_id, coverage, pct, qty_received, over_delivery, note, photo_path)
  values (v_ref, v_entity, po.id, v_receiver,
          case when (existing + v_qty) >= ordered then 'full' else 'partial' end,
          greatest(v_pct, 1), v_qty, v_over, p_note, p_photo_path);
  if po.state = 'open' and (existing + v_qty) < ordered then
    update public.purchase_orders set state = 'partially_received' where id = po.id;
  end if;
  perform public.audit_write('grn.received','grn', v_ref,
    jsonb_build_object('po', p_po_ref, 'qty', v_qty, 'ordered', ordered, 'over', v_over));
  return jsonb_build_object('id', v_ref, 'po', p_po_ref, 'received', existing + v_qty, 'ordered', ordered, 'over', v_over);
end $$;

-- ---------- three-way match on quantity ----------
create or replace function public.three_way_match(p_invoice_id uuid) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  inv record; po record; recv numeric; ordered numeric; tol numeric;
  amount_ok boolean; grn_ok boolean; over boolean;
begin
  select * into inv from public.invoices_ap where id = p_invoice_id;
  select * into po from public.purchase_orders where id = inv.po_id;
  ordered := coalesce(po.qty, 1);
  select coalesce(sum(qty_received), 0) into recv from public.goods_received_notes where po_id = po.id and state = 'received';
  tol := coalesce((select value::numeric from public.app_config where key = 'match_tolerance_pct'), 0.5) / 100.0;
  amount_ok := abs(inv.amount - po.amount) <= po.amount * tol;
  over := recv > ordered;
  grn_ok := recv >= ordered and not over;
  if amount_ok and grn_ok then
    update public.invoices_ap set state = 'matched', match_note = null where id = inv.id;
    update public.purchase_orders set state = 'closed' where id = po.id and state in ('open','partially_received');
    perform public.audit_write('invoice.matched','invoice_ap', inv.ref, jsonb_build_object('po', po.ref, 'amount', inv.amount));
    return jsonb_build_object('state','matched');
  else
    update public.invoices_ap set state = 'exception',
      match_note = case
        when over then format('Over-delivery: %s of %s received', recv, ordered)
        when recv < ordered then format('Goods received %s of %s — awaiting balance', recv, ordered)
        else format('Amount mismatch: invoice %s vs PO %s', inv.amount, po.amount) end
      where id = inv.id;
    perform public.audit_write('invoice.exception','invoice_ap', inv.ref,
      jsonb_build_object('po', po.ref, 'received', recv, 'ordered', ordered, 'invoice', inv.amount, 'poAmount', po.amount, 'over', over));
    perform public.notify_role('finance', 3, 'match_exception',
      inv.ref || ' held — match exception',
      case when over then po.vendor_name || ': over-delivery ' || recv || '/' || ordered
           when recv < ordered then po.vendor_name || ': received ' || recv || '/' || ordered
           else po.vendor_name || ': amount mismatch' end,
      'finance', inv.ref);
    return jsonb_build_object('state','exception');
  end if;
end $$;

-- ---------- #1 capture supplier invoice (number/date/currency/WHT + duplicate guard) ----------
drop function if exists public.capture_ap_invoice(text,numeric);
create or replace function public.capture_ap_invoice(
  p_po_ref text, p_amount numeric, p_invoice_number text default null,
  p_invoice_date date default null, p_currency text default 'KES', p_wht boolean default false)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  po record; v_ref text; v_id uuid; m jsonb; line record; dup text; v_wht numeric; v_rate numeric;
  v_entity uuid := (select id from public.entities where code = 'KE');
  v_actor uuid := (select id from public.app_users where auth_id = auth.uid());
  v_num text := nullif(trim(coalesce(p_invoice_number, '')), '');
begin
  perform public.assert_access('finance', 2);
  select * into po from public.purchase_orders where ref = p_po_ref;
  if not found then raise exception 'PO % not found', p_po_ref; end if;
  if po.needs_reapproval then raise exception 'PO % was amended and is awaiting re-approval', p_po_ref; end if;
  -- duplicate guard: same vendor + invoice number + amount already in the system
  if v_num is not null then
    select i.ref into dup from public.invoices_ap i
      where i.vendor_id = po.vendor_id and lower(i.invoice_number) = lower(v_num) and i.amount = p_amount
      limit 1;
    if dup is not null then raise exception 'Possible duplicate of % (same vendor, invoice number and amount)', dup; end if;
  end if;
  -- one live invoice per PO in this single-line model
  if exists (select 1 from public.invoices_ap where po_id = po.id and state in ('captured','matched','approved','paid')) then
    raise exception 'Possible duplicate: % already has a supplier invoice captured', p_po_ref;
  end if;
  v_rate := coalesce((select value::numeric from public.app_config where key = 'wht_rate_pct'), 5);
  v_wht := case when p_wht then round(p_amount * v_rate / 100.0, 2) else 0 end;
  v_ref := public.next_ref('INV');
  insert into public.invoices_ap(ref, entity_id, vendor_id, po_id, amount, invoice_number, invoice_date, currency, wht_applied, wht_amount, captured_by)
  values (v_ref, v_entity, po.vendor_id, po.id, p_amount, v_num, p_invoice_date, coalesce(nullif(p_currency,''),'KES'), p_wht, v_wht, v_actor)
  returning id into v_id;
  select bl.* into line from public.budget_lines bl
    join public.requisitions r on r.budget_code = bl.code where r.id = po.requisition_id;
  perform public.post_journal('Supplier invoice ' || v_ref || ' — ' || po.vendor_name, 'invoice_ap', v_ref,
    jsonb_build_array(
      jsonb_build_object('account', coalesce(line.account_code,'5000'), 'debit', p_amount),
      jsonb_build_object('account', '2000', 'credit', p_amount)));
  perform public.audit_write('invoice.captured','invoice_ap', v_ref,
    jsonb_build_object('po', p_po_ref, 'amount', p_amount, 'number', v_num, 'wht', v_wht));
  m := public.three_way_match(v_id);
  return jsonb_build_object('id', v_ref, 'po', p_po_ref, 'match', m->>'state', 'wht', v_wht);
end $$;

-- ---------- #1 approve for payment (preparer ≠ approver) ----------
create or replace function public.approve_ap_invoice(p_inv_ref text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare inv record; v_me uuid := (select id from public.app_users where auth_id = auth.uid());
begin
  perform public.assert_access('finance', 3);
  select * into inv from public.invoices_ap where ref = p_inv_ref;
  if not found then raise exception 'Invoice % not found', p_inv_ref; end if;
  if inv.state <> 'matched' then raise exception '% must be matched before approval (state: %)', p_inv_ref, inv.state; end if;
  if v_me is not null and inv.captured_by is not null and v_me = inv.captured_by then
    raise exception 'The person who captured % cannot approve it for payment', p_inv_ref;
  end if;
  update public.invoices_ap set state = 'approved' where id = inv.id;
  perform public.audit_write('invoice.approved','invoice_ap', p_inv_ref, jsonb_build_object('amount', inv.amount));
  return jsonb_build_object('id', p_inv_ref, 'state', 'approved');
end $$;

-- ---------- pay (requires approval; deducts WHT) ----------
create or replace function public.pay_invoice(p_inv_ref text, p_method text default 'bank')
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  inv record; po record; v_ref text; je text; bcode text; net numeric; lines jsonb;
  v_entity uuid := (select id from public.entities where code = 'KE');
begin
  perform public.assert_access('finance', 3);
  select * into inv from public.invoices_ap where ref = p_inv_ref;
  if not found then raise exception 'Invoice % not found', p_inv_ref; end if;
  if inv.state <> 'approved' then
    raise exception 'Approval required: % must be approved for payment first (state: %)', p_inv_ref, inv.state;
  end if;
  select * into po from public.purchase_orders where id = inv.po_id;
  net := inv.amount - coalesce(inv.wht_amount, 0);
  v_ref := public.next_ref('PAY');
  lines := jsonb_build_array(
    jsonb_build_object('account', '2000', 'debit', inv.amount),
    jsonb_build_object('account', '1000', 'credit', net));
  if coalesce(inv.wht_amount, 0) > 0 then
    lines := lines || jsonb_build_object('account', '2200', 'credit', inv.wht_amount);
  end if;
  je := public.post_journal('Payment ' || v_ref || ' — ' || po.vendor_name, 'payment', v_ref, lines);
  insert into public.payments(ref, entity_id, invoice_ap_id, method, amount, journal_ref)
  values (v_ref, v_entity, inv.id, p_method, net, je);
  if p_method = 'mpesa' then
    insert into public.mpesa_payments(payment_ref, shortcode, amount, state) values (v_ref, '174379', net, 'pending');
  end if;
  update public.invoices_ap set state = 'paid' where id = inv.id;
  update public.vendors set open_pos = greatest(open_pos - 1, 0) where id = inv.vendor_id;
  select budget_code into bcode from public.requisitions where id = po.requisition_id;
  if bcode is not null then
    update public.budget_lines set committed = greatest(committed - inv.amount, 0), actual = actual + inv.amount where code = bcode;
  end if;
  perform public.audit_write('payment.made','payment', v_ref,
    jsonb_build_object('invoice', p_inv_ref, 'method', p_method, 'net', net, 'wht', inv.wht_amount, 'journal', je));
  return jsonb_build_object('id', v_ref, 'invoice', p_inv_ref, 'journal', je, 'net', net);
end $$;

-- ---------- grants ----------
do $$
declare fn text;
begin
  foreach fn in array array[
    'raise_po(text,text,text,numeric,numeric)',
    'submit_grn(text,numeric,text,text,text)',
    'three_way_match(uuid)',
    'capture_ap_invoice(text,numeric,text,date,text,boolean)',
    'approve_ap_invoice(text)',
    'pay_invoice(text,text)']
  loop
    execute format('revoke execute on function public.%s from public, anon', fn);
    execute format('grant execute on function public.%s to authenticated', fn);
  end loop;
end $$;
