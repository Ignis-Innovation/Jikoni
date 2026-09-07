-- ============================================================
-- 0072 — Projects: budget items & expenses (actuals coding)
-- HR (Ciku) needs to create the IRENA project and code money already
-- spent against it so it accrues in the project's actuals. Adds two child
-- tables under projects:
--   * project_budget_items — planned allocations (name, description, amount)
--   * project_expenses     — actual spend (description, amount, spent_on)
-- Budget items drive the project's budget_amount; expenses roll into
-- spentAmount alongside completed milestones. Both surface in the bootstrap
-- project JSON (budgetItems / expenses). Also seeds the IRENA – Taita Taveta
-- project. RPCs are edit-gated via assert_access('projects', 2).
-- Idempotent: safe to re-run.
-- ============================================================

-- ---------- tables ----------
create table if not exists public.project_budget_items (
  id          uuid primary key default gen_random_uuid(),
  project_id  uuid not null references public.projects(id) on delete cascade,
  name        text not null,
  description text,
  amount      numeric not null default 0 check (amount >= 0),
  added_by    text,
  sort        bigint not null default (extract(epoch from now())*1000)::bigint,
  created_at  timestamptz not null default now()
);
create index if not exists idx_pbi_project on public.project_budget_items(project_id);

create table if not exists public.project_expenses (
  id          uuid primary key default gen_random_uuid(),
  project_id  uuid not null references public.projects(id) on delete cascade,
  description text not null,
  amount      numeric not null default 0 check (amount >= 0),
  spent_on    date,
  added_by    text,
  sort        bigint not null default (extract(epoch from now())*1000)::bigint,
  created_at  timestamptz not null default now()
);
create index if not exists idx_pexp_project on public.project_expenses(project_id);

-- Access to these child tables is via the security-definer RPCs below (same
-- model as milestones/drawdowns). Enable RLS with no direct policies so the
-- tables are not readable/writable through PostgREST directly.
alter table public.project_budget_items enable row level security;
alter table public.project_expenses     enable row level security;

-- ---------- recompute: spent now includes expenses ----------
create or replace function public.recompute_project_money(p_id uuid) returns void
language plpgsql security definer set search_path = public as $$
declare v_spent numeric; v_budget numeric;
begin
  select coalesce(sum(amount), 0)
       + coalesce((select sum(amount) from public.project_expenses where project_id = p_id), 0)
    into v_spent
    from public.project_milestones where project_id = p_id and status = 'done';
  select budget_amount into v_budget from public.projects where id = p_id;
  update public.projects
     set spent_txt  = public.fmt_kes(v_spent),
         pct        = case when coalesce(v_budget, 0) > 0
                           then round(v_spent / v_budget * 100)::text || '%' else '0%' end,
         updated_at = now()
   where id = p_id;
end $$;

-- Set a project's budget_amount to the sum of its budget items (used by the
-- budget-item RPCs; projects without items keep their create-time budget).
create or replace function public.recompute_project_budget(p_id uuid) returns void
language plpgsql security definer set search_path = public as $$
declare v_budget numeric;
begin
  select coalesce(sum(amount), 0) into v_budget
    from public.project_budget_items where project_id = p_id;
  update public.projects
     set budget_amount = v_budget,
         budget_txt    = public.fmt_kes(v_budget),
         updated_at    = now()
   where id = p_id;
  perform public.recompute_project_money(p_id);
end $$;

-- ---------- read model: add budgetItems + expenses, expenses in spentAmount ----------
create or replace function public.project_detail_json(p_id uuid) returns jsonb
language sql stable security definer set search_path = public as $$
  select jsonb_build_object(
    'id', p.id, 'state', p.state,
    'funder', p.funder, 'status', p.status, 'budget', p.budget_txt, 'spent', p.spent_txt,
    'pct', p.pct, 'timeline', p.timeline, 'team', p.team, 'reporting', p.reporting, 'field', p.field,
    'budgetAmount', p.budget_amount,
    'spentAmount', coalesce((select sum(amount) from public.project_milestones
                             where project_id = p.id and status = 'done'), 0)
                 + coalesce((select sum(amount) from public.project_expenses
                             where project_id = p.id), 0),
    'startDate', p.start_date, 'endDate', p.end_date,
    'updatedAt', p.updated_at,
    'location', p.location, 'docs', p.docs,
    'createdByMe', (
      (p.created_by is not null and p.created_by = (select id from public.app_users where auth_id = auth.uid()))
      or coalesce((select level from public.user_permissions
                   where email = lower(coalesce(nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'email', ''))
                     and module = 'projects'), 0) >= 3
    ),
    'milestones', coalesce((select jsonb_agg(jsonb_build_object('id', id, 't', title, 's', status,
                             'amount', amount, 'start', start_date, 'end', end_date) order by sort)
                            from public.project_milestones where project_id = p.id), '[]'::jsonb),
    'drawdowns',  coalesce((select jsonb_agg(jsonb_build_object('id', id, 't', title, 'v', amount_txt, 's', status) order by sort)
                            from public.project_drawdowns where project_id = p.id), '[]'::jsonb),
    'budgetItems', coalesce((select jsonb_agg(jsonb_build_object('id', id, 'name', name,
                             'description', description, 'amount', amount, 'addedBy', added_by) order by sort)
                            from public.project_budget_items where project_id = p.id), '[]'::jsonb),
    'expenses',   coalesce((select jsonb_agg(jsonb_build_object('id', id, 'description', description,
                             'amount', amount, 'spentOn', spent_on, 'addedBy', added_by) order by sort)
                            from public.project_expenses where project_id = p.id), '[]'::jsonb))
  from public.projects p where p.id = p_id
