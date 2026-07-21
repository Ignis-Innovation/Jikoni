-- ============================================================
-- Jikoni — CRM: the New Engagement form drops the Stage picker and
-- gains a free-text "where we are on the discussion" note.
--   * stage is no longer collected — new engagements enter at the top
--     of the funnel (Discovery upstream / Identification downstream)
--   * the note (p_next_action) is stored as the engagement's first
--     entry in engagement_updates, so it shows in the updates log
-- Same 6-arg signature as 0011, so existing grants stay valid.
-- Idempotent: safe to re-run.
-- ============================================================

create or replace function public.create_engagement(
  p_name text, p_stage text, p_owner_name text, p_pipeline text,
  p_next_action text default null, p_due_key text default 'week'
) returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_ref text; v_pill text; v_pill_txt text; v_stage text; v_id uuid; v_who text;
  v_note text := nullif(trim(coalesce(p_next_action, '')), '');
  v_entity uuid := (select id from public.entities where code = 'KE');
begin
  perform public.assert_access('crm', 2);
  v_ref := public.next_ref(case when p_pipeline = 'down' then 'DST' else 'ENG' end);
  -- stage is no longer asked on the form; start at the top of the funnel
  v_stage := coalesce(nullif(trim(coalesce(p_stage, '')), ''),
                      case when p_pipeline = 'down' then 'Identification' else 'Discovery' end);
  select case p_due_key when 'today' then 'today' when 'over' then 'over' else 'week' end,
         case p_due_key when 'today' then 'Today' when 'over' then 'Overdue' when 'nweek' then 'Next week' else 'This week' end
    into v_pill, v_pill_txt;
  insert into public.engagements(ref, entity_id, name, stage, owner_name, pill, pill_txt, pipeline)
  values (v_ref, v_entity, p_name, v_stage, p_owner_name, v_pill, v_pill_txt, p_pipeline)
  returning id into v_id;
  -- "where we are on the discussion" seeds the engagement's update log
  if v_note is not null then
    v_who := coalesce((select name from public.app_users where auth_id = auth.uid()), p_owner_name);
    insert into public.engagement_updates(engagement_id, channel, who, note, happened)
    values (v_id, 'Note', v_who, v_note, 'Today');
  end if;
  perform public.audit_write('engagement.created', 'engagement', v_ref,
    jsonb_build_object('name', p_name, 'stage', v_stage, 'owner', p_owner_name, 'pipeline', p_pipeline, 'note', v_note));
  return jsonb_build_object(
    'id', v_ref, 'n', p_name, 'st', v_stage, 'o', p_owner_name,
    'pl', v_pill, 'plt', v_pill_txt, 'pipeline', p_pipeline);
end $$;

revoke execute on function public.create_engagement(text,text,text,text,text,text) from public, anon;
grant execute on function public.create_engagement(text,text,text,text,text,text) to authenticated;
