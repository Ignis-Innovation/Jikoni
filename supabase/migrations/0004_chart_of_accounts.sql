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
