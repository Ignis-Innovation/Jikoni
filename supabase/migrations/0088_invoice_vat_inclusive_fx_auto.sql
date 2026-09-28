-- ============================================================
-- 0088 — VAT-inclusive invoice prices + automatic USD rate (2026-09-28)
--   · sales_invoices.vat_inclusive: line prices already include VAT (goods sales).
--     total = sum of lines; VAT = total × rate / (100 + rate); net = total − VAT.
--     Off (default) keeps VAT added on top. Journal/eTIMS use net + VAT as before.
--   · settings keys usd_kes_rate_auto / usd_kes_rate_updated — the daily
--     /api/fx-rate cron keeps usd_kes_rate at the market rate unless switched off.
--   · T&C clause 1 unchanged ("inclusive of applicable VAT") — true when ticked.
-- Idempotent.
-- ============================================================

alter table public.sales_invoices add column if not exists vat_inclusive boolean not null default false;

insert into public.app_config(key, value) values ('usd_kes_rate_auto', 'true')
on conflict (key) do nothing;

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
    'invoice_payment_note','invoice_vat_rates','usd_kes_rate','invoice_terms_conditions',
    'usd_kes_rate_auto','usd_kes_rate_updated'
  ) then
    raise exception 'Unknown setting: %', p_key;
  end if;
  insert into public.app_config(key, value, updated_at) values (p_key, p_value, now())
  on conflict (key) do update set value = excluded.value, updated_at = now();
  perform public.audit_write('config.updated','app_config', p_key, jsonb_build_object('value', p_value));
  return jsonb_build_object('key', p_key, 'value', p_value);
end $$;

-- ---------- recompute totals from lines (VAT on top, or backed out of inclusive prices) ----------
create or replace function public.si_recompute(p_id uuid) returns void
language plpgsql security definer set search_path = public as $$
declare v_sum numeric; v_vat numeric; s record;
begin
  select * into s from public.sales_invoices where id = p_id;
  select coalesce(sum(amount), 0) into v_sum from public.sales_invoice_lines where invoice_id = p_id;
  v_vat := case when not s.vat_applicable then 0
                when s.vat_inclusive then round(v_sum * s.vat_rate / (100 + s.vat_rate), 2)
                else round(v_sum * s.vat_rate / 100, 2) end;
  update public.sales_invoices
     set net   = case when s.vat_inclusive then v_sum - v_vat else v_sum end,
         vat   = v_vat,
         total = case when s.vat_inclusive then v_sum else v_sum + v_vat end,
         due_date = s.invoice_date + s.payment_terms_days,
         updated_at = now()
   where id = p_id;
end $$;

create or replace function public.si_json(p_id uuid) returns jsonb
language sql stable security definer set search_path = public as $$
  select jsonb_build_object(
    'uuid', s.id, 'id', s.ref, 'state', s.state, 'customer', s.customer, 'currency', s.currency,
    'fxRate', s.fx_rate, 'invoiceDate', s.invoice_date, 'dueDate', s.due_date, 'terms', s.payment_terms_days,
    'vatApplicable', s.vat_applicable, 'vatRate', s.vat_rate, 'vatInclusive', s.vat_inclusive,
    'subtotal', s.net, 'vat', s.vat, 'total', s.total, 'totalKes', s.total_kes,
    'paid', s.amount_paid, 'balance', s.total - s.amount_paid,
    'lines', coalesce((select jsonb_agg(jsonb_build_object('title', l.title, 'description', l.description,
        'qty', l.qty, 'unitPrice', l.unit_price, 'amount', l.amount) order by l.position)
      from public.sales_invoice_lines l where l.invoice_id = s.id), '[]'::jsonb))
  from public.sales_invoices s where s.id = p_id
$$;

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
    vat_inclusive  = v_vat_on and coalesce((p_data->>'vatInclusive')::boolean, false),
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

do $$
declare fn text;
begin
  foreach fn in array array['save_sales_invoice(uuid, jsonb)', 'set_app_config(text, jsonb)'] loop
    execute format('revoke execute on function public.%s from public, anon', fn);
    execute format('grant execute on function public.%s to authenticated', fn);
  end loop;
  execute 'revoke execute on function public.si_recompute(uuid) from public, anon, authenticated';
end $$;
