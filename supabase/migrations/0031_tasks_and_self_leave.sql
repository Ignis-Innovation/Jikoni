-- ============================================================================
-- 0031_tasks_and_self_leave.sql — personal tasks + self-service leave.
-- Idempotent: safe to re-run.
-- ============================================================================

-- ---- Tasks -----------------------------------------------------------------
-- User-scoped (not module-scoped): you see/manage tasks you own or are assigned.
-- assigned_by/assignee_id let HR assign tasks to others later (HR is the creator,
-- which the insert policy already permits).
create table if not exists public.tasks (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  description text,
  status text not null default 'pending' check (status in ('pending', 'in_progress', 'done')),
  priority text default 'medium',
  due_date date,
  assignee_id uuid references public.users(id),
  assigned_by uuid references public.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid references public.users(id),
  updated_by uuid references public.users(id),
  deleted_at timestamptz
);

select public.apply_standard_triggers('tasks');

alter table public.tasks enable row level security;
drop policy if exists tasks_sel on public.tasks;
drop policy if exists tasks_ins on public.tasks;
drop policy if exists tasks_upd on public.tasks;
drop policy if exists tasks_del on public.tasks;
create policy tasks_sel on public.tasks for select to authenticated
  using (assignee_id = auth.uid() or created_by = auth.uid());
create policy tasks_ins on public.tasks for insert to authenticated
  with check (created_by = auth.uid() or assignee_id = auth.uid());
create policy tasks_upd on public.tasks for update to authenticated
  using (assignee_id = auth.uid() or created_by = auth.uid())
  with check (assignee_id = auth.uid() or created_by = auth.uid());
create policy tasks_del on public.tasks for delete to authenticated
  using (created_by = auth.uid());

-- ---- Self-service leave ----------------------------------------------------
-- Tie a leave application to the applying user so anyone can apply for their own
-- leave (in addition to the existing people.* policies used for HR oversight).
alter table public.leave_applications add column if not exists user_id uuid references public.users(id);

drop policy if exists leave_self_sel on public.leave_applications;
drop policy if exists leave_self_ins on public.leave_applications;
drop policy if exists leave_self_upd on public.leave_applications;
drop policy if exists leave_self_del on public.leave_applications;
create policy leave_self_sel on public.leave_applications for select to authenticated
  using (user_id = auth.uid());
create policy leave_self_ins on public.leave_applications for insert to authenticated
  with check (user_id = auth.uid());
create policy leave_self_upd on public.leave_applications for update to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy leave_self_del on public.leave_applications for delete to authenticated
  using (user_id = auth.uid());
