-- ============================================================
-- 0065 — Proforma invoices (Order-to-cash: the offer before the sale)
-- A proforma is a priced quote to a customer. It posts nothing to the ledger and
-- carries no VAT liability until the customer ACCEPTS it — acceptance converts it into
-- a real tax invoice (reusing submit_sales_invoice, so eTIMS + GL fire exactly as for
-- any sales invoice). Proformas can also be declined (reason kept for conversion
-- analysis) or expire on their own past the valid-to date. Idempotent.
-- ============================================================

-- ---------- tables ----------
create table if not exists public.proformas (
  id             uuid primary key default gen_random_uuid(),
  ref            text not null unique,
  entity_id      uuid references public.entities(id),
  customer       text not null,
  org_id         text,                                   -- CRM partner id when picked (free text otherwise)
  owner_name     text,                                   -- "raised by" (display)
  issued_on      date not null default current_date,
  valid_to       date,
  terms          text,
  lead_time      text,
  notes          text,
  currency       text not null default 'KES',
  state          text not null default 'issued' check (state in ('issued','accepted','declined','expired')),
  decline_reason text,
  invoice_ref    text references public.sales_invoices(ref),
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);

create table if not exists public.proforma_lines (
  id           uuid primary key default gen_random_uuid(),
  proforma_id  uuid not null references public.proformas(id) on delete cascade,
  description  text not null,
  qty          numeric not null default 1 check (qty > 0),
  unit_price   numeric not null default 0 check (unit_price >= 0),
  sort         int not null default 0
);
create index if not exists proforma_lines_proforma_idx on public.proforma_lines(proforma_id);

-- RLS: read for signed-in users; writes only through the definer RPCs below
alter table public.proformas       enable row level security;
alter table public.proforma_lines  enable row level security;
do $$
begin
  drop policy if exists "proformas read"      on public.proformas;
  drop policy if exists "proforma_lines read" on public.proforma_lines;
  create policy "proformas read"      on public.proformas      for select to authenticated using (true);
  create policy "proforma_lines read" on public.proforma_lines for select to authenticated using (true);
end $$;

-- PF ref counter → PF-0042, PF-0043, … (matches SI-style formatting)
insert into public.ref_counters(kind, prefix, n) values ('PF', 'PF-00', 41)
  on conflict (kind) do nothing;

-- ---------- create_proforma: register the offer (no ledger impact) ----------
create or replace function public.create_proforma(
  p_customer text, p_org_id text, p_owner text, p_valid_to date,
  p_terms text, p_lead text, p_notes text, p_lines jsonb
) returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_entity uuid := (select id from public.entities where code = 'KE');
  v_ref text; v_id uuid; ln jsonb; i int := 0; v_lines int := 0;
begin
  perform public.assert_access('finance', 2);
  if coalesce(trim(p_customer), '') = '' then raise exception 'A proforma needs a customer'; end if;
  v_ref := public.next_ref('PF');
  insert into public.proformas(ref, entity_id, customer, org_id, owner_name, valid_to,
                               terms, lead_time, notes)
  values (v_ref, v_entity, p_customer, nullif(p_org_id,''), nullif(p_owner,''), p_valid_to,
          nullif(p_terms,''), nullif(p_lead,''), nullif(p_notes,''))
  returning id into v_id;
  for ln in select * from jsonb_array_elements(coalesce(p_lines, '[]'::jsonb)) loop
    if coalesce(trim(ln->>'d'), '') <> '' then
      insert into public.proforma_lines(proforma_id, description, qty, unit_price, sort)
      values (v_id, ln->>'d', greatest(coalesce((ln->>'q')::numeric, 1), 1),
              coalesce((ln->>'p')::numeric, 0), i);
      v_lines := v_lines + 1;
    end if;
    i := i + 1;
  end loop;
  if v_lines = 0 then raise exception 'A proforma needs at least one line item'; end if;
  perform public.audit_write('proforma.created', 'proforma', v_ref,
    jsonb_build_object('customer', p_customer, 'lines', v_lines));
  return jsonb_build_object('ref', v_ref);
end $$;

