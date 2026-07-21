-- ============================================================
-- Jikoni — Phase CRM Forms: Partners, Opportunities, create-
-- engagement/partner/opportunity RPCs, extensible dropdowns,
-- and an updated bootstrap() that returns live CRM data.
-- Idempotent: safe to re-run.
-- ============================================================

-- ---------- ref counters for ENG / DST (start after the highest seeded ref) ----------
insert into public.ref_counters(kind, prefix, n) values
  ('ENG', 'ENG-', 30),
  ('DST', 'DST-', 19)
on conflict (kind) do nothing;

-- ---------- extensible dropdown options for CRM forms ----------
create table if not exists public.crm_dropdown_options (
  id         uuid primary key default gen_random_uuid(),
  category   text not null,       -- 'eng_stage_up', 'eng_stage_down', 'partner_type', 'partner_status', 'opp_type', 'opp_status'
  value      text not null,
  sort       int not null default 0,
  active     boolean not null default true,
  created_at timestamptz not null default now(),
  unique (category, value)
);

insert into public.crm_dropdown_options(category, value, sort) values
  -- upstream engagement stages
  ('eng_stage_up', 'Discovery',    1),
  ('eng_stage_up', 'Materials',    2),
  ('eng_stage_up', 'Negotiation',  3),
  ('eng_stage_up', 'Term sheet',   4),
  ('eng_stage_up', 'Close',        5),
  -- downstream engagement stages
  ('eng_stage_down', 'Identification', 1),
  ('eng_stage_down', 'EOI',            2),
  ('eng_stage_down', 'Site visit',     3),
  ('eng_stage_down', 'Contracting',    4),
  ('eng_stage_down', 'Deployed',       5),
  -- partner types
  ('partner_type', 'Blended funder',  1),
  ('partner_type', 'Concessional debt', 2),
  ('partner_type', 'Equity investor',  3),
  ('partner_type', 'Institution',      4),
  ('partner_type', 'Manufacturer',     5),
  ('partner_type', 'Programme / TA',   6),
  ('partner_type', 'TA / convener',    7),
  ('partner_type', 'Lender',           8),
  ('partner_type', 'Distributor / EPC',9),
  ('partner_type', 'Government',       10),
  -- partner statuses
  ('partner_status', 'Discovery',      1),
  ('partner_status', 'Materials',      2),
  ('partner_status', 'Negotiation',    3),
  ('partner_status', 'Term sheet',     4),
  ('partner_status', 'EOI',            5),
  ('partner_status', 'Site visit',     6),
  ('partner_status', 'Contracting',    7),
  ('partner_status', 'Ready to fund',  8),
  ('partner_status', 'Active',         9),
  ('partner_status', 'Holding',        10),
  -- opportunity types
  ('opp_type', 'Convening',       1),
  ('opp_type', 'Accelerator',     2),
  ('opp_type', 'Grant / TA',      3),
  ('opp_type', 'Climate finance',  4),
  ('opp_type', 'Tender',          5),
  ('opp_type', 'RFP',             6),
  -- opportunity statuses
  ('opp_status', 'On track',      1),
  ('opp_status', 'Applying',      2),
  ('opp_status', 'Discovery',     3),
  ('opp_status', 'Watching',      4),
  ('opp_status', 'Preparing',     5),
  ('opp_status', 'Won',           6),
  ('opp_status', 'Closed',        7)
on conflict (category, value) do nothing;

