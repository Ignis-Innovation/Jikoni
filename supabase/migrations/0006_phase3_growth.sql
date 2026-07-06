-- ============================================================
-- Jikoni Master PRD — Phase 3: Growth & delivery (CRM, Projects, Fundraise)
-- Normalized milestones/drawdowns (one source of truth; bootstrap rebuilds
-- the jsonb shapes the UI reads), field activity, engagement updates/tasks,
-- Raise pipeline (Discovery → Committed), term sheets reconciled to SIGNED
-- instruments vs the $3M target, data room with time-boxed logged access,
-- diligence (DDQ) tracker. Idempotent: safe to re-run.
-- ============================================================

-- ---------- projects: normalize milestones & drawdowns out of jsonb ----------
create table if not exists public.project_milestones (
  id         uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects(id) on delete cascade,
  title      text not null,
  status     text not null default 'todo' check (status in ('done','now','todo')),
  sort       int not null default 0,
  created_at timestamptz not null default now()
);

create table if not exists public.project_drawdowns (
  id         uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects(id) on delete cascade,
  title      text not null,
  amount_txt text not null,
  status     text not null default 'Requested',
  sort       int not null default 0,
  created_at timestamptz not null default now()
);

create table if not exists public.field_activities (
  id         uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects(id) on delete cascade,
  kind       text not null check (kind in ('site_visit','install','readiness_assessment')),
  county     text,
  note       text,
  activity_on date not null default current_date,
  created_at timestamptz not null default now()
);

-- migrate the seeded jsonb into rows once, then rows are the source of truth
do $$
declare p record; m jsonb; d jsonb; i int;
begin
  if not exists (select 1 from public.project_milestones) then
    for p in select * from public.projects loop
      i := 0;
      for m in select * from jsonb_array_elements(p.milestones) loop
        i := i + 1;
        insert into public.project_milestones(project_id, title, status, sort)
        values (p.id, m->>'t', m->>'s', i);
      end loop;
      i := 0;
      for d in select * from jsonb_array_elements(p.drawdowns) loop
        i := i + 1;
        insert into public.project_drawdowns(project_id, title, amount_txt, status, sort)
        values (p.id, d->>'t', d->>'v', d->>'s', i);
      end loop;
    end loop;
  end if;
end $$;

-- rebuild helpers so every reader sees one truth
create or replace function public.project_detail_json(p_id uuid) returns jsonb
language sql stable security definer set search_path = public as $$
  select jsonb_build_object(
    'funder', p.funder, 'status', p.status, 'budget', p.budget_txt, 'spent', p.spent_txt,
    'pct', p.pct, 'timeline', p.timeline, 'team', p.team, 'reporting', p.reporting, 'field', p.field,
    'docs', p.docs,
    'milestones', coalesce((select jsonb_agg(jsonb_build_object('t', title, 's', status) order by sort)
                            from public.project_milestones where project_id = p.id), '[]'::jsonb),
    'drawdowns',  coalesce((select jsonb_agg(jsonb_build_object('t', title, 'v', amount_txt, 's', status) order by sort)
                            from public.project_drawdowns where project_id = p.id), '[]'::jsonb))
  from public.projects p where p.id = p_id
$$;

-- ---------- CRM: engagement updates + linked tasks + docs (backing engDetails) ----------
create table if not exists public.engagement_updates (
  id            uuid primary key default gen_random_uuid(),
  engagement_id uuid not null references public.engagements(id) on delete cascade,
  channel       text not null default 'Email',
  who           text,
  note          text not null,
  happened      text,                          -- display string ('Today', '3 days ago' in demo)
  created_at    timestamptz not null default now()
);

