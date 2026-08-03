-- Invited members must read as "Pending sign-in" until they actually log in.
--
-- Bug: link_auth_user() (0008) fired on auth.users INSERT and immediately set
-- state/status = 'active'. But generating an invite/recovery link *creates* the
-- auth.users row (with last_sign_in_at still null), so invitees were promoted to
-- active before ever signing in — they showed as members, not pending.
--
-- Fix: still link the auth account on insert, but only promote to active once the
-- user has genuinely signed in (last_sign_in_at is set). Fire on INSERT OR UPDATE
-- so the promotion lands on that first real sign-in.

create or replace function public.link_auth_user() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  -- always link the auth account to the app_users row (safe on invite creation)
  update public.app_users set auth_id = new.id, updated_at = now()
  where email = new.email and auth_id is null;

  -- only promote to active on a real sign-in; invite-link creation leaves
  -- last_sign_in_at null, so those rows stay 'invited' (Pending sign-in)
  if new.last_sign_in_at is not null then
    update public.app_users set state = 'active', status = 'active', updated_at = now()
    where email = new.email and state = 'invited';
    update public.invites set state = 'accepted', updated_at = now()
    where email = new.email and state = 'sent';
  end if;
  return new;
end $$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert or update on auth.users
  for each row execute function public.link_auth_user();

-- Backfill: anyone marked active/linked but who has never actually signed in was
-- promoted by the old bug — put them back to pending until their first login.
-- The state-machine trigger has no active→invited edge (correction, not a normal
-- transition), so disable it just for this one-time repair.
alter table public.app_users disable trigger state_machine;
update public.app_users au
set state = 'invited', status = 'off', updated_at = now()
where au.state = 'active'
  and not exists (
    select 1 from auth.users u
    where u.email = au.email and u.last_sign_in_at is not null
  );
alter table public.app_users enable trigger state_machine;
