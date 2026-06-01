-- ============================================================================
-- 0002_identity.sql — Phase 1A Identity & Access (PRD §1A)
-- Profile mirror of auth.users + RBAC (roles, permissions, mappings).
-- ============================================================================

-- Profile mirror. Credentials live in auth.users; this holds app profile + status.
create table public.users (
  id                 uuid primary key references auth.users(id) on delete cascade,
  email              text unique not null,
  full_name          text,
  phone              text,
  avatar_url         text,
  status             text not null default 'invited'
                       check (status in ('active','invited','suspended')),
  last_login_at      timestamptz,
  two_factor_enabled boolean not null default false,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now(),
  created_by         uuid references public.users(id),
  updated_by         uuid references public.users(id),
  deleted_at         timestamptz
);

create table public.roles (
  id          uuid primary key default gen_random_uuid(),
  key         text unique not null,
  name        text not null,
  description text,
  is_system   boolean not null default false,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  created_by  uuid references public.users(id),
  updated_by  uuid references public.users(id),
  deleted_at  timestamptz
);

create table public.permissions (
  id          uuid primary key default gen_random_uuid(),
  key         text unique not null,        -- e.g. procurement.po.approve
  module      text not null,
  action      text not null,
  description text
);

create table public.role_permissions (
  role_id       uuid not null references public.roles(id) on delete cascade,
  permission_id uuid not null references public.permissions(id) on delete cascade,
  primary key (role_id, permission_id)
);

create table public.user_roles (
  user_id    uuid not null references public.users(id) on delete cascade,
  role_id    uuid not null references public.roles(id) on delete cascade,
  scope      text,                          -- optional dept/project id for scoped roles
  created_at timestamptz not null default now(),
  created_by uuid references public.users(id),
  primary key (user_id, role_id)
);

create index on public.user_roles(user_id);
create index on public.role_permissions(role_id);

-- ----------------------------------------------------------------------------
-- Auth helper functions (SECURITY DEFINER so RLS policies can call them
-- without recursing into the very tables they protect).
-- ----------------------------------------------------------------------------
create or replace function public.is_super_admin(uid uuid default auth.uid())
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.user_roles ur
    join public.roles r on r.id = ur.role_id
    where ur.user_id = uid and r.key = 'super_admin'
  );
$$;

create or replace function public.has_permission(perm_key text, uid uuid default auth.uid())
returns boolean language sql stable security definer set search_path = public as $$
  select public.is_super_admin(uid)
      or exists (
        select 1
        from public.user_roles ur
        join public.role_permissions rp on rp.role_id = ur.role_id
        join public.permissions p on p.id = rp.permission_id
        where ur.user_id = uid and p.key = perm_key
      );
$$;

create or replace function public.has_module_access(p_module text, uid uuid default auth.uid())
returns boolean language sql stable security definer set search_path = public as $$
  select public.is_super_admin(uid)
      or exists (
        select 1
        from public.user_roles ur
        join public.role_permissions rp on rp.role_id = ur.role_id
        join public.permissions p on p.id = rp.permission_id
        where ur.user_id = uid and p.module = p_module
      );
$$;

-- Mirror new auth users into public.users automatically.
create or replace function public.handle_new_auth_user()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into public.users (id, email, full_name, status)
  values (
    new.id,
    new.email,
    coalesce(new.raw_user_meta_data->>'full_name', new.email),
    'invited'
  )
  on conflict (id) do update set email = excluded.email;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_auth_user();
