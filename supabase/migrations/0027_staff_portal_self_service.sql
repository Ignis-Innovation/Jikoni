-- ============================================================
-- Jikoni — Staff Portal self-service (Jikoni_9 flows, live)
-- The HR suite (0026) gates writes behind assert_access('hr', …), which
-- regular staff don't hold. The portal needs me-scoped equivalents where
-- the guard is "this record is about the caller", not module access:
--   * self_assess_kpi / submit_self_assessment — my appraisal only
--   * submit_my_certification — lands in HR's verification queue
-- Feedback already works for any signed-in user (submit_feedback, 0026).
-- Idempotent: safe to re-run.
-- ============================================================

-- ---------- my appraisal: rate my own KPIs during self-assessment ----------
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
  v := jsonb_set(a.kpis, array[p_idx::text, 'met'], to_jsonb(not coalesce((a.kpis -> p_idx ->> 'met')::boolean, false)));
  update public.appraisals set kpis = v, stage = 'self', updated_at = now() where id = p_id;
  return jsonb_build_object('id', p_id, 'kpis', v, 'stage', 'self');
end $$;

-- ---------- my appraisal: hand my self-assessment to the manager ----------
create or replace function public.submit_self_assessment(p_id uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_me uuid := (select id from public.app_users where auth_id = auth.uid());
  a record;
begin
  if v_me is null then raise exception 'No staff record is linked to this login'; end if;
  select ap.*, u.name into a from public.appraisals ap join public.app_users u on u.id = ap.app_user_id where ap.id = p_id;
  if not found then raise exception 'Appraisal not found'; end if;
  if a.app_user_id <> v_me then raise exception 'This is not your review'; end if;
  if a.stage not in ('not_started','self') then raise exception 'Already submitted'; end if;
  update public.appraisals set stage = 'manager', updated_at = now() where id = p_id;
  perform public.audit_write('hr.self_assessment_submitted','appraisal', a.cycle,
    jsonb_build_object('who', a.name));
  return jsonb_build_object('id', p_id, 'stage', 'manager');
end $$;

-- ---------- my certifications: submit for HR verification ----------
create or replace function public.submit_my_certification(p_name text, p_issuer text default null, p_expiry date default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_entity uuid := (select id from public.entities where code = 'KE');
  v_me uuid := (select id from public.app_users where auth_id = auth.uid());
  v_name text; v_id uuid;
begin
  if v_me is null then raise exception 'No staff record is linked to this login'; end if;
  if nullif(trim(coalesce(p_name,'')),'') is null then raise exception 'A certification needs a name'; end if;
  select name into v_name from public.app_users where id = v_me;
  insert into public.certifications(entity_id, app_user_id, holder, name, issuer, expiry, state)
  values (v_entity, v_me, v_name, trim(p_name), nullif(trim(coalesce(p_issuer,'')),''), p_expiry, 'pending')
  returning id into v_id;
  perform public.audit_write('hr.certification_submitted','staff', v_name,
    jsonb_build_object('name', p_name, 'issuer', p_issuer));
  return jsonb_build_object('id', v_id, 'name', p_name, 'state', 'pending');
end $$;

do $$
declare fn text;
begin
  foreach fn in array array[
    'self_assess_kpi(uuid,int)','submit_self_assessment(uuid)','submit_my_certification(text,text,date)']
  loop
    execute format('revoke execute on function public.%s from public, anon', fn);
    execute format('grant execute on function public.%s to authenticated', fn);
  end loop;
end $$;
