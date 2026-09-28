-- ============================================================
-- 0085 — Receivables invoicing (client invoicing spec, Sept 2026)
-- Standard Ignis invoice (template IGN-2026-SF-001):
--   · optional VAT with a selectable rate, computed server-side
--   · KES / USD currency; USD carries a KES-per-USD rate so the GL posts KES
--   · payment details (bank account picked by currency) snapshotted at issue
--   · IGN-YYYY-NNN numbering — one global sequence per year, assigned at issue
--     so drafts never burn numbers (no gaps)
--   · free-typed client + editable billing address / contact
--   · invoice date set at issue; editable terms → due date computed
--   · multiple line items (deliverable, description, qty, unit price)
--   · PO number, engagement reference, notes
--   · Draft → Issued → Partially Paid → Paid (+ Overdue derived from due date, Cancelled)
--   · part-payments recorded as ar_receipts; balance kept on the invoice
-- Idempotent.
-- ============================================================

-- Ignis books in Nairobi time: "today" is the Kenyan calendar date, not UTC
-- (an invoice issued at 01:00 EAT must be dated that day, not the day before).
create or replace function public.ke_today() returns date
language sql stable as $$ select (now() at time zone 'Africa/Nairobi')::date $$;

-- ---------- sales_invoices: new columns ----------
alter table public.sales_invoices
  add column if not exists currency text not null default 'KES',
  add column if not exists fx_rate numeric not null default 1,
  add column if not exists invoice_date date not null default public.ke_today(),
  add column if not exists payment_terms_days int not null default 14,
  add column if not exists due_date date,
  add column if not exists vat_applicable boolean not null default false,
  add column if not exists vat_rate numeric not null default 0,
  add column if not exists amount_paid numeric not null default 0,
  add column if not exists total_kes numeric,
  add column if not exists bill_to_address text,
  add column if not exists bill_to_contact text,
  add column if not exists bill_to_email text,
  add column if not exists crm_partner_id uuid references public.partners(id) on delete set null,
  add column if not exists po_number text,
  add column if not exists engagement_ref text,
  add column if not exists notes text,
  add column if not exists include_payment_details boolean not null default true,
  add column if not exists payment_details jsonb,
  add column if not exists from_details jsonb,
  add column if not exists issued_at timestamptz,
  add column if not exists issue_journal text;

alter table public.sales_invoices alter column invoice_date set default public.ke_today();

do $$
begin
  -- drafts may be saved before any line is priced
  alter table public.sales_invoices drop constraint if exists sales_invoices_net_check;
  alter table public.sales_invoices add constraint sales_invoices_net_check check (net >= 0);
  alter table public.sales_invoices drop constraint if exists sales_invoices_state_check;
  alter table public.sales_invoices add constraint sales_invoices_state_check
    check (state in ('draft','issued','partially_paid','paid','overdue','cancelled'));
  alter table public.sales_invoices drop constraint if exists sales_invoices_currency_check;
  alter table public.sales_invoices add constraint sales_invoices_currency_check check (currency in ('KES','USD'));
  alter table public.sales_invoices drop constraint if exists sales_invoices_fx_check;
  alter table public.sales_invoices add constraint sales_invoices_fx_check check (fx_rate > 0);
  alter table public.sales_invoices drop constraint if exists sales_invoices_terms_check;
  alter table public.sales_invoices add constraint sales_invoices_terms_check check (payment_terms_days between 0 and 365);
end $$;

update public.sales_invoices
   set due_date = coalesce(due_date, invoice_date + payment_terms_days),
       total_kes = coalesce(total_kes, total),
       vat_applicable = (vat > 0) or vat_applicable,
       vat_rate = case when vat > 0 and vat_rate = 0 then 16 else vat_rate end,
       amount_paid = case when state = 'paid' and amount_paid = 0 then total else amount_paid end,
       issued_at = coalesce(issued_at, created_at)
 where state <> 'draft';

insert into public.record_transitions(record_type, from_state, to_state) values
  ('sales_invoice','draft','issued'),
  ('sales_invoice','issued','partially_paid'),
  ('sales_invoice','partially_paid','paid'),
  ('sales_invoice','partially_paid','overdue'),
  ('sales_invoice','overdue','partially_paid'),
  ('sales_invoice','overdue','cancelled')
on conflict do nothing;

