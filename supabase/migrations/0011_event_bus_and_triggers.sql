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