$$;

-- ---------- caller display name helper (added_by) ----------
create or replace function public._caller_name() returns text
language sql stable security definer set search_path = public as $$
  select coalesce(
    (select name from public.app_users
      where lower(email) = lower(coalesce(nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'email', ''))
      limit 1),
    nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'email',
    'Someone');
$$;

-- ---------- RPCs: budget items ----------
create or replace function public.add_project_budget_item(
  p_project_id uuid, p_name text, p_description text, p_amount numeric
) returns jsonb language plpgsql security definer set search_path = public as $$
begin
  perform public.assert_access('projects', 2);
  if not exists (select 1 from public.projects where id = p_project_id) then
    raise exception 'Project not found';
  end if;
  if nullif(trim(coalesce(p_name, '')), '') is null then
    raise exception 'A budget item name is required';
  end if;
  if coalesce(p_amount, 0) < 0 then raise exception 'Amount must be zero or more'; end if;
  insert into public.project_budget_items(project_id, name, description, amount, added_by)
  values (p_project_id, trim(p_name), nullif(trim(coalesce(p_description, '')), ''),
          coalesce(p_amount, 0), public._caller_name());
  perform public.recompute_project_budget(p_project_id);
  perform public.audit_write('project.budget_item_added', 'project', p_project_id::text,
    jsonb_build_object('name', p_name, 'amount', p_amount));
  return public.project_payload(p_project_id);
end $$;

create or replace function public.delete_project_budget_item(p_id uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_project uuid;
begin
  perform public.assert_access('projects', 2);
  select project_id into v_project from public.project_budget_items where id = p_id;
  if v_project is null then raise exception 'Budget item not found'; end if;
  delete from public.project_budget_items where id = p_id;
  perform public.recompute_project_budget(v_project);
  perform public.audit_write('project.budget_item_removed', 'project', v_project::text,
    jsonb_build_object('item', p_id));
  return public.project_payload(v_project);
end $$;

-- ---------- RPCs: expenses ----------
create or replace function public.add_project_expense(
  p_project_id uuid, p_description text, p_amount numeric, p_spent_on date
) returns jsonb language plpgsql security definer set search_path = public as $$
begin
  perform public.assert_access('projects', 2);
  if not exists (select 1 from public.projects where id = p_project_id) then
    raise exception 'Project not found';
  end if;
  if nullif(trim(coalesce(p_description, '')), '') is null then
    raise exception 'An expense description is required';
  end if;
  if coalesce(p_amount, 0) < 0 then raise exception 'Amount must be zero or more'; end if;
  insert into public.project_expenses(project_id, description, amount, spent_on, added_by)
  values (p_project_id, trim(p_description), coalesce(p_amount, 0),
          coalesce(p_spent_on, current_date), public._caller_name());
  perform public.recompute_project_money(p_project_id);
  perform public.audit_write('project.expense_added', 'project', p_project_id::text,
    jsonb_build_object('description', p_description, 'amount', p_amount, 'spentOn', p_spent_on));
  return public.project_payload(p_project_id);
end $$;

create or replace function public.delete_project_expense(p_id uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_project uuid;
begin
  perform public.assert_access('projects', 2);
  select project_id into v_project from public.project_expenses where id = p_id;
  if v_project is null then raise exception 'Expense not found'; end if;
  delete from public.project_expenses where id = p_id;
  perform public.recompute_project_money(v_project);
  perform public.audit_write('project.expense_removed', 'project', v_project::text,
    jsonb_build_object('expense', p_id));
  return public.project_payload(v_project);
end $$;

-- ---------- seed the IRENA – Taita Taveta project ----------
do $$
declare v_entity uuid := (select id from public.entities where code = 'KE');
begin
  if not exists (select 1 from public.projects where lower(name) like '%irena%' and lower(name) like '%taita%') then
    insert into public.projects(entity_id, name, funder, status, budget_amount, budget_txt, spent_txt, pct,
                                start_date, end_date, timeline, team, reporting, field, is_extra, state)
    values (v_entity, 'IRENA – Taita Taveta',
            'IRENA / UK-PACT',
            'Active', 0, public.fmt_kes(0), 'KES 0', '0%',
            date '2026-01-01', date '2026-12-31', 'Jan 2026 → Dec 2026',
            'Programmes', 'Quarterly to IRENA', 'Taita Taveta County', true, 'active');
  end if;
end $$;

-- ---------- grants ----------
revoke execute on function public.add_project_budget_item(uuid,text,text,numeric) from public, anon;
grant  execute on function public.add_project_budget_item(uuid,text,text,numeric) to authenticated;
revoke execute on function public.delete_project_budget_item(uuid) from public, anon;
grant  execute on function public.delete_project_budget_item(uuid) to authenticated;
revoke execute on function public.add_project_expense(uuid,text,numeric,date) from public, anon;
grant  execute on function public.add_project_expense(uuid,text,numeric,date) to authenticated;
revoke execute on function public.delete_project_expense(uuid) from public, anon;
grant  execute on function public.delete_project_expense(uuid) to authenticated;
