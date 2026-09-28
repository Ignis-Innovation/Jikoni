-- ============================================================
-- 0092 — Anyone can draft an invoice; an editor issues it (client request 2026-09-28)
-- Same pattern as petty cash / claims: any signed-in staff member creates an
-- invoice draft (Staff Portal → Invoices), then "Send for issuing". The three
-- editors (Joan, Dennis, Brian) see it in Finance → Receivables, check it, and
-- Issue it (only then does it get its IGN-INV number and post to the ledger) or
-- Return it with a note. Preparers can edit / delete only their own drafts, and
-- not while Finance has them.
-- Idempotent.
-- ============================================================

alter table public.sales_invoices
  add column if not exists submitted_at timestamptz,
  add column if not exists submitted_by uuid references public.app_users(id),
  add column if not exists return_note  text;

-- the three editor accounts (same list as assert_access / GLOBAL_EDITORS)
create or replace function public.is_editor() returns boolean
language sql stable security definer set search_path = public as $$
  select lower(coalesce(nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'email', '')) in (
    'jwanjiku@ignis-innovation.com', 'dnderitu@ignis-innovation.com', 'brian55mwangi@gmail.com')
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
  -- anyone may draft an invoice (like petty cash / claims); only an editor issues it
  if v_owner is null then raise exception 'No user is linked to this login'; end if;
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
    if not public.is_editor() then
      if s.owner_id is distinct from v_owner then raise exception 'You can only edit invoices you drafted'; end if;
      if s.submitted_at is not null then raise exception 'This draft is with Finance for issuing — ask them to return it if it needs changes'; end if;
    end if;
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

create or replace function public.delete_draft_invoice(p_id uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
declare s record;
begin
  select * into s from public.sales_invoices where id = p_id;
  if not found then raise exception 'Invoice not found'; end if;
  if not public.is_editor() and s.owner_id is distinct from (select id from public.app_users where auth_id = auth.uid()) then
    raise exception 'You can only delete invoices you drafted';
  end if;
  if s.state <> 'draft' then raise exception 'Only a draft can be deleted — cancel an issued invoice instead'; end if;
  delete from public.sales_invoices where id = p_id;
  perform public.audit_write('sales_invoice.draft_deleted','sales_invoice', s.ref, jsonb_build_object('customer', s.customer));
  return jsonb_build_object('deleted', s.ref);
end $$;

create or replace function public.is_editor_email(p_email text) returns boolean
language sql immutable as $$
  select lower(coalesce(p_email, '')) in ('jwanjiku@ignis-innovation.com', 'dnderitu@ignis-innovation.com', 'brian55mwangi@gmail.com')
$$;

-- preparer → Finance
create or replace function public.submit_invoice_for_issue(p_id uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
declare s record; v_me uuid := (select id from public.app_users where auth_id = auth.uid()); v_name text;
begin
  select * into s from public.sales_invoices where id = p_id for update;
  if not found then raise exception 'Invoice not found'; end if;
  if s.state <> 'draft' then raise exception 'This invoice is already issued'; end if;
  if s.owner_id is distinct from v_me and not public.is_editor() then raise exception 'You can only send invoices you drafted'; end if;
  if s.submitted_at is not null then raise exception 'Already sent for issuing'; end if;
  if not exists (select 1 from public.sales_invoice_lines where invoice_id = p_id) or s.net <= 0 then
    raise exception 'Add at least one priced line item first';
  end if;
  update public.sales_invoices set submitted_at = now(), submitted_by = v_me, return_note = null, updated_at = now() where id = p_id;
  select name into v_name from public.app_users where id = v_me;
  insert into public.notifications(entity_id, recipient_email, kind, title, body, link_view, link_ref)
  select s.entity_id, lower(u.email), 'invoice_to_issue', coalesce(v_name, 'A colleague') || ' sent an invoice to issue',
         s.customer || ' — ' || s.currency || ' ' || to_char(s.total, 'FM999,999,990.00'), 'finance', s.ref
  from public.app_users u
  where public.is_editor_email(u.email) and u.id is distinct from v_me;
  perform public.audit_write('sales_invoice.sent_for_issue', 'sales_invoice', s.ref, jsonb_build_object('customer', s.customer, 'total', s.total));
  return public.si_json(p_id);
end $$;

-- Finance → preparer (needs changes)
create or replace function public.return_invoice_draft(p_id uuid, p_note text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare s record;
begin
  perform public.assert_access('finance', 2);
  if nullif(trim(coalesce(p_note, '')), '') is null then raise exception 'Say what needs changing'; end if;
  select * into s from public.sales_invoices where id = p_id for update;
  if not found then raise exception 'Invoice not found'; end if;
  if s.state <> 'draft' or s.submitted_at is null then raise exception 'This invoice is not waiting to be issued'; end if;
  update public.sales_invoices set submitted_at = null, return_note = trim(p_note), updated_at = now() where id = p_id;
  insert into public.notifications(entity_id, recipient_email, kind, title, body, link_view, link_ref)
  select s.entity_id, lower(u.email), 'invoice_returned', 'Invoice returned for changes', s.customer || ' — ' || trim(p_note), 'staffportal', s.ref
  from public.app_users u where u.id = coalesce(s.submitted_by, s.owner_id);
  perform public.audit_write('sales_invoice.returned', 'sales_invoice', s.ref, jsonb_build_object('note', p_note));
  return public.si_json(p_id);
end $$;

-- tell the preparer when Finance issues their invoice
create or replace function public.si_trg_issued_notify() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if old.state = 'draft' and new.state = 'issued' and coalesce(new.submitted_by, new.owner_id) is not null
     and coalesce(new.submitted_by, new.owner_id) is distinct from (select id from public.app_users where auth_id = auth.uid()) then
    insert into public.notifications(entity_id, recipient_email, kind, title, body, link_view, link_ref)
    select new.entity_id, lower(u.email), 'invoice_issued', 'Invoice ' || new.ref || ' issued',
           new.customer || ' — ' || new.currency || ' ' || to_char(new.total, 'FM999,999,990.00'), 'staffportal', new.ref
    from public.app_users u where u.id = coalesce(new.submitted_by, new.owner_id);
  end if;
  return new;
end $$;
drop trigger if exists si_issued_notify on public.sales_invoices;
create trigger si_issued_notify after update of state on public.sales_invoices
  for each row execute function public.si_trg_issued_notify();

do $$
declare fn text;
begin
  foreach fn in array array['save_sales_invoice(uuid, jsonb)', 'delete_draft_invoice(uuid)', 'submit_invoice_for_issue(uuid)',
                            'return_invoice_draft(uuid, text)', 'is_editor()'] loop
    execute format('revoke execute on function public.%s from public, anon', fn);
    execute format('grant execute on function public.%s to authenticated', fn);
  end loop;
  execute 'revoke execute on function public.si_trg_issued_notify() from public, anon, authenticated';
end $$;
