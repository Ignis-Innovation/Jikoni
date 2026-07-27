-- ============================================================
-- Jikoni — Exit self-service + account suspension on clearance
-- Two gaps closed:
--   1. The departing employee could only WATCH the clearance list.
--      Areas now carry an owner ('staff' | 'company'); the employee
--      ticks their own two — Supervisor handover, Assets returned —
--      from My Exit via sign_my_exit_step. HR can still tick all.
--   2. Clearing an exit never closed access. sign_exit_step (and the
--      self variant, if their tick is the last) now stamps
--      cleared_at + access_until = now() + 24h. Once that grace
--      window passes, enforce_exit_suspensions() offboards the user
--      (reusing offboard_user: state exited, permissions zeroed,
--      grants/invites revoked) and bans the auth login. The sweep is
--      run opportunistically by my_access_state(), which every
--      client calls at session load.
-- Idempotent: safe to re-run.
-- ============================================================

alter table public.staff_exits add column if not exists cleared_at   timestamptz;
alter table public.staff_exits add column if not exists access_until timestamptz;

-- ---------- backfill: clearance areas gain an owner ----------
update public.staff_exits x
set clearance = coalesce((
      select jsonb_agg(e || jsonb_build_object('owner',
               case when e->>'area' in ('Supervisor handover','Assets returned')
                    then 'staff' else 'company' end)
             order by ord)
      from jsonb_array_elements(x.clearance) with ordinality as t(e, ord)
    ), '[]'::jsonb),
    updated_at = now()
where exists (select 1 from jsonb_array_elements(x.clearance) e where not (e ? 'owner'));

-- ---------- start_exit: seed areas with owners ----------
create or replace function public.start_exit(
  p_person text, p_reason text default null, p_final_day date default null, p_staff_no text default null
) returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_entity uuid := (select id from public.entities where code = 'KE');
  v_user uuid; v_role text; v_ref text;
begin
  perform public.assert_access('hr', 2);
  if nullif(trim(coalesce(p_person,'')),'') is null then raise exception 'An exit needs a person'; end if;
  if p_staff_no is not null then
    select sf.app_user_id, u.role_title into v_user, v_role
    from public.staff_files sf join public.app_users u on u.id = sf.app_user_id
    where sf.staff_no = p_staff_no;
    if v_user is not null and exists (select 1 from public.staff_exits where app_user_id = v_user and state = 'in_progress') then
      raise exception '% already has an exit in progress', p_person;
    end if;
  end if;
  v_ref := public.next_ref('EXT');
  insert into public.staff_exits(ref, entity_id, app_user_id, person, role_title, reason, final_day, clearance, state)
  values (v_ref, v_entity, v_user, trim(p_person), v_role, nullif(trim(coalesce(p_reason,'')),''), p_final_day,
    jsonb_build_array(
      jsonb_build_object('area','Supervisor handover','done',false,'owner','staff'),
      jsonb_build_object('area','IT — access & equipment','done',false,'owner','company'),
      jsonb_build_object('area','Finance — advances & floats','done',false,'owner','company'),
      jsonb_build_object('area','Assets returned','done',false,'owner','staff'),
      jsonb_build_object('area','HR — documents & exit interview','done',false,'owner','company'),
      jsonb_build_object('area','Final pay computed','done',false,'owner','company'),
      jsonb_build_object('area','Certificate of service issued','done',false,'owner','company')),
    'in_progress');
  perform public.audit_write('hr.exit_started','exit', v_ref,
    jsonb_build_object('person', p_person, 'reason', p_reason, 'finalDay', p_final_day));
  return jsonb_build_object('id', v_ref, 'person', p_person);
end $$;

-- ---------- HR signs any area; full clearance starts the 24h clock ----------
create or replace function public.sign_exit_step(p_ref text, p_idx int)
returns jsonb language plpgsql security definer set search_path = public as $$
declare x record; v jsonb; v_all boolean;
begin
  perform public.assert_access('hr', 2);
  select * into x from public.staff_exits where ref = p_ref;
  if not found then raise exception 'Exit % not found', p_ref; end if;
  if x.state = 'cleared' then raise exception '% is fully cleared already', p_ref; end if;
  if p_idx < 0 or p_idx >= jsonb_array_length(x.clearance) then raise exception 'No clearance area at position %', p_idx; end if;
  v := jsonb_set(x.clearance, array[p_idx::text, 'done'], to_jsonb(not coalesce((x.clearance -> p_idx ->> 'done')::boolean, false)));
  v_all := not exists (select 1 from jsonb_array_elements(v) e where not coalesce((e ->> 'done')::boolean, false));
  update public.staff_exits
     set clearance = v, state = case when v_all then 'cleared' else 'in_progress' end,
         cleared_at   = case when v_all then now() else cleared_at end,
         access_until = case when v_all then now() + interval '24 hours' else access_until end,
         updated_at = now()
   where ref = p_ref;
  if v_all then
    if x.app_user_id is not null then
      update public.staff_files set state = 'exited', updated_at = now() where app_user_id = x.app_user_id;
    end if;
    perform public.audit_write('hr.exit_cleared','exit', p_ref,
      jsonb_build_object('person', x.person, 'certificateOfService', true, 'accessCloses', now() + interval '24 hours'));
  end if;
  return jsonb_build_object('id', p_ref, 'clearance', v, 'state', case when v_all then 'cleared' else 'in_progress' end);
