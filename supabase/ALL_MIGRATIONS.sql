-- ============================================================================
-- Jikoni — Phase 1 Spine
-- 0001_foundation.sql — extensions, shared helper functions, human-ID sequences
-- ============================================================================
-- Conventions (PRD §1.6): every table has id uuid pk, created_at, updated_at,
-- created_by, updated_by, deleted_at (soft delete). Money = integer minor units
-- + currency_code. Human-facing IDs use prefixes (PO-00012) via a sequence svc.
-- ============================================================================

create extension if not exists "pgcrypto";   -- gen_random_uuid()
create extension if not exists "pg_trgm";     -- fuzzy search

-- ----------------------------------------------------------------------------
-- updated_at maintenance
-- ----------------------------------------------------------------------------
create or replace function public.set_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

-- ----------------------------------------------------------------------------
-- created_by / updated_by maintenance (pulls the acting auth user)
-- ----------------------------------------------------------------------------
create or replace function public.set_audit_fields()
returns trigger language plpgsql as $$
begin
  if (tg_op = 'INSERT') then
    new.created_by := coalesce(new.created_by, auth.uid());
    new.updated_by := coalesce(new.updated_by, auth.uid());
  elsif (tg_op = 'UPDATE') then
    new.updated_by := coalesce(auth.uid(), new.updated_by);
    new.created_by := old.created_by;        -- never reassign creator
    new.created_at := old.created_at;
  end if;
  return new;
end;
$$;

-- ----------------------------------------------------------------------------
-- Human-readable ID sequences (PO-00012, ENG-001, ...). PRD §1.6
-- ----------------------------------------------------------------------------
create table if not exists public.id_sequences (
  prefix      text primary key,
  next_val    bigint not null default 1,
  pad         int    not null default 5
);

create or replace function public.next_human_id(p_prefix text)
returns text language plpgsql as $$
declare
  v_val bigint;
  v_pad int;
begin
  insert into public.id_sequences(prefix) values (p_prefix)
    on conflict (prefix) do nothing;

  update public.id_sequences
     set next_val = next_val + 1
   where prefix = p_prefix
  returning next_val - 1, pad into v_val, v_pad;

  return p_prefix || '-' || lpad(v_val::text, v_pad, '0');
end;
$$;
-- ============================================================================
-- 0002_identity.sql — Phase 1A Identity & Access (PRD §1A)
-- Profile mirror of auth.users + RBAC (roles, permissions, mappings).
-- ============================================================================

-- Profile mirror. Credentials live in auth.users; this holds app profile + status.
create table public.users (
  id                 uuid primary key references auth.users(id) on delete cascade,
  email              text unique not null,
  full_name          text,
  phone              text,
  avatar_url         text,
  status             text not null default 'invited'
                       check (status in ('active','invited','suspended')),
  last_login_at      timestamptz,
  two_factor_enabled boolean not null default false,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now(),
  created_by         uuid references public.users(id),
  updated_by         uuid references public.users(id),
  deleted_at         timestamptz
);

create table public.roles (
  id          uuid primary key default gen_random_uuid(),
  key         text unique not null,
  name        text not null,
  description text,
  is_system   boolean not null default false,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  created_by  uuid references public.users(id),
  updated_by  uuid references public.users(id),
  deleted_at  timestamptz
);

create table public.permissions (
  id          uuid primary key default gen_random_uuid(),
  key         text unique not null,        -- e.g. procurement.po.approve
  module      text not null,
  action      text not null,
  description text
);

create table public.role_permissions (
  role_id       uuid not null references public.roles(id) on delete cascade,
  permission_id uuid not null references public.permissions(id) on delete cascade,
  primary key (role_id, permission_id)
);

create table public.user_roles (
  user_id    uuid not null references public.users(id) on delete cascade,
  role_id    uuid not null references public.roles(id) on delete cascade,
  scope      text,                          -- optional dept/project id for scoped roles
  created_at timestamptz not null default now(),
  created_by uuid references public.users(id),
  primary key (user_id, role_id)
);

create index on public.user_roles(user_id);
create index on public.role_permissions(role_id);

-- ----------------------------------------------------------------------------
-- Auth helper functions (SECURITY DEFINER so RLS policies can call them
-- without recursing into the very tables they protect).
-- ----------------------------------------------------------------------------
create or replace function public.is_super_admin(uid uuid default auth.uid())
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.user_roles ur
    join public.roles r on r.id = ur.role_id
    where ur.user_id = uid and r.key = 'super_admin'
  );
$$;

create or replace function public.has_permission(perm_key text, uid uuid default auth.uid())
returns boolean language sql stable security definer set search_path = public as $$
  select public.is_super_admin(uid)
      or exists (
        select 1
        from public.user_roles ur
        join public.role_permissions rp on rp.role_id = ur.role_id
        join public.permissions p on p.id = rp.permission_id
        where ur.user_id = uid and p.key = perm_key
      );
$$;

create or replace function public.has_module_access(p_module text, uid uuid default auth.uid())
returns boolean language sql stable security definer set search_path = public as $$
  select public.is_super_admin(uid)
      or exists (
        select 1
        from public.user_roles ur
        join public.role_permissions rp on rp.role_id = ur.role_id
        join public.permissions p on p.id = rp.permission_id
        where ur.user_id = uid and p.module = p_module
      );
$$;

-- Mirror new auth users into public.users automatically.
create or replace function public.handle_new_auth_user()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into public.users (id, email, full_name, status)
  values (
    new.id,
    new.email,
    coalesce(new.raw_user_meta_data->>'full_name', new.email),
    'invited'
  )
  on conflict (id) do update set email = excluded.email;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_auth_user();
-- ============================================================================
-- 0003_org_model.sql — Phase 1B Organization Model (PRD §1B)
-- Shared structure every module tags data against. Referenced by ID, never copied.
-- ============================================================================

create table public.institutions (
  id         uuid primary key default gen_random_uuid(),
  name       text not null,
  type       text,
  parent_id  uuid references public.institutions(id),
  status     text not null default 'active',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid references public.users(id),
  updated_by uuid references public.users(id),
  deleted_at timestamptz
);

create table public.departments (
  id           uuid primary key default gen_random_uuid(),
  name         text not null,
  parent_id    uuid references public.departments(id),
  head_user_id uuid references public.users(id),
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  created_by   uuid references public.users(id),
  updated_by   uuid references public.users(id),
  deleted_at   timestamptz
);

-- Base projects table (extended in Phase 6).
create table public.projects (
  id              uuid primary key default gen_random_uuid(),
  code            text unique not null,
  name            text not null,
  funder_party_id uuid,                       -- -> parties.id (added in 0005)
  status          text not null default 'active',
  start_date      date,
  end_date        date,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  created_by      uuid references public.users(id),
  updated_by      uuid references public.users(id),
  deleted_at      timestamptz
);

create table public.locations (
  id         uuid primary key default gen_random_uuid(),
  name       text not null,
  type       text check (type in ('office','site','warehouse')),
  geo_lat    double precision,
  geo_lng    double precision,
  address    text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid references public.users(id),
  updated_by uuid references public.users(id),
  deleted_at timestamptz
);

create table public.cost_centers (
  id            uuid primary key default gen_random_uuid(),
  code          text unique not null,
  name          text not null,
  department_id uuid references public.departments(id),
  project_id    uuid references public.projects(id),
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  created_by    uuid references public.users(id),
  updated_by    uuid references public.users(id),
  deleted_at    timestamptz
);
-- ============================================================================
-- 0004_chart_of_accounts.sql — Phase 1C Chart of Accounts (PRD §1C)
-- ============================================================================

create table public.accounts (
  id            uuid primary key default gen_random_uuid(),
  code          text unique not null,
  name          text not null,
  type          text not null check (type in ('asset','liability','equity','income','expense')),
  parent_id     uuid references public.accounts(id),
  is_postable   boolean not null default true,
  currency_code text not null default 'KES',  -- -> currencies.code (ref data)
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  created_by    uuid references public.users(id),
  updated_by    uuid references public.users(id),
  deleted_at    timestamptz
);

