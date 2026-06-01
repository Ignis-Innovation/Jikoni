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
