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
