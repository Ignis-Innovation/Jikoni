-- ============================================================
-- 0058 — Weekly reports
-- Each staff member submits, from the Staff Portal, a short weekly report:
-- what they did, blockers, and next week's plan. Reports land in a new
-- "Weekly Reports" section under HR, visible to HR (hr>=1) and Super Admins
-- (users:3), who can Acknowledge them. One report per person per ISO week
-- (Monday-anchored); re-submitting the same week updates it. Idempotent.
--
-- Companion: api/weekly-reminder.js emails + bells anyone who hasn't submitted
-- for the current week (Vercel cron, Friday morning).
-- ============================================================

-- ---------- ref counter ----------
insert into public.ref_counters(kind, prefix, n) values ('WR', 'WR-00', 0) on conflict (kind) do nothing;

-- ---------- schema ----------
create table if not exists public.weekly_reports (
  id           uuid primary key default gen_random_uuid(),
  ref          text unique not null,
  entity_id    uuid references public.entities(id),
  author_id    uuid not null references public.app_users(id),
  author_name  text not null,
  week_start   date not null,                    -- Monday of the report's ISO week
  did          text not null,
  blockers     text,
  next_week    text,
  state        text not null default 'submitted', -- 'submitted' | 'acknowledged'
  reviewed_by  uuid references public.app_users(id),
  reviewed_at  timestamptz,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);
create unique index if not exists weekly_reports_author_week_uk
  on public.weekly_reports(author_id, week_start);

-- ---------- who may see every report? (HR hr>=1 OR Super Admin users:3) ----------
create or replace function public.can_view_reports() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.user_permissions p
    join public.app_users u on lower(u.email) = p.email
    where u.auth_id = auth.uid()
      and ((p.module = 'hr' and p.level >= 1) or (p.module = 'users' and p.level >= 3))
  )
$$;

-- ---------- RLS: own rows for everyone, all rows for reviewers; writes via RPC ----------
alter table public.weekly_reports enable row level security;
drop policy if exists "read own or reviewer weekly_reports" on public.weekly_reports;
create policy "read own or reviewer weekly_reports" on public.weekly_reports
  for select to authenticated
  using (
    author_id = (select id from public.app_users where auth_id = auth.uid())
    or public.can_view_reports()
  );

-- ---------- frontend read shape ----------
create or replace function public.wr_json(p_ref text) returns jsonb
language sql stable security definer set search_path = public as $$
  select jsonb_build_object(
    'id', r.ref, 'ref', r.ref,
    'author', a.name, 'authorEmail', a.email,
    'weekStart', to_char(r.week_start, 'YYYY-MM-DD'),
    'did', r.did, 'blockers', r.blockers, 'nextWeek', r.next_week,
    'state', r.state,
    'reviewedBy', rv.name, 'reviewedAt', r.reviewed_at,
    'createdAt', r.created_at)
  from public.weekly_reports r
  join public.app_users a on a.id = r.author_id
  left join public.app_users rv on rv.id = r.reviewed_by
  where r.ref = p_ref
$$;

-- ---------- submit (staff) — upsert this week's report, bell the reviewers ----------
create or replace function public.submit_weekly_report(
  p_did text, p_blockers text default null, p_next_week text default null
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
          state = 'submitted', reviewed_by = null, reviewed_at = null, updated_at = now()
      where ref = v_existing;
    v_ref := v_existing;
  else
    v_ref := public.next_ref('WR');
    insert into public.weekly_reports(ref, entity_id, author_id, author_name, week_start, did, blockers, next_week)
    values (v_ref, v_entity, v_me, v_name, v_week, trim(p_did),
            nullif(trim(coalesce(p_blockers, '')), ''), nullif(trim(coalesce(p_next_week, '')), ''));
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

-- ---------- acknowledge (HR / Super Admin) ----------
create or replace function public.acknowledge_weekly_report(p_ref text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_me uuid := (select id from public.app_users where auth_id = auth.uid());
  r record;
begin
  if not public.can_view_reports() then
    raise exception 'Only HR or a Super Admin can acknowledge weekly reports';
  end if;
  select * into r from public.weekly_reports where ref = p_ref;
  if not found then raise exception 'Report not found'; end if;
  update public.weekly_reports
    set state = 'acknowledged', reviewed_by = v_me, reviewed_at = now(), updated_at = now()
    where ref = p_ref;
  perform public.audit_write('weekly_report.acknowledged', 'weekly_report', p_ref, '{}'::jsonb);
  return public.wr_json(p_ref);
end $$;

-- ---------- grants ----------
do $$
declare fn text;
begin
  foreach fn in array array[
    'can_view_reports()',
    'wr_json(text)',
    'submit_weekly_report(text,text,text)',
    'acknowledge_weekly_report(text)']
  loop
    execute format('revoke execute on function public.%s from public, anon', fn);
    execute format('grant execute on function public.%s to authenticated', fn);
  end loop;
end $$;
