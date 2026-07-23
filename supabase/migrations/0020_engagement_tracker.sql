-- ============================================================
-- Jikoni — Partnerships CRM: DB-backed engagement progress tracker
-- The engagement detail drawer was static mock data. This makes the two
-- interactive parts persistent so the owner/CEO can open a record and see the
-- real, saved progress of the conversation:
--   * engagement_notes     — the Updates log (channel/who/note + stage move)
--   * engagement_partners  — which partners an engagement involves (many)
--   * log_engagement_note()      — append a note, optionally advance the stage
--   * set_engagement_partners()  — replace the linked-partner set
-- Seeds the existing hardcoded updates so the log isn't empty on first load, and
-- extends bootstrap() to return per-engagement updates + an engPartners map.
-- Idempotent: safe to re-run.
-- ============================================================

-- ---------- tables ----------
create table if not exists public.engagement_notes (
  id            uuid primary key default gen_random_uuid(),
  engagement_id uuid not null references public.engagements(id) on delete cascade,
  channel       text,
  who           text,
  note          text not null,
  stage_from    text,
  stage_to      text,
  created_at    timestamptz not null default now()
);
create index if not exists engagement_notes_eng_idx on public.engagement_notes(engagement_id, created_at desc);

create table if not exists public.engagement_partners (
  engagement_id uuid not null references public.engagements(id) on delete cascade,
  partner_id    uuid not null references public.partners(id) on delete cascade,
  created_at    timestamptz not null default now(),
  primary key (engagement_id, partner_id)
);

-- ---------- RLS: read for signed-in users; writes only via definer RPCs ----------
do $$
declare t text;
begin
  foreach t in array array['engagement_notes', 'engagement_partners']
  loop
    execute format('alter table public.%I enable row level security', t);
    execute format('drop policy if exists "read for authenticated" on public.%I', t);
    execute format('create policy "read for authenticated" on public.%I for select to authenticated using (true)', t);
  end loop;
end $$;

-- ---------- RPC: log an update (diary note + optional stage move) ----------
create or replace function public.log_engagement_note(
  p_eng_ref text, p_channel text, p_who text, p_note text, p_stage_to text default null
) returns jsonb language plpgsql security definer set search_path = public as $$
declare
  e public.engagements;
  v_id uuid; v_stage_to text := nullif(trim(coalesce(p_stage_to, '')), '');
begin
  perform public.assert_access('crm', 2);
  select * into e from public.engagements where ref = p_eng_ref;
  if not found then raise exception 'Unknown engagement: %', p_eng_ref; end if;
  if nullif(trim(coalesce(p_note, '')), '') is null then raise exception 'An update needs a note'; end if;

  insert into public.engagement_notes(engagement_id, channel, who, note, stage_from, stage_to)
  values (e.id, nullif(trim(coalesce(p_channel,'')),''), nullif(trim(coalesce(p_who,'')),''),
          trim(p_note), e.stage, v_stage_to)
  returning id into v_id;

  -- advance the engagement's stage when the update moves it
  if v_stage_to is not null and v_stage_to is distinct from e.stage then
    update public.engagements set stage = v_stage_to, updated_at = now() where id = e.id;
  end if;

  perform public.audit_write('crm.engagement_note', 'engagement', p_eng_ref,
    jsonb_build_object('channel', p_channel, 'who', p_who, 'from', e.stage, 'to', v_stage_to));
  return jsonb_build_object('id', v_id, 'ref', p_eng_ref, 'stage', coalesce(v_stage_to, e.stage));
end $$;

-- ---------- RPC: set the linked partners (replace the whole set) ----------
create or replace function public.set_engagement_partners(p_eng_ref text, p_partner_ids uuid[])
returns jsonb language plpgsql security definer set search_path = public as $$
declare e_id uuid;
begin
  perform public.assert_access('crm', 2);
  select id into e_id from public.engagements where ref = p_eng_ref;
  if e_id is null then raise exception 'Unknown engagement: %', p_eng_ref; end if;

  delete from public.engagement_partners where engagement_id = e_id;
  insert into public.engagement_partners(engagement_id, partner_id)
  select e_id, pid from unnest(coalesce(p_partner_ids, '{}'::uuid[])) as pid
  where exists (select 1 from public.partners where id = pid)
  on conflict do nothing;

  perform public.audit_write('crm.engagement_partners', 'engagement', p_eng_ref,
    jsonb_build_object('count', coalesce(array_length(p_partner_ids, 1), 0)));
  return jsonb_build_object('ref', p_eng_ref, 'count', coalesce(array_length(p_partner_ids, 1), 0));