-- ---------- line items ----------
create table if not exists public.sales_invoice_lines (
  id          uuid primary key default gen_random_uuid(),
  invoice_id  uuid not null references public.sales_invoices(id) on delete cascade,
  position    int not null default 0,
  title       text,
  description text,
  qty         numeric not null default 1 check (qty > 0),
  unit_price  numeric not null default 0 check (unit_price >= 0),
  amount      numeric not null default 0,
  created_at  timestamptz not null default now()
);
create index if not exists sales_invoice_lines_inv_idx on public.sales_invoice_lines(invoice_id);

-- one line for any legacy invoice that has none
insert into public.sales_invoice_lines(invoice_id, position, title, description, qty, unit_price, amount)
select s.id, 0, coalesce(nullif(s.description,''), 'Services'), null, 1, s.net, s.net
  from public.sales_invoices s
 where not exists (select 1 from public.sales_invoice_lines l where l.invoice_id = s.id);

-- ---------- payments received ----------
create table if not exists public.ar_receipts (
  id           uuid primary key default gen_random_uuid(),
  invoice_id   uuid not null references public.sales_invoices(id) on delete cascade,
  amount       numeric not null check (amount > 0),
  amount_kes   numeric not null,
  receipt_date date not null default public.ke_today(),
  method       text not null default 'bank' check (method in ('bank','mpesa','cheque','other')),
  reference    text,
  journal_ref  text,
  created_by   uuid references public.app_users(id),
  created_at   timestamptz not null default now()
);
create index if not exists ar_receipts_inv_idx on public.ar_receipts(invoice_id);
alter table public.ar_receipts alter column receipt_date set default public.ke_today();

do $$
declare t text;
begin
  foreach t in array array['sales_invoice_lines','ar_receipts'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('drop policy if exists "read for authenticated" on public.%I', t);
    execute format('create policy "read for authenticated" on public.%I for select to authenticated using (true)', t);
  end loop;
end $$;

-- ---------- settings: invoicing keys ----------
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
    'invoice_payment_note','invoice_vat_rates','usd_kes_rate'
  ) then
    raise exception 'Unknown setting: %', p_key;
  end if;
  insert into public.app_config(key, value, updated_at) values (p_key, p_value, now())
  on conflict (key) do update set value = excluded.value, updated_at = now();
  perform public.audit_write('config.updated','app_config', p_key, jsonb_build_object('value', p_value));
  return jsonb_build_object('key', p_key, 'value', p_value);
end $$;

insert into public.app_config(key, value) values
  ('invoice_bank_usd', '{"account_name":"Ignis Innovation Ltd","bank":"KCB Bank Kenya","account_no":"1342100026","branch":"Sarit Centre","swift":""}'),
  ('invoice_bank_kes', '{"account_name":"Ignis Innovation Ltd","bank":"","account_no":"","branch":"","swift":""}'),
  ('invoice_from', '{"company":"Ignis Innovation Ltd","signatory":"Dennis Waweru Nderitu, Managing Director","address":"Nairobi, Kenya","email":"dnderitu@ignis-innovation.com","phone":"+254 724 326 256"}'),
  ('invoice_default_notes', '"Payment is due within the payment terms from the invoice date; late payment may attract interest at 1.5% per month."'),
  ('invoice_payment_note', '"Mobile money by arrangement. Please quote invoice number {no} on payment."'),
  ('invoice_vat_rates', '[16, 8, 0]'),
  ('usd_kes_rate', '129')
on conflict (key) do nothing;

-- ---------- numbering: IGN-YYYY-NNN, one sequence per year ----------
drop function if exists public.next_invoice_no(date);
create or replace function public.next_invoice_no(p_date date default public.ke_today()) returns text
language plpgsql security definer set search_path = public as $$
declare v_kind text := 'IGN-' || to_char(p_date, 'YYYY'); v_n int;
begin
  insert into public.ref_counters(kind, prefix, n) values (v_kind, v_kind || '-', 0)
  on conflict (kind) do nothing;
  update public.ref_counters set n = n + 1 where kind = v_kind returning n into v_n;
  return v_kind || '-' || lpad(v_n::text, 3, '0');
end $$;

