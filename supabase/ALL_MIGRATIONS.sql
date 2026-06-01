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
