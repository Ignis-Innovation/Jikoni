-- ============================================================
-- 0075 — Per-project members & delegated edit (IRENA Members tab)
-- HR needs to grant IRENA edit rights to specific people WITHOUT giving them
-- global edit. Adds project_members(project_id,email,role) and a project-scoped
-- gate assert_project_edit(): a write to a project's budget is allowed if the
-- caller is a global editor OR an 'editor' member of THAT project. Managing
-- membership (set_project_member_role) stays restricted to the global editors
-- (HR = jwanjiku). The three global editors are always effective editors;
-- brian55mwangi@gmail.com is never listed/managed here. Idempotent.
-- ============================================================

create table if not exists public.project_members (
  project_id uuid not null references public.projects(id) on delete cascade,
  email      text not null,
  role       text not null default 'viewer' check (role in ('viewer','editor')),
  updated_at timestamptz not null default now(),
  primary key (project_id, email)
);
alter table public.project_members enable row level security;  -- access via RPCs only

-- Project-scoped edit gate. Global editors pass everywhere; otherwise the caller
-- must be an 'editor' member of this specific project. Honours enforce_access +
-- the system_action bypass, exactly like assert_access.
create or replace function public.assert_project_edit(p_project_id uuid) returns void
language plpgsql security definer set search_path = public as $$
declare
  v_on boolean := coalesce((select value::text = 'true' from public.app_config where key = 'enforce_access'), false);
  v_email text := lower(coalesce(nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'email', ''));
  v_editor boolean := v_email in ('jwanjiku@ignis-innovation.com','dnderitu@ignis-innovation.com','brian55mwangi@gmail.com');
begin
  if not v_on then return; end if;
  if coalesce(current_setting('jikoni.system_action', true), '') = 'true' then return; end if;
  if v_editor then return; end if;
  if exists (select 1 from public.project_members
             where project_id = p_project_id and lower(email) = v_email and role = 'editor') then
    return;
  end if;
  raise exception 'Access denied: you have view-only access to this project';
end $$;

-- Repoint the budget-item RPCs at the project-scoped gate (was assert_access('projects',2),
-- which the global lock restricts to the 3 accounts). Bodies otherwise unchanged.
create or replace function public.add_project_budget_item(
  p_project_id uuid, p_name text, p_description text, p_amount numeric
) returns jsonb language plpgsql security definer set search_path = public as $$
begin
  perform public.assert_project_edit(p_project_id);
  if not exists (select 1 from public.projects where id = p_project_id) then raise exception 'Project not found'; end if;
  if nullif(trim(coalesce(p_name, '')), '') is null then raise exception 'A budget item name is required'; end if;
  if coalesce(p_amount, 0) < 0 then raise exception 'Amount must be zero or more'; end if;
  insert into public.project_budget_items(project_id, name, description, amount, added_by)
  values (p_project_id, trim(p_name), nullif(trim(coalesce(p_description, '')), ''), coalesce(p_amount, 0), public._caller_name());
  perform public.recompute_project_budget(p_project_id);
  perform public.audit_write('project.budget_item_added', 'project', p_project_id::text, jsonb_build_object('name', p_name, 'amount', p_amount));
  return public.project_payload(p_project_id);
end $$;

create or replace function public.update_project_budget_item(
  p_id uuid, p_name text, p_description text, p_amount numeric
) returns jsonb language plpgsql security definer set search_path = public as $$
declare v_project uuid;
begin
  select project_id into v_project from public.project_budget_items where id = p_id;
  if v_project is null then raise exception 'Budget item not found'; end if;
  perform public.assert_project_edit(v_project);
  if nullif(trim(coalesce(p_name, '')), '') is null then raise exception 'A budget item name is required'; end if;
  if coalesce(p_amount, 0) < 0 then raise exception 'Amount must be zero or more'; end if;
  update public.project_budget_items
     set name = trim(p_name), description = nullif(trim(coalesce(p_description, '')), ''), amount = coalesce(p_amount, 0)
   where id = p_id;
  perform public.recompute_project_budget(v_project);
  perform public.audit_write('project.budget_item_updated', 'project', v_project::text, jsonb_build_object('item', p_id, 'name', p_name, 'amount', p_amount));
  return public.project_payload(v_project);
