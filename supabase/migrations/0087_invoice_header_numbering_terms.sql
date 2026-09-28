-- ============================================================
-- 0087 — Invoice changes (client request, 2026-09-28)
--   · header: company "Ignis Innovation", email info@ignis-innovation.com
--   · numbering: IGN-INV-YYYY-NNN (new sequence per year, starts at 001);
--     invoices already issued keep their IGN-YYYY-NNN number
--   · due date optional: payment_terms_days NULL = no terms / no due date
--     (never overdue, row left off the PDF)
--   · optional Terms & Conditions: text kept in Settings → Invoicing
--     (invoice_terms_conditions), ticked per invoice, snapshotted at issue
-- Idempotent.
-- ============================================================

-- ---------- header ----------
update public.app_config
   set value = value || '{"company":"Ignis Innovation","email":"info@ignis-innovation.com"}'::jsonb, updated_at = now()
 where key = 'invoice_from';

-- ---------- columns ----------
alter table public.sales_invoices alter column payment_terms_days drop not null;
alter table public.sales_invoices
  add column if not exists include_terms boolean not null default false,
  add column if not exists terms_conditions text;

-- ---------- settings: T&C text ----------
create or replace function public.set_app_config(p_key text, p_value jsonb)
returns jsonb language plpgsql security definer set search_path = public as $$
begin
  perform public.assert_access('users', 2);
  if p_key not in (
    'match_tolerance_pct','po_amend_tolerance_pct','manual_journal_threshold',
    'reminder_hours','escalation_hours','enforce_sod','enforce_access',
    'org_legal_name','primary_entity','base_currency','fiscal_year_start',
    'notif_in_app','notif_email_digest','notif_sms_overdue','notif_stalled_eng',
    'approve_auto_below','single_approver_max','dual_approval_max','md_signoff_above',
    'require_2fa','dataroom_mode',
    'integ_mpesa','integ_etims','integ_email','integ_sms','integ_claude','integ_ura',
    'per_diem_daily_rate',
    'invoice_bank_usd','invoice_bank_kes','invoice_from','invoice_default_notes',
    'invoice_payment_note','invoice_vat_rates','usd_kes_rate','invoice_terms_conditions'
  ) then
    raise exception 'Unknown setting: %', p_key;
  end if;
  insert into public.app_config(key, value, updated_at) values (p_key, p_value, now())
  on conflict (key) do update set value = excluded.value, updated_at = now();
  perform public.audit_write('config.updated','app_config', p_key, jsonb_build_object('value', p_value));
  return jsonb_build_object('key', p_key, 'value', p_value);
end $$;

