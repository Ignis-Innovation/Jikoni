-- ============================================================
-- 0073 — Server-side hard edit lock (three editor accounts only)
-- The client hides edit controls for everyone except three accounts
-- (GLOBAL_EDITORS in src/data.ts). This makes the lock real: assert_access —
-- the gate every module-write RPC calls — now denies ANY write (level >= 2) to
-- anyone who is not one of the three editors, regardless of their
-- user_permissions grants. Self-service RPCs (personal tasks, weekly reports,
-- leave requests, password) do NOT call assert_access, so staff keep those.
-- Also: clamp existing non-editor grants to view, and ensure the three editors
-- hold full grants (for read-model consistency, e.g. createdByMe / bootstrap).
-- Idempotent: safe to re-run.
-- ============================================================

create or replace function public.assert_access(p_module text, p_min_level int) returns void
language plpgsql security definer set search_path = public as $$
declare
  v_on boolean := coalesce((select value::text = 'true' from public.app_config where key = 'enforce_access'), false);
  v_email text := coalesce(nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'email', '');
  v_level int;
  v_editor boolean := lower(v_email) in (
    'jwanjiku@ignis-innovation.com', 'dnderitu@ignis-innovation.com', 'brian55mwangi@gmail.com');
begin
  if not v_on then return; end if;
  if coalesce(current_setting('jikoni.system_action', true), '') = 'true' then return; end if;
  -- Company-wide hard lock: only the three editor accounts may perform writes
  -- (level >= 2) anywhere. Everyone else is strictly view-only, whatever their
  -- user_permissions say. Reads (level < 2) still honour per-module grants.
  if v_editor then return; end if;
  if p_min_level >= 2 then
    raise exception 'Access denied: this account is view-only';
  end if;
  select level into v_level from public.user_permissions where email = v_email and module = p_module;
  if coalesce(v_level, 0) < p_min_level then
    raise exception 'Access denied: % requires level % on %', coalesce(nullif(v_email,''),'(no user)'), p_min_level, p_module;
  end if;
end $$;

-- Reduce every non-editor account to view-only in the grants table (0 stays 0 so
-- hidden modules remain hidden; 2/3 drop to 1). Belt-and-suspenders with the gate
-- above, and keeps read-model checks (createdByMe) consistent with the lock.
update public.user_permissions
   set level = least(level, 1), updated_at = now()
 where lower(email) not in (
         'jwanjiku@ignis-innovation.com', 'dnderitu@ignis-innovation.com', 'brian55mwangi@gmail.com')
   and level > 1;

-- Ensure the three editors hold full access across every module.
insert into public.user_permissions(email, module, level)
select e.email, m.module, 3
from   (values ('jwanjiku@ignis-innovation.com'), ('dnderitu@ignis-innovation.com'),
               ('brian55mwangi@gmail.com')) as e(email),
       (values ('finance'), ('procurement'), ('inventory'), ('hr'), ('deploy'), ('readiness'),
               ('raise'), ('crm'), ('projects'), ('reports'), ('compliance'), ('dataroom'),
               ('settings'), ('users')) as m(module)
on conflict (email, module) do update set level = 3, updated_at = now();