end $$;

create or replace function public.delete_project_budget_item(p_id uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_project uuid;
begin
  select project_id into v_project from public.project_budget_items where id = p_id;
  if v_project is null then raise exception 'Budget item not found'; end if;
  perform public.assert_project_edit(v_project);
  delete from public.project_budget_items where id = p_id;
  perform public.recompute_project_budget(v_project);
  perform public.audit_write('project.budget_item_removed', 'project', v_project::text, jsonb_build_object('item', p_id));
  return public.project_payload(v_project);
end $$;

-- List members + their effective IRENA role. Every real app user except the
-- always-hidden ones and brian55mwangi@gmail.com. Global editors show as editors.
-- Readable by project editors (and global editors) — the ones who manage the tab.
create or replace function public.list_project_members(p_project_id uuid)
returns jsonb language sql stable security definer set search_path = public as $$
  select coalesce(jsonb_agg(jsonb_build_object(
           'email', u.email, 'name', u.name,
           'role', case when lower(u.email) in ('jwanjiku@ignis-innovation.com','dnderitu@ignis-innovation.com','brian55mwangi@gmail.com')
                        then 'editor' else coalesce(pm.role, 'viewer') end,
           'locked', lower(u.email) in ('jwanjiku@ignis-innovation.com','dnderitu@ignis-innovation.com','brian55mwangi@gmail.com')
         ) order by u.name), '[]'::jsonb)
  from public.app_users u
  left join public.project_members pm on pm.project_id = p_project_id and lower(pm.email) = lower(u.email)
  where u.state <> 'invited'
    and lower(u.email) <> 'brian55mwangi@gmail.com'
$$;

-- Set a member's role on one project. Only the global editors (HR) may call.
-- Cannot change a global editor's role (fixed) and never manages brian55mwangi.
create or replace function public.set_project_member_role(p_project_id uuid, p_email text, p_role text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_email text := lower(coalesce(nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'email', ''));
  v_caller_editor boolean := v_email in ('jwanjiku@ignis-innovation.com','dnderitu@ignis-innovation.com','brian55mwangi@gmail.com');
  v_sys boolean := coalesce(current_setting('jikoni.system_action', true), '') = 'true';
  v_target text := lower(trim(coalesce(p_email, '')));
begin
  if not (v_caller_editor or v_sys) then raise exception 'Only an authorised administrator can change project access'; end if;
  if p_role not in ('viewer','editor') then raise exception 'Role must be viewer or editor'; end if;
  if v_target in ('jwanjiku@ignis-innovation.com','dnderitu@ignis-innovation.com','brian55mwangi@gmail.com') then
    raise exception 'That account''s access is fixed and cannot be changed here';
  end if;
  if not exists (select 1 from public.app_users where lower(email) = v_target) then raise exception 'No such user'; end if;
  insert into public.project_members(project_id, email, role) values (p_project_id, v_target, p_role)
  on conflict (project_id, email) do update set role = excluded.role, updated_at = now();
  perform public.audit_write('project.member_role_set', 'project', p_project_id::text, jsonb_build_object('email', v_target, 'role', p_role));
  return public.list_project_members(p_project_id);
end $$;

revoke execute on function public.assert_project_edit(uuid) from public, anon;
grant  execute on function public.assert_project_edit(uuid) to authenticated;
revoke execute on function public.list_project_members(uuid) from public, anon;
grant  execute on function public.list_project_members(uuid) to authenticated;
revoke execute on function public.set_project_member_role(uuid,text,text) from public, anon;
grant  execute on function public.set_project_member_role(uuid,text,text) to authenticated;