end $$;

-- ---------- seed the existing hardcoded updates (from data.ts engDetails) ----------
insert into public.engagement_notes(engagement_id, channel, who, note, created_at)
select e.id, v.channel, v.who, v.note, now() - v.ago
from public.engagements e
join (values
  ('ENG-002', 'Email',   'Wilson',    'Chased DSA signature; dataset ready to share on confirmation.', interval '0 day'),
  ('ENG-002', 'Call',    'Wilson',    'Agreed scope of the data exchange ahead of the summit.',        interval '3 day'),
  ('ENG-008', 'Meeting', 'Wilson',    'Discussed concessional terms; follow-up call scheduled.',       interval '2 day'),
  ('ENG-012', 'Call',    'Wilson',    'Term sheet received; reviewing repayment and milestone conditions.', interval '0 day'),
  ('ENG-012', 'Email',   'Wilson',    'Shared the updated model and pipeline.',                        interval '7 day'),
  ('ENG-019', 'Email',   'Wilson',    'Sent intro deck; awaiting response.',                           interval '16 day'),
  ('ENG-026', 'Call',    'Wilson',    'Discussed Ethiopia collaboration; brief requested.',            interval '5 day'),
  ('DST-004', 'Email',   'Elizabeth', '22 of 63 institutions now registered on the platform.',         interval '1 day'),
  ('DST-004', 'Field',   'Elizabeth', 'Onboarding workshop held with the county.',                     interval '7 day'),
  ('DST-011', 'Field',   'Elizabeth', 'EOI signed by the diocese.',                                    interval '3 day'),
  ('DST-018', 'Call',    'Elizabeth', 'Tentative site-visit window agreed; not yet confirmed.',        interval '16 day')
) as v(ref, channel, who, note, ago) on v.ref = e.ref
where not exists (select 1 from public.engagement_notes);

-- ---------- updated bootstrap(): per-engagement updates + engPartners map ----------
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
          'id', ref, 'n', name, 'st', stage, 'o', owner_name, 'pl', pill, 'plt', pill_txt,
          'updates', coalesce((select jsonb_agg(jsonb_build_object(
              'ts', n.created_at, 'd', to_char(n.created_at, 'DD Mon'), 'ch', n.channel, 'who', n.who, 'note', n.note)
              order by n.created_at desc)
            from public.engagement_notes n where n.engagement_id = engagements.id), '[]'::jsonb))
          order by created_at desc)
        from public.engagements where pipeline = 'up' and state = 'active'), '[]'::jsonb),
      'down', coalesce((select jsonb_agg(jsonb_build_object(
          'id', ref, 'n', name, 'st', stage, 'o', owner_name, 'pl', pill, 'plt', pill_txt,
          'updates', coalesce((select jsonb_agg(jsonb_build_object(
              'ts', n.created_at, 'd', to_char(n.created_at, 'DD Mon'), 'ch', n.channel, 'who', n.who, 'note', n.note)
              order by n.created_at desc)
            from public.engagement_notes n where n.engagement_id = engagements.id), '[]'::jsonb))
          order by created_at desc)
        from public.engagements where pipeline = 'down' and state = 'active'), '[]'::jsonb)),
    'engPartners', coalesce((select jsonb_object_agg(ref, pids) from (
        select e.ref, jsonb_agg(ep.partner_id order by ep.created_at) as pids
        from public.engagements e
        join public.engagement_partners ep on ep.engagement_id = e.id
        group by e.ref) q), '{}'::jsonb),
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

-- ---------- grants: authenticated only, never public/anon ----------
do $$
declare fn text;
begin
  foreach fn in array array[
    'log_engagement_note(text,text,text,text,text)',
    'set_engagement_partners(text,uuid[])']
  loop
    execute format('revoke execute on function public.%s from public, anon', fn);
    execute format('grant execute on function public.%s to authenticated', fn);
  end loop;
end $$;