-- ---------- partners table ----------
create table if not exists public.partners (
  id         uuid primary key default gen_random_uuid(),
  entity_id  uuid references public.entities(id),
  name       text not null,
  type       text,
  country    text default 'KE',
  owner_name text,
  status     text,
  status_cls text default 'week',
  state      text not null default 'active'
             check (state in ('active','inactive','archived')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- ---------- opportunities table ----------
create table if not exists public.opportunities (
  id         uuid primary key default gen_random_uuid(),
  entity_id  uuid references public.entities(id),
  name       text not null,
  type       text,
  deadline   text,
  linked_to  text,
  status     text,
  status_cls text default 'week',
  state      text not null default 'active'
             check (state in ('active','won','closed')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- triggers
do $$
begin
  if not exists (select 1 from pg_trigger where tgname = 'touch_partners') then
    create trigger touch_partners before update on public.partners
      for each row execute function public.touch_updated_at();
  end if;
  if not exists (select 1 from pg_trigger where tgname = 'touch_opportunities') then
    create trigger touch_opportunities before update on public.opportunities
      for each row execute function public.touch_updated_at();
  end if;
end $$;

-- ---------- state machines ----------
insert into public.record_transitions(record_type, from_state, to_state) values
  ('partner', 'active', 'inactive'),
  ('partner', 'active', 'archived'),
  ('partner', 'inactive', 'active'),
  ('opportunity', 'active', 'won'),
  ('opportunity', 'active', 'closed')
on conflict do nothing;

-- ---------- seed existing hardcoded partners ----------
do $$
declare v_entity uuid := (select id from public.entities where code = 'KE');
begin
  if not exists (select 1 from public.partners) then
    insert into public.partners(entity_id, name, type, country, owner_name, status, status_cls) values
      (v_entity, 'Charm Impact',             'Blended funder',   'UK / KE', 'Wilson',    'Term sheet',   'week'),
      (v_entity, 'EAIF',                     'Concessional debt', 'UK',      'Wilson',    'Negotiation',  'today'),
      (v_entity, 'KIICO',                    'Equity investor',   'KE',      'Wilson',    'Materials',    'today'),
      (v_entity, 'Signum Capital',           'Equity investor',   'SG',      'Wilson',    'Holding',      'over'),
      (v_entity, 'UNDP / WAIIS',            'Programme / TA',    'KE',      'Wilson',    'Discovery',    'week'),
      (v_entity, 'Stanbic Bank',            'Lender',            'UG',      'Wilson',    'Ready to fund', 'done'),
      (v_entity, 'Makueni County VTCs',     'Institution',       'KE',      'Elizabeth', 'Contracting',  'today'),
      (v_entity, 'Catholic Diocese — Machakos', 'Institution',   'KE',      'Elizabeth', 'EOI',          'week'),
      (v_entity, 'BURN Manufacturing',      'Manufacturer',      'KE',      'Elizabeth', 'Active',       'done'),
      (v_entity, 'CLASP',                   'TA / convener',     'Global',  'Elizabeth', 'Site visit',   'week');
  end if;
end $$;

-- ---------- seed existing hardcoded opportunities ----------
do $$
declare v_entity uuid := (select id from public.entities where code = 'KE');
begin
  if not exists (select 1 from public.opportunities) then
    insert into public.opportunities(entity_id, name, type, deadline, linked_to, status, status_cls) values
      (v_entity, 'Africa Clean Cooking Summit', 'Convening',      '9–10 Jul',  'Multiple',       'On track',  'done'),
      (v_entity, 'Accelerate Africa cohort',    'Accelerator',    'Rolling',   'Concept note',   'Applying',  'today'),
      (v_entity, 'FCDO Uganda window',          'Grant / TA',     'Q3',        'ENG (FCDO)',      'Discovery', 'week'),
      (v_entity, 'Carbon finance window',       'Climate finance', 'Q4',        'MRV readiness',  'Watching',  'week'),
      (v_entity, 'County institutional RFP',    'Tender',         'Aug',       'Downstream',     'Preparing', 'week');
  end if;
end $$;

-- ---------- RPC: create engagement ----------
create or replace function public.create_engagement(
  p_name text, p_stage text, p_owner_name text, p_pipeline text,
  p_next_action text default null, p_due_key text default 'week'
) returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_ref text; v_pill text; v_pill_txt text;
  v_entity uuid := (select id from public.entities where code = 'KE');
begin
  perform public.assert_access('crm', 2);
  v_ref := public.next_ref(case when p_pipeline = 'down' then 'DST' else 'ENG' end);
  select case p_due_key when 'today' then 'today' when 'over' then 'over' else 'week' end,
         case p_due_key when 'today' then 'Today' when 'over' then 'Overdue' when 'nweek' then 'Next week' else 'This week' end
    into v_pill, v_pill_txt;
  insert into public.engagements(ref, entity_id, name, stage, owner_name, pill, pill_txt, pipeline)
  values (v_ref, v_entity, p_name, p_stage, p_owner_name, v_pill, v_pill_txt, p_pipeline);
  perform public.audit_write('engagement.created', 'engagement', v_ref,
    jsonb_build_object('name', p_name, 'stage', p_stage, 'owner', p_owner_name, 'pipeline', p_pipeline));
  return jsonb_build_object(
    'id', v_ref, 'n', p_name, 'st', p_stage, 'o', p_owner_name,
    'pl', v_pill, 'plt', v_pill_txt, 'pipeline', p_pipeline);
end $$;

-- ---------- RPC: create partner ----------
create or replace function public.create_partner(
  p_name text, p_type text, p_country text, p_owner_name text, p_status text
) returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_entity uuid := (select id from public.entities where code = 'KE');
  v_cls text;
  v_id uuid;
begin
  perform public.assert_access('crm', 2);
  v_cls := case p_status
    when 'Active'        then 'done'
    when 'Ready to fund' then 'done'
    when 'Holding'       then 'over'
    when 'Negotiation'   then 'today'
    when 'Materials'     then 'today'
    when 'Contracting'   then 'today'
    else 'week' end;
  insert into public.partners(entity_id, name, type, country, owner_name, status, status_cls)
  values (v_entity, p_name, p_type, p_country, p_owner_name, p_status, v_cls)
  returning id into v_id;
  perform public.audit_write('partner.created', 'partner', p_name,
    jsonb_build_object('type', p_type, 'country', p_country, 'owner', p_owner_name, 'status', p_status));
  return jsonb_build_object(
    'id', v_id, 'name', p_name, 'type', p_type, 'country', p_country,
    'ownerName', p_owner_name, 'status', p_status, 'statusCls', v_cls);
end $$;

-- ---------- RPC: create opportunity ----------
create or replace function public.create_opportunity(
  p_name text, p_type text, p_deadline text, p_linked_to text, p_status text
) returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_entity uuid := (select id from public.entities where code = 'KE');
  v_cls text;
  v_id uuid;
begin
  perform public.assert_access('crm', 2);
  v_cls := case p_status
    when 'On track' then 'done'
    when 'Applying' then 'today'
    when 'Won'      then 'done'
    when 'Closed'   then 'over'
    else 'week' end;
  insert into public.opportunities(entity_id, name, type, deadline, linked_to, status, status_cls)
  values (v_entity, p_name, p_type, p_deadline, p_linked_to, p_status, v_cls)
  returning id into v_id;
  perform public.audit_write('opportunity.created', 'opportunity', p_name,
    jsonb_build_object('type', p_type, 'deadline', p_deadline, 'linked', p_linked_to, 'status', p_status));
  return jsonb_build_object(
    'id', v_id, 'name', p_name, 'type', p_type, 'deadline', p_deadline,
    'linkedTo', p_linked_to, 'status', p_status, 'statusCls', v_cls);
end $$;

-- ---------- updated bootstrap() — adds engagements, partners, opportunities, team ----------
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
    -- ---- CRM forms data (new) ----
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
    'teamNames', coalesce((select jsonb_agg(name order by name) from public.app_users where state = 'active'), '[]'::jsonb)
  );
end $$;

-- ---------- RLS + grants ----------
do $$
declare t text;
begin
  foreach t in array array['partners', 'opportunities', 'crm_dropdown_options']
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
    'create_engagement(text,text,text,text,text,text)',
    'create_partner(text,text,text,text,text)',
    'create_opportunity(text,text,text,text,text)']
  loop
    execute format('revoke execute on function public.%s from public, anon', fn);
    execute format('grant execute on function public.%s to authenticated', fn);
  end loop;
end $$;
