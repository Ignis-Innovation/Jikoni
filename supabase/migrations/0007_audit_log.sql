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
