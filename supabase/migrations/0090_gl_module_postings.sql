-- ============================================================
-- 0090 — Every module posts to the General Ledger through the one engine
-- (spec §7 "What posts to the ledger", A2/A4). Account codes now come from
-- gl_mappings via gl_acct(); each posting carries a source key (no duplicates),
-- its date, and its coding (project / cost centre / fund).
--   · re-pointed: sales invoice issue/cancel, customer receipts (+ M-Pesa, + FX
--     gain/loss on USD receipts — D3/D4), supplier invoice, supplier payment
--     (bank or M-Pesa), payroll, depreciation
--   · NEW postings (triggers on the module's own status change, so every path posts):
--       petty cash approved        Dr expense (project-coded)   Cr petty cash float
--       expense claim paid         Dr expense per category      Cr bank
--       travel advance issued      Dr employee advances         Cr bank
--       travel advance reconciled  Dr expense per category      Cr employee advances
--       travel advance settled     refund: Dr bank / Cr advances · top-up: Dr advances / Cr bank
--       recurring bill paid        Dr utilities & bills         Cr bank
-- Idempotent.
-- ============================================================

create or replace function public.issue_sales_invoice(p_id uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
declare s record; v_no text; v_tot_kes numeric; v_net_kes numeric; v_vat_kes numeric; v_je text; v_ctrl text;
        v_lines jsonb; v_bank jsonb;
begin
  perform public.assert_access('finance', 2);
  select * into s from public.sales_invoices where id = p_id for update;
  if not found then raise exception 'Invoice not found'; end if;
  if s.state <> 'draft' then raise exception '% has already been issued', s.ref; end if;
  -- invoice date is generated at issue; due date follows from the terms
  update public.sales_invoices set invoice_date = public.ke_today() where id = p_id;
  perform public.si_recompute(p_id);
  select * into s from public.sales_invoices where id = p_id;
  if not exists (select 1 from public.sales_invoice_lines where invoice_id = p_id) or s.net <= 0 then
    raise exception 'Add at least one priced line item before issuing';
  end if;

  v_no := public.next_invoice_no(s.invoice_date);
  v_tot_kes := round(s.total * s.fx_rate, 2);
  v_net_kes := round(s.net * s.fx_rate, 2);
  v_vat_kes := v_tot_kes - v_net_kes;
  v_bank := case when s.include_payment_details then
    (select value from public.app_config where key = case when s.currency = 'USD' then 'invoice_bank_usd' else 'invoice_bank_kes' end)
    else null end;

  update public.sales_invoices set
    ref = v_no, state = 'issued', issued_at = now(), total_kes = v_tot_kes,
    etims_state = 'filed',
    due_pill_cls = case when s.payment_terms_days = 0 then 'today' else 'week' end,
    due_pill_txt = case when s.payment_terms_days is null then 'No due date'
                        when s.payment_terms_days = 0 then 'On receipt'
                        else s.payment_terms_days || ' days' end,
    payment_details = v_bank,
    from_details = (select value from public.app_config where key = 'invoice_from'),
    terms_conditions = case when s.include_terms then
      nullif(trim((select value #>> '{}' from public.app_config where key = 'invoice_terms_conditions')), '') end
  where id = p_id;

  v_lines := jsonb_build_array(
    jsonb_build_object('account', public.gl_acct('sales_invoice','receivable'), 'debit', v_tot_kes),
    jsonb_build_object('account', public.gl_acct('sales_invoice','revenue'), 'credit', v_net_kes));
  if v_vat_kes > 0 then
    v_lines := v_lines || jsonb_build_array(jsonb_build_object('account', public.gl_acct('sales_invoice','vat'), 'credit', v_vat_kes));
  end if;
  v_je := public.post_journal('Sales invoice ' || v_no || ' — ' || s.customer ||
            case when s.currency <> 'KES' then ' (' || s.currency || ' ' || s.total || ' @ ' || s.fx_rate || ')' else '' end,
          'sales_invoice', v_no, v_lines,
      p_key => 'sales_invoice:' || v_no || ':issue', p_coding => jsonb_build_object('project', (select p.name from public.projects p where p.name = s.engagement_ref)));
  update public.sales_invoices set issue_journal = v_je where id = p_id;

  -- eTIMS: filing record on every issue (queue stub — see PRD)
  v_ctrl := public.next_ref('ETIMS');
  insert into public.etims_submissions(invoice_ref, control_no, state, submitted_at, payload)
  values (v_no, v_ctrl, 'filed', now(),
          jsonb_build_object('customer', s.customer, 'currency', s.currency, 'net', s.net, 'vat', s.vat,
                             'total', s.total, 'totalKes', v_tot_kes));
  perform public.audit_write('sales_invoice.issued','sales_invoice', v_no,
    jsonb_build_object('customer', s.customer, 'currency', s.currency, 'total', s.total, 'totalKes', v_tot_kes,
                       'journal', v_je, 'etims', v_ctrl));
  return public.si_json(p_id);
end $$;

create or replace function public.cancel_sales_invoice(p_id uuid, p_reason text default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare s record; v_je text; v_net_kes numeric; v_vat_kes numeric; v_lines jsonb;
begin
  perform public.assert_access('finance', 2);
  select * into s from public.sales_invoices where id = p_id for update;
  if not found then raise exception 'Invoice not found'; end if;
  if s.state not in ('issued','overdue') then raise exception 'Only an issued, unpaid invoice can be cancelled (% is %)', s.ref, s.state; end if;
  if s.amount_paid > 0 then raise exception '% has payments recorded — it cannot be cancelled', s.ref; end if;
  v_net_kes := round(s.net * s.fx_rate, 2);
  v_vat_kes := coalesce(s.total_kes, round(s.total * s.fx_rate, 2)) - v_net_kes;
  v_lines := jsonb_build_array(
    jsonb_build_object('account', public.gl_acct('sales_invoice','revenue'), 'debit', v_net_kes),
    jsonb_build_object('account', public.gl_acct('sales_invoice','receivable'), 'credit', v_net_kes + v_vat_kes));
  if v_vat_kes > 0 then
    v_lines := v_lines || jsonb_build_array(jsonb_build_object('account', public.gl_acct('sales_invoice','vat'), 'debit', v_vat_kes));
  end if;
  v_je := public.post_journal('Cancel sales invoice ' || s.ref || coalesce(' — ' || nullif(trim(p_reason),''), ''),
          'sales_invoice', s.ref, v_lines,
      p_key => 'sales_invoice:' || s.ref || ':cancel', p_coding => jsonb_build_object('project', (select p.name from public.projects p where p.name = s.engagement_ref)));
  update public.sales_invoices set state = 'cancelled', due_pill_cls = 'done', due_pill_txt = 'Cancelled' where id = p_id;
  perform public.audit_write('sales_invoice.cancelled','sales_invoice', s.ref, jsonb_build_object('reason', p_reason, 'journal', v_je));
  return public.si_json(p_id);
end $$;

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
      jsonb_build_object('account', coalesce(line.account_code, public.gl_acct('ap_invoice','expense')), 'debit', p_amount),
      jsonb_build_object('account', public.gl_acct('ap_invoice','payable'), 'credit', p_amount)),
      p_key => 'invoice_ap:' || v_ref, p_coding => jsonb_build_object('costCentre', line.code, 'project', (select nullif(trim(r.project_code),'') from public.requisitions r where r.id = po.requisition_id)));
  perform public.audit_write('invoice.captured','invoice_ap', v_ref,
    jsonb_build_object('po', p_po_ref, 'amount', p_amount, 'number', v_num, 'wht', v_wht));
  m := public.three_way_match(v_id);
  return jsonb_build_object('id', v_ref, 'po', p_po_ref, 'match', m->>'state', 'wht', v_wht);
end $$;

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
    jsonb_build_object('account', public.gl_acct('ap_payment','payable'), 'debit', inv.amount),
    jsonb_build_object('account', case when p_method = 'mpesa' then public.gl_acct('ap_payment','mpesa') else public.gl_acct('ap_payment','bank') end, 'credit', net));
  if coalesce(inv.wht_amount, 0) > 0 then
    lines := lines || jsonb_build_object('account', public.gl_acct('ap_payment','wht'), 'credit', inv.wht_amount);
  end if;
  je := public.post_journal('Payment ' || v_ref || ' — ' || po.vendor_name, 'payment', v_ref, lines,
      p_key => 'payment:' || p_inv_ref);
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
    jsonb_build_object('account', public.gl_acct('ap_payment','payable'), 'debit', inv.amount),
    jsonb_build_object('account', case when p_method = 'mpesa' then public.gl_acct('ap_payment','mpesa') else public.gl_acct('ap_payment','bank') end, 'credit', net));
  if coalesce(inv.wht_amount, 0) > 0 then
    lines := lines || jsonb_build_object('account', public.gl_acct('ap_payment','wht'), 'credit', inv.wht_amount);
  end if;
  je := public.post_journal('Payment ' || v_ref || ' — ' || po.vendor_name, 'payment', v_ref, lines,
      p_key => 'payment:' || p_inv_ref);
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

create or replace function public.post_payroll(p_ref text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  r record; je text; pf jsonb;
  t_gross numeric; t_paye numeric; t_nssf numeric; t_shif numeric; t_housing numeric; t_net numeric;
  er_nssf numeric; er_housing numeric;
  cfg_nssf jsonb; cfg_hl jsonb;
begin
  perform public.assert_access('finance', 3);
  select * into r from public.payroll_runs where ref = p_ref;
  if not found then raise exception 'Payroll run % not found', p_ref; end if;
  if r.state <> 'approved' then raise exception 'Document chain: % must be approved before posting (state: %)', p_ref, r.state; end if;

  select sum(gross), sum(paye), sum(nssf), sum(shif), sum(housing), sum(net)
    into t_gross, t_paye, t_nssf, t_shif, t_housing, t_net
  from public.payroll_items where run_id = r.id;

  select value into cfg_nssf from public.statutory_rates where kind='nssf' and effective_from <= current_date order by effective_from desc limit 1;
  select value into cfg_hl from public.statutory_rates where kind='housing_levy' and effective_from <= current_date order by effective_from desc limit 1;
  er_nssf := case when (cfg_nssf->>'employer_match')::boolean then t_nssf else 0 end;
  er_housing := round(t_gross * (cfg_hl->>'employer')::numeric, 2);

  je := public.post_journal('Payroll ' || r.period, 'payroll', p_ref, jsonb_build_array(
    jsonb_build_object('account', public.gl_acct('payroll','expense'),'debit',  t_gross + er_nssf + er_housing),
    jsonb_build_object('account', public.gl_acct('payroll','paye'),'credit', t_paye),
    jsonb_build_object('account', public.gl_acct('payroll','nssf'),'credit', t_nssf + er_nssf),
    jsonb_build_object('account', public.gl_acct('payroll','shif'),'credit', t_shif),
    jsonb_build_object('account', public.gl_acct('payroll','housing'),'credit', t_housing + er_housing),
    jsonb_build_object('account', public.gl_acct('payroll','net'),'credit', t_net)),
      p_key => 'payroll:' || p_ref);

  select jsonb_agg(jsonb_build_object('staff', u.name, 'bank', sf.bank, 'net', i.net) order by u.name)
    into pf
  from public.payroll_items i
  join public.app_users u on u.id = i.app_user_id
  join public.staff_files sf on sf.app_user_id = i.app_user_id
  where i.run_id = r.id;

  update public.payroll_runs set state = 'posted', journal_ref = je, payment_file = pf where id = r.id;
  perform public.audit_write('payroll.posted','payroll', p_ref,
    jsonb_build_object('journal', je, 'gross', t_gross, 'net', t_net));
  return jsonb_build_object('id', p_ref, 'journal', je, 'paymentFile', pf);
end $$;

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
        jsonb_build_object('account', public.gl_acct('depreciation','expense'), 'debit', amt),
        jsonb_build_object('account', public.gl_acct('depreciation','accumulated'), 'credit', amt)),
      p_date => public.gl_period_end(p_period), p_key => 'depreciation:' || a.ref || ':' || p_period);
    insert into public.asset_depreciations(asset_id, period, amount, journal_ref) values (a.id, p_period, amt, je);
    update public.assets set accum_dep = accum_dep + amt where id = a.id;
    total := total + amt; n := n + 1;
  end loop;
  perform public.audit_write('depreciation.run','asset', p_period,
    jsonb_build_object('assets', n, 'total', total));
  return jsonb_build_object('period', p_period, 'assets', n, 'total', total);
end $$;

-- ---------- customer receipt: bank or M-Pesa; USD receipts post the FX difference ----------
drop function if exists public.record_ar_receipt(text, numeric, text, date, text);
create or replace function public.record_ar_receipt(p_inv_ref text, p_amount numeric, p_method text default 'bank',
                                                    p_date date default public.ke_today(), p_reference text default null,
                                                    p_fx_rate numeric default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare s record; v_bal numeric; v_ar_kes numeric; v_cash_kes numeric; v_fx numeric; v_prev_kes numeric; v_je text;
        v_paid numeric; v_state text; v_lines jsonb; v_rate numeric;
        v_method text := coalesce(nullif(p_method,''), 'bank');
begin
  perform public.assert_access('finance', 2);
  if coalesce(p_amount, 0) <= 0 then raise exception 'Enter the amount received'; end if;
  if p_date is null or p_date > public.ke_today() then raise exception 'The payment date cannot be in the future'; end if;
  if v_method not in ('bank','mpesa','cheque','other') then raise exception 'Unknown payment method'; end if;
  select * into s from public.sales_invoices where ref = p_inv_ref for update;
  if not found then raise exception 'Sales invoice % not found', p_inv_ref; end if;
  if s.state = 'paid' then raise exception '% is already fully paid', p_inv_ref; end if;
  if s.state not in ('issued','partially_paid','overdue') then raise exception '% is % — payments can only be recorded on an issued invoice', p_inv_ref, s.state; end if;
  v_bal := s.total - s.amount_paid;
  if p_amount > v_bal + 0.005 then
    raise exception 'That is more than the outstanding balance (% %)', s.currency, to_char(v_bal, 'FM999,999,999,990.00');
  end if;
  v_paid := s.amount_paid + p_amount;
  -- the receivable clears at the invoice's rate; the final payment clears it exactly
  select coalesce(sum(amount_kes), 0) into v_prev_kes from public.ar_receipts where invoice_id = s.id;
  v_ar_kes := case when v_paid >= s.total - 0.005 then coalesce(s.total_kes, round(s.total * s.fx_rate, 2)) - v_prev_kes
                   else round(p_amount * s.fx_rate, 2) end;
  -- cash lands at the rate actually received (USD); the difference is FX gain / (loss)
  v_rate := case when s.currency = 'KES' then 1 else coalesce(nullif(p_fx_rate, 0), s.fx_rate) end;
  if v_rate <= 0 then raise exception 'Enter the exchange rate the money was received at'; end if;
  v_cash_kes := case when s.currency = 'KES' then v_ar_kes else round(p_amount * v_rate, 2) end;
  v_fx := v_cash_kes - v_ar_kes;
  v_lines := jsonb_build_array(
    jsonb_build_object('account', case when v_method = 'mpesa' then public.gl_acct('ar_receipt','mpesa') else public.gl_acct('ar_receipt','bank') end, 'debit', v_cash_kes),
    jsonb_build_object('account', public.gl_acct('ar_receipt','receivable'), 'credit', v_ar_kes));
  if v_fx > 0 then v_lines := v_lines || jsonb_build_array(jsonb_build_object('account', public.gl_acct('ar_receipt','fx'), 'credit', v_fx));
  elsif v_fx < 0 then v_lines := v_lines || jsonb_build_array(jsonb_build_object('account', public.gl_acct('ar_receipt','fx'), 'debit', -v_fx));
  end if;
  v_je := public.post_journal('Receipt for ' || p_inv_ref || ' — ' || s.customer ||
            case when s.currency <> 'KES' then ' (' || s.currency || ' ' || p_amount || ' @ ' || v_rate || ')' else '' end,
          'receipt', p_inv_ref, v_lines, p_date, null, 'auto',
          jsonb_build_object('project', (select p.name from public.projects p where p.name = s.engagement_ref)));
  insert into public.ar_receipts(invoice_id, amount, amount_kes, receipt_date, method, reference, journal_ref, created_by)
  values (s.id, p_amount, v_ar_kes, p_date, v_method, nullif(trim(coalesce(p_reference,'')),''), v_je,
          (select id from public.app_users where auth_id = auth.uid()));
  v_state := case when v_paid >= s.total - 0.005 then 'paid' else 'partially_paid' end;
  update public.sales_invoices set amount_paid = v_paid, state = v_state,
         due_pill_cls = case when v_state = 'paid' then 'done' else due_pill_cls end,
         due_pill_txt = case when v_state = 'paid' then 'Paid' else 'Part paid' end
   where id = s.id;
  perform public.audit_write('receipt.recorded', 'sales_invoice', p_inv_ref,
    jsonb_build_object('amount', p_amount, 'currency', s.currency, 'amountKes', v_cash_kes, 'fxDifference', v_fx, 'method', v_method,
                       'date', p_date, 'reference', p_reference, 'journal', v_je, 'state', v_state));
  return jsonb_build_object('invoice', p_inv_ref, 'amount', p_amount, 'journal', v_je, 'fx', v_fx,
                            'paid', v_paid, 'balance', s.total - v_paid, 'state', v_state);
end $$;

-- ---------- petty cash: approved = cash paid out of the float, expensed to the project ----------
create or replace function public.gl_trg_petty_cash() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.state = 'approved' and (tg_op = 'INSERT' or old.state is distinct from 'approved') then
    perform public.post_journal('Petty cash ' || new.ref || ' — ' || new.item, 'petty_cash', new.ref,
      jsonb_build_array(
        jsonb_build_object('account', public.gl_acct('petty_cash','expense'), 'debit', new.amount),
        jsonb_build_object('account', public.gl_acct('petty_cash','cash'), 'credit', new.amount)),
      public.ke_today(), 'petty_cash:' || new.ref, 'auto',
      jsonb_build_object('project', nullif(trim(coalesce(new.project_code,'')),'')));
  end if;
  return new;
end $$;
drop trigger if exists gl_post_petty_cash on public.petty_cash_requests;
create trigger gl_post_petty_cash after insert or update of state on public.petty_cash_requests
  for each row execute function public.gl_trg_petty_cash();

-- ---------- expense claim: reimbursed = expense per category, paid from bank ----------
create or replace function public.gl_trg_expense_claim() returns trigger
language plpgsql security definer set search_path = public as $$
declare v_lines jsonb; v_total numeric;
begin
  if new.state = 'paid' and old.state is distinct from 'paid' then
    select jsonb_agg(jsonb_build_object('account', public.gl_acct('expense_claim', category), 'debit', amt, 'memo', category)),
           sum(amt)
      into v_lines, v_total
    from (select category, sum(amount) amt from public.expense_claim_lines where claim_id = new.id group by category having sum(amount) > 0) x;
    if coalesce(v_total, 0) > 0 then
      perform public.post_journal('Expense claim ' || new.ref || ' — ' || coalesce(new.requester_name,'') || ' · ' || new.purpose,
        'expense_claim', new.ref,
        v_lines || jsonb_build_array(jsonb_build_object('account', public.gl_acct('expense_claim','bank'), 'credit', v_total)),
        public.ke_today(), 'expense_claim:' || new.ref, 'auto',
        jsonb_build_object('project', nullif(trim(coalesce(new.project_code,'')),'')));
    end if;
  end if;
  return new;
end $$;
drop trigger if exists gl_post_expense_claim on public.expense_claims;
create trigger gl_post_expense_claim after update of state on public.expense_claims
  for each row execute function public.gl_trg_expense_claim();

-- ---------- travel advance: issue → reconcile → settle (advance-as-receivable) ----------
create or replace function public.gl_trg_travel_advance() returns trigger
language plpgsql security definer set search_path = public as $$
declare v_lines jsonb; v_total numeric; v_coding jsonb := jsonb_build_object('project', nullif(trim(coalesce(new.project_code,'')),''));
        v_who text := coalesce(new.holder_name, '');
begin
  if new.state = 'issued' and old.state is distinct from 'issued' then
    perform public.post_journal('Travel advance ' || new.ref || ' issued — ' || v_who || ' · ' || new.purpose, 'travel_advance', new.ref,
      jsonb_build_array(
        jsonb_build_object('account', public.gl_acct('travel_advance','advances'), 'debit', new.amount),
        jsonb_build_object('account', public.gl_acct('travel_advance','bank'), 'credit', new.amount)),
      public.ke_today(), 'travel_advance:' || new.ref || ':issue', 'auto', v_coding);
  elsif new.state = 'reconciled' and old.state is distinct from 'reconciled' then
    select jsonb_agg(jsonb_build_object('account', public.gl_acct('travel_advance', category), 'debit', amt, 'memo', category)),
           sum(amt)
      into v_lines, v_total
    from (select category, sum(amount) amt from public.travel_advance_lines
           where advance_id = new.id and not is_estimate group by category having sum(amount) > 0) x;
    if coalesce(v_total, 0) > 0 then
      perform public.post_journal('Travel advance ' || new.ref || ' reconciled — ' || v_who || ' · ' || new.purpose, 'travel_advance', new.ref,
        v_lines || jsonb_build_array(jsonb_build_object('account', public.gl_acct('travel_advance','advances'), 'credit', v_total)),
        public.ke_today(), 'travel_advance:' || new.ref || ':reconcile', 'auto', v_coding);
    end if;
  elsif new.state = 'settled' and old.state is distinct from 'settled' and coalesce(new.balance, 0) <> 0 then
    perform public.post_journal('Travel advance ' || new.ref || ' settled — ' ||
        case when new.balance > 0 then 'balance returned by ' else 'top-up paid to ' end || v_who, 'travel_advance', new.ref,
      case when new.balance > 0 then jsonb_build_array(
        jsonb_build_object('account', public.gl_acct('travel_advance','bank'), 'debit', new.balance),
        jsonb_build_object('account', public.gl_acct('travel_advance','advances'), 'credit', new.balance))
      else jsonb_build_array(
        jsonb_build_object('account', public.gl_acct('travel_advance','advances'), 'debit', -new.balance),
        jsonb_build_object('account', public.gl_acct('travel_advance','bank'), 'credit', -new.balance)) end,
      public.ke_today(), 'travel_advance:' || new.ref || ':settle', 'auto', v_coding);
  end if;
  return new;
end $$;
drop trigger if exists gl_post_travel_advance on public.travel_advances;
create trigger gl_post_travel_advance after update of state on public.travel_advances
  for each row execute function public.gl_trg_travel_advance();

-- ---------- recurring bill paid ----------
create or replace function public.gl_trg_recurring_bill() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.state = 'paid' and old.state = 'pending' then
    perform public.post_journal('Recurring bill ' || new.ref || ' — ' || new.item || coalesce(' (' || new.vendor || ')', ''),
      'recurring_bill', new.ref,
      jsonb_build_array(
        jsonb_build_object('account', public.gl_acct('recurring_bill','expense'), 'debit', new.amount),
        jsonb_build_object('account', public.gl_acct('recurring_bill','bank'), 'credit', new.amount)),
      public.ke_today(), 'recurring_bill:' || new.ref || ':' || to_char(coalesce(new.decided_at, now()), 'YYYYMMDDHH24MISS'), 'auto', null);
  end if;
  return new;
end $$;
drop trigger if exists gl_post_recurring_bill on public.recurring_bills;
create trigger gl_post_recurring_bill after update of state on public.recurring_bills
  for each row execute function public.gl_trg_recurring_bill();

-- ---------- grants ----------
revoke execute on function public.record_ar_receipt(text, numeric, text, date, text, numeric) from public, anon;
grant execute on function public.record_ar_receipt(text, numeric, text, date, text, numeric) to authenticated;
do $$
declare fn text;
begin
  foreach fn in array array['gl_trg_petty_cash()', 'gl_trg_expense_claim()', 'gl_trg_travel_advance()', 'gl_trg_recurring_bill()'] loop
    execute format('revoke execute on function public.%s from public, anon, authenticated', fn);
  end loop;
end $$;
