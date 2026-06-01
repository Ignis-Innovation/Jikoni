-- ============================================================================
-- 0009_notifications.sql — Phase 1H Notifications (PRD §1H)
-- One service for in-app / email / SMS. Modules call notify(); they never talk
-- to Resend / Africa's Talking directly.
-- ============================================================================

create table public.notifications (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null references public.users(id) on delete cascade,
  channel    text not null default 'in_app' check (channel in ('in_app','email','sms')),
  type       text not null,
  title      text not null,
  body       text,
  link       text,
  read_at    timestamptz,
  sent_at    timestamptz,
  status     text not null default 'pending',
  created_at timestamptz not null default now()
);

create index on public.notifications(user_id, read_at);

create table public.notification_prefs (
  user_id  uuid not null references public.users(id) on delete cascade,
  type     text not null,
  in_app   boolean not null default true,
  email    boolean not null default false,
  sms      boolean not null default false,
  primary key (user_id, type)
);

-- notify(): the single fan-out entry point. Creates one in_app row immediately;
-- a worker/edge function delivers email/sms per prefs (wired in a later phase).
create or replace function public.notify(
  p_user_id uuid,
  p_type    text,
  p_title   text,
  p_body    text default null,
  p_link    text default null
) returns uuid language plpgsql security definer set search_path = public as $$
declare
  v_id uuid;
begin
  insert into public.notifications(user_id, channel, type, title, body, link, status)
  values (p_user_id, 'in_app', p_type, p_title, p_body, p_link, 'sent')
  returning id into v_id;
  return v_id;
end;
$$;