insert into public.app_config(key, value) values
  ('invoice_terms_conditions', to_jsonb(
'1. All prices are inclusive of applicable VAT.
2. Delivery within 1–2 working days of order confirmation, subject to stock availability and delivery location.
3. Products carry a 1-year manufacturer''s warranty, subject to the applicable warranty terms. This invoice serves as proof of purchase.
4. Goods remain the property of Ignis Innovation Limited until paid for in full.
5. Customers should report any damage, defects or incorrect items upon delivery. Returns and warranty claims are subject to applicable terms and conditions.
6. Any invoice discrepancies should be reported within 7 days of receipt.'::text))
on conflict (key) do nothing;

-- ---------- numbering: IGN-INV-YYYY-NNN ----------
create or replace function public.next_invoice_no(p_date date default public.ke_today()) returns text
language plpgsql security definer set search_path = public as $$
declare v_kind text := 'IGN-INV-' || to_char(p_date, 'YYYY'); v_n int;
begin
  insert into public.ref_counters(kind, prefix, n) values (v_kind, v_kind || '-', 0)
  on conflict (kind) do nothing;
  update public.ref_counters set n = n + 1 where kind = v_kind returning n into v_n;
  return v_kind || '-' || lpad(v_n::text, 3, '0');
end $$;

-- ---------- save a DRAFT (terms optional, T&C flag) ----------
create or replace function public.save_sales_invoice(p_id uuid, p_data jsonb)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_id uuid := p_id; s record; ln jsonb; i int := 0;
  v_cur text := upper(coalesce(nullif(trim(p_data->>'currency'),''), 'KES'));
  v_fx numeric; v_terms int; v_vat_on boolean; v_rate numeric; v_qty numeric; v_price numeric;
  v_cust text := nullif(trim(coalesce(p_data->>'customer','')), '');
  v_owner uuid := (select id from public.app_users where auth_id = auth.uid());
  v_entity uuid := (select id from public.entities where code = 'KE');
begin
  perform public.assert_access('finance', 2);
  if v_cust is null then raise exception 'Enter the client''s name'; end if;
  if v_cur not in ('KES','USD') then raise exception 'Currency must be KES or USD'; end if;
  v_fx := case when v_cur = 'KES' then 1 else coalesce(nullif(p_data->>'fxRate','')::numeric, 0) end;
  if v_fx <= 0 then raise exception 'Enter the exchange rate (KES per 1 USD)'; end if;
  -- no due date → terms stored as NULL
  v_terms := case when coalesce((p_data->>'noDueDate')::boolean, false) then null
                  else coalesce(nullif(p_data->>'terms','')::int, 14) end;
  if v_terms is not null and (v_terms < 0 or v_terms > 365) then raise exception 'Payment terms must be between 0 and 365 days'; end if;
  v_vat_on := coalesce((p_data->>'vatApplicable')::boolean, false);
  v_rate := case when v_vat_on then coalesce(nullif(p_data->>'vatRate','')::numeric, 16) else 0 end;
  if v_rate < 0 or v_rate > 100 then raise exception 'VAT rate must be between 0 and 100%%'; end if;

  if v_id is null then
    insert into public.sales_invoices(ref, entity_id, owner_id, customer, net, vat, total, state, etims_state, invoice_date)
    values ('DRAFT-' || substr(replace(gen_random_uuid()::text,'-',''), 1, 8), v_entity, v_owner, v_cust, 0, 0, 0, 'draft', 'pending', public.ke_today())
    returning id into v_id;
  else
    select * into s from public.sales_invoices where id = v_id for update;
    if not found then raise exception 'Invoice not found'; end if;
    if s.state <> 'draft' then raise exception 'Only a draft invoice can be edited (% is %)', s.ref, s.state; end if;
  end if;

  update public.sales_invoices set
    customer = v_cust,
    bill_to_address = nullif(trim(coalesce(p_data->>'billToAddress','')), ''),
    bill_to_contact = nullif(trim(coalesce(p_data->>'billToContact','')), ''),
    bill_to_email   = nullif(trim(coalesce(p_data->>'billToEmail','')), ''),
    crm_partner_id  = nullif(p_data->>'crmPartnerId','')::uuid,
    currency = v_cur, fx_rate = v_fx, payment_terms_days = v_terms,
    vat_applicable = v_vat_on, vat_rate = v_rate,
    po_number      = nullif(trim(coalesce(p_data->>'poNumber','')), ''),
    engagement_ref = nullif(trim(coalesce(p_data->>'engagementRef','')), ''),
    notes          = nullif(trim(coalesce(p_data->>'notes','')), ''),
    description    = nullif(trim(coalesce(p_data->>'engagementRef','')), ''),
    include_payment_details = coalesce((p_data->>'includePaymentDetails')::boolean, true),
    include_terms  = coalesce((p_data->>'includeTerms')::boolean, false),
    invoice_date = public.ke_today()
  where id = v_id;

  delete from public.sales_invoice_lines where invoice_id = v_id;
  for ln in select value from jsonb_array_elements(coalesce(p_data->'lines', '[]'::jsonb)) loop
    if coalesce(trim(ln->>'title'),'') = '' and coalesce(trim(ln->>'description'),'') = ''
       and coalesce(nullif(ln->>'unitPrice','')::numeric, 0) = 0 then
      continue;   -- blank row
    end if;
    v_qty := coalesce(nullif(ln->>'qty','')::numeric, 1);
    v_price := coalesce(nullif(ln->>'unitPrice','')::numeric, 0);
    if v_qty <= 0 then raise exception 'Quantity must be greater than zero'; end if;
    if v_price < 0 then raise exception 'Unit price cannot be negative'; end if;
    insert into public.sales_invoice_lines(invoice_id, position, title, description, qty, unit_price, amount)
    values (v_id, i, nullif(trim(coalesce(ln->>'title','')),''), nullif(trim(coalesce(ln->>'description','')),''),
            v_qty, v_price, round(v_qty * v_price, 2));
    i := i + 1;
  end loop;

  perform public.si_recompute(v_id);   -- due_date = invoice_date + terms (NULL when no terms)
  perform public.audit_write('sales_invoice.draft_saved', 'sales_invoice', (select ref from public.sales_invoices where id = v_id),
    jsonb_build_object('customer', v_cust, 'currency', v_cur, 'lines', i));
  return public.si_json(v_id);
end $$;

-- ---------- issue: new number format, optional terms, T&C snapshot ----------
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
    jsonb_build_object('account', '1100', 'debit', v_tot_kes),
    jsonb_build_object('account', '4000', 'credit', v_net_kes));
  if v_vat_kes > 0 then
    v_lines := v_lines || jsonb_build_array(jsonb_build_object('account', '2100', 'credit', v_vat_kes));
  end if;
  v_je := public.post_journal('Sales invoice ' || v_no || ' — ' || s.customer ||
            case when s.currency <> 'KES' then ' (' || s.currency || ' ' || s.total || ' @ ' || s.fx_rate || ')' else '' end,
          'sales_invoice', v_no, v_lines);
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

-- ---------- grants (create or replace keeps them; restated for safety) ----------
do $$
declare fn text;
begin
  foreach fn in array array['save_sales_invoice(uuid, jsonb)', 'issue_sales_invoice(uuid)', 'set_app_config(text, jsonb)'] loop
    execute format('revoke execute on function public.%s from public, anon', fn);
    execute format('grant execute on function public.%s to authenticated', fn);
  end loop;
  execute 'revoke execute on function public.next_invoice_no(date) from public, anon, authenticated';
end $$;
