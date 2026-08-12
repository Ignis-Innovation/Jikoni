-- ============================================================
-- 0051 — Rename the HR login wanjiku@ignis.africa → jwanjiku@ignis-innovation.com
-- The password hash lives on auth.users and is untouched by an email change, and
-- every HR record is keyed by app_users.id (not email), so the login and all data
-- (leave, payroll, exits, etc.) survive the rename. We update every place the
-- email itself is stored. Idempotent: the WHERE clauses no longer match on re-run.
-- ============================================================
do $$
declare old_email constant text := 'wanjiku@ignis.africa';
        new_email constant text := 'jwanjiku@ignis-innovation.com';
begin
  update auth.users            set email = new_email where email = old_email;
  update public.app_users      set email = new_email where email = old_email;
  update public.user_permissions set email = new_email where email = old_email;
  update public.invites        set email = new_email where email = old_email;
  update public.notifications  set recipient_email = new_email where recipient_email = old_email;
end $$;
