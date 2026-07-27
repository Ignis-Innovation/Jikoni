-- ============================================================
-- Jikoni — Appraisals: independent self vs manager ratings
-- Until now HR (toggle_appraisal_kpi) and the employee
-- (self_assess_kpi) flipped the SAME kpis[].met flag, so the two
-- "independent" assessments overwrote each other. This migration
-- splits them:
--   * kpis[]        → [{k, met, self_met}]  met = manager, self_met = employee
--   * self_assess_kpi now flips self_met
--   * set_appraisal_kpis lets HR agree a custom KPI list while a
--     review is still not_started (locks when self-assessment opens)
--   * start_appraisal_cycle seeds self_met on the default template
-- toggle_appraisal_kpi / advance_appraisal / submit_self_assessment
-- are unchanged on purpose (manager may rate any time before
-- sign-off; submitting an all-✗ self-assessment is legitimate).
-- Idempotent: safe to re-run.
-- ============================================================

-- ---------- backfill: give every existing kpi element a self_met ----------
-- Copy met → self_met where the key is missing. Signed-off history must show
-- the same outcome on both sides; in-flight rows get a forgiving baseline the
-- manager can adjust before sign-off.
update public.appraisals a
set kpis = coalesce((
      select jsonb_agg(e || jsonb_build_object('self_met',
               coalesce((e->>'self_met')::boolean, (e->>'met')::boolean, false))
             order by ord)
      from jsonb_array_elements(a.kpis) with ordinality as t(e, ord)
    ), '[]'::jsonb),
    updated_at = now()
where exists (select 1 from jsonb_array_elements(a.kpis) e where not (e ? 'self_met'));

-- ---------- my appraisal: self-rating now writes self_met ----------
create or replace function public.self_assess_kpi(p_id uuid, p_idx int)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_me uuid := (select id from public.app_users where auth_id = auth.uid());
  a record; v jsonb;
begin
  if v_me is null then raise exception 'No staff record is linked to this login'; end if;
  select * into a from public.appraisals where id = p_id;
  if not found then raise exception 'Appraisal not found'; end if;
  if a.app_user_id <> v_me then raise exception 'This is not your review'; end if;
  if a.stage not in ('not_started','self') then
    raise exception 'Self-assessment is closed — the review is with your manager';
  end if;
  if p_idx < 0 or p_idx >= jsonb_array_length(a.kpis) then raise exception 'No KPI at position %', p_idx; end if;
  v := jsonb_set(a.kpis, array[p_idx::text, 'self_met'],
         to_jsonb(not coalesce((a.kpis -> p_idx ->> 'self_met')::boolean, false)));
  update public.appraisals set kpis = v, stage = 'self', updated_at = now() where id = p_id;
  return jsonb_build_object('id', p_id, 'kpis', v, 'stage', 'self');
end $$;

-- ---------- HR: agree the KPI list before self-assessment opens ----------
-- Whole-list replace; ratings reset to false (nothing real exists yet at
-- not_started). Locks the moment the employee starts rating, because
-- self_assess_kpi moves the stage to 'self' on their first click.
create or replace function public.set_appraisal_kpis(p_id uuid, p_kpis jsonb)
returns jsonb language plpgsql security definer set search_path = public as $$
declare a record; v jsonb; v_distinct int;
begin
  perform public.assert_access('hr', 2);
  select ap.*, u.name as who into a from public.appraisals ap
    join public.app_users u on u.id = ap.app_user_id where ap.id = p_id;
  if not found then raise exception 'Appraisal not found'; end if;
  if a.stage <> 'not_started' then
    raise exception 'KPIs lock once self-assessment opens';
  end if;
  if p_kpis is null or jsonb_typeof(p_kpis) <> 'array' or jsonb_array_length(p_kpis) = 0 then
    raise exception 'A review needs at least one KPI';
  end if;
  if jsonb_array_length(p_kpis) > 12 then raise exception 'Keep it under 12 KPIs'; end if;
  select coalesce(jsonb_agg(jsonb_build_object('k', t.k, 'met', false, 'self_met', false) order by t.ord), '[]'::jsonb),
         count(distinct lower(t.k))
    into v, v_distinct
  from (select nullif(trim(e->>'k'),'') as k, ord
        from jsonb_array_elements(p_kpis) with ordinality as x(e, ord)) t
  where t.k is not null;
  if jsonb_array_length(v) <> jsonb_array_length(p_kpis) or v_distinct <> jsonb_array_length(v) then
    raise exception 'Each KPI needs a distinct, non-empty name';
  end if;
  update public.appraisals set kpis = v, updated_at = now() where id = p_id;
  perform public.audit_write('hr.appraisal_kpis_set','appraisal', a.cycle,
    jsonb_build_object('who', a.who, 'count', jsonb_array_length(v)));
  return jsonb_build_object('id', p_id, 'kpis', v);
end $$;

-- ---------- cycle start: seed the template with both rating fields ----------
create or replace function public.start_appraisal_cycle(p_cycle text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_entity uuid := (select id from public.entities where code = 'KE');
  v_md uuid := (select id from public.app_users where role_title = 'Managing Director' limit 1);
  v_n int;
begin
  perform public.assert_access('hr', 3);
  if nullif(trim(coalesce(p_cycle,'')),'') is null then raise exception 'A cycle needs a name, e.g. H1 2026'; end if;
  insert into public.appraisals(entity_id, app_user_id, cycle, reviewer_id, kpis, stage)
  select v_entity, sf.app_user_id, trim(p_cycle), v_md,
    jsonb_build_array(
      jsonb_build_object('k','Delivery against plan','met',false,'self_met',false),
      jsonb_build_object('k','Quality & compliance','met',false,'self_met',false),
      jsonb_build_object('k','Collaboration & culture','met',false,'self_met',false),
      jsonb_build_object('k','Growth objective','met',false,'self_met',false)),
    'not_started'
  from public.staff_files sf
  where sf.state = 'active'
    and not exists (select 1 from public.appraisals a where a.app_user_id = sf.app_user_id and a.cycle = trim(p_cycle));
  get diagnostics v_n = row_count;
  perform public.audit_write('hr.appraisal_cycle_started','appraisal', trim(p_cycle), jsonb_build_object('opened', v_n));
  return jsonb_build_object('cycle', trim(p_cycle), 'opened', v_n);
end $$;

-- ---------- grants (replaced functions keep theirs; only the new one needs this) ----------
do $$ begin
  revoke execute on function public.set_appraisal_kpis(uuid, jsonb) from public, anon;
  grant execute on function public.set_appraisal_kpis(uuid, jsonb) to authenticated;
end $$;
