-- ============================================================
-- Jikoni Master PRD — Phase 4: Compliance, reporting, integrations
-- Versioned policies, company documents with expiry flags, compliance
-- calendar (statutory obligations + due dates), risk register, contracts
-- registry (used by Procurement + CRM). Integration plumbing: eTIMS
-- files on EVERY sales invoice issue, M-Pesa payment intents, sanctions
-- screening API log. Real HTTP calls live in serverless functions later;
-- the queue tables + document chain are wired now. Idempotent.
-- ============================================================

-- ---------- policies & manuals (versioned) ----------
create table if not exists public.policies (
  id             uuid primary key default gen_random_uuid(),
  code           text not null,                 -- 'IGN-PROC-001'
  title          text not null,
  version        int not null default 1,
  effective_from date,
  doc            text,
  state          text not null default 'active' check (state in ('draft','active','superseded')),
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),
  unique (code, version)
);

-- ---------- company documents (statutory docs with expiry flags) ----------
create table if not exists public.company_documents (
  id         uuid primary key default gen_random_uuid(),
  entity_id  uuid references public.entities(id),
  name       text not null unique,
  kind       text,
  expires_on date,                              -- null = no expiry
  doc        text,
  state      text not null default 'active',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- ---------- compliance calendar (statutory obligations + due dates) ----------
create table if not exists public.compliance_obligations (
  id         uuid primary key default gen_random_uuid(),
  entity_id  uuid references public.entities(id),
  obligation text not null unique,
  authority  text,                              -- KRA / NSSF / SHA / …
  frequency  text not null check (frequency in ('monthly','quarterly','annual')),
  due_rule   text,                              -- '9th of following month'
  next_due   date not null,
  owner_module text,                            -- finance | hr — shared calendar (PRD cross-links)
  state      text not null default 'pending' check (state in ('pending','filed','overdue')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create or replace function public.mark_obligation_filed(p_obligation text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare o record; nxt date;
begin
  perform public.assert_access('reports', 2);
  select * into o from public.compliance_obligations where obligation = p_obligation;
  if not found then raise exception 'Unknown obligation: %', p_obligation; end if;
  nxt := case o.frequency
    when 'monthly' then o.next_due + interval '1 month'
    when 'quarterly' then o.next_due + interval '3 months'
    else o.next_due + interval '1 year' end;
  update public.compliance_obligations set state = 'pending', next_due = nxt where id = o.id;
  perform public.audit_write('compliance.filed','obligation', p_obligation,
    jsonb_build_object('filedFor', o.next_due, 'nextDue', nxt));
  return jsonb_build_object('obligation', p_obligation, 'nextDue', nxt);
end $$;

-- ---------- risk register ----------
create table if not exists public.risks (
  id         uuid primary key default gen_random_uuid(),
  ref        text not null unique,
  entity_id  uuid references public.entities(id),
  risk       text not null,
  category   text,
  likelihood int not null check (likelihood between 1 and 5),
  impact     int not null check (impact between 1 and 5),
  mitigation text,
  owner_name text,
  state      text not null default 'open' check (state in ('open','mitigated','closed')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- ---------- contracts registry (Procurement + CRM read this) ----------
create table if not exists public.contracts (
  id           uuid primary key default gen_random_uuid(),
  entity_id    uuid references public.entities(id),
  counterparty text not null,
  kind         text not null check (kind in ('vendor','funder','customer','partner')),
  title        text not null,
  detail       text,
  expires_on   date,
  vendor_id    uuid references public.vendors(id),
  state        text not null default 'active' check (state in ('active','renew_soon','expired','terminated')),
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  unique (counterparty, title)
);

-- ---------- integration queues ----------
create table if not exists public.etims_submissions (
  id           uuid primary key default gen_random_uuid(),
  invoice_ref  text not null references public.sales_invoices(ref),
  control_no   text,
  payload      jsonb,
  state        text not null default 'pending' check (state in ('pending','filed','failed')),
  submitted_at timestamptz,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);

create table if not exists public.mpesa_payments (
  id          uuid primary key default gen_random_uuid(),
  payment_ref text not null references public.payments(ref),
  shortcode   text,
  checkout_id text,
  amount      numeric not null,
  state       text not null default 'pending' check (state in ('pending','confirmed','failed')),
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

create table if not exists public.sanctions_checks (
  id         uuid primary key default gen_random_uuid(),
  vendor_id  uuid not null references public.vendors(id),
  provider   text not null default 'manual',
  result     text not null check (result in ('cleared','flagged')),
  detail     jsonb,
  checked_by uuid references public.app_users(id),
  created_at timestamptz not null default now()
);

-- ---------- transitions + counters ----------
insert into public.record_transitions(record_type, from_state, to_state) values
  ('policy','draft','active'), ('policy','active','superseded'),
  ('risk','open','mitigated'), ('risk','mitigated','closed'), ('risk','open','closed'),
  ('contract','active','renew_soon'), ('contract','renew_soon','expired'),
  ('contract','active','expired'), ('contract','active','terminated'),
  ('etims','pending','filed'), ('etims','pending','failed'), ('etims','failed','filed'),
  ('mpesa','pending','confirmed'), ('mpesa','pending','failed'),
  ('obligation','pending','filed'), ('obligation','pending','overdue'), ('obligation','overdue','filed')
on conflict do nothing;

do $$
declare r record;
begin
  for r in select * from (values
    ('policies','policy'), ('risks','risk'), ('contracts','contract'),
    ('etims_submissions','etims'), ('mpesa_payments','mpesa'), ('compliance_obligations','obligation')
  ) as t(tbl, rtype)
  loop
    execute format('drop trigger if exists state_machine on public.%I', r.tbl);
    execute format('create trigger state_machine before update of state on public.%I
                    for each row execute function public.enforce_state_machine(%L)', r.tbl, r.rtype);
  end loop;
end $$;

insert into public.ref_counters(kind, prefix, n) values
  ('RSK', 'RSK-', 100),
  ('ETIMS', 'KRA-CU-', 550000)
on conflict (kind) do nothing;

-- ---------- eTIMS files on EVERY sales invoice issue (legal requirement) ----------
create or replace function public.submit_sales_invoice(p_customer text, p_description text, p_net numeric, p_due_key text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_ref text; v_total numeric; v_vat numeric; v_cls text; v_txt text; v_ctrl text;
  v_entity uuid := (select id from public.entities where code = 'KE');
  v_owner uuid := (select id from public.app_users where auth_id = auth.uid());
begin
  perform public.assert_access('finance', 2);
  v_total := round(p_net * 1.16);
  v_vat := v_total - p_net;
  select case p_due_key when 'today' then 'today' else 'week' end,
         case p_due_key when 'today' then 'On receipt' when 'week30' then '30 days' else '14 days' end
    into v_cls, v_txt;
  v_ref := public.next_ref('SI');
  insert into public.sales_invoices(ref, entity_id, owner_id, customer, description, net, vat, total, due_pill_cls, due_pill_txt)
  values (v_ref, v_entity, v_owner, p_customer, p_description, p_net, v_vat, v_total, v_cls, v_txt);
  -- eTIMS: filed on issue — no invoice without a filing record
  v_ctrl := public.next_ref('ETIMS');
  insert into public.etims_submissions(invoice_ref, control_no, state, submitted_at, payload)
  values (v_ref, v_ctrl, 'filed', now(),
          jsonb_build_object('customer', p_customer, 'net', p_net, 'vat', v_vat, 'total', v_total));
  perform public.post_journal('Sales invoice ' || v_ref || ' — ' || p_customer, 'sales_invoice', v_ref,
    jsonb_build_array(
      jsonb_build_object('account', '1100', 'debit', v_total),
      jsonb_build_object('account', '4000', 'credit', p_net),
      jsonb_build_object('account', '2100', 'credit', v_vat)));
  perform public.audit_write('sales_invoice.issued','sales_invoice', v_ref,
    jsonb_build_object('customer', p_customer, 'net', p_net, 'total', v_total, 'etims', v_ctrl));
  return jsonb_build_object('cust', p_customer, 'id', v_ref, 'tot', v_total, 'pillCls', v_cls, 'pillTxt', v_txt);
end $$;

-- ---------- M-Pesa rail: payment intent recorded on mpesa payments ----------
create or replace function public.pay_invoice(p_inv_ref text, p_method text default 'bank')
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  inv record; po record; v_ref text; je text; bcode text;
  v_entity uuid := (select id from public.entities where code = 'KE');
begin
  perform public.assert_access('finance', 3);
  select * into inv from public.invoices_ap where ref = p_inv_ref;
  if not found then raise exception 'Invoice % not found', p_inv_ref; end if;
  if inv.state <> 'matched' then
    raise exception 'Three-way match: % must be matched before payment (state: %)', p_inv_ref, inv.state;
  end if;
  select * into po from public.purchase_orders where id = inv.po_id;
  v_ref := public.next_ref('PAY');
  je := public.post_journal('Payment ' || v_ref || ' — ' || po.vendor_name, 'payment', v_ref,
    jsonb_build_array(
      jsonb_build_object('account', '2000', 'debit', inv.amount),
      jsonb_build_object('account', '1000', 'credit', inv.amount)));
  insert into public.payments(ref, entity_id, invoice_ap_id, method, amount, journal_ref)
  values (v_ref, v_entity, inv.id, p_method, inv.amount, je);
  if p_method = 'mpesa' then
    insert into public.mpesa_payments(payment_ref, shortcode, amount, state)
    values (v_ref, '174379', inv.amount, 'pending');   -- serverless function fires the STK later
  end if;
  update public.invoices_ap set state = 'paid' where id = inv.id;
  update public.vendors set open_pos = greatest(open_pos - 1, 0) where id = inv.vendor_id;
  select budget_code into bcode from public.requisitions where id = po.requisition_id;
  if bcode is not null then
    update public.budget_lines set committed = greatest(committed - inv.amount, 0),
                                   actual = actual + inv.amount where code = bcode;
  end if;
  perform public.audit_write('payment.made','payment', v_ref,
    jsonb_build_object('invoice', p_inv_ref, 'method', p_method, 'amount', inv.amount, 'journal', je));
  return jsonb_build_object('id', v_ref, 'invoice', p_inv_ref, 'journal', je);
end $$;

-- ---------- sanctions screening: recorded check clears the vendor gate ----------
create or replace function public.screen_vendor(p_vendor_name text, p_result text, p_detail text default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v record;
  v_actor uuid := (select id from public.app_users where auth_id = auth.uid());
begin
  perform public.assert_access('procurement', 3);
  if p_result not in ('cleared','flagged') then raise exception 'Result must be cleared or flagged'; end if;
  select * into v from public.vendors where name = p_vendor_name;
  if not found then raise exception 'Vendor % not found', p_vendor_name; end if;
  insert into public.sanctions_checks(vendor_id, provider, result, detail, checked_by)
  values (v.id, 'manual', p_result, jsonb_build_object('note', p_detail), v_actor);
  if p_result = 'cleared' then
    update public.vendors set screen_status = 'cleared' where id = v.id;
    if v.state = 'draft' then update public.vendors set state = 'in_screening' where id = v.id; end if;
    if (select state from public.vendors where id = v.id) = 'in_screening' then
      update public.vendors set state = 'prequalified' where id = v.id;
      update public.vendors set state = 'active' where id = v.id;
    end if;
  else
    update public.vendors set screen_status = 'flagged' where id = v.id;
  end if;
  perform public.audit_write('vendor.screened','vendor', p_vendor_name,
    jsonb_build_object('result', p_result, 'detail', p_detail));
  return jsonb_build_object('vendor', p_vendor_name, 'result', p_result,
    'state', (select state from public.vendors where id = v.id));
end $$;

-- ---------- seeds ----------
insert into public.policies(code, title, version, effective_from, state) values
  ('IGN-PROC-001', 'Procurement policy & SOP',            2, '2026-01-01', 'active'),
  ('IGN-FIN-001',  'Financial management manual',         1, '2025-07-01', 'active'),
  ('IGN-HR-001',   'HR policy & staff handbook',          1, '2025-07-01', 'active'),
  ('IGN-SAF-001',  'Safeguarding & ethics policy',        1, '2025-10-01', 'active'),
  ('IGN-DATA-001', 'Data protection policy (Kenya DPA)',  1, '2025-10-01', 'active')
on conflict (code, version) do nothing;

with ke as (select id from public.entities where code = 'KE')
insert into public.company_documents(entity_id, name, kind, expires_on)
select ke.id, v.name, v.kind, v.expires::date from ke, (values
  ('Certificate of incorporation', 'statutory', null),
  ('KRA PIN certificate',          'statutory', null),
  ('Tax Compliance Certificate',   'statutory', '2026-11-30'),
  ('Nairobi business permit',      'licence',   '2026-12-31'),
  ('EPRA licence — LPG handling',  'licence',   '2027-03-31')
) as v(name, kind, expires)
on conflict (name) do nothing;

with ke as (select id from public.entities where code = 'KE')
insert into public.compliance_obligations(entity_id, obligation, authority, frequency, due_rule, next_due, owner_module)
select ke.id, v.* from ke, (values
  ('PAYE remittance',          'KRA',  'monthly', '9th of following month',  '2026-07-09'::date, 'finance'),
  ('NSSF contributions',       'NSSF', 'monthly', '9th of following month',  '2026-07-09', 'hr'),
  ('SHIF contributions',       'SHA',  'monthly', '9th of following month',  '2026-07-09', 'hr'),
  ('Housing levy remittance',  'KRA',  'monthly', '9th of following month',  '2026-07-09', 'finance'),
  ('VAT return',               'KRA',  'monthly', '20th of following month', '2026-07-20', 'finance'),
  ('NITA levy',                'NITA', 'monthly', '9th of following month',  '2026-07-09', 'hr'),
  ('Annual returns (CR12)',    'BRS',  'annual',  'anniversary of incorporation', '2027-01-31', 'reports')
) as v(obligation, authority, frequency, due_rule, next_due, owner_module)
on conflict (obligation) do nothing;

with ke as (select id from public.entities where code = 'KE')
insert into public.risks(ref, entity_id, risk, category, likelihood, impact, mitigation, owner_name, state)
select v.ref, ke.id, v.risk, v.category, v.l, v.i, v.mitigation, v.owner, v.state from ke, (values
  ('RSK-101', 'Wave 1 fund decision slips past Q3 — bridge funding gap', 'Funding',   3, 4, 'Charm term sheet + EAIF parallel track; 6-month runway floor', 'Dennis', 'open'),
  ('RSK-102', 'LPG price volatility erodes institution savings case',    'Market',    3, 3, 'Framework pricing with BURN; multi-fuel positioning',           'Wilson', 'open'),
  ('RSK-103', 'Vendor concentration — BURN single-source for cookers',   'Supply',    2, 4, 'Second fabricator prequalified (Nakuru); framework dual-award', 'Joan',   'mitigated'),
  ('RSK-104', 'Enumerator data quality in 5-county baseline',            'Delivery',  2, 3, 'KoboToolbox validation rules + 10% back-check sample',          'Elizabeth', 'open')
) as v(ref, risk, category, l, i, mitigation, owner, state)
on conflict (ref) do nothing;

-- contracts registry from the vendor + funder records
with ke as (select id from public.entities where code = 'KE')
insert into public.contracts(entity_id, counterparty, kind, title, detail, expires_on, vendor_id, state)
select ke.id, v.counterparty, v.kind, v.title, v.detail, v.expires::date,
       (select id from public.vendors where name = v.counterparty), v.state
from ke, (values
  ('BURN Manufacturing', 'vendor', 'Cookstove supply framework', 'Framework · agreed rates', '2026-12-31', 'active'),
  ('Equity Logistics',   'vendor', 'Logistics framework',        'Framework',                '2027-03-31', 'active'),
  ('Safaricom',          'vendor', 'Data & connectivity',        'Service agreement',        '2026-09-30', 'renew_soon'),
  ('Makueni County',     'partner','MoU — VTC rollout',          'County partnership',       '2026-12-31', 'active'),
  ('PICREF',             'funder', 'Sierra Leone grant agreement','$240k programme grant',   '2027-06-30', 'active')
) as v(counterparty, kind, title, detail, expires, state)
on conflict (counterparty, title) do nothing;

-- ---------- RLS + grants ----------
do $$
declare t text;
begin
  foreach t in array array['policies','company_documents','compliance_obligations','risks',
    'contracts','etims_submissions','mpesa_payments','sanctions_checks']
  loop
    execute format('alter table public.%I enable row level security', t);
    execute format('drop policy if exists "read for authenticated" on public.%I', t);
    execute format('create policy "read for authenticated" on public.%I for select to authenticated using (true)', t);
  end loop;
end $$;

do $$
declare fn text;
begin
  foreach fn in array array[
    'mark_obligation_filed(text)','screen_vendor(text,text,text)']
  loop
    execute format('revoke execute on function public.%s from public, anon', fn);
    execute format('grant execute on function public.%s to authenticated', fn);
  end loop;
end $$;