end $$;

-- ---------- the departing employee ticks their own areas ----------
create or replace function public.sign_my_exit_step(p_ref text, p_idx int)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_me uuid := (select id from public.app_users where auth_id = auth.uid());
  x record; v jsonb; v_all boolean;
begin
  if v_me is null then raise exception 'No staff record is linked to this login'; end if;
  select * into x from public.staff_exits where ref = p_ref;
  if not found then raise exception 'Exit % not found', p_ref; end if;
  if x.app_user_id is distinct from v_me then raise exception 'This is not your exit'; end if;
  if x.state = 'cleared' then raise exception 'Your exit is fully cleared already'; end if;
  if p_idx < 0 or p_idx >= jsonb_array_length(x.clearance) then raise exception 'No clearance area at position %', p_idx; end if;
  if coalesce(x.clearance -> p_idx ->> 'owner', 'company') <> 'staff' then
    raise exception '"%" is signed off by the function that owns it — you can only tick your own parts', x.clearance -> p_idx ->> 'area';
  end if;
  v := jsonb_set(x.clearance, array[p_idx::text, 'done'], to_jsonb(not coalesce((x.clearance -> p_idx ->> 'done')::boolean, false)));
  v_all := not exists (select 1 from jsonb_array_elements(v) e where not coalesce((e ->> 'done')::boolean, false));
  update public.staff_exits
     set clearance = v, state = case when v_all then 'cleared' else 'in_progress' end,
         cleared_at   = case when v_all then now() else cleared_at end,
         access_until = case when v_all then now() + interval '24 hours' else access_until end,
         updated_at = now()
   where ref = p_ref;
  perform public.audit_write('hr.exit_step_self_signed','exit', p_ref,
    jsonb_build_object('person', x.person, 'area', x.clearance -> p_idx ->> 'area'));
  if v_all then
    update public.staff_files set state = 'exited', updated_at = now() where app_user_id = x.app_user_id;
    perform public.audit_write('hr.exit_cleared','exit', p_ref,
      jsonb_build_object('person', x.person, 'certificateOfService', true, 'accessCloses', now() + interval '24 hours'));
  end if;
  return jsonb_build_object('id', p_ref, 'clearance', v, 'state', case when v_all then 'cleared' else 'in_progress' end);
end $$;

-- ---------- suspend accounts whose 24h grace has passed ----------
-- Reuses offboard_user (state exited, permissions zeroed, grants + invites
-- revoked) under the system-action bypass, then bans the auth login so the
-- password stops working. Auth-schema access is attempted best-effort — the
-- app-side block holds even if that update is not permitted.
create or replace function public.enforce_exit_suspensions()
returns jsonb language plpgsql security definer set search_path = public as $$
declare r record; v_n int := 0;
begin
  for r in
    select x.ref, u.id as uid, u.auth_id, u.email, u.name
    from public.staff_exits x
    join public.app_users u on u.id = x.app_user_id
    where x.state = 'cleared' and x.access_until is not null and x.access_until < now()
      and u.state <> 'exited'
  loop
    perform set_config('jikoni.system_action', 'true', true);
    perform public.offboard_user(r.email);
    perform set_config('jikoni.system_action', 'false', true);
    if r.auth_id is not null then
      begin
        update auth.users set banned_until = timestamptz '2999-12-31' where id = r.auth_id;
      exception when others then
        perform public.audit_write('user.suspend_auth_ban_failed','user', r.email, jsonb_build_object('error', sqlerrm));
      end;
    end if;
    perform public.audit_write('user.suspended_after_exit','user', r.email,
      jsonb_build_object('name', r.name, 'exit', r.ref));
    v_n := v_n + 1;
  end loop;
  return jsonb_build_object('suspended', v_n);
end $$;

-- ---------- the client's session gate: sweep, then report my state ----------
create or replace function public.my_access_state()
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_me record;
  v_until timestamptz;
begin
  perform public.enforce_exit_suspensions();
  select u.id, u.state into v_me from public.app_users u where u.auth_id = auth.uid();
  if v_me.id is null then return jsonb_build_object('state', 'unlinked'); end if;
  select x.access_until into v_until
  from public.staff_exits x
  where x.app_user_id = v_me.id and x.state = 'cleared'
  order by x.cleared_at desc nulls last limit 1;
  return jsonb_build_object('state', v_me.state, 'accessUntil', v_until);
end $$;

-- ---------- grants ----------
do $$
declare fn text;
begin
  foreach fn in array array[
    'sign_my_exit_step(text,int)','enforce_exit_suspensions()','my_access_state()']
  loop
    execute format('revoke execute on function public.%s from public, anon', fn);
    execute format('grant execute on function public.%s to authenticated', fn);
  end loop;
end $$;
