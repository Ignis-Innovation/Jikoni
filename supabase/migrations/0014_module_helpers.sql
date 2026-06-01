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
