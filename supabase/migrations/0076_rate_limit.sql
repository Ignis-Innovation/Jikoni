-- ============================================================
-- 0076 — Rate limiting for public / email-sending serverless endpoints
-- A fixed-window counter keyed by an arbitrary bucket string (e.g. an IP for the
-- public forgot-password endpoint, or a user email for notify/invite/screen-cv).
-- rl_hit() records one hit and returns true while under the limit, false once
-- over. SECURITY DEFINER so the endpoints (anon or service-role) can call it
-- without exposing the table. Idempotent.
-- ============================================================

create table if not exists public.rate_limit (
  bucket       text not null,
  window_start timestamptz not null,
  count        int not null default 0,
  primary key (bucket, window_start)
);
alter table public.rate_limit enable row level security;  -- reachable only via rl_hit()

create or replace function public.rl_hit(p_key text, p_max int, p_window int) returns boolean
language plpgsql security definer set search_path = public as $$
declare
  v_window timestamptz := to_timestamp(floor(extract(epoch from now()) / greatest(p_window, 1)) * greatest(p_window, 1));
  v_count int;
begin
  insert into public.rate_limit(bucket, window_start, count)
  values (p_key, v_window, 1)
  on conflict (bucket, window_start) do update set count = public.rate_limit.count + 1
  returning count into v_count;
  -- prune this bucket's stale windows (pk-indexed, cheap) so the table stays small
  delete from public.rate_limit where bucket = p_key and window_start < v_window - make_interval(secs => greatest(p_window, 1) * 3);
  return v_count <= p_max;
end $$;

revoke execute on function public.rl_hit(text,int,int) from public;
grant  execute on function public.rl_hit(text,int,int) to anon, authenticated, service_role;
