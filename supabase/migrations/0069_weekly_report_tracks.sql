-- ============================================================
-- 0069 — Weekly reports: role-specific "five lines" format
-- HR wants a tight, structured report that differs by track:
--   * pipeline    — revenue/pipeline, deals advanced, stalled deal, one win, one ask
--   * technology  — features shipped, features blocked, uptime/incidents, next-week commitments, one ask
--   * leadership  — the five CEO dashboard numbers
-- The track is assigned per user by an admin (app_users.report_track); the submit
-- form then shows the matching five prompts. Answers are stored structured in
-- weekly_reports.answers ([{q,a}]) with the track on weekly_reports.track. The
-- legacy did/blockers/next_week columns stay for older rows and for people with no
-- track (they keep the free-text form). `did` is also filled with a plain-text
-- summary of the five answers so existing list views / exports keep working.
-- Extends 0058 + 0068. Idempotent throughout.
-- ============================================================

-- ---------- schema ----------
alter table public.app_users      add column if not exists report_track text;   -- pipeline|technology|leadership|null
alter table public.weekly_reports add column if not exists track text;          -- snapshot of the track at submit time
alter table public.weekly_reports add column if not exists answers jsonb;       -- [{"q":..,"a":..}] for structured reports

-- ---------- admin: assign a user's report track (HR edit or Super Admin) ----------
create or replace function public.set_report_track(p_email text, p_track text)
returns void language plpgsql security definer set search_path = public as $$
declare v_ok boolean;
begin
  select exists (
    select 1 from public.user_permissions p
    join public.app_users u on lower(u.email) = p.email
    where u.auth_id = auth.uid()
      and ((p.module = 'hr' and p.level >= 2) or (p.module = 'users' and p.level >= 3))
  ) into v_ok;
  if not v_ok then raise exception 'Only HR or a Super Admin can set a report track'; end if;
  if coalesce(p_track, '') not in ('', 'pipeline', 'technology', 'leadership') then
    raise exception 'Unknown report track %', p_track;
  end if;
  update public.app_users
    set report_track = nullif(p_track, ''), updated_at = now()
    where lower(email) = lower(trim(p_email));
end $$;

-- ---------- read shape now also carries track + answers ----------
create or replace function public.wr_json(p_ref text) returns jsonb
language sql stable security definer set search_path = public as $$
  select jsonb_build_object(
    'id', r.ref, 'ref', r.ref,
    'author', a.name, 'authorEmail', a.email,
    'weekStart', to_char(r.week_start, 'YYYY-MM-DD'),
    'did', r.did, 'blockers', r.blockers, 'nextWeek', r.next_week,
    'track', r.track, 'answers', r.answers,
    'state', r.state,
    'attachmentPath', r.attachment_path,
    'reviewedBy', rv.name, 'reviewedAt', r.reviewed_at,
    'createdAt', r.created_at)
  from public.weekly_reports r
  join public.app_users a on a.id = r.author_id
  left join public.app_users rv on rv.id = r.reviewed_by
  where r.ref = p_ref
$$;

-- ---------- submit (staff): structured (track+answers) OR legacy (did/blockers/next) ----------
-- Drop the old 4-arg version so the extended signature is unambiguous.
drop function if exists public.submit_weekly_report(text, text, text, text);

create or replace function public.submit_weekly_report(
  p_did text default null, p_blockers text default null, p_next_week text default null,
  p_attachment text default null, p_track text default null, p_answers jsonb default null
) returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_me uuid := (select id from public.app_users where auth_id = auth.uid());
  v_entity uuid := (select id from public.entities where code = 'KE');
  v_week date := date_trunc('week', now())::date;
  v_name text; v_email text; v_ref text; v_existing text;
  v_track text := nullif(trim(coalesce(p_track, '')), '');
  v_answers jsonb; v_did text; v_summary text;
begin
  if v_me is null then raise exception 'No user is linked to this login'; end if;
  select name, email into v_name, v_email from public.app_users where id = v_me;

  if v_track is not null and p_answers is not null then
    -- keep only answered rows; build a plain-text summary into `did` for legacy views
    select coalesce(jsonb_agg(jsonb_build_object('q', q, 'a', a) order by ord), '[]'::jsonb),
           string_agg(q || ': ' || a, E'\n' order by ord)
      into v_answers, v_summary
    from (
      select trim(coalesce(e ->> 'q', '')) as q,
             trim(coalesce(e ->> 'a', '')) as a,
             ord
      from jsonb_array_elements(p_answers) with ordinality as t(e, ord)
    ) s
    where a <> '';
    if v_answers is null or jsonb_array_length(v_answers) = 0 then
      raise exception 'Fill in at least one line of your report';
    end if;
    v_did := v_summary;
  else
    -- legacy free-text path
    if nullif(trim(coalesce(p_did, '')), '') is null then
      raise exception 'Tell us what you did this week';
    end if;
    v_did := trim(p_did);
    v_answers := null;
    v_track := null;
  end if;

  select ref into v_existing from public.weekly_reports where author_id = v_me and week_start = v_week;
  if v_existing is not null then
    update public.weekly_reports
      set did = v_did,
          blockers = case when v_track is null then nullif(trim(coalesce(p_blockers, '')), '') else null end,
          next_week = case when v_track is null then nullif(trim(coalesce(p_next_week, '')), '') else null end,
          track = v_track, answers = v_answers,
          attachment_path = nullif(trim(coalesce(p_attachment, '')), ''),
          state = 'submitted', reviewed_by = null, reviewed_at = null, updated_at = now()
      where ref = v_existing;
    v_ref := v_existing;
  else
    v_ref := public.next_ref('WR');
    insert into public.weekly_reports(ref, entity_id, author_id, author_name, week_start, did, blockers, next_week, track, answers, attachment_path)
    values (v_ref, v_entity, v_me, v_name, v_week, v_did,
            case when v_track is null then nullif(trim(coalesce(p_blockers, '')), '') else null end,
            case when v_track is null then nullif(trim(coalesce(p_next_week, '')), '') else null end,
            v_track, v_answers,
            nullif(trim(coalesce(p_attachment, '')), ''));
  end if;

  -- bell the reviewers (HR hr>=1, or Super Admin users:3)
  insert into public.notifications(entity_id, recipient_email, kind, title, body, link_view, link_ref)
  select v_entity, lower(u.email), 'weekly_report',
         v_name || ' submitted a weekly report',
         'Week of ' || to_char(v_week, 'DD Mon YYYY'), 'hr', v_ref
  from public.app_users u
  join public.user_permissions p on p.email = lower(u.email)
  where ((p.module = 'hr' and p.level >= 1) or (p.module = 'users' and p.level >= 3))
    and lower(u.email) <> lower(v_email);

  perform public.audit_write('weekly_report.submitted', 'weekly_report', v_ref,
    jsonb_build_object('week', v_week, 'track', v_track));
  return public.wr_json(v_ref);
end $$;

-- ---------- grants ----------
do $$
declare fn text;
begin
  foreach fn in array array[
    'set_report_track(text,text)',
    'wr_json(text)',
    'submit_weekly_report(text,text,text,text,text,jsonb)']
  loop
    execute format('revoke execute on function public.%s from public, anon', fn);
    execute format('grant execute on function public.%s to authenticated', fn);
  end loop;
end $$;
