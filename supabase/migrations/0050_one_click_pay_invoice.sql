-- One-click pay for supplier invoices: HR/Finance can mark an invoice paid in a
-- single click, without the separate "Approve for Payment" step. Posts the same
-- payment journal, records the payment, moves the budget line committed→actual
-- and decrements the vendor's open POs — exactly like pay_invoice, but it can be
-- called from any non-paid state (captured/matched/approved/exception).
--
-- NOTE: this deliberately relaxes the approve-then-pay segregation of duties, per
-- an explicit product decision. pay_invoice (the two-step control) is left intact
-- and still used elsewhere. Idempotent.

create or replace function public.mark_invoice_paid(p_inv_ref text, p_method text default 'bank')
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  inv record; po record; v_ref text; je text; bcode text; net numeric; lines jsonb;
  v_entity uuid := (select id from public.entities where code = 'KE');
begin
  perform public.assert_access('finance', 2);
  select * into inv from public.invoices_ap where ref = p_inv_ref;
  if not found then raise exception 'Invoice % not found', p_inv_ref; end if;
  if inv.state = 'paid' then raise exception 'Invoice % is already paid', p_inv_ref; end if;
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
  update public.invoices_ap set state = 'paid' where id = inv.id;
  update public.vendors set open_pos = greatest(open_pos - 1, 0) where id = inv.vendor_id;
  select budget_code into bcode from public.requisitions where id = po.requisition_id;
  if bcode is not null then
    update public.budget_lines set committed = greatest(committed - inv.amount, 0), actual = actual + inv.amount where code = bcode;
  end if;
  perform public.audit_write('payment.made', 'payment', v_ref,
    jsonb_build_object('invoice', p_inv_ref, 'method', p_method, 'net', net, 'wht', inv.wht_amount, 'journal', je, 'oneClick', true));
  return jsonb_build_object('id', v_ref, 'invoice', p_inv_ref, 'journal', je, 'net', net);
end $$;

revoke execute on function public.mark_invoice_paid(text, text) from public, anon;
grant execute on function public.mark_invoice_paid(text, text) to authenticated;
