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
