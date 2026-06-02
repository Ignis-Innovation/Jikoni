-- ============================================================================
-- 0027_me_function.sql — single-roundtrip identity resolver.
-- Returns the current user's profile + role keys + permission keys in one call,
-- resolved from auth.uid() server-side. Replaces getUser()+profile+roles (3
-- round trips) with one rpc, so page navigation is noticeably snappier.
-- ============================================================================

create or replace function public.me()
returns jsonb language sql stable security definer set search_path = public as $$
  select case when auth.uid() is null then null else
    jsonb_build_object(
      'id', u.id,
      'email', u.email,
      'full_name', u.full_name,
      'avatar_url', u.avatar_url,
      'roles', coalesce((
        select array_agg(distinct r.key)
        from public.user_roles ur join public.roles r on r.id = ur.role_id
        where ur.user_id = u.id), '{}'),
      'permissions', coalesce((
        select array_agg(distinct p.key)
        from public.user_roles ur
        join public.role_permissions rp on rp.role_id = ur.role_id
        join public.permissions p on p.id = rp.permission_id
        where ur.user_id = u.id), '{}')
    )
  end
  from public.users u
  where u.id = auth.uid();
$$;
