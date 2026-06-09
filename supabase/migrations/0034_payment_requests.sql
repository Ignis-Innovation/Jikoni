-- ============================================================================
-- 0034_payment_requests.sql — self-service payment / reimbursement requests.
-- A user submits a request (title, amount, date, short description); it sits
-- pending until an admin OR HR approves/rejects it. After approval, admin/HR
-- marks it paid once cash is disbursed (handled manually — no card/M-Pesa).
-- Mirrors the self-service leave flow (0031): the requester is scoped to their
-- own rows via user_id; approvers see/act on all rows via the 'payments' module
-- permission. Idempotent: safe to re-run.
-- ============================================================================

-- ---- Permissions -----------------------------------------------------------
-- Seed payments.view/create/edit/delete and grant to super_admin + admin (and
-- view to viewer). Then give HR the whole module so HR can approve alongside admin.
select public.seed_module_permissions('payments', 'Payment requests');

insert into public.role_permissions (role_id, permission_id)
select r.id, p.id from public.roles r
join public.permissions p on p.module = 'payments'
where r.key = 'hr'
on conflict do nothing;

-- ---- Table -----------------------------------------------------------------
-- Money stored in integer minor units (cents) to match the rest of the system
-- (see formatMoney in src/lib/utils.ts). status walks
-- pending -> approved -> paid, with rejected / cancelled as terminal branches.
create table if not exists public.payment_requests (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  amount_minor bigint not null check (amount_minor > 0),
  currency text not null default 'KES',
  request_date date not null default current_date,
  description text,
  status text not null default 'pending'
    check (status in ('pending', 'approved', 'rejected', 'paid', 'cancelled')),
  decided_by uuid references public.users(id),
  decided_at timestamptz,
  decision_note text,
  paid_by uuid references public.users(id),
  paid_at timestamptz,
  user_id uuid references public.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid references public.users(id),
  updated_by uuid references public.users(id),
  deleted_at timestamptz
);

select public.apply_standard_triggers('payment_requests');

-- ---- RLS -------------------------------------------------------------------
alter table public.payment_requests enable row level security;
drop policy if exists payreq_sel on public.payment_requests;
drop policy if exists payreq_ins on public.payment_requests;
drop policy if exists payreq_upd on public.payment_requests;
drop policy if exists payreq_del on public.payment_requests;

-- See your own requests; approvers (admin / HR) see everyone's.
create policy payreq_sel on public.payment_requests for select to authenticated
  using (user_id = auth.uid() or public.has_module_access('payments'));
-- Anyone can file a request for themselves.
create policy payreq_ins on public.payment_requests for insert to authenticated
  with check (user_id = auth.uid());
-- Requester can edit/cancel their own; approvers can act on any.
create policy payreq_upd on public.payment_requests for update to authenticated
  using (user_id = auth.uid() or public.has_module_access('payments'))
  with check (user_id = auth.uid() or public.has_module_access('payments'));
-- Hard delete reserved for the requester (the app soft-deletes via deleted_at).
create policy payreq_del on public.payment_requests for delete to authenticated
  using (user_id = auth.uid());

-- Helps approver screens skip soft-deleted rows quickly.
create index if not exists payment_requests_status_idx
  on public.payment_requests (status) where deleted_at is null;

-- ---- In-app notification fan-out to approvers ------------------------------
-- Mirrors notify_approvers (0026) but targets the payments module, so admin + HR
-- get a bell notification when a new payment request is submitted.
create or replace function public.notify_payment_approvers(
  p_type text, p_title text, p_body text default null, p_link text default null
) returns int language plpgsql security definer set search_path = public as $$
declare n int;
begin
  insert into public.notifications(user_id, channel, type, title, body, link, status)
  select distinct ur.user_id, 'in_app', p_type, p_title, p_body, p_link, 'sent'
  from public.user_roles ur
  join public.role_permissions rp on rp.role_id = ur.role_id
  join public.permissions p on p.id = rp.permission_id
  where p.module = 'payments' and p.action = 'edit';
  get diagnostics n = row_count;
  return n;
end;
$$;
