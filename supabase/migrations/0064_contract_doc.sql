-- ============================================================
-- 0064 — Contracts can carry an uploaded document
-- Policies and company documents already attach a file (compliance-docs bucket). This
-- adds the same to the contracts registry: a nullable doc path, an add_contract that
-- accepts it, and bootstrap()'s contracts feed returns it so the app can render a
-- download link. bootstrap() is recreated verbatim from 0023 with only 'doc' added to
-- the contracts object (0023 is the last migration to define it). Idempotent.
-- ============================================================

alter table public.contracts add column if not exists doc text;

-- add_contract now takes p_doc (nullable). Same body as 0023 plus the doc column.
create or replace function public.add_contract(
  p_counterparty text, p_kind text, p_title text, p_detail text, p_expires_on date,
  p_doc text default null
) returns jsonb language plpgsql security definer set search_path = public as $$
declare v_entity uuid := (select id from public.entities where code = 'KE');
begin
  perform public.assert_access('compliance', 2);
  if p_kind not in ('vendor','funder','customer','partner') then
    raise exception 'Contract kind must be vendor, funder, customer or partner';
  end if;
  insert into public.contracts(entity_id, counterparty, kind, title, detail, expires_on,
                               doc, vendor_id, state)
  values (v_entity, p_counterparty, p_kind, p_title, nullif(p_detail,''), p_expires_on,
          p_doc, (select id from public.vendors where name = p_counterparty), 'active')
  on conflict (counterparty, title) do update set
    detail = coalesce(excluded.detail, public.contracts.detail),
    expires_on = excluded.expires_on,
    doc = coalesce(excluded.doc, public.contracts.doc),
    updated_at = now();
  perform public.audit_write('contract.added', 'contract', p_title,
    jsonb_build_object('counterparty', p_counterparty, 'kind', p_kind, 'expiresOn', p_expires_on));
  return jsonb_build_object('counterparty', p_counterparty, 'title', p_title);
end $$;

-- grant the new add_contract signature to authenticated (mirror 0023)
do $$
begin
  execute 'revoke execute on function public.add_contract(text,text,text,text,date,text) from public, anon';
  execute 'grant execute on function public.add_contract(text,text,text,text,date,text) to authenticated';
end $$;

-- bootstrap(): recreated verbatim from 0023, with 'doc', doc added to the contracts object
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