-- ---------- recompute totals from lines ----------
create or replace function public.si_recompute(p_id uuid) returns void
language plpgsql security definer set search_path = public as $$
declare v_net numeric; s record;
begin
  select * into s from public.sales_invoices where id = p_id;
  select coalesce(sum(amount), 0) into v_net from public.sales_invoice_lines where invoice_id = p_id;
  update public.sales_invoices
     set net = v_net,
         vat = case when s.vat_applicable then round(v_net * s.vat_rate / 100, 2) else 0 end,
         total = v_net + case when s.vat_applicable then round(v_net * s.vat_rate / 100, 2) else 0 end,
         due_date = s.invoice_date + s.payment_terms_days,
         updated_at = now()
   where id = p_id;
end $$;

-- ---------- read shape ----------
create or replace function public.si_json(p_id uuid) returns jsonb
language sql stable security definer set search_path = public as $$
  select jsonb_build_object(
    'uuid', s.id, 'id', s.ref, 'state', s.state, 'customer', s.customer, 'currency', s.currency,
    'fxRate', s.fx_rate, 'invoiceDate', s.invoice_date, 'dueDate', s.due_date, 'terms', s.payment_terms_days,
    'vatApplicable', s.vat_applicable, 'vatRate', s.vat_rate,
    'subtotal', s.net, 'vat', s.vat, 'total', s.total, 'totalKes', s.total_kes,
    'paid', s.amount_paid, 'balance', s.total - s.amount_paid,
    'lines', coalesce((select jsonb_agg(jsonb_build_object('title', l.title, 'description', l.description,
        'qty', l.qty, 'unitPrice', l.unit_price, 'amount', l.amount) order by l.position)
      from public.sales_invoice_lines l where l.invoice_id = s.id), '[]'::jsonb))
  from public.sales_invoices s where s.id = p_id
$$;

-- ---------- save (create or update) a DRAFT ----------
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
  v_terms := coalesce(nullif(p_data->>'terms','')::int, 14);
  if v_terms < 0 or v_terms > 365 then raise exception 'Payment terms must be between 0 and 365 days'; end if;
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

  perform public.si_recompute(v_id);
  perform public.audit_write('sales_invoice.draft_saved', 'sales_invoice', (select ref from public.sales_invoices where id = v_id),
    jsonb_build_object('customer', v_cust, 'currency', v_cur, 'lines', i));
  return public.si_json(v_id);
end $$;

-- ---------- issue a draft: number, date, journal (KES), eTIMS queue ----------
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
    due_pill_txt = case when s.payment_terms_days = 0 then 'On receipt' else s.payment_terms_days || ' days' end,
    payment_details = v_bank,
    from_details = (select value from public.app_config where key = 'invoice_from')
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

create or replace function public.delete_draft_invoice(p_id uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
declare s record;
begin
  perform public.assert_access('finance', 2);
  select * into s from public.sales_invoices where id = p_id;
  if not found then raise exception 'Invoice not found'; end if;
  if s.state <> 'draft' then raise exception 'Only a draft can be deleted — cancel an issued invoice instead'; end if;
  delete from public.sales_invoices where id = p_id;
  perform public.audit_write('sales_invoice.draft_deleted','sales_invoice', s.ref, jsonb_build_object('customer', s.customer));
  return jsonb_build_object('deleted', s.ref);
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
    jsonb_build_object('account', '4000', 'debit', v_net_kes),
    jsonb_build_object('account', '1100', 'credit', v_net_kes + v_vat_kes));
  if v_vat_kes > 0 then
    v_lines := v_lines || jsonb_build_array(jsonb_build_object('account', '2100', 'debit', v_vat_kes));
  end if;
  v_je := public.post_journal('Cancel sales invoice ' || s.ref || coalesce(' — ' || nullif(trim(p_reason),''), ''),
          'sales_invoice', s.ref, v_lines);
  update public.sales_invoices set state = 'cancelled', due_pill_cls = 'done', due_pill_txt = 'Cancelled' where id = p_id;
  perform public.audit_write('sales_invoice.cancelled','sales_invoice', s.ref, jsonb_build_object('reason', p_reason, 'journal', v_je));
  return public.si_json(p_id);
end $$;

