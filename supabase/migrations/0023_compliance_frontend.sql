-- ============================================================
-- Jikoni — Compliance & Governance: wire the module to the frontend
-- The Phase 4 backend (policies, company_documents, compliance_obligations,
-- risks, contracts) already exists but was never read by the app. This makes
-- Compliance a first-class, Supabase-backed, interactive module like the rest:
--   * dedicated 'compliance' access key (backfilled from each user's reports level)
--   * compliance-docs storage bucket (public-read, authenticated-write)
--   * create RPCs: create_risk / add_policy / add_company_document / add_contract
--   * mark_obligation_filed re-gated onto 'compliance'
--   * bootstrap() extended with policies/companyDocuments/obligations/risks/contracts
--   * seeds reconciled to the intended demo content
-- Idempotent: safe to re-run.
-- ============================================================

-- ---------- access key: backfill 'compliance' from each user's 'reports' level ----------
insert into public.user_permissions(email, module, level)
select email, 'compliance', level from public.user_permissions where module = 'reports'
on conflict (email, module) do nothing;

-- ---------- storage bucket 'compliance-docs' (public read, authenticated write) ----------
do $$
begin
  insert into storage.buckets (id, name, public)
  values ('compliance-docs', 'compliance-docs', true)
  on conflict (id) do nothing;

  drop policy if exists "compliance-docs read"   on storage.objects;
  drop policy if exists "compliance-docs write"  on storage.objects;
  drop policy if exists "compliance-docs update" on storage.objects;
  create policy "compliance-docs read"   on storage.objects
    for select to public using (bucket_id = 'compliance-docs');
  create policy "compliance-docs write"  on storage.objects
    for insert to authenticated with check (bucket_id = 'compliance-docs');
  create policy "compliance-docs update" on storage.objects
    for update to authenticated using (bucket_id = 'compliance-docs');
end $$;

-- ---------- mutation RPCs (mirror the create_partner template) ----------

-- risk register: new risk gets an RSK- ref; severity is likelihood × impact
create or replace function public.create_risk(
  p_risk text, p_category text, p_likelihood int, p_impact int, p_mitigation text, p_owner text
) returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_entity uuid := (select id from public.entities where code = 'KE');
  v_ref text;
begin
  perform public.assert_access('compliance', 2);
  if p_likelihood not between 1 and 5 or p_impact not between 1 and 5 then
    raise exception 'Likelihood and impact must be 1–5';
  end if;
  v_ref := public.next_ref('RSK');
  insert into public.risks(ref, entity_id, risk, category, likelihood, impact, mitigation, owner_name, state)
  values (v_ref, v_entity, p_risk, nullif(p_category,''), p_likelihood, p_impact, nullif(p_mitigation,''), nullif(p_owner,''), 'open');
  perform public.audit_write('risk.created', 'risk', v_ref,
    jsonb_build_object('risk', p_risk, 'likelihood', p_likelihood, 'impact', p_impact, 'owner', p_owner));
  return jsonb_build_object('ref', v_ref, 'risk', p_risk);
end $$;

-- policies: adding a version supersedes the prior active one for the same code
create or replace function public.add_policy(
  p_code text, p_title text, p_effective_from date, p_doc text
) returns jsonb language plpgsql security definer set search_path = public as $$
declare v_ver int;
begin
  perform public.assert_access('compliance', 2);
  select coalesce(max(version), 0) into v_ver from public.policies where code = p_code;
  update public.policies set state = 'superseded' where code = p_code and state = 'active';
  insert into public.policies(code, title, version, effective_from, doc, state)
  values (p_code, p_title, v_ver + 1, p_effective_from, nullif(p_doc,''), 'active');
  perform public.audit_write('policy.added', 'policy', p_code,
    jsonb_build_object('title', p_title, 'version', v_ver + 1));
  return jsonb_build_object('code', p_code, 'title', p_title, 'version', v_ver + 1);
end $$;

-- company documents: upsert by name (statutory docs are one-per-name with an expiry)
create or replace function public.add_company_document(
  p_name text, p_kind text, p_expires_on date, p_doc text
) returns jsonb language plpgsql security definer set search_path = public as $$
declare v_entity uuid := (select id from public.entities where code = 'KE');
begin
  perform public.assert_access('compliance', 2);
  insert into public.company_documents(entity_id, name, kind, expires_on, doc, state)
  values (v_entity, p_name, nullif(p_kind,''), p_expires_on, nullif(p_doc,''), 'active')
  on conflict (name) do update set
    kind = coalesce(nullif(excluded.kind,''), public.company_documents.kind),
    expires_on = excluded.expires_on,
    doc = coalesce(excluded.doc, public.company_documents.doc),
    updated_at = now();
  perform public.audit_write('company_document.added', 'company_document', p_name,
    jsonb_build_object('kind', p_kind, 'expiresOn', p_expires_on));
  return jsonb_build_object('name', p_name);
end $$;

-- contracts registry (governance home; also read by Procurement + CRM)
create or replace function public.add_contract(
  p_counterparty text, p_kind text, p_title text, p_detail text, p_expires_on date
) returns jsonb language plpgsql security definer set search_path = public as $$
declare v_entity uuid := (select id from public.entities where code = 'KE');
begin
  perform public.assert_access('compliance', 2);
  if p_kind not in ('vendor','funder','customer','partner') then
    raise exception 'Contract kind must be vendor, funder, customer or partner';
  end if;
  insert into public.contracts(entity_id, counterparty, kind, title, detail, expires_on,
                               vendor_id, state)
  values (v_entity, p_counterparty, p_kind, p_title, nullif(p_detail,''), p_expires_on,
          (select id from public.vendors where name = p_counterparty), 'active')
  on conflict (counterparty, title) do update set
    detail = coalesce(excluded.detail, public.contracts.detail),
    expires_on = excluded.expires_on,
    updated_at = now();
  perform public.audit_write('contract.added', 'contract', p_title,
    jsonb_build_object('counterparty', p_counterparty, 'kind', p_kind, 'expiresOn', p_expires_on));
  return jsonb_build_object('counterparty', p_counterparty, 'title', p_title);
end $$;

-- re-gate the existing obligation-filed RPC onto the new module
create or replace function public.mark_obligation_filed(p_obligation text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare o record; nxt date;
begin
  perform public.assert_access('compliance', 2);
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

-- ---------- seeds: reconcile to the intended demo content (idempotent) ----------
insert into public.policies(code, title, version, effective_from, state) values
  ('IGN-PROC-001', 'Procurement policy & SOP',            2, '2026-01-01', 'active'),
  ('IGN-FIN-001',  'Financial management manual',         1, '2025-07-01', 'active'),
  ('IGN-HR-001',   'HR policy & staff handbook',          1, '2025-07-01', 'active'),
  ('IGN-GOV-002',  'Code of Conduct',                     1, '2025-07-01', 'active'),
  ('IGN-GOV-004',  'Safeguarding / Child Protection',     1, '2024-10-01', 'active'),
  ('IGN-GOV-005',  'Data protection policy (Kenya DPA)',  1, '2025-10-01', 'active'),
  ('IGN-PROC-002', 'Anti-corruption & sanctions policy',  1, '2025-10-01', 'active')
on conflict (code, version) do nothing;

with ke as (select id from public.entities where code = 'KE')
insert into public.company_documents(entity_id, name, kind, expires_on)
select ke.id, v.name, v.kind, v.expires::date from ke, (values
  ('Certificate of incorporation', 'statutory', null),
  ('KRA PIN certificate',          'statutory', null),
  ('Tax Compliance Certificate',   'statutory', '2027-02-14'),
  ('CR12 (shareholding)',          'statutory', null),
  ('NSSF / SHIF registration',     'statutory', null),
  ('Single Business Permit',       'licence',   '2026-12-31'),
  ('Annual Returns (Registrar)',   'statutory', '2026-09-30'),
  ('EPRA licence — LPG handling',  'licence',   '2027-03-31')
) as v(name, kind, expires)
on conflict (name) do nothing;

with ke as (select id from public.entities where code = 'KE')
insert into public.risks(ref, entity_id, risk, category, likelihood, impact, mitigation, owner_name, state)
select v.ref, ke.id, v.risk, v.category, v.l, v.i, v.mitigation, v.owner, v.state from ke, (values
  ('RSK-105', 'Single-funder dependency (Wave 1)', 'Funding',  3, 5, 'Diversify pipeline — 7 funders live',        'Wilson',    'open'),
  ('RSK-106', 'FX exposure (USD / KES)',           'Market',   3, 3, 'Monthly revaluation; USD grant account',      'Dennis',    'open'),
  ('RSK-107', 'Field data quality',                'Delivery', 2, 3, 'Enumerator rubric + supervisor QA',           'Elizabeth', 'open'),
  ('RSK-108', 'Key-person dependency',             'People',   2, 3, 'Documented SOPs; cross-training',             'Dennis',    'open'),
  ('RSK-109', 'Carbon registry ambiguity',         'Delivery', 2, 3, 'MRV lineage; verifier engagement',            'Wanjiku',   'open')
) as v(ref, risk, category, l, i, mitigation, owner, state)
on conflict (ref) do nothing;

-- keep the RSK counter ahead of the seeded refs so create_risk doesn't collide
update public.ref_counters set n = greatest(n, 109) where kind = 'RSK';

-- ---------- bootstrap(): add compliance keys (policies/docs/obligations/risks/contracts) ----------
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
    -- ---- Compliance & Governance (new) ----
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
          'state', state,
          'statusCls', case state when 'active' then 'done' when 'renew_soon' then 'today'
                                  when 'expired' then 'over' else 'week' end,
          'statusTxt', case state when 'active' then 'Active' when 'renew_soon' then 'Renew soon'
                                  when 'expired' then 'Expired' else 'Terminated' end)
          order by expires_on nulls last, counterparty)
        from public.contracts where state <> 'terminated'), '[]'::jsonb))
  );
end $$;

-- ---------- grants: create RPCs are authenticated-only ----------
do $$
declare fn text;
begin
  foreach fn in array array[
    'create_risk(text,text,int,int,text,text)',
    'add_policy(text,text,date,text)',
    'add_company_document(text,text,date,text)',
    'add_contract(text,text,text,text,date)',
    'mark_obligation_filed(text)']
  loop
    execute format('revoke execute on function public.%s from public, anon', fn);
    execute format('grant execute on function public.%s to authenticated', fn);
  end loop;
end $$;