create or replace function public.log_engagement_update(p_eng_ref text, p_channel text, p_note text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare e record; v_who text;
begin
  perform public.assert_access('crm', 2);
  select * into e from public.engagements where ref = p_eng_ref;
  if not found then raise exception 'Engagement % not found', p_eng_ref; end if;
  v_who := coalesce((select name from public.app_users where auth_id = auth.uid()), 'system');
  insert into public.engagement_updates(engagement_id, channel, who, note, happened)
  values (e.id, p_channel, v_who, p_note, 'Today');
  perform public.audit_write('engagement.updated','engagement', p_eng_ref,
    jsonb_build_object('channel', p_channel, 'note', p_note));
  return jsonb_build_object('eng', p_eng_ref, 'channel', p_channel, 'who', v_who);
end $$;

-- ---------- Fundraise (B6): pipeline → term sheets → data room → DDQ → close ----------
create table if not exists public.raise_pipeline (
  id         uuid primary key default gen_random_uuid(),
  entity_id  uuid references public.entities(id),
  funder     text not null unique,
  kind       text not null,                    -- Blended / Concessional debt / Equity / Grant / Programme
  stage      text not null default 'discovery'
             check (stage in ('discovery','materials','negotiation','term_sheet','committed','holding','passed')),
  amount_usd numeric not null default 0,
  owner_name text,
  note       text,
  state      text not null default 'active' check (state in ('active','won','lost')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.term_sheets (
  id          uuid primary key default gen_random_uuid(),
  ref         text not null unique,
  entity_id   uuid references public.entities(id),
  pipeline_id uuid not null references public.raise_pipeline(id),
  amount_usd  numeric not null check (amount_usd > 0),
  instrument  text not null check (instrument in ('equity','concessional','grant','blended')),
  state       text not null default 'draft' check (state in ('draft','issued','signed','lapsed')),
  signed_on   date,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

create table if not exists public.dataroom_grants (
  id         uuid primary key default gen_random_uuid(),
  entity_id  uuid references public.entities(id),
  grantee    text not null,                    -- funder / email
  expires_at timestamptz not null,             -- time-boxed
  state      text not null default 'active' check (state in ('active','revoked','expired')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.dataroom_access_log (
  id         bigint generated always as identity primary key,
  grant_id   uuid references public.dataroom_grants(id),
  grantee    text not null,
  document   text not null,                    -- every document open is logged
  opened_at  timestamptz not null default now()
);

create table if not exists public.diligence_requests (
  id          uuid primary key default gen_random_uuid(),
  ref         text not null unique,
  entity_id   uuid references public.entities(id),
  pipeline_id uuid references public.raise_pipeline(id),
  item        text not null,
  state       text not null default 'open' check (state in ('open','provided','closed')),
  due_on      date,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

-- ---------- transitions + counters ----------
insert into public.record_transitions(record_type, from_state, to_state) values
  ('pipeline','active','won'), ('pipeline','active','lost'),
  ('term_sheet','draft','issued'), ('term_sheet','issued','signed'), ('term_sheet','issued','lapsed'),
  ('dataroom_grant','active','revoked'), ('dataroom_grant','active','expired'),
  ('ddq','open','provided'), ('ddq','provided','closed'), ('ddq','open','closed')
on conflict do nothing;

do $$
declare r record;
begin
  for r in select * from (values
    ('raise_pipeline','pipeline'), ('term_sheets','term_sheet'),
    ('dataroom_grants','dataroom_grant'), ('diligence_requests','ddq')
  ) as t(tbl, rtype)
  loop
    execute format('drop trigger if exists state_machine on public.%I', r.tbl);
    execute format('create trigger state_machine before update of state on public.%I
                    for each row execute function public.enforce_state_machine(%L)', r.tbl, r.rtype);
  end loop;
end $$;

insert into public.ref_counters(kind, prefix, n) values
  ('TS',  'TS-',  100),
  ('DDQ', 'DDQ-', 100)
on conflict (kind) do nothing;

insert into public.app_config(key, value) values
  ('raise_target_usd', '3000000'::jsonb)
on conflict (key) do nothing;

-- ---------- engines ----------
-- Committed total reconciles to SIGNED instruments, not pipeline optimism
create or replace function public.raise_summary() returns jsonb
language sql stable security definer set search_path = public as $$
  select jsonb_build_object(
    'targetUsd', (select value::numeric from public.app_config where key = 'raise_target_usd'),
    'committedUsd', coalesce((select sum(amount_usd) from public.term_sheets where state = 'signed'), 0),
    'equityUsd', coalesce((select sum(amount_usd) from public.term_sheets where state = 'signed' and instrument = 'equity'), 0),
    'concessionalUsd', coalesce((select sum(amount_usd) from public.term_sheets
                                 where state = 'signed' and instrument in ('concessional','grant','blended')), 0),
    'inNegotiationUsd', coalesce((select sum(amount_usd) from public.raise_pipeline
                                  where stage in ('negotiation','term_sheet') and state = 'active'), 0))
$$;

create or replace function public.issue_term_sheet(p_funder text, p_amount_usd numeric, p_instrument text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare pl record; v_ref text;
  v_entity uuid := (select id from public.entities where code = 'KE');
begin
  perform public.assert_access('raise', 2);
  select * into pl from public.raise_pipeline where funder = p_funder;
  if not found then raise exception 'Funder % is not in the pipeline', p_funder; end if;
  v_ref := public.next_ref('TS');
  insert into public.term_sheets(ref, entity_id, pipeline_id, amount_usd, instrument, state)
  values (v_ref, v_entity, pl.id, p_amount_usd, p_instrument, 'issued');
  update public.raise_pipeline set stage = 'term_sheet' where id = pl.id and stage <> 'committed';
  perform public.audit_write('term_sheet.issued','term_sheet', v_ref,
    jsonb_build_object('funder', p_funder, 'amountUsd', p_amount_usd, 'instrument', p_instrument));
  return jsonb_build_object('id', v_ref, 'funder', p_funder);
end $$;

create or replace function public.sign_term_sheet(p_ref text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare ts record; pl record;
begin
  perform public.assert_access('raise', 3);
  select * into ts from public.term_sheets where ref = p_ref;
  if not found then raise exception 'Term sheet % not found', p_ref; end if;
  update public.term_sheets set state = 'signed', signed_on = current_date where id = ts.id;
  select * into pl from public.raise_pipeline where id = ts.pipeline_id;
  update public.raise_pipeline set stage = 'committed', state = 'won' where id = pl.id and state = 'active';
  perform public.audit_write('term_sheet.signed','term_sheet', p_ref,
    jsonb_build_object('funder', pl.funder, 'amountUsd', ts.amount_usd) || public.raise_summary());
  return public.raise_summary() || jsonb_build_object('id', p_ref);
end $$;

-- Data room: grant is time-boxed; every open is logged (and gate-checked)
create or replace function public.grant_dataroom(p_grantee text, p_days int default 14)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_id uuid;
  v_entity uuid := (select id from public.entities where code = 'KE');
begin
  perform public.assert_access('dataroom', 3);
  insert into public.dataroom_grants(entity_id, grantee, expires_at)
  values (v_entity, p_grantee, now() + make_interval(days => p_days)) returning id into v_id;
  perform public.audit_write('dataroom.granted','dataroom_grant', p_grantee,
    jsonb_build_object('days', p_days));
  return jsonb_build_object('grantee', p_grantee, 'expiresInDays', p_days);
end $$;

create or replace function public.log_dataroom_open(p_grantee text, p_document text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare g record;
begin
  select * into g from public.dataroom_grants
  where grantee = p_grantee and state = 'active' order by created_at desc limit 1;
  if not found then raise exception 'No data-room access for %', p_grantee; end if;
  if g.expires_at < now() then
    update public.dataroom_grants set state = 'expired' where id = g.id;
    raise exception 'Data-room access for % expired %', p_grantee, g.expires_at::date;
  end if;
  insert into public.dataroom_access_log(grant_id, grantee, document) values (g.id, p_grantee, p_document);
  perform public.audit_write('dataroom.opened','dataroom_grant', p_grantee,
    jsonb_build_object('document', p_document));
  return jsonb_build_object('grantee', p_grantee, 'document', p_document);
end $$;

-- ---------- seeds: pipeline from the funders board ----------
with ke as (select id from public.entities where code = 'KE')
insert into public.raise_pipeline(entity_id, funder, kind, stage, amount_usd, owner_name, note)
select ke.id, v.* from ke, (values
  ('Charm Impact',   'Blended',           'term_sheet',  500000, 'Wilson', 'Term sheet received; reviewing terms'),
  ('EAIF',           'Concessional debt', 'negotiation', 800000, 'Wilson', 'Concessional call scheduled'),
  ('KIICO',          'Equity',            'materials',   550000, 'Wilson', null),
  ('RPFF / AfDB',    'Concessional',      'discovery',   500000, 'Wilson', null),
  ('FCDO',           'Grant / TA',        'discovery',   350000, 'Wilson', null),
  ('Signum Capital', 'Equity',            'holding',          0, 'Wilson', 'Wants an anchor investor first'),
  ('UNDP / WAIIS',   'Programme',         'discovery',   300000, 'Wilson', null)
) as v(funder, kind, stage, amount_usd, owner_name, note)
on conflict (funder) do nothing;

with ke as (select id from public.entities where code = 'KE')
insert into public.diligence_requests(ref, entity_id, pipeline_id, item, state, due_on)
select v.ref, ke.id, p.id, v.item, v.state, v.due::date
from ke, (values
  ('DDQ-101', 'Charm Impact', 'Audited accounts FY2025',        'provided', '2026-06-20'),
  ('DDQ-102', 'Charm Impact', 'Cap table + shareholder deeds',  'open',     '2026-07-15'),
  ('DDQ-103', 'EAIF',         'ESG & safeguarding policy',      'open',     '2026-07-30')
) as v(ref, funder, item, state, due)
join public.raise_pipeline p on p.funder = v.funder
on conflict (ref) do nothing;

-- ---------- keep create_project_from_eng writing normalized rows ----------
create or replace function public.create_project_from_eng(p_eng_ref text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  e record; v_name text; p record;
  v_entity uuid := (select id from public.entities where code = 'KE');
  created boolean := false;
begin
  perform public.assert_access('projects', 2);
  select * into e from public.engagements where ref = p_eng_ref;
  if not found then raise exception 'Engagement % not found', p_eng_ref; end if;
  v_name := regexp_replace(e.name, ' \(.*\)', '') || ' — deployment';
  select * into p from public.projects where name = v_name;
  if not found then
    insert into public.projects(entity_id, name, funder, status, team, is_extra, docs)
    values (v_entity, v_name, e.name, 'Setup', e.owner_name, true,
            jsonb_build_array('Signed agreement (from ' || p_eng_ref || ')'))
    returning * into p;
    insert into public.project_milestones(project_id, title, status, sort) values
      (p.id, 'Project set up from won deal', 'done', 1),
      (p.id, 'Budget & funder agreement',    'now',  2),
      (p.id, 'Deployment',                   'todo', 3);
    insert into public.eng_project_links(eng_ref, project_name, is_primary)
    values (p_eng_ref, v_name, true)
    on conflict (eng_ref) do update set project_name = excluded.project_name;
    if e.state = 'active' then
      update public.engagements set state = 'won' where id = e.id;
    end if;
    created := true;
    perform public.audit_write('project.created_from_eng','project', v_name,
      jsonb_build_object('engagement', p_eng_ref, 'funder', e.name));
  end if;
  return jsonb_build_object('name', v_name, 'funder', e.name, 'created', created,
    'detail', public.project_detail_json(p.id));
end $$;

-- bootstrap: projects now come from the normalized rows
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
        from public.assets), '[]'::jsonb))
  );
end $$;

-- ---------- RLS + grants ----------
do $$
declare t text;
begin
  foreach t in array array['project_milestones','project_drawdowns','field_activities',
    'engagement_updates','raise_pipeline','term_sheets','dataroom_grants',
    'dataroom_access_log','diligence_requests']
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
    'log_engagement_update(text,text,text)','raise_summary()',
    'issue_term_sheet(text,numeric,text)','sign_term_sheet(text)',
    'grant_dataroom(text,int)','log_dataroom_open(text,text)']
  loop
    execute format('revoke execute on function public.%s from public, anon', fn);
    execute format('grant execute on function public.%s to authenticated', fn);
  end loop;
end $$;