-- ---------- record a payment (part or full) ----------
drop function if exists public.record_ar_receipt(text, numeric, text);
drop function if exists public.record_ar_receipt(text, numeric, text, date, text);
create or replace function public.record_ar_receipt(p_inv_ref text, p_amount numeric, p_method text default 'bank',
                                                    p_date date default public.ke_today(), p_reference text default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare s record; v_bal numeric; v_kes numeric; v_prev_kes numeric; v_je text; v_paid numeric; v_state text;
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
  -- KES at the invoice's rate; the final payment clears the receivable exactly
  select coalesce(sum(amount_kes), 0) into v_prev_kes from public.ar_receipts where invoice_id = s.id;
  v_kes := case when v_paid >= s.total - 0.005 then coalesce(s.total_kes, round(s.total * s.fx_rate, 2)) - v_prev_kes
                else round(p_amount * s.fx_rate, 2) end;
  v_je := public.post_journal('Receipt for ' || p_inv_ref || ' — ' || s.customer ||
            case when s.currency <> 'KES' then ' (' || s.currency || ' ' || p_amount || ')' else '' end,
          'receipt', p_inv_ref,
    jsonb_build_array(
      jsonb_build_object('account', '1000', 'debit', v_kes),
      jsonb_build_object('account', '1100', 'credit', v_kes)));
  insert into public.ar_receipts(invoice_id, amount, amount_kes, receipt_date, method, reference, journal_ref, created_by)
  values (s.id, p_amount, v_kes, p_date, v_method, nullif(trim(coalesce(p_reference,'')),''), v_je,
          (select id from public.app_users where auth_id = auth.uid()));
  v_state := case when v_paid >= s.total - 0.005 then 'paid' else 'partially_paid' end;
  update public.sales_invoices set amount_paid = v_paid, state = v_state,
         due_pill_cls = case when v_state = 'paid' then 'done' else due_pill_cls end,
         due_pill_txt = case when v_state = 'paid' then 'Paid' else 'Part paid' end
   where id = s.id;
  perform public.audit_write('receipt.recorded', 'sales_invoice', p_inv_ref,
    jsonb_build_object('amount', p_amount, 'currency', s.currency, 'amountKes', v_kes, 'method', v_method,
                       'date', p_date, 'reference', p_reference, 'journal', v_je, 'state', v_state));
  return jsonb_build_object('invoice', p_inv_ref, 'amount', p_amount, 'journal', v_je,
                            'paid', v_paid, 'balance', s.total - v_paid, 'state', v_state);
end $$;

-- ---------- legacy single-line path (kept for accept_proforma) ----------
-- Builds a one-line KES invoice with 16% VAT, then issues it through the new flow.
create or replace function public.submit_sales_invoice(p_customer text, p_description text, p_net numeric, p_due_key text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v jsonb; v_id uuid;
begin
  if coalesce(p_net, 0) <= 0 then raise exception 'Enter a net amount'; end if;
  v := public.save_sales_invoice(null, jsonb_build_object(
    'customer', p_customer, 'currency', 'KES', 'vatApplicable', true, 'vatRate', 16,
    'terms', case p_due_key when 'today' then 0 when 'week30' then 30 else 14 end,
    'engagementRef', p_description,
    'lines', jsonb_build_array(jsonb_build_object('title', coalesce(nullif(p_description,''), 'Services'), 'qty', 1, 'unitPrice', p_net))));
  v_id := (v->>'uuid')::uuid;
  v := public.issue_sales_invoice(v_id);
  return jsonb_build_object('cust', p_customer, 'id', v->>'id', 'tot', (v->>'total')::numeric,
    'pillCls', case p_due_key when 'today' then 'today' else 'week' end,
    'pillTxt', case p_due_key when 'today' then 'On receipt' when 'week30' then '30 days' else '14 days' end);
end $$;

-- ---------- grants ----------
do $$
declare fn text;
begin
  foreach fn in array array[
    'save_sales_invoice(uuid, jsonb)', 'issue_sales_invoice(uuid)', 'delete_draft_invoice(uuid)',
    'cancel_sales_invoice(uuid, text)', 'record_ar_receipt(text, numeric, text, date, text)',
    'submit_sales_invoice(text, text, numeric, text)']
  loop
    execute format('revoke execute on function public.%s from public, anon', fn);
    execute format('grant execute on function public.%s to authenticated', fn);
  end loop;
  -- internal helpers: not callable from the client
  foreach fn in array array['next_invoice_no(date)', 'si_recompute(uuid)'] loop
    execute format('revoke execute on function public.%s from public, anon, authenticated', fn);
  end loop;
end $$;
