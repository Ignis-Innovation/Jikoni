-- ============================================================
-- Jikoni Master PRD (Kenya-only, v2) — Phase 0: Foundations
-- entities, app_users, chart_of_accounts, audit_log, documents,
-- record-state pattern, permission hooks (always-allow), audit writer.
-- Idempotent: safe to re-run.
-- ============================================================

create extension if not exists pgcrypto;

-- ---------- entities (Kenya live; Uganda is config, no UG logic) ----------
create table if not exists public.entities (
  id          uuid primary key default gen_random_uuid(),
  code        text not null unique,          -- 'KE', 'UG'
  name        text not null,
  currency    text not null default 'KES',
  active      boolean not null default true,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

-- ---------- app users (Phase 0 auth = "who is logged in", nothing more) ----------
create table if not exists public.app_users (
  id          uuid primary key default gen_random_uuid(),
  auth_id     uuid unique references auth.users(id) on delete set null,
  entity_id   uuid references public.entities(id),
  name        text not null,
  email       text not null unique,
  role_key    text not null default 'std',   -- admin | fin | std | view (template only, no enforcement yet)
  role_title  text,
  two_fa      boolean not null default false,
  status      text not null default 'active',
  color       text,
  state       text not null default 'active',
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

-- link auth accounts to app_users by email as they sign up
create or replace function public.link_auth_user() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  update public.app_users set auth_id = new.id, updated_at = now()
  where email = new.email and auth_id is null;
  return new;
end $$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.link_auth_user();

-- ---------- config (feature flags; Phase 5 flips enforcement on) ----------
create table if not exists public.app_config (
  key         text primary key,
  value       jsonb not null,
  updated_at  timestamptz not null default now()
);

insert into public.app_config(key, value) values
  ('enforce_access', 'false'::jsonb),
  ('enforce_sod',    'false'::jsonb)
on conflict (key) do nothing;

-- ---------- per-user module permissions (matrix stored now, enforced Phase 5) ----------
create table if not exists public.user_permissions (
  email       text not null,
  module      text not null,
  level       int  not null default 0 check (level between 0 and 3), -- 0 none · 1 view · 2 edit · 3 full
  updated_at  timestamptz not null default now(),
  primary key (email, module)
);

-- ---------- audit log: live immediately, non-negotiable, append-only ----------
create table if not exists public.audit_log (
  id          bigint generated always as identity primary key,
  entity_id   uuid references public.entities(id),
  actor_id    uuid,
  actor_email text,
  action      text not null,
  record_type text not null,
  record_ref  text,
  detail      jsonb not null default '{}'::jsonb,
  created_at  timestamptz not null default now()
);

create or replace function public.audit_log_immutable() returns trigger
language plpgsql as $$
begin
  raise exception 'audit_log is append-only';
end $$;

drop trigger if exists audit_log_no_update on public.audit_log;
create trigger audit_log_no_update
  before update or delete on public.audit_log
  for each row execute function public.audit_log_immutable();

-- central audit writer — called from every mutating action
create or replace function public.audit_write(
  p_action text, p_record_type text, p_record_ref text, p_detail jsonb default '{}'::jsonb
) returns void language plpgsql security definer set search_path = public as $$
declare
  v_email text := coalesce(nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'email', 'system');
  v_actor uuid := auth.uid();
  v_entity uuid := (select id from public.entities where code = 'KE');
begin
  insert into public.audit_log(entity_id, actor_id, actor_email, action, record_type, record_ref, detail)
  values (v_entity, v_actor, v_email, p_action, p_record_type, p_record_ref, coalesce(p_detail, '{}'::jsonb));
end $$;

-- ---------- permission hook: checkpoint on every transition, ALWAYS-ALLOW until Phase 5 ----------
create or replace function public.assert_access(p_module text, p_min_level int) returns void
language plpgsql security definer set search_path = public as $$
declare
  v_on boolean := coalesce((select value::text = 'true' from public.app_config where key = 'enforce_access'), false);
  v_email text := coalesce(nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'email', '');
  v_level int;
begin
  if not v_on then return; end if;  -- build open, enforce last
  select level into v_level from public.user_permissions where email = v_email and module = p_module;
  if coalesce(v_level, 0) < p_min_level then
    raise exception 'Access denied: % requires level % on %', v_email, p_min_level, p_module;
  end if;
end $$;

-- ---------- record-state pattern: explicit transitions, not free-form strings ----------
create table if not exists public.record_transitions (
  record_type text not null,
  from_state  text not null,
  to_state    text not null,
  primary key (record_type, from_state, to_state)
);

create or replace function public.assert_transition(p_type text, p_from text, p_to text) returns void
language plpgsql stable security definer set search_path = public as $$
begin
  if p_from = p_to then return; end if;
  if not exists (
    select 1 from public.record_transitions
    where record_type = p_type and from_state = p_from and to_state = p_to
  ) then
    raise exception 'Illegal % transition: % → %', p_type, p_from, p_to;
  end if;
end $$;

-- generic trigger: table sets trigger argument = record_type
create or replace function public.enforce_state_machine() returns trigger
language plpgsql as $$
begin
  perform public.assert_transition(tg_argv[0], old.state, new.state);
  new.updated_at := now();
  return new;
end $$;

create or replace function public.touch_updated_at() returns trigger
language plpgsql as $$
begin
  new.updated_at := now();
  return new;
end $$;

-- ---------- chart of accounts ----------
create table if not exists public.chart_of_accounts (
  id          uuid primary key default gen_random_uuid(),
  entity_id   uuid references public.entities(id),
  code        text not null,
  name        text not null,
  kind        text not null check (kind in ('asset','liability','equity','income','expense')),
  active      boolean not null default true,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  unique (entity_id, code)
);

-- ---------- documents (Supabase Storage-backed; path only for now) ----------
create table if not exists public.documents (
  id           uuid primary key default gen_random_uuid(),
  entity_id    uuid references public.entities(id),
  owner_id     uuid references public.app_users(id),
  record_type  text,
  record_ref   text,
  name         text not null,
  storage_path text,
  state        text not null default 'active',
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);

-- ---------- reference counters (PR-209, PO-62, SI-0189, …) ----------
create table if not exists public.ref_counters (
  kind   text primary key,
  prefix text not null,
  n      int  not null
);

create or replace function public.next_ref(p_kind text) returns text
language plpgsql security definer set search_path = public as $$
declare v text;
begin
  update public.ref_counters set n = n + 1 where kind = p_kind
  returning prefix || n::text into v;
  if v is null then raise exception 'Unknown ref counter: %', p_kind; end if;
  return v;
end $$;

-- ---------- RLS: read for signed-in users; writes only via definer RPCs ----------
do $$
declare t text;
begin
  foreach t in array array['entities','app_users','app_config','user_permissions','audit_log',
                           'record_transitions','chart_of_accounts','documents','ref_counters']
  loop
    execute format('alter table public.%I enable row level security', t);
    execute format('drop policy if exists "read for authenticated" on public.%I', t);
    execute format('create policy "read for authenticated" on public.%I for select to authenticated using (true)', t);
  end loop;
end $$;
