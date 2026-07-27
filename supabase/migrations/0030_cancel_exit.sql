-- ============================================================
-- Jikoni — Cancel a mistaken exit
-- An exit can be started (or even cleared) by mistake. cancel_exit
-- removes the exit record and undoes its side effects: the staff
-- file returns to active, and if the 24h grace had already passed
-- (account offboarded + auth banned by 0029), the person is
-- reinstated and the login unbanned. Module permissions zeroed by
-- offboard_user are NOT restorable automatically — re-grant those
-- in User Management.
-- Idempotent: safe to re-run.
-- ============================================================

-- reinstatement becomes a legal transition for both records (were one-way active → exited)
insert into public.record_transitions(record_type, from_state, to_state)
select v.record_type, v.from_state, v.to_state
from (values ('app_user','exited','active'), ('staff','exited','active')) as v(record_type, from_state, to_state)
where not exists (select 1 from public.record_transitions r
                  where r.record_type = v.record_type and r.from_state = v.from_state and r.to_state = v.to_state);

create or replace function public.cancel_exit(p_ref text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare x record; u record; v_reinstated boolean := false;
begin
  perform public.assert_access('hr', 2);
  select * into x from public.staff_exits where ref = p_ref;
  if not found then raise exception 'Exit % not found', p_ref; end if;
  if x.app_user_id is not null then
    update public.staff_files set state = 'active', updated_at = now()
     where app_user_id = x.app_user_id and state = 'exited';
    select * into u from public.app_users where id = x.app_user_id;
    if u.state = 'exited' then
      update public.app_users set state = 'active', status = 'active', updated_at = now() where id = u.id;
      v_reinstated := true;
      if u.auth_id is not null then
        begin
          update auth.users set banned_until = null where id = u.auth_id;
        exception when others then
          perform public.audit_write('user.unban_failed','user', u.email, jsonb_build_object('error', sqlerrm));
        end;
      end if;
    end if;
  end if;
  delete from public.staff_exits where ref = p_ref;
  perform public.audit_write('hr.exit_cancelled','exit', p_ref,
    jsonb_build_object('person', x.person, 'wasState', x.state, 'reinstated', v_reinstated));
  return jsonb_build_object('id', p_ref, 'person', x.person, 'reinstated', v_reinstated);
end $$;

do $$ begin
  revoke execute on function public.cancel_exit(text) from public, anon;
  grant execute on function public.cancel_exit(text) to authenticated;
end $$;
