-- Settings overhaul: self-service profile edit, plus storage for real integrations
-- (Google OAuth tokens + a vaulted Anthropic key). Idempotent.

-- ---------- edit my own profile (name / role title / avatar colour) ----------
create or replace function public.update_my_profile(p_name text, p_role_title text, p_color text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_me uuid := (select id from public.app_users where auth_id = auth.uid());
begin
  if v_me is null then raise exception 'No user is linked to this login'; end if;
  if nullif(trim(coalesce(p_name, '')), '') is null then raise exception 'A name is required'; end if;
  update public.app_users set
    name       = trim(p_name),
    role_title = nullif(trim(coalesce(p_role_title, '')), ''),
    color      = nullif(trim(coalesce(p_color, '')), ''),
    updated_at = now()
  where id = v_me;
  perform public.audit_write('profile.updated', 'user', (select email from public.app_users where id = v_me),
    jsonb_build_object('name', p_name, 'role_title', p_role_title, 'color', p_color));
  return (select jsonb_build_object('email', email, 'name', name, 'roleTitle', role_title, 'color', color)
          from public.app_users where id = v_me);
end $$;

-- ---------- OAuth connections (Google: Gmail + Drive). Tokens never reach the client. ----------
create table if not exists public.oauth_connections (
  provider      text primary key,               -- 'google'
  account_email text,
  scopes        text,
  access_token  text,
  refresh_token text,
  expiry        timestamptz,
  connected_by  uuid references public.app_users(id),
  updated_at    timestamptz not null default now()
);
alter table public.oauth_connections enable row level security;   -- no client policy → locked; server uses service role

-- ---------- vaulted secrets (e.g. the Anthropic API key). Locked from the client. ----------
create table if not exists public.app_secrets (
  key        text primary key,
  value      text not null,
  updated_at timestamptz not null default now()
);
alter table public.app_secrets enable row level security;         -- no client policy → locked

-- ---------- which providers are connected (status only, never the tokens) ----------
create or replace function public.oauth_status()
returns jsonb language sql stable security definer set search_path = public as $$
  select jsonb_build_object(
    'google', (select jsonb_build_object('connected', true, 'email', account_email)
               from public.oauth_connections where provider = 'google'),
    'claude', (select jsonb_build_object('connected', true)
               from public.app_secrets where key = 'anthropic_api_key')
  )
$$;

-- ---------- store a vaulted secret (admins only) ----------
create or replace function public.set_secret(p_key text, p_value text)
returns jsonb language plpgsql security definer set search_path = public as $$
begin
  perform public.assert_access('users', 2);
  if p_key not in ('anthropic_api_key') then raise exception 'Unknown secret: %', p_key; end if;
  if nullif(trim(coalesce(p_value, '')), '') is null then raise exception 'A value is required'; end if;
  insert into public.app_secrets(key, value, updated_at) values (p_key, trim(p_value), now())
  on conflict (key) do update set value = excluded.value, updated_at = now();
  perform public.audit_write('secret.updated', 'app_secrets', p_key, '{}'::jsonb);
  return jsonb_build_object('key', p_key, 'connected', true);
end $$;

-- ---------- grants ----------
do $$
declare fn text;
begin
  foreach fn in array array[
    'update_my_profile(text,text,text)',
    'oauth_status()',
    'set_secret(text,text)']
  loop
    execute format('revoke execute on function public.%s from public, anon', fn);
    execute format('grant execute on function public.%s to authenticated', fn);
  end loop;
end $$;
