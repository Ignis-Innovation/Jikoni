-- ============================================================
-- 0068 — Weekly reports: optional file attachment
-- A staff member may attach one file (any format) to their weekly report from the
-- shared 'uploads' bucket. The path is carried on the row and returned by wr_json.
-- submit_weekly_report gains a 4th arg (p_attachment); re-submitting replaces the
-- report and its attachment (pass null to clear). Extends 0058. Idempotent.
-- ============================================================

alter table public.weekly_reports add column if not exists attachment_path text;

-- read shape now also carries the attachment path
create or replace function public.wr_json(p_ref text) returns jsonb
language sql stable security definer set search_path = public as $$
  select jsonb_build_object(
    'id', r.ref, 'ref', r.ref,
    'author', a.name, 'authorEmail', a.email,
    'weekStart', to_char(r.week_start, 'YYYY-MM-DD'),
    'did', r.did, 'blockers', r.blockers, 'nextWeek', r.next_week,
    'state', r.state,
    'attachmentPath', r.attachment_path,
    'reviewedBy', rv.name, 'reviewedAt', r.reviewed_at,
    'createdAt', r.created_at)
  from public.weekly_reports r
  join public.app_users a on a.id = r.author_id
  left join public.app_users rv on rv.id = r.reviewed_by
  where r.ref = p_ref
$$;

-- drop the old 3-arg version so the new 4-arg signature is unambiguous
drop function if exists public.submit_weekly_report(text, text, text);

-- ---------- submit (staff) — upsert this week's report, now with an attachment ----------
create or replace function public.submit_weekly_report(
  p_did text, p_blockers text default null, p_next_week text default null, p_attachment text default null
) returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_me uuid := (select id from public.app_users where auth_id = auth.uid());
  v_entity uuid := (select id from public.entities where code = 'KE');
  v_week date := date_trunc('week', now())::date;
  v_name text; v_email text; v_ref text; v_existing text;
begin
  if v_me is null then raise exception 'No user is linked to this login'; end if;
  if nullif(trim(coalesce(p_did, '')), '') is null then
    raise exception 'Tell us what you did this week';
  end if;
  select name, email into v_name, v_email from public.app_users where id = v_me;

  select ref into v_existing from public.weekly_reports where author_id = v_me and week_start = v_week;
  if v_existing is not null then
    update public.weekly_reports
      set did = trim(p_did),
          blockers = nullif(trim(coalesce(p_blockers, '')), ''),
          next_week = nullif(trim(coalesce(p_next_week, '')), ''),
          attachment_path = nullif(trim(coalesce(p_attachment, '')), ''),
          state = 'submitted', reviewed_by = null, reviewed_at = null, updated_at = now()
      where ref = v_existing;
    v_ref := v_existing;
  else
    v_ref := public.next_ref('WR');
    insert into public.weekly_reports(ref, entity_id, author_id, author_name, week_start, did, blockers, next_week, attachment_path)
    values (v_ref, v_entity, v_me, v_name, v_week, trim(p_did),
            nullif(trim(coalesce(p_blockers, '')), ''), nullif(trim(coalesce(p_next_week, '')), ''),
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
    jsonb_build_object('week', v_week));
  return public.wr_json(v_ref);
end $$;

-- ---------- grants ----------
do $$
declare fn text;
begin
  foreach fn in array array[
    'wr_json(text)',
    'submit_weekly_report(text,text,text,text)']
  loop
    execute format('revoke execute on function public.%s from public, anon', fn);
    execute format('grant execute on function public.%s to authenticated', fn);
  end loop;
end $$;