create table public.fiscal_periods (
  id         uuid primary key default gen_random_uuid(),
  name       text unique not null,            -- 2026-Q1
  start_date date not null,
  end_date   date not null,
  status     text not null default 'open' check (status in ('open','closed')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid references public.users(id),
  updated_by uuid references public.users(id),
  deleted_at timestamptz
);

create table public.opening_balances (
  id               uuid primary key default gen_random_uuid(),
  account_id       uuid not null references public.accounts(id),
  fiscal_period_id uuid not null references public.fiscal_periods(id),
  amount_minor     bigint not null default 0,
  currency_code    text not null default 'KES',
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  created_by       uuid references public.users(id),
  updated_by       uuid references public.users(id),
  deleted_at       timestamptz,
  unique (account_id, fiscal_period_id)
);
-- ============================================================================
-- 0005_parties.sql — Phase 1D Parties (PRD §1D)
-- Single source of truth for everyone Ignis deals with. One party can carry
-- multiple type tags (vendor AND partner) — proves Rule 1 (no duplication).
-- ============================================================================

create table public.parties (
  id           uuid primary key default gen_random_uuid(),
  type         text not null check (type in ('vendor','customer','partner','employee','contact')),
  display_name text not null,
  legal_name   text,
  kra_pin      text,
  email        text,
  phone        text,
  status       text not null default 'active',
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  created_by   uuid references public.users(id),
  updated_by   uuid references public.users(id),
  deleted_at   timestamptz
);

create index on public.parties(type);
create index on public.parties using gin (display_name gin_trgm_ops);

-- Multiple type tags so one entity can be both vendor and partner.
create table public.party_types (
  party_id uuid not null references public.parties(id) on delete cascade,
  type     text not null check (type in ('vendor','customer','partner','employee','contact')),
  primary key (party_id, type)
);

create table public.party_contacts (
  id         uuid primary key default gen_random_uuid(),
  party_id   uuid not null references public.parties(id) on delete cascade,
  name       text not null,
  role       text,
  email      text,
  phone      text,
  is_primary boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid references public.users(id),
  updated_by uuid references public.users(id),
  deleted_at timestamptz
);

create table public.party_bank_details (
  id            uuid primary key default gen_random_uuid(),
  party_id      uuid not null references public.parties(id) on delete cascade,
  bank          text,
  account_no    text,
  branch        text,
  currency_code text not null default 'KES',
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  created_by    uuid references public.users(id),
  updated_by    uuid references public.users(id),
  deleted_at    timestamptz
);

-- Now wire the deferred FK from projects.funder_party_id (declared in 0003).
alter table public.projects
  add constraint projects_funder_party_fk
  foreign key (funder_party_id) references public.parties(id);
-- ============================================================================
-- 0006_documents.sql — Phase 1E Documents (PRD §1E)
-- Attach + version any file against any record (entity_type + entity_id).
-- Files live in Supabase Storage bucket 'documents'.
-- ============================================================================

create table public.documents (
  id           uuid primary key default gen_random_uuid(),
  filename     text not null,
  storage_path text not null,
  mime_type    text,
  size_bytes   bigint,
  version      int not null default 1,
  entity_type  text not null,        -- e.g. 'purchase_orders'
  entity_id    uuid not null,        -- the linked record's id
  uploaded_by  uuid references public.users(id),
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  created_by   uuid references public.users(id),
  updated_by   uuid references public.users(id),
  deleted_at   timestamptz
);

create index on public.documents(entity_type, entity_id);

create table public.document_versions (
  id           uuid primary key default gen_random_uuid(),
  document_id  uuid not null references public.documents(id) on delete cascade,
  version      int not null,
  storage_path text not null,
  uploaded_by  uuid references public.users(id),
  created_at   timestamptz not null default now()
);
-- ============================================================================
-- 0007_audit_log.sql — Phase 1F Audit Log (PRD §1F)
-- Append-only who-did-what-when. Implemented via a generic trigger applied to
-- every spine table in 0012. No app path may update or delete an audit row.
-- ============================================================================

create table public.audit_log (
  id            bigint generated always as identity primary key,
  actor_user_id uuid,
  action        text not null check (action in ('insert','update','delete')),
  table_name    text not null,
  record_id     uuid,
  before        jsonb,
  after         jsonb,
  created_at    timestamptz not null default now()
);

create index on public.audit_log(table_name, record_id);
create index on public.audit_log(actor_user_id);
create index on public.audit_log(created_at);

-- Generic audit trigger. "delete" here means the soft-delete UPDATE that sets
-- deleted_at; true row deletes are also captured if they ever happen.
create or replace function public.audit_trigger()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  v_action text;
  v_record_id uuid;
begin
  if (tg_op = 'INSERT') then
    v_action := 'insert';
    v_record_id := (to_jsonb(new)->>'id')::uuid;
    insert into public.audit_log(actor_user_id, action, table_name, record_id, before, after)
    values (auth.uid(), v_action, tg_table_name, v_record_id, null, to_jsonb(new));
    return new;

  elsif (tg_op = 'UPDATE') then
    if (to_jsonb(old)->>'deleted_at' is null and to_jsonb(new)->>'deleted_at' is not null) then
      v_action := 'delete';   -- soft delete
    else
      v_action := 'update';
    end if;
    v_record_id := (to_jsonb(new)->>'id')::uuid;
    insert into public.audit_log(actor_user_id, action, table_name, record_id, before, after)
    values (auth.uid(), v_action, tg_table_name, v_record_id, to_jsonb(old), to_jsonb(new));
    return new;

  elsif (tg_op = 'DELETE') then
    v_record_id := (to_jsonb(old)->>'id')::uuid;
    insert into public.audit_log(actor_user_id, action, table_name, record_id, before, after)
    values (auth.uid(), 'delete', tg_table_name, v_record_id, to_jsonb(old), null);
    return old;
  end if;
  return null;
end;
$$;
-- ============================================================================
-- 0008_approvals.sql — Phase 1G Approvals Engine (PRD §1G)
-- One configurable approval system reused by every module. No module builds
-- its own approval logic.
-- ============================================================================

create table public.approval_chains (
  id          uuid primary key default gen_random_uuid(),
  name        text not null,
  module      text not null,
  entity_type text not null,
  conditions  jsonb not null default '{}'::jsonb,  -- {amount_min, amount_max, type, department_id}
  active      boolean not null default true,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  created_by  uuid references public.users(id),
  updated_by  uuid references public.users(id),
  deleted_at  timestamptz
);

create table public.approval_steps (
  id               uuid primary key default gen_random_uuid(),
  chain_id         uuid not null references public.approval_chains(id) on delete cascade,
  step_no          int not null,
  approver_role_id uuid references public.roles(id),
  approver_user_id uuid references public.users(id),
  min_amount       bigint,
  max_amount       bigint,
  unique (chain_id, step_no)
);

create table public.approval_requests (
  id           uuid primary key default gen_random_uuid(),
  entity_type  text not null,
  entity_id    uuid not null,
  chain_id     uuid references public.approval_chains(id),
  current_step int not null default 1,
  status       text not null default 'pending'
                 check (status in ('pending','approved','rejected','changes_requested')),
  requested_by uuid references public.users(id),
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  created_by   uuid references public.users(id),
  updated_by   uuid references public.users(id),
  deleted_at   timestamptz
);

create index on public.approval_requests(entity_type, entity_id);
create index on public.approval_requests(status);

create table public.approval_actions (
  id             uuid primary key default gen_random_uuid(),
  request_id     uuid not null references public.approval_requests(id) on delete cascade,
  step_no        int not null,
  actor_user_id  uuid references public.users(id),
  action         text not null check (action in ('approve','reject','request_changes')),
  comment        text,
  created_at     timestamptz not null default now()
);
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
-- ============================================================================
-- 0010_reference_data.sql — Phase 1I Reference Data (PRD §1I)
-- Shared lookups. Every currency/tax/UoM/category dropdown reads from here.
-- ============================================================================

create table public.currencies (
  code           text primary key,        -- KES, USD
  name           text not null,
  symbol         text,
  decimal_places int not null default 2
);

create table public.tax_codes (
  code      text primary key,
  name      text not null,
  rate_pct  numeric(6,3) not null default 0,
  kra_code  text,
  active    boolean not null default true
);

create table public.units_of_measure (
  code text primary key,
  name text not null
);

create table public.categories (
  id         uuid primary key default gen_random_uuid(),
  domain     text not null,                -- expense | asset | product | ...
  name       text not null,
  parent_id  uuid references public.categories(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);

create index on public.categories(domain);
-- ============================================================================
-- 0011_event_bus_and_triggers.sql — Phase 1J Event Bus (PRD §1J) + wiring
-- Every write fires an event ('<entity>.<action>') subscribers can listen to.
-- Then we attach the four standard triggers to every spine table at once.
-- ============================================================================

-- Durable event log; Supabase Realtime broadcasts inserts on this table to the
-- 'jikoni-events' subscription. Dashboards/alerts subscribe and filter by prefix.
create table public.events (
  id         bigint generated always as identity primary key,
  event      text not null,        -- e.g. procurement.po.created
  table_name text not null,
  record_id  uuid,
  actor      uuid,
  payload    jsonb,
  created_at timestamptz not null default now()
);

create index on public.events(event);
create index on public.events(created_at);

create or replace function public.emit_event()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  v_action text;
  v_rec    jsonb;
  v_id     uuid;
begin
  if (tg_op = 'INSERT') then
    v_action := 'created'; v_rec := to_jsonb(new);
  elsif (tg_op = 'UPDATE') then
    if (to_jsonb(old)->>'deleted_at' is null and to_jsonb(new)->>'deleted_at' is not null) then
      v_action := 'deleted';
    else
      v_action := 'updated';
    end if;
    v_rec := to_jsonb(new);
  else
    v_action := 'deleted'; v_rec := to_jsonb(old);
  end if;

  v_id := (v_rec->>'id')::uuid;
  insert into public.events(event, table_name, record_id, actor, payload)
  values (tg_table_name || '.' || v_action, tg_table_name, v_id, auth.uid(),
          jsonb_build_object('id', v_id));
  return coalesce(new, old);
end;
$$;

-- ----------------------------------------------------------------------------
-- Attach standard triggers to every spine table that carries the standard
-- columns. Skips append-only/log tables (audit_log, events) and pure mapping
-- tables without an updated_at/deleted_at.
-- ----------------------------------------------------------------------------
do $$
declare
  t text;
  has_updated boolean;
  has_audit_cols boolean;
  managed text[] := array[
    'users','roles','permissions','institutions','departments','projects',
    'locations','cost_centers','accounts','fiscal_periods','opening_balances',
    'parties','party_contacts','party_bank_details','documents',
    'approval_chains','approval_steps','approval_requests',
    'notifications','categories','tax_codes','currencies','units_of_measure'
  ];
begin
  foreach t in array managed loop
    -- updated_at trigger (only where column exists)
    select exists (
      select 1 from information_schema.columns
      where table_schema = 'public' and table_name = t and column_name = 'updated_at'
    ) into has_updated;

    if has_updated then
      execute format(
        'drop trigger if exists trg_set_updated_at on public.%I;
         create trigger trg_set_updated_at before update on public.%I
         for each row execute function public.set_updated_at();', t, t);
    end if;

    -- created_by/updated_by trigger (only where created_by exists)
    select exists (
      select 1 from information_schema.columns
      where table_schema = 'public' and table_name = t and column_name = 'created_by'
    ) into has_audit_cols;

    if has_audit_cols then
      execute format(
        'drop trigger if exists trg_set_audit_fields on public.%I;
         create trigger trg_set_audit_fields before insert or update on public.%I
         for each row execute function public.set_audit_fields();', t, t);
    end if;

    -- audit log + event emit on every write
    execute format(
      'drop trigger if exists trg_audit on public.%I;
       create trigger trg_audit after insert or update or delete on public.%I
       for each row execute function public.audit_trigger();', t, t);

    execute format(
      'drop trigger if exists trg_emit_event on public.%I;
       create trigger trg_emit_event after insert or update or delete on public.%I
       for each row execute function public.emit_event();', t, t);
  end loop;
end $$;
-- ============================================================================
-- 0012_rls.sql — Row-Level Security (PRD gate B7: enforce permissions server-side)
-- Pattern: SELECT gated by '<area>.view' (super_admin passes everything via
-- has_permission); writes gated by '<area>.<action>'. Reference data + the user
-- directory are readable by any authenticated user. audit_log and events are
-- read-only to the app — only SECURITY DEFINER triggers write them.
-- ============================================================================

-- Enable RLS on every spine table.
do $$
declare t text;
declare tbls text[] := array[
  'users','roles','permissions','role_permissions','user_roles',
  'institutions','departments','projects','locations','cost_centers',
  'accounts','fiscal_periods','opening_balances',
  'parties','party_types','party_contacts','party_bank_details',
  'documents','document_versions','audit_log','events',
  'approval_chains','approval_steps','approval_requests','approval_actions',
  'notifications','notification_prefs',
  'currencies','tax_codes','units_of_measure','categories','id_sequences'
];
begin
  foreach t in array tbls loop
    execute format('alter table public.%I enable row level security;', t);
  end loop;
end $$;

-- Helper to keep policies terse.
-- (We write explicit policies below rather than templating, for clarity.)

-- ---- Reference data + user directory: readable by all authenticated --------
create policy ref_read_currencies   on public.currencies        for select to authenticated using (true);
create policy ref_read_taxcodes     on public.tax_codes         for select to authenticated using (true);
create policy ref_read_uom          on public.units_of_measure  for select to authenticated using (true);
create policy ref_read_categories   on public.categories        for select to authenticated using (deleted_at is null);
create policy users_read_directory  on public.users             for select to authenticated using (true);

-- Reference data writes: refdata.manage
create policy ref_write_currencies  on public.currencies       for all to authenticated using (public.has_permission('refdata.manage')) with check (public.has_permission('refdata.manage'));
create policy ref_write_taxcodes    on public.tax_codes        for all to authenticated using (public.has_permission('refdata.manage')) with check (public.has_permission('refdata.manage'));
create policy ref_write_uom         on public.units_of_measure for all to authenticated using (public.has_permission('refdata.manage')) with check (public.has_permission('refdata.manage'));
create policy ref_write_categories  on public.categories       for all to authenticated using (public.has_permission('refdata.manage')) with check (public.has_permission('refdata.manage'));

-- ---- Identity --------------------------------------------------------------
create policy users_write   on public.users for update to authenticated
  using (public.has_permission('identity.users.edit') or id = auth.uid())
  with check (public.has_permission('identity.users.edit') or id = auth.uid());
create policy users_insert  on public.users for insert to authenticated
  with check (public.has_permission('identity.users.create'));

create policy roles_read    on public.roles for select to authenticated using (public.has_permission('identity.roles.view'));
create policy roles_write   on public.roles for all to authenticated
  using (public.has_permission('identity.roles.edit')) with check (public.has_permission('identity.roles.edit'));

create policy perms_read    on public.permissions for select to authenticated using (public.has_permission('identity.roles.view'));
create policy rp_read       on public.role_permissions for select to authenticated using (public.has_permission('identity.roles.view'));
create policy rp_write      on public.role_permissions for all to authenticated
  using (public.has_permission('identity.roles.edit')) with check (public.has_permission('identity.roles.edit'));

create policy ur_read       on public.user_roles for select to authenticated
  using (public.has_permission('identity.users.view') or user_id = auth.uid());
create policy ur_write      on public.user_roles for all to authenticated
  using (public.has_permission('identity.users.edit')) with check (public.has_permission('identity.users.edit'));

-- ---- Generic CRUD areas: SELECT by .view, writes by .create/.edit ----------
-- Org model
create policy org_inst_read  on public.institutions for select to authenticated using (public.has_permission('org.view'));
create policy org_inst_ins   on public.institutions for insert to authenticated with check (public.has_permission('org.create'));
create policy org_inst_upd   on public.institutions for update to authenticated using (public.has_permission('org.edit')) with check (public.has_permission('org.edit'));
create policy org_dept_read  on public.departments for select to authenticated using (public.has_permission('org.view'));
create policy org_dept_ins   on public.departments for insert to authenticated with check (public.has_permission('org.create'));
create policy org_dept_upd   on public.departments for update to authenticated using (public.has_permission('org.edit')) with check (public.has_permission('org.edit'));
create policy org_proj_read  on public.projects for select to authenticated using (public.has_permission('org.view'));
create policy org_proj_ins   on public.projects for insert to authenticated with check (public.has_permission('org.create'));
create policy org_proj_upd   on public.projects for update to authenticated using (public.has_permission('org.edit')) with check (public.has_permission('org.edit'));
create policy org_loc_read   on public.locations for select to authenticated using (public.has_permission('org.view'));
create policy org_loc_ins    on public.locations for insert to authenticated with check (public.has_permission('org.create'));
create policy org_loc_upd    on public.locations for update to authenticated using (public.has_permission('org.edit')) with check (public.has_permission('org.edit'));
create policy org_cc_read    on public.cost_centers for select to authenticated using (public.has_permission('org.view'));
create policy org_cc_ins     on public.cost_centers for insert to authenticated with check (public.has_permission('org.create'));
create policy org_cc_upd     on public.cost_centers for update to authenticated using (public.has_permission('org.edit')) with check (public.has_permission('org.edit'));

-- Chart of accounts
create policy coa_acc_read   on public.accounts for select to authenticated using (public.has_permission('coa.view'));
create policy coa_acc_ins    on public.accounts for insert to authenticated with check (public.has_permission('coa.edit'));
create policy coa_acc_upd    on public.accounts for update to authenticated using (public.has_permission('coa.edit')) with check (public.has_permission('coa.edit'));
create policy coa_per_read   on public.fiscal_periods for select to authenticated using (public.has_permission('coa.view'));
create policy coa_per_write  on public.fiscal_periods for all to authenticated using (public.has_permission('coa.edit')) with check (public.has_permission('coa.edit'));
create policy coa_ob_read    on public.opening_balances for select to authenticated using (public.has_permission('coa.view'));
create policy coa_ob_write   on public.opening_balances for all to authenticated using (public.has_permission('coa.edit')) with check (public.has_permission('coa.edit'));

-- Parties
create policy party_read     on public.parties for select to authenticated using (public.has_permission('parties.view'));
create policy party_ins      on public.parties for insert to authenticated with check (public.has_permission('parties.create'));
create policy party_upd      on public.parties for update to authenticated using (public.has_permission('parties.edit')) with check (public.has_permission('parties.edit'));
create policy pt_read        on public.party_types for select to authenticated using (public.has_permission('parties.view'));
create policy pt_write       on public.party_types for all to authenticated using (public.has_permission('parties.edit')) with check (public.has_permission('parties.edit'));
create policy pc_read        on public.party_contacts for select to authenticated using (public.has_permission('parties.view'));
create policy pc_write       on public.party_contacts for all to authenticated using (public.has_permission('parties.edit')) with check (public.has_permission('parties.edit'));
create policy pb_read        on public.party_bank_details for select to authenticated using (public.has_permission('parties.view'));
create policy pb_write       on public.party_bank_details for all to authenticated using (public.has_permission('parties.edit')) with check (public.has_permission('parties.edit'));

-- Documents (any authenticated with documents.view can read; create/delete gated)
create policy doc_read       on public.documents for select to authenticated using (public.has_permission('documents.view'));
create policy doc_ins        on public.documents for insert to authenticated with check (public.has_permission('documents.create'));
create policy doc_upd        on public.documents for update to authenticated using (public.has_permission('documents.create')) with check (public.has_permission('documents.create'));
create policy docv_read      on public.document_versions for select to authenticated using (public.has_permission('documents.view'));
create policy docv_ins       on public.document_versions for insert to authenticated with check (public.has_permission('documents.create'));

-- Approvals
create policy ac_read   on public.approval_chains for select to authenticated using (public.has_permission('approvals.view'));
create policy ac_write  on public.approval_chains for all to authenticated using (public.has_permission('approvals.configure')) with check (public.has_permission('approvals.configure'));
create policy as_read   on public.approval_steps for select to authenticated using (public.has_permission('approvals.view'));
create policy as_write  on public.approval_steps for all to authenticated using (public.has_permission('approvals.configure')) with check (public.has_permission('approvals.configure'));
create policy ar_read   on public.approval_requests for select to authenticated using (public.has_permission('approvals.view') or requested_by = auth.uid());
create policy ar_write  on public.approval_requests for all to authenticated using (public.has_permission('approvals.act') or requested_by = auth.uid()) with check (public.has_permission('approvals.act') or requested_by = auth.uid());
create policy aa_read   on public.approval_actions for select to authenticated using (public.has_permission('approvals.view'));
create policy aa_write  on public.approval_actions for insert to authenticated with check (public.has_permission('approvals.act'));

-- Notifications (each user sees/updates their own)
create policy notif_read   on public.notifications for select to authenticated using (user_id = auth.uid());
create policy notif_upd    on public.notifications for update to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy np_read      on public.notification_prefs for select to authenticated using (user_id = auth.uid());
create policy np_write     on public.notification_prefs for all to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());

-- Audit log + events: read-only to the app, never writable via API.
create policy audit_read   on public.audit_log for select to authenticated using (public.has_permission('audit.view'));
create policy events_read  on public.events    for select to authenticated using (true);

-- id_sequences: no direct access needed (touched only by SECURITY DEFINER fn).
-- ============================================================================
-- 0013_seed.sql — baseline roles, permissions, reference data, storage bucket
-- Idempotent: safe to re-run.
-- ============================================================================

-- ---- Roles (PRD §1.2) ------------------------------------------------------
insert into public.roles (key, name, description, is_system) values
  ('super_admin',     'Super Admin',     'Everything, incl. user/role management and config', true),
  ('admin',           'Admin',           'All modules, no destructive config',                 true),
  ('finance',         'Finance',         'CoA, payables, receivables, payments, reports',      true),
  ('procurement',     'Procurement',     'Vendors, requisitions, POs, GRNs',                   true),
  ('hr',              'HR',              'People Ops modules',                                 true),
  ('project_manager', 'Project Manager', 'Projects, budgets, milestones',                      true),
  ('bd',              'Business Dev',    'CRM, opportunities, BD intelligence',                true),
  ('partner_manager', 'Partner Manager', 'Partners/parties, CRM pipeline, procurement',        true),
  ('sales_manager',   'Sales Manager',   'Revenue, CRM pipeline, parties, procurement',        true),
  ('field_officer',   'Field Officer',   'Mobile/field modules, asset deployment',             true),
  ('viewer',          'Viewer',          'Read-only across permitted modules',                 true)
on conflict (key) do nothing;

-- ---- Permissions -----------------------------------------------------------
insert into public.permissions (key, module, action, description) values
  ('identity.users.view',   'identity', 'view',   'View users'),
  ('identity.users.create', 'identity', 'create', 'Invite users'),
  ('identity.users.edit',   'identity', 'edit',   'Edit users'),
  ('identity.users.delete', 'identity', 'delete', 'Deactivate users'),
  ('identity.roles.view',   'identity', 'view',   'View roles'),
  ('identity.roles.create', 'identity', 'create', 'Create roles'),
  ('identity.roles.edit',   'identity', 'edit',   'Edit roles'),
  ('org.view',     'org', 'view',   'View org model'),
  ('org.create',   'org', 'create', 'Create org records'),
  ('org.edit',     'org', 'edit',   'Edit org records'),
  ('org.delete',   'org', 'delete', 'Delete org records'),
  ('coa.view',     'coa', 'view',   'View chart of accounts'),
  ('coa.edit',     'coa', 'edit',   'Edit chart of accounts'),
  ('parties.view',   'parties', 'view',   'View parties'),
  ('parties.create', 'parties', 'create', 'Create parties'),
  ('parties.edit',   'parties', 'edit',   'Edit parties'),
  ('parties.delete', 'parties', 'delete', 'Delete parties'),
  ('documents.view',   'documents', 'view',   'View documents'),
  ('documents.create', 'documents', 'create', 'Upload documents'),
  ('documents.delete', 'documents', 'delete', 'Delete documents'),
  ('approvals.view',      'approvals', 'view',      'View approvals'),
  ('approvals.configure', 'approvals', 'configure', 'Configure approval chains'),
  ('approvals.act',       'approvals', 'act',       'Act on approval requests'),
  ('refdata.manage', 'refdata', 'manage', 'Manage reference data'),
  ('audit.view',     'audit',   'view',   'View audit log')
on conflict (key) do nothing;

-- ---- Grant super_admin every permission ------------------------------------
insert into public.role_permissions (role_id, permission_id)
select r.id, p.id
from public.roles r cross join public.permissions p
where r.key = 'super_admin'
on conflict do nothing;

-- ---- admin: everything except role editing & destructive config ------------
insert into public.role_permissions (role_id, permission_id)
select r.id, p.id
from public.roles r join public.permissions p on p.key in (
  'identity.users.view','identity.users.create','identity.users.edit','identity.roles.view',
  'org.view','org.create','org.edit','coa.view','coa.edit',
  'parties.view','parties.create','parties.edit',
  'documents.view','documents.create','documents.delete',
  'approvals.view','approvals.configure','approvals.act','refdata.manage','audit.view'
)
where r.key = 'admin'
on conflict do nothing;

-- ---- finance ---------------------------------------------------------------
insert into public.role_permissions (role_id, permission_id)
select r.id, p.id
from public.roles r join public.permissions p on p.key in (
  'coa.view','coa.edit','parties.view','documents.view','documents.create',
  'approvals.view','approvals.act','org.view'
)
where r.key = 'finance'
on conflict do nothing;

-- ---- procurement -----------------------------------------------------------
insert into public.role_permissions (role_id, permission_id)
select r.id, p.id
from public.roles r join public.permissions p on p.key in (
  'parties.view','parties.create','parties.edit','documents.view','documents.create',
  'approvals.view','org.view'
)
where r.key = 'procurement'
on conflict do nothing;

-- ---- viewer: read-only across permitted areas ------------------------------
insert into public.role_permissions (role_id, permission_id)
select r.id, p.id
from public.roles r join public.permissions p on p.action = 'view'
where r.key = 'viewer'
on conflict do nothing;

-- ---- Reference data --------------------------------------------------------
insert into public.currencies (code, name, symbol, decimal_places) values
  ('KES','Kenyan Shilling','KSh',2),
  ('USD','US Dollar','$',2),
  ('EUR','Euro','€',2),
  ('GBP','Pound Sterling','£',2)
on conflict (code) do nothing;

insert into public.tax_codes (code, name, rate_pct, kra_code, active) values
  ('VAT16','VAT 16%',16.000,'A',true),
  ('VAT0','Zero Rated',0.000,'B',true),
  ('EXEMPT','Exempt',0.000,'E',true)
on conflict (code) do nothing;

insert into public.units_of_measure (code, name) values
  ('EA','Each'),('BOX','Box'),('KG','Kilogram'),('L','Litre'),
  ('M','Metre'),('HR','Hour'),('DAY','Day'),('SET','Set')
on conflict (code) do nothing;

insert into public.categories (domain, name) values
  ('expense','Utilities'),('expense','Office Supplies'),('expense','Travel'),
  ('asset','Cookers'),('asset','IT Equipment'),('asset','Furniture'),
  ('product','Services'),('product','Goods')
on conflict do nothing;

-- ---- Storage bucket for Documents service ----------------------------------
insert into storage.buckets (id, name, public)
values ('documents','documents', false)
on conflict (id) do nothing;
-- ============================================================================
-- 0014_module_helpers.sql — reusable installers so every Phase 2-11 table gets
-- the same spine guarantees (triggers, RLS, human codes) with one call each.
-- ============================================================================

-- Attach the 4 standard triggers to a table (skips ones whose columns are absent).
create or replace function public.apply_standard_triggers(p_table text)
returns void language plpgsql as $$
declare has_updated boolean; has_audit boolean;
begin
  select exists(select 1 from information_schema.columns
    where table_schema='public' and table_name=p_table and column_name='updated_at') into has_updated;
  select exists(select 1 from information_schema.columns
    where table_schema='public' and table_name=p_table and column_name='created_by') into has_audit;

  if has_updated then
    execute format('drop trigger if exists trg_set_updated_at on public.%I;
      create trigger trg_set_updated_at before update on public.%I
      for each row execute function public.set_updated_at();', p_table, p_table);
  end if;
  if has_audit then
    execute format('drop trigger if exists trg_set_audit_fields on public.%I;
      create trigger trg_set_audit_fields before insert or update on public.%I
      for each row execute function public.set_audit_fields();', p_table, p_table);
  end if;
  execute format('drop trigger if exists trg_audit on public.%I;
    create trigger trg_audit after insert or update or delete on public.%I
    for each row execute function public.audit_trigger();', p_table, p_table);
  execute format('drop trigger if exists trg_emit_event on public.%I;
    create trigger trg_emit_event after insert or update or delete on public.%I
    for each row execute function public.emit_event();', p_table, p_table);
end;
$$;

-- Enable RLS + create the 4 module-permission policies (<module>.view/create/edit/delete).
create or replace function public.apply_module_rls(p_table text, p_module text)
returns void language plpgsql as $$
begin
  execute format('alter table public.%I enable row level security;', p_table);
  execute format('drop policy if exists %I on public.%I;', p_table||'_sel', p_table);
  execute format('drop policy if exists %I on public.%I;', p_table||'_ins', p_table);
  execute format('drop policy if exists %I on public.%I;', p_table||'_upd', p_table);
  execute format('drop policy if exists %I on public.%I;', p_table||'_del', p_table);
  execute format($f$create policy %I on public.%I for select to authenticated using (public.has_permission('%s.view'));$f$,
    p_table||'_sel', p_table, p_module);
  execute format($f$create policy %I on public.%I for insert to authenticated with check (public.has_permission('%s.create'));$f$,
    p_table||'_ins', p_table, p_module);
  execute format($f$create policy %I on public.%I for update to authenticated using (public.has_permission('%s.edit')) with check (public.has_permission('%s.edit'));$f$,
    p_table||'_upd', p_table, p_module, p_module);
  execute format($f$create policy %I on public.%I for delete to authenticated using (public.has_permission('%s.delete'));$f$,
    p_table||'_del', p_table, p_module);
end;
$$;

-- Install a BEFORE INSERT trigger that fills a human-readable code (e.g. PO-00001).
create or replace function public.apply_code_default(p_table text, p_prefix text)
returns void language plpgsql as $$
begin
  -- one generated fn + trigger per (table) using the prefix baked in
  execute format($f$
    create or replace function public.%I() returns trigger language plpgsql as $body$
    begin
      if new.code is null or new.code = '' then
        new.code := public.next_human_id(%L);
      end if;
      return new;
    end; $body$;
  $f$, 'set_code_'||p_table, p_prefix);
  execute format('drop trigger if exists trg_set_code on public.%I;
    create trigger trg_set_code before insert on public.%I
    for each row execute function public.%I();', p_table, p_table, 'set_code_'||p_table);
end;
$$;

-- Seed a module's standard CRUD permissions and grant them to super_admin + admin.
create or replace function public.seed_module_permissions(p_module text, p_label text)
returns void language plpgsql as $$
declare act text; perm_id uuid;
begin
  foreach act in array array['view','create','edit','delete'] loop
    insert into public.permissions(key, module, action, description)
    values (p_module||'.'||act, p_module, act, p_label||' — '||act)
    on conflict (key) do nothing;
  end loop;
  -- super_admin already holds everything via is_super_admin(); grant admin too.
  insert into public.role_permissions(role_id, permission_id)
  select r.id, p.id from public.roles r join public.permissions p on p.module = p_module
  where r.key in ('super_admin','admin')
  on conflict do nothing;
  -- viewer gets read.
  insert into public.role_permissions(role_id, permission_id)
  select r.id, p.id from public.roles r join public.permissions p on p.module = p_module and p.action='view'
  where r.key = 'viewer'
  on conflict do nothing;
end;
$$;
-- ============================================================================
-- 0015_phase2_procure_to_pay.sql — PHASE 2 (PRD §2A-2H)
-- Closed loop: Vendor -> Requisition -> PO -> GRN -> Invoice -> Payment.
-- All reference spine entities (parties, accounts, cost centers) by ID.
-- ============================================================================

-- 2A Vendor Registry (extends spine parties type=vendor)
create table public.vendor_profiles (
  party_id              uuid primary key references public.parties(id) on delete cascade,
  kra_pin               text,
  tax_compliance_status text default 'unknown',
  tax_cert_expiry       date,
  category_id           uuid references public.categories(id),
  rating_avg            numeric(3,2) default 0,
  onboarding_status     text not null default 'draft',
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
  created_by uuid references public.users(id), updated_by uuid references public.users(id), deleted_at timestamptz
);
create table public.vendor_ratings (
  id uuid primary key default gen_random_uuid(),
  party_id uuid not null references public.parties(id) on delete cascade,
  po_id    uuid,
  score    int not null check (score between 1 and 5),
  comment  text,
  rated_by uuid references public.users(id),
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
  created_by uuid references public.users(id), updated_by uuid references public.users(id), deleted_at timestamptz
);

-- 2B Petty Cash
create table public.petty_cash_floats (
  id uuid primary key default gen_random_uuid(),
  custodian_user_id uuid references public.users(id),
  location_id uuid references public.locations(id),
  opening_amount_minor bigint not null default 0,
  balance_minor bigint not null default 0,
  currency_code text not null default 'KES',
  status text not null default 'active',
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
  created_by uuid references public.users(id), updated_by uuid references public.users(id), deleted_at timestamptz
);
create table public.petty_cash_vouchers (
  id uuid primary key default gen_random_uuid(),
  float_id uuid not null references public.petty_cash_floats(id),
  payee_party_id uuid references public.parties(id),
  amount_minor bigint not null,
  account_id uuid references public.accounts(id),
  category_id uuid references public.categories(id),
  receipt_document_id uuid references public.documents(id),
  description text,
  status text not null default 'posted',
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
  created_by uuid references public.users(id), updated_by uuid references public.users(id), deleted_at timestamptz
);
create table public.petty_cash_replenishments (
  id uuid primary key default gen_random_uuid(),
  float_id uuid not null references public.petty_cash_floats(id),
  amount_minor bigint not null,
  approval_request_id uuid references public.approval_requests(id),
  status text not null default 'pending',
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
  created_by uuid references public.users(id), updated_by uuid references public.users(id), deleted_at timestamptz
);

-- 2C Receipts & Expense Capture (OCR via Claude API at the app layer)
create table public.expense_receipts (
  id uuid primary key default gen_random_uuid(),
  document_id uuid references public.documents(id),
  vendor_party_id uuid references public.parties(id),
  receipt_date date,
  amount_minor bigint,
  tax_minor bigint default 0,
  currency_code text not null default 'KES',
  category_id uuid references public.categories(id),
  account_id uuid references public.accounts(id),
  ocr_confidence numeric(4,3),
  status text not null default 'draft',
  linked_voucher_id uuid references public.petty_cash_vouchers(id),
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
  created_by uuid references public.users(id), updated_by uuid references public.users(id), deleted_at timestamptz
);

-- 2D Purchase Requisitions
create table public.requisitions (
  id uuid primary key default gen_random_uuid(),
  code text unique,
  requested_by uuid references public.users(id),
  department_id uuid references public.departments(id),
  project_id uuid references public.projects(id),
  cost_center_id uuid references public.cost_centers(id),
  need_by_date date,
  status text not null default 'draft',  -- draft|pending_approval|approved|rejected|converted
  approval_request_id uuid references public.approval_requests(id),
  total_minor bigint not null default 0,
  currency_code text not null default 'KES',
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
  created_by uuid references public.users(id), updated_by uuid references public.users(id), deleted_at timestamptz
);
create table public.requisition_lines (
  id uuid primary key default gen_random_uuid(),
  req_id uuid not null references public.requisitions(id) on delete cascade,
  item_desc text not null,
  qty numeric(14,3) not null default 1,
  uom_code text references public.units_of_measure(code),
  est_unit_price_minor bigint not null default 0,
  account_id uuid references public.accounts(id),
  category_id uuid references public.categories(id)
);

-- 2E Purchase Orders
create table public.purchase_orders (
  id uuid primary key default gen_random_uuid(),
  code text unique,
  vendor_party_id uuid references public.parties(id),
  requisition_id uuid references public.requisitions(id),
  status text not null default 'draft',  -- draft|issued|partially_received|received|closed
  total_minor bigint not null default 0,
  currency_code text not null default 'KES',
  expected_date date,
  project_id uuid references public.projects(id),
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
  created_by uuid references public.users(id), updated_by uuid references public.users(id), deleted_at timestamptz
);
create table public.po_lines (
  id uuid primary key default gen_random_uuid(),
  po_id uuid not null references public.purchase_orders(id) on delete cascade,
  item_desc text not null,
  qty_ordered numeric(14,3) not null default 1,
  qty_received numeric(14,3) not null default 0,
  unit_price_minor bigint not null default 0,
  account_id uuid references public.accounts(id),
  tax_code text references public.tax_codes(code)
);

-- 2F Goods Received Notes
create table public.grns (
  id uuid primary key default gen_random_uuid(),
  code text unique,
  po_id uuid not null references public.purchase_orders(id),
  received_by uuid references public.users(id),
  received_date date default now(),
  status text not null default 'received',
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
  created_by uuid references public.users(id), updated_by uuid references public.users(id), deleted_at timestamptz
);
create table public.grn_lines (
  id uuid primary key default gen_random_uuid(),
  grn_id uuid not null references public.grns(id) on delete cascade,
  po_line_id uuid references public.po_lines(id),
  qty_received numeric(14,3) not null default 0,
  condition text,
  photo_document_id uuid references public.documents(id)
);

-- 2G Payables (vendor invoices, three-way match)
create table public.payable_invoices (
  id uuid primary key default gen_random_uuid(),
  code text unique,
  vendor_party_id uuid references public.parties(id),
  po_id uuid references public.purchase_orders(id),
  invoice_no text,
  invoice_date date,
  due_date date,
  amount_minor bigint not null default 0,
  tax_minor bigint not null default 0,
  currency_code text not null default 'KES',
  status text not null default 'draft',       -- draft|matched|approved|scheduled|paid
  match_status text not null default 'unmatched',
  approval_request_id uuid references public.approval_requests(id),
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
  created_by uuid references public.users(id), updated_by uuid references public.users(id), deleted_at timestamptz
);
create table public.payable_invoice_lines (
  id uuid primary key default gen_random_uuid(),
  invoice_id uuid not null references public.payable_invoices(id) on delete cascade,
  description text,
  qty numeric(14,3) default 1,
  unit_price_minor bigint default 0,
  account_id uuid references public.accounts(id),
  tax_code text references public.tax_codes(code)
);

-- 2H Payments
create table public.payment_runs (
  id uuid primary key default gen_random_uuid(),
  code text unique,
  run_date date default now(),
  status text not null default 'draft',
  total_minor bigint not null default 0,
  approval_request_id uuid references public.approval_requests(id),
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
  created_by uuid references public.users(id), updated_by uuid references public.users(id), deleted_at timestamptz
);
create table public.payments (
  id uuid primary key default gen_random_uuid(),
  run_id uuid references public.payment_runs(id),
  payable_invoice_id uuid references public.payable_invoices(id),
  vendor_party_id uuid references public.parties(id),
  method text check (method in ('mpesa','bank')),
  amount_minor bigint not null default 0,
  status text not null default 'pending',
  external_ref text,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
  created_by uuid references public.users(id), updated_by uuid references public.users(id), deleted_at timestamptz
);

-- ---- Wire spine guarantees ----
do $$
declare
  procurement_tbls text[] := array['vendor_profiles','vendor_ratings','requisitions','requisition_lines','purchase_orders','po_lines','grns','grn_lines'];
  finance_tbls text[] := array['petty_cash_floats','petty_cash_vouchers','petty_cash_replenishments','expense_receipts','payable_invoices','payable_invoice_lines','payment_runs','payments'];
  t text;
begin
  perform public.seed_module_permissions('procurement','Procurement');
  perform public.seed_module_permissions('finance','Finance');
  foreach t in array procurement_tbls loop
    perform public.apply_standard_triggers(t);
    perform public.apply_module_rls(t,'procurement');
  end loop;
  foreach t in array finance_tbls loop
    perform public.apply_standard_triggers(t);
    perform public.apply_module_rls(t,'finance');
  end loop;
  perform public.apply_code_default('requisitions','PR');
  perform public.apply_code_default('purchase_orders','PO');
  perform public.apply_code_default('grns','GRN');
  perform public.apply_code_default('payable_invoices','AP');
  perform public.apply_code_default('payment_runs','PAY');
end $$;
-- ============================================================================
-- 0016_phase3_revenue.sql — PHASE 3 (PRD §3A-3F) — money coming in.
-- ============================================================================

create table public.customer_profiles (
  party_id uuid primary key references public.parties(id) on delete cascade,
  billing_terms text,
  credit_limit_minor bigint default 0,
  kra_pin text,
  tier text,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
  created_by uuid references public.users(id), updated_by uuid references public.users(id), deleted_at timestamptz
);

create table public.quotations (
  id uuid primary key default gen_random_uuid(),
  code text unique,
  customer_party_id uuid references public.parties(id),
  version int not null default 1,
  valid_until date,
  status text not null default 'draft',
  total_minor bigint not null default 0,
  currency_code text not null default 'KES',
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
  created_by uuid references public.users(id), updated_by uuid references public.users(id), deleted_at timestamptz
);
create table public.quotation_lines (
  id uuid primary key default gen_random_uuid(),
  quotation_id uuid not null references public.quotations(id) on delete cascade,
  description text, qty numeric(14,3) default 1, unit_price_minor bigint default 0,
  tax_code text references public.tax_codes(code)
);

create table public.sales_orders (
  id uuid primary key default gen_random_uuid(),
  code text unique,
  customer_party_id uuid references public.parties(id),
  quotation_id uuid references public.quotations(id),
  project_id uuid references public.projects(id),
  status text not null default 'draft',
  total_minor bigint not null default 0,
  currency_code text not null default 'KES',
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
  created_by uuid references public.users(id), updated_by uuid references public.users(id), deleted_at timestamptz
);
create table public.so_milestones (
  id uuid primary key default gen_random_uuid(),
  so_id uuid not null references public.sales_orders(id) on delete cascade,
  name text not null, due_date date, amount_minor bigint default 0,
  billing_status text not null default 'pending'
);

create table public.receivable_invoices (
  id uuid primary key default gen_random_uuid(),
  code text unique,
  customer_party_id uuid references public.parties(id),
  so_id uuid references public.sales_orders(id),
  invoice_date date, due_date date,
  amount_minor bigint not null default 0, tax_minor bigint not null default 0,
  currency_code text not null default 'KES',
  etims_status text not null default 'pending', etims_ref text,
  status text not null default 'draft',
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
  created_by uuid references public.users(id), updated_by uuid references public.users(id), deleted_at timestamptz
);
create table public.receivable_invoice_lines (
  id uuid primary key default gen_random_uuid(),
  invoice_id uuid not null references public.receivable_invoices(id) on delete cascade,
  description text, qty numeric(14,3) default 1, unit_price_minor bigint default 0,
  tax_code text references public.tax_codes(code)
);

create table public.customer_receipts (
  id uuid primary key default gen_random_uuid(),
  code text unique,
  customer_party_id uuid references public.parties(id),
  invoice_id uuid references public.receivable_invoices(id),
  amount_minor bigint not null default 0,
  method text, external_ref text, received_date date default now(),
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
  created_by uuid references public.users(id), updated_by uuid references public.users(id), deleted_at timestamptz
);
create table public.dunning_log (
  id uuid primary key default gen_random_uuid(),
  invoice_id uuid references public.receivable_invoices(id),
  channel text, sent_at timestamptz default now(), note text
);

create table public.credit_notes (
  id uuid primary key default gen_random_uuid(),
  code text unique,
  customer_party_id uuid references public.parties(id),
  invoice_id uuid references public.receivable_invoices(id),
  reason text, amount_minor bigint not null default 0,
  status text not null default 'draft',
  approval_request_id uuid references public.approval_requests(id),
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
  created_by uuid references public.users(id), updated_by uuid references public.users(id), deleted_at timestamptz
);

do $$
declare t text;
declare tbls text[] := array['customer_profiles','quotations','quotation_lines','sales_orders','so_milestones','receivable_invoices','receivable_invoice_lines','customer_receipts','dunning_log','credit_notes'];
begin
  perform public.seed_module_permissions('revenue','Revenue');
  foreach t in array tbls loop
    perform public.apply_standard_triggers(t);
    perform public.apply_module_rls(t,'revenue');
  end loop;
  perform public.apply_code_default('quotations','QT');
  perform public.apply_code_default('sales_orders','SO');
  perform public.apply_code_default('receivable_invoices','AR');
  perform public.apply_code_default('customer_receipts','RCT');
  perform public.apply_code_default('credit_notes','CN');
end $$;
-- ============================================================================
-- 0017_phase4_people.sql — PHASE 4 People Operations (PRD §4A-4F)
-- ============================================================================

create table public.employee_profiles (
  party_id uuid primary key references public.parties(id) on delete cascade,
  staff_no text unique,
  department_id uuid references public.departments(id),
  job_title text, contract_type text, start_date date,
  nssf_no text, shif_no text, kra_pin text,
  bank_details_id uuid references public.party_bank_details(id),
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
  created_by uuid references public.users(id), updated_by uuid references public.users(id), deleted_at timestamptz
);
create table public.next_of_kin (
  id uuid primary key default gen_random_uuid(),
  party_id uuid not null references public.parties(id) on delete cascade,
  name text, relationship text, phone text
);

create table public.leave_types (
  id uuid primary key default gen_random_uuid(),
  name text not null, annual_days int default 0, accrual text,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
  created_by uuid references public.users(id), updated_by uuid references public.users(id), deleted_at timestamptz
);
create table public.leave_balances (
  id uuid primary key default gen_random_uuid(),
  employee_party_id uuid references public.parties(id),
  type_id uuid references public.leave_types(id),
  entitled numeric(6,2) default 0, taken numeric(6,2) default 0, remaining numeric(6,2) default 0
);
create table public.leave_applications (
  id uuid primary key default gen_random_uuid(),
  employee_party_id uuid references public.parties(id),
  type_id uuid references public.leave_types(id),
  start_date date, end_date date, days numeric(6,2),
  status text not null default 'pending',
  approval_request_id uuid references public.approval_requests(id),
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
  created_by uuid references public.users(id), updated_by uuid references public.users(id), deleted_at timestamptz
);

create table public.attendance (
  id uuid primary key default gen_random_uuid(),
  employee_party_id uuid references public.parties(id),
  date date, clock_in timestamptz, clock_out timestamptz, hours numeric(6,2),
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
  created_by uuid references public.users(id), updated_by uuid references public.users(id), deleted_at timestamptz
);
create table public.timesheet_entries (
  id uuid primary key default gen_random_uuid(),
  employee_party_id uuid references public.parties(id),
  date date, project_id uuid references public.projects(id), hours numeric(6,2), notes text,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
  created_by uuid references public.users(id), updated_by uuid references public.users(id), deleted_at timestamptz
);

create table public.salary_structures (
  id uuid primary key default gen_random_uuid(),
  employee_party_id uuid references public.parties(id),
  basic_minor bigint default 0, effective_date date,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
  created_by uuid references public.users(id), updated_by uuid references public.users(id), deleted_at timestamptz
);
create table public.pay_components (
  id uuid primary key default gen_random_uuid(),
  employee_party_id uuid references public.parties(id),
  kind text check (kind in ('allowance','deduction')),
  type text, amount_minor bigint default 0, recurring boolean default true,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
  created_by uuid references public.users(id), updated_by uuid references public.users(id), deleted_at timestamptz
);
create table public.hr_payroll_runs (
  id uuid primary key default gen_random_uuid(),
  period text, status text not null default 'draft',
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
  created_by uuid references public.users(id), updated_by uuid references public.users(id), deleted_at timestamptz
);

create table public.objectives (
  id uuid primary key default gen_random_uuid(),
  employee_party_id uuid references public.parties(id),
  cycle text, description text, weight numeric(5,2), status text default 'open', score numeric(5,2),
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
  created_by uuid references public.users(id), updated_by uuid references public.users(id), deleted_at timestamptz
);
create table public.performance_reviews (
  id uuid primary key default gen_random_uuid(),
  employee_party_id uuid references public.parties(id),
  cycle text, reviewer_user_id uuid references public.users(id), rating numeric(5,2), comments text,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
  created_by uuid references public.users(id), updated_by uuid references public.users(id), deleted_at timestamptz
);
create table public.one_on_ones (
  id uuid primary key default gen_random_uuid(),
  employee_party_id uuid references public.parties(id),
  manager_user_id uuid references public.users(id), date date, notes text,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
  created_by uuid references public.users(id), updated_by uuid references public.users(id), deleted_at timestamptz
);

create table public.hr_checklists (
  id uuid primary key default gen_random_uuid(),
  type text check (type in ('onboarding','offboarding')), template jsonb default '[]'::jsonb, name text,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
  created_by uuid references public.users(id), updated_by uuid references public.users(id), deleted_at timestamptz
);
create table public.hr_checklist_runs (
  id uuid primary key default gen_random_uuid(),
  employee_party_id uuid references public.parties(id),
  template_id uuid references public.hr_checklists(id),
  items jsonb default '[]'::jsonb, status text not null default 'in_progress',
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
  created_by uuid references public.users(id), updated_by uuid references public.users(id), deleted_at timestamptz
);

do $$
declare t text;
declare tbls text[] := array['employee_profiles','next_of_kin','leave_types','leave_balances','leave_applications','attendance','timesheet_entries','salary_structures','pay_components','hr_payroll_runs','objectives','performance_reviews','one_on_ones','hr_checklists','hr_checklist_runs'];
begin
  perform public.seed_module_permissions('people','People Ops');
  foreach t in array tbls loop
    perform public.apply_standard_triggers(t);
    perform public.apply_module_rls(t,'people');
  end loop;
end $$;
-- ============================================================================
-- 0018_phase5_assets.sql — PHASE 5 Asset & Inventory (PRD §5A-5E)
-- ============================================================================

create table public.assets (
  id uuid primary key default gen_random_uuid(),
  code text unique,
  name text not null,
  category_id uuid references public.categories(id),
  serial_no text,
  location_id uuid references public.locations(id),
  custodian_user_id uuid references public.users(id),
  purchase_po_id uuid references public.purchase_orders(id),
  cost_minor bigint default 0,
  depreciation_method text default 'straight_line',
  useful_life_months int,
  nbv_minor bigint default 0,
  qr_code text,
  status text not null default 'in_store',
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
  created_by uuid references public.users(id), updated_by uuid references public.users(id), deleted_at timestamptz
);
create table public.asset_events (
  id uuid primary key default gen_random_uuid(),
  asset_id uuid not null references public.assets(id) on delete cascade,
  type text check (type in ('acquired','deployed','maintained','transferred','disposed')),
  event_date date default now(),
  from_location_id uuid references public.locations(id),
  to_location_id uuid references public.locations(id),
  notes text,
  approval_request_id uuid references public.approval_requests(id),
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
  created_by uuid references public.users(id), updated_by uuid references public.users(id), deleted_at timestamptz
);

create table public.stock_items (
  id uuid primary key default gen_random_uuid(),
  name text not null, uom_code text references public.units_of_measure(code),
  reorder_point numeric(14,3) default 0, category_id uuid references public.categories(id),
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
  created_by uuid references public.users(id), updated_by uuid references public.users(id), deleted_at timestamptz
);
create table public.stock_levels (
  id uuid primary key default gen_random_uuid(),
  item_id uuid references public.stock_items(id), location_id uuid references public.locations(id),
  qty numeric(14,3) default 0, unique(item_id, location_id)
);
create table public.stock_movements (
  id uuid primary key default gen_random_uuid(),
  item_id uuid references public.stock_items(id),
  from_location_id uuid references public.locations(id),
  to_location_id uuid references public.locations(id),
  qty numeric(14,3), type text, ref text,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
  created_by uuid references public.users(id), updated_by uuid references public.users(id), deleted_at timestamptz
);

create table public.maintenance_schedules (
  id uuid primary key default gen_random_uuid(),
  asset_id uuid references public.assets(id), frequency text, next_due date,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
  created_by uuid references public.users(id), updated_by uuid references public.users(id), deleted_at timestamptz
);
create table public.work_orders (
  id uuid primary key default gen_random_uuid(),
  code text unique,
  asset_id uuid references public.assets(id), type text, status text not null default 'open',
  assignee_user_id uuid references public.users(id), parts jsonb default '[]'::jsonb,
  approval_request_id uuid references public.approval_requests(id),
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
  created_by uuid references public.users(id), updated_by uuid references public.users(id), deleted_at timestamptz
);

create table public.deployments (
  id uuid primary key default gen_random_uuid(),
  asset_id uuid references public.assets(id),
  institution_id uuid references public.institutions(id),
  deployed_date date default now(), condition text, status text not null default 'active',
  field_officer_id uuid references public.users(id), photo_document_id uuid references public.documents(id),
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
  created_by uuid references public.users(id), updated_by uuid references public.users(id), deleted_at timestamptz
);

do $$
declare t text;
declare tbls text[] := array['assets','asset_events','stock_items','stock_levels','stock_movements','maintenance_schedules','work_orders','deployments'];
begin
  perform public.seed_module_permissions('assets','Assets & Inventory');
  foreach t in array tbls loop
    perform public.apply_standard_triggers(t);
    perform public.apply_module_rls(t,'assets');
  end loop;
  perform public.apply_code_default('assets','AST');
  perform public.apply_code_default('work_orders','WO');
end $$;
-- ============================================================================
-- 0019_phase6_projects.sql — PHASE 6 Project & Programme Management (PRD §6A-6F)
-- Extends spine projects; project procurement reuses Phase 2 (filtered by project_id).
-- ============================================================================

create table public.project_details (
  project_id uuid primary key references public.projects(id) on delete cascade,
  funder_party_id uuid references public.parties(id),
  total_budget_minor bigint default 0, currency_code text not null default 'KES',
  manager_user_id uuid references public.users(id), status text not null default 'active',
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
  created_by uuid references public.users(id), updated_by uuid references public.users(id), deleted_at timestamptz
);
create table public.project_team (
  id uuid primary key default gen_random_uuid(),
  project_id uuid references public.projects(id) on delete cascade,
  user_id uuid references public.users(id), role text, unique(project_id, user_id)
);
create table public.project_budgets (
  id uuid primary key default gen_random_uuid(),
  project_id uuid references public.projects(id) on delete cascade,
  cost_center_id uuid references public.cost_centers(id),
  line text, budget_minor bigint default 0,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
  created_by uuid references public.users(id), updated_by uuid references public.users(id), deleted_at timestamptz
);
create table public.milestones (
  id uuid primary key default gen_random_uuid(),
  project_id uuid references public.projects(id) on delete cascade,
  name text not null, due_date date, status text not null default 'pending',
  deliverable_document_id uuid references public.documents(id),
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
  created_by uuid references public.users(id), updated_by uuid references public.users(id), deleted_at timestamptz
);
create table public.funder_reports (
  id uuid primary key default gen_random_uuid(),
  project_id uuid references public.projects(id) on delete cascade,
  period text, status text not null default 'pending', submitted_date date,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
  created_by uuid references public.users(id), updated_by uuid references public.users(id), deleted_at timestamptz
);
create table public.grants (
  id uuid primary key default gen_random_uuid(),
  funder_party_id uuid references public.parties(id),
  project_id uuid references public.projects(id),
  agreement_document_id uuid references public.documents(id),
  total_minor bigint default 0, currency_code text not null default 'KES',
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
  created_by uuid references public.users(id), updated_by uuid references public.users(id), deleted_at timestamptz
);
create table public.drawdowns (
  id uuid primary key default gen_random_uuid(),
  grant_id uuid references public.grants(id) on delete cascade,
  tranche text, amount_minor bigint default 0, due_date date, status text not null default 'scheduled'
);
create table public.field_activities (
  id uuid primary key default gen_random_uuid(),
  project_id uuid references public.projects(id),
  institution_id uuid references public.institutions(id),
  type text, activity_date date default now(), officer_user_id uuid references public.users(id),
  notes text, geo_lat double precision, geo_lng double precision, photos jsonb default '[]'::jsonb,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
  created_by uuid references public.users(id), updated_by uuid references public.users(id), deleted_at timestamptz
);

do $$
declare t text;
declare tbls text[] := array['project_details','project_team','project_budgets','milestones','funder_reports','grants','drawdowns','field_activities'];
begin
  perform public.seed_module_permissions('projects','Projects');
  foreach t in array tbls loop
    perform public.apply_standard_triggers(t);
    perform public.apply_module_rls(t,'projects');
  end loop;
end $$;
-- ============================================================================
-- 0020_phase7_crm.sql — PHASE 7 Partnerships, Pipeline & CRM (PRD §7A-7J)
-- ONE CRM module, two views (upstream/downstream). Built on spine parties.
-- ============================================================================

create table public.partner_profiles (
  party_id uuid primary key references public.parties(id) on delete cascade,
  relationship_types text[] default '{}',  -- funder|investor|ta|government|convener|institution|distributor|epc|manufacturer
  tier text, owner_user_id uuid references public.users(id),
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
  created_by uuid references public.users(id), updated_by uuid references public.users(id), deleted_at timestamptz
);

create table public.engagements (
  id uuid primary key default gen_random_uuid(),
  code text unique,
  partner_party_id uuid references public.parties(id),
  stage text, priority text, owner_user_id uuid references public.users(id),
  status text not null default 'active', next_action text, due_by date,
  view text not null default 'upstream' check (view in ('upstream','downstream')),
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
  created_by uuid references public.users(id), updated_by uuid references public.users(id), deleted_at timestamptz
);
create index on public.engagements(view);
create index on public.engagements(owner_user_id);

create table public.engagement_updates (
  id uuid primary key default gen_random_uuid(),
  engagement_id uuid not null references public.engagements(id) on delete cascade,
  update_date date default now(), channel text, summary text, logged_by uuid references public.users(id),
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
  created_by uuid references public.users(id), updated_by uuid references public.users(id), deleted_at timestamptz
);
create table public.action_items (
  id uuid primary key default gen_random_uuid(),
  engagement_id uuid references public.engagements(id) on delete cascade,
  description text not null, owner_user_id uuid references public.users(id),
  due_date date, status text not null default 'open',
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
  created_by uuid references public.users(id), updated_by uuid references public.users(id), deleted_at timestamptz
);

create table public.institution_pipeline (
  id uuid primary key default gen_random_uuid(),
  institution_id uuid references public.institutions(id),
  tier text, status text, eoi_stage text, owner_user_id uuid references public.users(id),
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
  created_by uuid references public.users(id), updated_by uuid references public.users(id), deleted_at timestamptz
);
create table public.eois (
  id uuid primary key default gen_random_uuid(),
  institution_id uuid references public.institutions(id),
  submitted_date date, status text not null default 'received',
  converted_to_so_id uuid references public.sales_orders(id),
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
  created_by uuid references public.users(id), updated_by uuid references public.users(id), deleted_at timestamptz
);
create table public.opportunities (
  id uuid primary key default gen_random_uuid(),
  title text not null, funder_party_id uuid references public.parties(id),
  type text, deadline date, status text not null default 'open', source_url text,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
  created_by uuid references public.users(id), updated_by uuid references public.users(id), deleted_at timestamptz
);

do $$
declare t text;
declare tbls text[] := array['partner_profiles','engagements','engagement_updates','action_items','institution_pipeline','eois','opportunities'];
begin
  perform public.seed_module_permissions('crm','CRM');
  -- BD role gets CRM access too.
  insert into public.role_permissions(role_id, permission_id)
  select r.id, p.id from public.roles r join public.permissions p on p.module='crm'
  where r.key='bd' on conflict do nothing;
  foreach t in array tbls loop
    perform public.apply_standard_triggers(t);
    perform public.apply_module_rls(t,'crm');
  end loop;
  perform public.apply_code_default('engagements','ENG');
end $$;
-- ============================================================================
-- 0021_phase8_intelligence.sql — PHASE 8 Intelligence & Reporting (PRD §8B-8H)
-- Home Dashboard (8A) is already live and stores nothing of its own.
-- ============================================================================

create table public.kpis (
  id uuid primary key default gen_random_uuid(),
  name text not null, formula text, target numeric, module_source text,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
  created_by uuid references public.users(id), updated_by uuid references public.users(id), deleted_at timestamptz
);
create table public.kpi_values (
  id uuid primary key default gen_random_uuid(),
  kpi_id uuid references public.kpis(id) on delete cascade,
  period text, value numeric
);
create table public.impact_metrics (
  id uuid primary key default gen_random_uuid(),
  type text not null, value numeric, period text,
  project_id uuid references public.projects(id), public_visible boolean not null default false,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
  created_by uuid references public.users(id), updated_by uuid references public.users(id), deleted_at timestamptz
);
create table public.alert_rules (
  id uuid primary key default gen_random_uuid(),
  name text not null, condition jsonb default '{}'::jsonb, channel text default 'in_app',
  recipients jsonb default '[]'::jsonb, active boolean not null default true,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
  created_by uuid references public.users(id), updated_by uuid references public.users(id), deleted_at timestamptz
);

do $$
declare t text;
declare tbls text[] := array['kpis','kpi_values','impact_metrics','alert_rules'];
begin
  perform public.seed_module_permissions('intelligence','Intelligence');
  foreach t in array tbls loop
    perform public.apply_standard_triggers(t);
    perform public.apply_module_rls(t,'intelligence');
  end loop;
end $$;
-- ============================================================================
-- 0022_phase9_governance.sql — PHASE 9 Governance, Compliance & Diligence (§9A-9F)
-- ============================================================================

create table public.contracts (
  id uuid primary key default gen_random_uuid(),
  code text unique,
  type text, counterparty_party_id uuid references public.parties(id),
  start_date date, end_date date, value_minor bigint default 0,
  document_id uuid references public.documents(id), status text not null default 'active',
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
  created_by uuid references public.users(id), updated_by uuid references public.users(id), deleted_at timestamptz
);
create table public.compliance_obligations (
  id uuid primary key default gen_random_uuid(),
  name text not null, authority text, frequency text, next_due date,
  owner_user_id uuid references public.users(id), status text not null default 'pending',
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
  created_by uuid references public.users(id), updated_by uuid references public.users(id), deleted_at timestamptz
);
create table public.policies (
  id uuid primary key default gen_random_uuid(),
  title text not null, category text, current_version int default 1,
  document_id uuid references public.documents(id), status text not null default 'active',
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
  created_by uuid references public.users(id), updated_by uuid references public.users(id), deleted_at timestamptz
);
create table public.policy_versions (
  id uuid primary key default gen_random_uuid(),
  policy_id uuid references public.policies(id) on delete cascade,
  version int, document_id uuid references public.documents(id), created_at timestamptz not null default now()
);
create table public.risks (
  id uuid primary key default gen_random_uuid(),
  description text not null, likelihood int check (likelihood between 1 and 5),
  impact int check (impact between 1 and 5),
  score int generated always as (likelihood * impact) stored,
  owner_user_id uuid references public.users(id), mitigation text, status text not null default 'open',
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
  created_by uuid references public.users(id), updated_by uuid references public.users(id), deleted_at timestamptz
);
create table public.board_members (
  id uuid primary key default gen_random_uuid(),
  party_id uuid references public.parties(id), role text, appointed_date date,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
  created_by uuid references public.users(id), updated_by uuid references public.users(id), deleted_at timestamptz
);
create table public.board_meetings (
  id uuid primary key default gen_random_uuid(),
  meeting_date date, minutes_document_id uuid references public.documents(id), notes text,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
  created_by uuid references public.users(id), updated_by uuid references public.users(id), deleted_at timestamptz
);
create table public.resolutions (
  id uuid primary key default gen_random_uuid(),
  meeting_id uuid references public.board_meetings(id), title text, outcome text,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
  created_by uuid references public.users(id), updated_by uuid references public.users(id), deleted_at timestamptz
);
create table public.shareholding (
  id uuid primary key default gen_random_uuid(),
  party_id uuid references public.parties(id), shares bigint, pct numeric(6,3),
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
  created_by uuid references public.users(id), updated_by uuid references public.users(id), deleted_at timestamptz
);
create table public.dataroom_shares (
  id uuid primary key default gen_random_uuid(),
  name text, document_ids jsonb default '[]'::jsonb,
  shared_with_party_id uuid references public.parties(id),
  expires_at timestamptz, created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid references public.users(id), updated_by uuid references public.users(id), deleted_at timestamptz
);

do $$
declare t text;
declare tbls text[] := array['contracts','compliance_obligations','policies','policy_versions','risks','board_members','board_meetings','resolutions','shareholding','dataroom_shares'];
begin
  perform public.seed_module_permissions('governance','Governance');
  foreach t in array tbls loop
    perform public.apply_standard_triggers(t);
    perform public.apply_module_rls(t,'governance');
  end loop;
  perform public.apply_code_default('contracts','CTR');
end $$;
-- ============================================================================
-- 0023_phase10_field.sql — PHASE 10 Field & Mobile (PRD §10A-10D)
-- Mobile (PWA) reuses GRN/deployment/field-activity tables. New: portals + tickets.
-- ============================================================================

create table public.support_tickets (
  id uuid primary key default gen_random_uuid(),
  code text unique,
  institution_id uuid references public.institutions(id),
  subject text not null, body text, status text not null default 'open',
  priority text not null default 'normal', raised_by uuid references public.users(id),
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
  created_by uuid references public.users(id), updated_by uuid references public.users(id), deleted_at timestamptz
);
create table public.ticket_comments (
  id uuid primary key default gen_random_uuid(),
  ticket_id uuid references public.support_tickets(id) on delete cascade,
  author_user_id uuid references public.users(id), body text, created_at timestamptz not null default now()
);

do $$
declare t text;
declare tbls text[] := array['support_tickets','ticket_comments'];
begin
  perform public.seed_module_permissions('field','Field & Portals');
  -- field_officer role gets field + assets access.
  insert into public.role_permissions(role_id, permission_id)
  select r.id, p.id from public.roles r join public.permissions p on p.module in ('field','assets')
  where r.key='field_officer' on conflict do nothing;
  foreach t in array tbls loop
    perform public.apply_standard_triggers(t);
    perform public.apply_module_rls(t,'field');
  end loop;
  perform public.apply_code_default('support_tickets','TKT');
end $$;

-- Public impact view (PRD §10D) — whitelisted metrics only, readable without auth.
create or replace view public.public_impact_metrics as
  select type, value, period from public.impact_metrics
  where public_visible = true and deleted_at is null;
-- ============================================================================
-- 0024_phase11_bd.sql — PHASE 11 Business Development Intelligence (§11A-11F)
-- Scans the whole spine (single-query, enabled by one-CRM design) to draft concepts.
-- ============================================================================

create table public.concepts (
  id uuid primary key default gen_random_uuid(),
  code text unique,
  opportunity_id uuid references public.opportunities(id),
  title text, status text not null default 'draft',  -- draft|review|submitted|won|lost
  assigned_to uuid references public.users(id),
  document_id uuid references public.documents(id),
  checklist jsonb default '[]'::jsonb,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
  created_by uuid references public.users(id), updated_by uuid references public.users(id), deleted_at timestamptz
);
create table public.capability_snapshots (
  id uuid primary key default gen_random_uuid(),
  opportunity_id uuid references public.opportunities(id),
  concept_id uuid references public.concepts(id),
  snapshot jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

do $$
declare t text;
declare tbls text[] := array['concepts','capability_snapshots'];
begin
  perform public.seed_module_permissions('bd','Business Development');
  insert into public.role_permissions(role_id, permission_id)
  select r.id, p.id from public.roles r join public.permissions p on p.module='bd'
  where r.key='bd' on conflict do nothing;
  foreach t in array tbls loop
    perform public.apply_standard_triggers(t);
    perform public.apply_module_rls(t,'bd');
  end loop;
  perform public.apply_code_default('concepts','CPT');
end $$;
-- ============================================================================
-- 0025_fix_sequence_security.sql
-- next_human_id() writes to id_sequences (RLS-protected). It must run as
-- SECURITY DEFINER so human-code generation works under a normal user session.
-- ============================================================================

create or replace function public.next_human_id(p_prefix text)
returns text language plpgsql security definer set search_path = public as $$
declare
  v_val bigint;
  v_pad int;
begin
  insert into public.id_sequences(prefix) values (p_prefix)
    on conflict (prefix) do nothing;

  update public.id_sequences
     set next_val = next_val + 1
   where prefix = p_prefix
  returning next_val - 1, pad into v_val, v_pad;

  return p_prefix || '-' || lpad(v_val::text, v_pad, '0');
end;
$$;

-- ============================================================================
-- 0028_partner_manager.sql — grant the Partner Manager role its module access.
-- Runs after every module's permissions are seeded (procurement, crm), so the
-- keys it references already exist. Idempotent: safe to re-run.
-- Partner Manager works across partners/parties, the CRM pipeline, and
-- procurement: view/create/edit on each (no destructive delete).
-- ============================================================================

insert into public.role_permissions (role_id, permission_id)
select r.id, p.id
from public.roles r
join public.permissions p
  on p.module in ('parties', 'crm', 'procurement')
 and p.action in ('view', 'create', 'edit')
where r.key = 'partner_manager'
on conflict do nothing;

-- ============================================================================
-- 0029_sales_manager.sql — grant the Sales Manager role its module access.
-- Runs after every module's permissions are seeded (procurement, revenue, crm),
-- so the keys it references already exist. Idempotent: safe to re-run.
-- Sales Manager works across revenue, the CRM pipeline, parties, and
-- procurement: view/create/edit on each (no destructive delete).
-- ============================================================================

insert into public.role_permissions (role_id, permission_id)
select r.id, p.id
from public.roles r
join public.permissions p
  on p.module in ('revenue', 'crm', 'parties', 'procurement')
 and p.action in ('view', 'create', 'edit')
where r.key = 'sales_manager'
on conflict do nothing;
-- ============================================================================
-- 0030_partner_manager_experience.sql — engagement title, CRM/leave grants,
-- leave-type seed. Idempotent: safe to re-run.
-- ============================================================================

-- 1. Free-text engagement name (the "engagement name" a manager types).
alter table public.engagements add column if not exists title text;

-- 2. HR can view the CRM pipeline/engagements, so partner-created rows are
--    visible across the org (admin & sales_manager already have crm).
insert into public.role_permissions (role_id, permission_id)
select r.id, p.id from public.roles r
join public.permissions p on p.module = 'crm' and p.action = 'view'
where r.key = 'hr'
on conflict do nothing;

-- 3. Partner Manager can file leave (people view/create/edit). Their nav only
--    surfaces Leave Application from the People area (see ROLE_NAV).
insert into public.role_permissions (role_id, permission_id)
select r.id, p.id from public.roles r
join public.permissions p on p.module = 'people' and p.action in ('view', 'create', 'edit')
where r.key = 'partner_manager'
on conflict do nothing;

-- 4. Partner Manager no longer needs procurement (not in their nav).
delete from public.role_permissions rp
using public.roles r, public.permissions p
where rp.role_id = r.id and rp.permission_id = p.id
  and r.key = 'partner_manager' and p.module = 'procurement';

-- 5. Seed baseline leave types so the Leave Application form is usable.
insert into public.leave_types (name, annual_days, accrual)
select v.name, v.days, 'annual'
from (values ('Annual', 21), ('Sick', 14), ('Compassionate', 5)) as v(name, days)
where not exists (select 1 from public.leave_types lt where lt.name = v.name and lt.deleted_at is null);
-- ============================================================================
-- 0031_tasks_and_self_leave.sql — personal tasks + self-service leave.
-- Idempotent: safe to re-run.
-- ============================================================================

-- ---- Tasks -----------------------------------------------------------------
-- User-scoped (not module-scoped): you see/manage tasks you own or are assigned.
-- assigned_by/assignee_id let HR assign tasks to others later (HR is the creator,
-- which the insert policy already permits).
create table if not exists public.tasks (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  description text,
  status text not null default 'pending' check (status in ('pending', 'in_progress', 'done')),
  priority text default 'medium',
  due_date date,
  assignee_id uuid references public.users(id),
  assigned_by uuid references public.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid references public.users(id),
  updated_by uuid references public.users(id),
  deleted_at timestamptz
);

select public.apply_standard_triggers('tasks');

alter table public.tasks enable row level security;
drop policy if exists tasks_sel on public.tasks;
drop policy if exists tasks_ins on public.tasks;
drop policy if exists tasks_upd on public.tasks;
drop policy if exists tasks_del on public.tasks;
create policy tasks_sel on public.tasks for select to authenticated
  using (assignee_id = auth.uid() or created_by = auth.uid());
create policy tasks_ins on public.tasks for insert to authenticated
  with check (created_by = auth.uid() or assignee_id = auth.uid());
create policy tasks_upd on public.tasks for update to authenticated
  using (assignee_id = auth.uid() or created_by = auth.uid())
  with check (assignee_id = auth.uid() or created_by = auth.uid());
create policy tasks_del on public.tasks for delete to authenticated
  using (created_by = auth.uid());

-- ---- Self-service leave ----------------------------------------------------
-- Tie a leave application to the applying user so anyone can apply for their own
-- leave (in addition to the existing people.* policies used for HR oversight).
alter table public.leave_applications add column if not exists user_id uuid references public.users(id);

drop policy if exists leave_self_sel on public.leave_applications;
drop policy if exists leave_self_ins on public.leave_applications;
drop policy if exists leave_self_upd on public.leave_applications;
drop policy if exists leave_self_del on public.leave_applications;
create policy leave_self_sel on public.leave_applications for select to authenticated
  using (user_id = auth.uid());
create policy leave_self_ins on public.leave_applications for insert to authenticated
  with check (user_id = auth.uid());
create policy leave_self_upd on public.leave_applications for update to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy leave_self_del on public.leave_applications for delete to authenticated
  using (user_id = auth.uid());
-- ============================================================================
-- 0032_hr_people_grants.sql — give HR ownership of the People module so HR can
-- view employees/leave and approve leave applications. Idempotent.
-- ============================================================================

insert into public.role_permissions (role_id, permission_id)
select r.id, p.id from public.roles r
join public.permissions p on p.module = 'people' and p.action in ('view', 'create', 'edit', 'delete')
where r.key = 'hr'
on conflict do nothing;

-- ============================================================================
-- 0033_task_assignment_notify.sql — track task-assignment email delivery.
-- When HR assigns a task to a team member, the row sits with notified_at = null
-- until scripts/send-task-assignments.mjs emails the assignee (then stamps it),
-- so an assignee is mailed exactly once. Idempotent: safe to re-run.
-- ============================================================================

alter table public.tasks add column if not exists notified_at timestamptz;

-- Helps the mailer find the un-notified assigned tasks quickly.
create index if not exists tasks_pending_notify_idx
  on public.tasks (created_at)
  where notified_at is null and assigned_by is not null;

-- ============================================================================
-- 0034_payment_requests.sql — self-service payment / reimbursement requests.
-- A user submits a request (title, amount, date, short description); it sits
-- pending until an admin OR HR approves/rejects it. After approval, admin/HR
-- marks it paid once cash is disbursed (handled manually — no card/M-Pesa).
-- Mirrors the self-service leave flow (0031): the requester is scoped to their
-- own rows via user_id; approvers see/act on all rows via the 'payments' module
-- permission. Idempotent: safe to re-run.
-- ============================================================================

-- ---- Permissions -----------------------------------------------------------
-- Seed payments.view/create/edit/delete and grant to super_admin + admin (and
-- view to viewer). Then give HR the whole module so HR can approve alongside admin.
select public.seed_module_permissions('payments', 'Payment requests');

insert into public.role_permissions (role_id, permission_id)
select r.id, p.id from public.roles r
join public.permissions p on p.module = 'payments'
where r.key = 'hr'
on conflict do nothing;

-- ---- Table -----------------------------------------------------------------
-- Money stored in integer minor units (cents) to match the rest of the system
-- (see formatMoney in src/lib/utils.ts). status walks
-- pending -> approved -> paid, with rejected / cancelled as terminal branches.
create table if not exists public.payment_requests (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  amount_minor bigint not null check (amount_minor > 0),
  currency text not null default 'KES',
  request_date date not null default current_date,
  description text,
  status text not null default 'pending'
    check (status in ('pending', 'approved', 'rejected', 'paid', 'cancelled')),
  decided_by uuid references public.users(id),
  decided_at timestamptz,
  decision_note text,
  paid_by uuid references public.users(id),
  paid_at timestamptz,
  user_id uuid references public.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid references public.users(id),
  updated_by uuid references public.users(id),
  deleted_at timestamptz
);

select public.apply_standard_triggers('payment_requests');

-- ---- RLS -------------------------------------------------------------------
alter table public.payment_requests enable row level security;
drop policy if exists payreq_sel on public.payment_requests;
drop policy if exists payreq_ins on public.payment_requests;
drop policy if exists payreq_upd on public.payment_requests;
drop policy if exists payreq_del on public.payment_requests;

-- See your own requests; approvers (admin / HR) see everyone's.
create policy payreq_sel on public.payment_requests for select to authenticated
  using (user_id = auth.uid() or public.has_module_access('payments'));
-- Anyone can file a request for themselves.
create policy payreq_ins on public.payment_requests for insert to authenticated
  with check (user_id = auth.uid());
-- Requester can edit/cancel their own; approvers can act on any.
create policy payreq_upd on public.payment_requests for update to authenticated
  using (user_id = auth.uid() or public.has_module_access('payments'))
  with check (user_id = auth.uid() or public.has_module_access('payments'));
-- Hard delete reserved for the requester (the app soft-deletes via deleted_at).
create policy payreq_del on public.payment_requests for delete to authenticated
  using (user_id = auth.uid());

-- Helps approver screens skip soft-deleted rows quickly.
create index if not exists payment_requests_status_idx
  on public.payment_requests (status) where deleted_at is null;

-- ---- In-app notification fan-out to approvers ------------------------------
-- Mirrors notify_approvers (0026) but targets the payments module, so admin + HR
-- get a bell notification when a new payment request is submitted.
create or replace function public.notify_payment_approvers(
  p_type text, p_title text, p_body text default null, p_link text default null
) returns int language plpgsql security definer set search_path = public as $$
declare n int;
begin
  insert into public.notifications(user_id, channel, type, title, body, link, status)
  select distinct ur.user_id, 'in_app', p_type, p_title, p_body, p_link, 'sent'
  from public.user_roles ur
  join public.role_permissions rp on rp.role_id = ur.role_id
  join public.permissions p on p.id = rp.permission_id
  where p.module = 'payments' and p.action = 'edit';
  get diagnostics n = row_count;
  return n;
end;
$$;
