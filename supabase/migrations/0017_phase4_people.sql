-- ============================================================================
-- 0017_phase4_people.sql — PHASE 4 People Operations (PRD §4A-4F)
-- ============================================================================

create table public.employee_profiles (
  party_id uuid primary key references public.parties(id) on delete cascade,
  staff_no text unique,
  department_id uuid references public.departments(id),
  job_title text, contract_type text, start_date date,
  nssf_no text, shif_no text, kra_pin text,
  bank_details_id uuid references public.party_bank_details(id),
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
  created_by uuid references public.users(id), updated_by uuid references public.users(id), deleted_at timestamptz
);
create table public.next_of_kin (
  id uuid primary key default gen_random_uuid(),
  party_id uuid not null references public.parties(id) on delete cascade,
  name text, relationship text, phone text
);

create table public.leave_types (
  id uuid primary key default gen_random_uuid(),
  name text not null, annual_days int default 0, accrual text,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
  created_by uuid references public.users(id), updated_by uuid references public.users(id), deleted_at timestamptz
);
create table public.leave_balances (
  id uuid primary key default gen_random_uuid(),
  employee_party_id uuid references public.parties(id),
  type_id uuid references public.leave_types(id),
  entitled numeric(6,2) default 0, taken numeric(6,2) default 0, remaining numeric(6,2) default 0
);
create table public.leave_applications (
  id uuid primary key default gen_random_uuid(),
  employee_party_id uuid references public.parties(id),
  type_id uuid references public.leave_types(id),
  start_date date, end_date date, days numeric(6,2),
  status text not null default 'pending',
  approval_request_id uuid references public.approval_requests(id),
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
  created_by uuid references public.users(id), updated_by uuid references public.users(id), deleted_at timestamptz
);

create table public.attendance (
  id uuid primary key default gen_random_uuid(),
  employee_party_id uuid references public.parties(id),
  date date, clock_in timestamptz, clock_out timestamptz, hours numeric(6,2),
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
  created_by uuid references public.users(id), updated_by uuid references public.users(id), deleted_at timestamptz
);
create table public.timesheet_entries (
  id uuid primary key default gen_random_uuid(),
  employee_party_id uuid references public.parties(id),
  date date, project_id uuid references public.projects(id), hours numeric(6,2), notes text,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
  created_by uuid references public.users(id), updated_by uuid references public.users(id), deleted_at timestamptz
);

create table public.salary_structures (
  id uuid primary key default gen_random_uuid(),
  employee_party_id uuid references public.parties(id),
  basic_minor bigint default 0, effective_date date,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
  created_by uuid references public.users(id), updated_by uuid references public.users(id), deleted_at timestamptz
);
create table public.pay_components (
  id uuid primary key default gen_random_uuid(),
  employee_party_id uuid references public.parties(id),
  kind text check (kind in ('allowance','deduction')),
  type text, amount_minor bigint default 0, recurring boolean default true,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
  created_by uuid references public.users(id), updated_by uuid references public.users(id), deleted_at timestamptz
);
create table public.hr_payroll_runs (
  id uuid primary key default gen_random_uuid(),
  period text, status text not null default 'draft',
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
  created_by uuid references public.users(id), updated_by uuid references public.users(id), deleted_at timestamptz
);

create table public.objectives (
  id uuid primary key default gen_random_uuid(),
  employee_party_id uuid references public.parties(id),
  cycle text, description text, weight numeric(5,2), status text default 'open', score numeric(5,2),
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
  created_by uuid references public.users(id), updated_by uuid references public.users(id), deleted_at timestamptz
);
create table public.performance_reviews (
  id uuid primary key default gen_random_uuid(),
  employee_party_id uuid references public.parties(id),
  cycle text, reviewer_user_id uuid references public.users(id), rating numeric(5,2), comments text,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
  created_by uuid references public.users(id), updated_by uuid references public.users(id), deleted_at timestamptz
);
create table public.one_on_ones (
  id uuid primary key default gen_random_uuid(),
  employee_party_id uuid references public.parties(id),
  manager_user_id uuid references public.users(id), date date, notes text,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
  created_by uuid references public.users(id), updated_by uuid references public.users(id), deleted_at timestamptz
);

create table public.hr_checklists (
  id uuid primary key default gen_random_uuid(),
  type text check (type in ('onboarding','offboarding')), template jsonb default '[]'::jsonb, name text,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
  created_by uuid references public.users(id), updated_by uuid references public.users(id), deleted_at timestamptz
);
create table public.hr_checklist_runs (
  id uuid primary key default gen_random_uuid(),
  employee_party_id uuid references public.parties(id),
  template_id uuid references public.hr_checklists(id),
  items jsonb default '[]'::jsonb, status text not null default 'in_progress',
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
  created_by uuid references public.users(id), updated_by uuid references public.users(id), deleted_at timestamptz
);

do $$
declare t text;
declare tbls text[] := array['employee_profiles','next_of_kin','leave_types','leave_balances','leave_applications','attendance','timesheet_entries','salary_structures','pay_components','hr_payroll_runs','objectives','performance_reviews','one_on_ones','hr_checklists','hr_checklist_runs'];
begin
  perform public.seed_module_permissions('people','People Ops');
  foreach t in array tbls loop
    perform public.apply_standard_triggers(t);
    perform public.apply_module_rls(t,'people');
  end loop;
end $$;