-- ---------- accept_proforma: convert the offer into a real tax invoice ----------
create or replace function public.accept_proforma(p_ref text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare p record; v_sub numeric; v_inv jsonb; v_si text;
begin
  perform public.assert_access('finance', 2);
  select * into p from public.proformas where ref = p_ref;
  if not found then raise exception 'Unknown proforma: %', p_ref; end if;
  if p.state <> 'issued' then raise exception 'Only an issued proforma can be accepted (this one is %)', p.state; end if;
  select coalesce(sum(qty * unit_price), 0) into v_sub from public.proforma_lines where proforma_id = p.id;
  if v_sub <= 0 then raise exception 'Proforma % has no priced lines to invoice', p_ref; end if;
  -- reuse the sales-invoice path: files eTIMS + posts the balanced journal
  v_inv := public.submit_sales_invoice(p.customer, 'Proforma ' || p_ref || ' accepted', v_sub, 'week30');
  v_si := v_inv->>'id';
  update public.proformas set state = 'accepted', invoice_ref = v_si, updated_at = now() where id = p.id;
  perform public.audit_write('proforma.accepted', 'proforma', p_ref,
    jsonb_build_object('invoice', v_si, 'net', v_sub));
  return jsonb_build_object('ref', p_ref, 'invoice', v_si);
end $$;

-- ---------- decline_proforma: record the loss + reason (no ledger impact) ----------
create or replace function public.decline_proforma(p_ref text, p_reason text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare p record;
begin
  perform public.assert_access('finance', 2);
  select * into p from public.proformas where ref = p_ref;
  if not found then raise exception 'Unknown proforma: %', p_ref; end if;
  if p.state <> 'issued' then raise exception 'Only an issued proforma can be declined (this one is %)', p.state; end if;
  update public.proformas set state = 'declined',
    decline_reason = nullif(trim(p_reason), ''), updated_at = now() where id = p.id;
  perform public.audit_write('proforma.declined', 'proforma', p_ref,
    jsonb_build_object('reason', p_reason));
  return jsonb_build_object('ref', p_ref);
end $$;

-- grants: create RPCs are authenticated-only
do $$
declare fn text;
begin
  foreach fn in array array[
    'create_proforma(text,text,text,date,text,text,text,jsonb)',
    'accept_proforma(text)',
    'decline_proforma(text,text)']
  loop
    execute format('revoke execute on function public.%s from public, anon', fn);
    execute format('grant execute on function public.%s to authenticated', fn);
  end loop;
end $$;

-- ============================================================
-- bootstrap(): recreated verbatim from 0064, adding the 'proformas' feed.
-- (0064 is the previous definition; only the proformas key is new.)
-- ============================================================
create or replace function public.bootstrap()
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare
  v_email text := coalesce(nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'email', '');
begin
  return jsonb_build_object(
    'me', (select jsonb_build_object('email', email, 'name', name, 'roleTitle', role_title)
           from public.app_users where email = v_email),
    'tasks', coalesce((select jsonb_agg(jsonb_build_object(
        'id', ref, 't', title, 's', sub, 'o', owner_name, 'p', due_pill, 'pl', due_label)
        order by created_at desc)
      from public.tasks where state = 'open'), '[]'::jsonb),
    'reqs', coalesce((select jsonb_agg(jsonb_build_object(
        'id', ref, 'item', item, 'amt', amount, 'code', budget_code,
        'chip', budget_chip, 'chipTxt', budget_chip_txt,
        'status', case state when 'approved' then 'approved' when 'md_review' then 'md'
                             when 'converted' then 'po' else 'await' end)
        order by created_at desc)
      from public.requisitions where state <> 'rejected'), '[]'::jsonb),
    'pos', coalesce((select jsonb_agg(jsonb_build_object(
        'id', ref, 'vendor', vendor_name, 'amt', amount, 'delivery', delivery)
        order by created_at desc)
      from public.purchase_orders), '[]'::jsonb),
    'salesInvoices', coalesce((select jsonb_agg(jsonb_build_object(
        'cust', customer, 'id', ref, 'tot', total, 'pillCls', due_pill_cls, 'pillTxt', due_pill_txt)
        order by created_at desc)
      from public.sales_invoices), '[]'::jsonb),
    'proformas', coalesce((select jsonb_agg(jsonb_build_object(
        'ref', ref, 'customer', customer, 'orgId', org_id, 'owner', owner_name,
        'issued', to_char(issued_on, 'DD Mon YYYY'),
        'validTo', case when valid_to is null then '—' else to_char(valid_to, 'DD Mon YYYY') end,
        'validRaw', valid_to, 'terms', terms, 'lead', lead_time, 'notes', notes,
        'currency', currency, 'state', state, 'declineReason', decline_reason, 'invoiceRef', invoice_ref,
        'lines', coalesce((select jsonb_agg(jsonb_build_object('d', description, 'q', qty, 'p', unit_price) order by sort)
                  from public.proforma_lines where proforma_id = pf.id), '[]'::jsonb),
        'subtotal', coalesce((select sum(qty * unit_price) from public.proforma_lines where proforma_id = pf.id), 0),
        -- display status: an issued proforma past its valid-to reads as lapsed
        'statusCls', case
            when state = 'accepted' then 'done'
            when state = 'declined' then 'over'
            when state = 'expired' then 'week'
            when valid_to is not null and valid_to < current_date then 'week'
            else 'today' end,
        'statusTxt', case
            when state = 'accepted' then 'Accepted'
            when state = 'declined' then 'Declined'
            when state = 'expired' then 'Expired'
            when valid_to is not null and valid_to < current_date then 'Lapsed'
            else 'Awaiting' end)
        order by created_at desc)
      from public.proformas pf), '[]'::jsonb),
    'perms', coalesce((select jsonb_object_agg(email, mods) from (
        select email, jsonb_object_agg(module, level) as mods
        from public.user_permissions group by email) q), '{}'::jsonb),
    'projects', coalesce((select jsonb_object_agg(name, public.project_detail_json(id))
      from public.projects), '{}'::jsonb),
    'extraProjects', coalesce((select jsonb_agg(jsonb_build_object('name', name, 'funder', funder)
        order by created_at)
      from public.projects where is_extra), '[]'::jsonb),
    'engToProject', coalesce((select jsonb_object_agg(eng_ref, project_name)
      from public.eng_project_links), '{}'::jsonb),
    'projectToEng', coalesce((select jsonb_object_agg(project_name, eng_ref)
      from public.eng_project_links where is_primary), '{}'::jsonb),
    'budgetLines', coalesce((select jsonb_object_agg(code, jsonb_build_object(
        'b', budget, 'u', committed + actual))
      from public.budget_lines), '{}'::jsonb),
    'inventory', jsonb_build_object(
      'items', coalesce((select jsonb_agg(jsonb_build_object(
          'sku', i.sku, 'name', i.name, 'category', i.category, 'unit', i.unit,
          'unitCost', i.unit_cost, 'reorderLevel', i.reorder_level,
          'onHand', coalesce((select sum(qty) from public.stock_levels where item_id = i.id), 0),
          'autoReq', i.auto_req_ref) order by i.sku)
        from public.stock_items i where i.state = 'active'), '[]'::jsonb),
      'locations', coalesce((select jsonb_agg(name order by name) from public.stock_locations where state='active'), '[]'::jsonb),
      'movements', coalesce((select jsonb_agg(jsonb_build_object(
          'when', to_char(m.created_at, 'DD Mon HH24:MI'), 'sku', i.sku, 'type', m.movement_type,
          'qty', m.qty, 'from', fl.name, 'to', tl.name, 'source', m.source_ref, 'note', m.note) order by m.created_at desc)
        from (select * from public.stock_movements order by created_at desc limit 40) m
        join public.stock_items i on i.id = m.item_id
        left join public.stock_locations fl on fl.id = m.from_location
        left join public.stock_locations tl on tl.id = m.to_location), '[]'::jsonb),
      'dispatches', coalesce((select jsonb_agg(jsonb_build_object(
          'id', ref, 'project', project_name, 'destination', destination, 'lines', lines, 'state', state)
          order by created_at desc)
        from public.dispatches), '[]'::jsonb),
      'assets', coalesce((select jsonb_agg(jsonb_build_object(
          'id', ref, 'name', name, 'category', category, 'cost', cost, 'accumDep', accum_dep,
          'nbv', cost - accum_dep, 'acquired', to_char(acquired_on, 'Mon YYYY'), 'state', state)
          order by ref)
        from public.assets), '[]'::jsonb)),
    -- ---- CRM forms data ----
    'engagements', jsonb_build_object(
      'up', coalesce((select jsonb_agg(jsonb_build_object(
          'id', ref, 'n', name, 'st', stage, 'o', owner_name, 'pl', pill, 'plt', pill_txt)
          order by created_at desc)
        from public.engagements where pipeline = 'up' and state = 'active'), '[]'::jsonb),
      'down', coalesce((select jsonb_agg(jsonb_build_object(
          'id', ref, 'n', name, 'st', stage, 'o', owner_name, 'pl', pill, 'plt', pill_txt)
          order by created_at desc)
        from public.engagements where pipeline = 'down' and state = 'active'), '[]'::jsonb)),
    'partners', coalesce((select jsonb_agg(jsonb_build_object(
        'id', id, 'name', name, 'type', type, 'country', country,
        'ownerName', owner_name, 'status', status, 'statusCls', status_cls)
        order by created_at desc)
      from public.partners where state = 'active'), '[]'::jsonb),
    'opportunities', coalesce((select jsonb_agg(jsonb_build_object(
        'id', id, 'name', name, 'type', type, 'deadline', deadline,
        'linkedTo', linked_to, 'status', status, 'statusCls', status_cls)
        order by created_at desc)
      from public.opportunities where state = 'active'), '[]'::jsonb),
    'crmDropdowns', coalesce((select jsonb_object_agg(cat, vals) from (
        select category as cat, jsonb_agg(value order by sort) as vals
        from public.crm_dropdown_options where active group by category) q), '{}'::jsonb),
    'teamNames', coalesce((select jsonb_agg(name order by name) from public.app_users where state = 'active'), '[]'::jsonb),
    -- ---- Compliance & Governance ----
    'compliance', jsonb_build_object(
      'policies', coalesce((select jsonb_agg(jsonb_build_object(
          'code', code, 'title', title, 'version', 'v' || version, 'effectiveFrom', effective_from,
          'doc', doc, 'state', state,
          'statusCls', case
            when state = 'superseded' then 'week'
            when state = 'draft' then 'today'
            when effective_from is not null and effective_from < (now() - interval '1 year')::date then 'today'
            else 'done' end,
          'statusTxt', case
            when state = 'superseded' then 'Superseded'
            when state = 'draft' then 'Draft'
            when effective_from is not null and effective_from < (now() - interval '1 year')::date then 'Review due'
            else 'Current' end)
          order by code)
        from public.policies where state <> 'superseded'), '[]'::jsonb),
      'companyDocuments', coalesce((select jsonb_agg(jsonb_build_object(
          'name', name, 'kind', kind, 'doc', doc,
          'expiry', case when expires_on is null then '—' else to_char(expires_on, 'DD Mon YYYY') end,
          'statusCls', case
            when expires_on is null then 'done'
            when expires_on < now()::date then 'over'
            when expires_on < (now() + interval '60 days')::date then 'today'
            when expires_on < (now() + interval '6 months')::date then 'week'
            else 'done' end,
          'statusTxt', case
            when expires_on is null then 'On file'
            when expires_on < now()::date then 'Expired'
            when expires_on < (now() + interval '60 days')::date then 'Renew soon'
            when expires_on < (now() + interval '6 months')::date then 'Upcoming'
            else 'Valid' end)
          order by expires_on nulls first, name)
        from public.company_documents where state = 'active'), '[]'::jsonb),
      'obligations', coalesce((select jsonb_agg(jsonb_build_object(
          'obligation', obligation, 'authority', authority, 'dueRule', due_rule,
          'nextDue', next_due, 'when', to_char(next_due, 'DD Mon'), 'state', state, 'ownerModule', owner_module,
          'statusCls', case
            when state = 'overdue' or next_due < now()::date then 'over'
            when next_due < (now() + interval '10 days')::date then 'today'
            else 'week' end,
          'statusTxt', case
            when state = 'overdue' or next_due < now()::date then 'Overdue'
            when next_due < (now() + interval '10 days')::date then 'Due soon'
            when next_due < (date_trunc('month', now()) + interval '1 month')::date then 'This month'
            else 'Upcoming' end)
          order by next_due)
        from public.compliance_obligations), '[]'::jsonb),
      'risks', coalesce((select jsonb_agg(jsonb_build_object(
          'ref', ref, 'risk', risk, 'category', category, 'owner', owner_name,
          'likelihood', likelihood, 'impact', impact, 'score', likelihood * impact,
          'mitigation', mitigation, 'state', state,
          'statusCls', case when likelihood * impact >= 12 then 'over'
                            when likelihood * impact >= 6 then 'today' else 'week' end,
          'statusTxt', case when likelihood * impact >= 12 then 'High'
                            when likelihood * impact >= 6 then 'Medium' else 'Low' end)
          order by likelihood * impact desc, ref)
        from public.risks where state <> 'closed'), '[]'::jsonb),
      'contracts', coalesce((select jsonb_agg(jsonb_build_object(
          'counterparty', counterparty, 'kind', kind, 'title', title, 'detail', detail,
          'expiry', case when expires_on is null then '—' else to_char(expires_on, 'DD Mon YYYY') end,
          'state', state, 'doc', doc,
          'statusCls', case state when 'active' then 'done' when 'renew_soon' then 'today'
                                  when 'expired' then 'over' else 'week' end,
          'statusTxt', case state when 'active' then 'Active' when 'renew_soon' then 'Renew soon'
                                  when 'expired' then 'Expired' else 'Terminated' end)
          order by expires_on nulls last, counterparty)
        from public.contracts where state <> 'terminated'), '[]'::jsonb))
  );
end $$;
