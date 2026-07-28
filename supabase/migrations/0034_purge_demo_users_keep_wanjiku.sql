-- ============================================================
-- 0034 — Purge all demo/seed members, keep only wanjiku@ignis.africa
-- Going-live cleanup: User Management should start from a single super-admin
-- account. app_users has many FK references with no ON DELETE CASCADE, so we
-- clear the person-specific HR rows, null out ownership/actor references on
-- business records, then delete the users and their auth logins.
-- Idempotent: re-running is a no-op once only wanjiku remains.
-- ============================================================
do $$
declare keep constant text := 'wanjiku@ignis.africa';
begin
  -- 1) person-specific HR rows belonging to a doomed user → delete outright
  delete from public.payroll_items      where app_user_id in (select id from public.app_users where email <> keep);
  delete from public.leave_balances      where app_user_id in (select id from public.app_users where email <> keep);
  delete from public.leave_applications  where app_user_id in (select id from public.app_users where email <> keep);
  delete from public.appraisals          where app_user_id in (select id from public.app_users where email <> keep);
  delete from public.certifications      where app_user_id in (select id from public.app_users where email <> keep);
  delete from public.staff_feedback      where author_id   in (select id from public.app_users where email <> keep);
  delete from public.staff_exits         where app_user_id in (select id from public.app_users where email <> keep);
  delete from public.staff_files         where app_user_id in (select id from public.app_users where email <> keep);

  -- 2) nullable ownership / actor references on business records → set null
  update public.appraisals          set reviewer_id = null where reviewer_id in (select id from public.app_users where email <> keep);
  update public.leave_applications  set approver_id = null where approver_id in (select id from public.app_users where email <> keep);
  update public.payroll_runs        set prepared_by = null where prepared_by in (select id from public.app_users where email <> keep);
  update public.payroll_runs        set approved_by = null where approved_by in (select id from public.app_users where email <> keep);
  update public.dispatches          set created_by  = null where created_by  in (select id from public.app_users where email <> keep);
  update public.documents           set owner_id    = null where owner_id    in (select id from public.app_users where email <> keep);
  update public.goods_received_notes set receiver_id = null where receiver_id in (select id from public.app_users where email <> keep);
  update public.invites             set invited_by  = null where invited_by  in (select id from public.app_users where email <> keep);
  update public.purchase_orders     set owner_id    = null where owner_id    in (select id from public.app_users where email <> keep);
  update public.requisitions        set owner_id    = null where owner_id    in (select id from public.app_users where email <> keep);
  update public.sales_invoices      set owner_id    = null where owner_id    in (select id from public.app_users where email <> keep);
  update public.sanctions_checks    set checked_by  = null where checked_by  in (select id from public.app_users where email <> keep);
  update public.stock_movements     set created_by  = null where created_by  in (select id from public.app_users where email <> keep);
  update public.tasks               set owner_id    = null where owner_id    in (select id from public.app_users where email <> keep);
  update public.vendor_screenings   set screened_by = null where screened_by in (select id from public.app_users where email <> keep);
  update public.vendors             set owner_id    = null where owner_id    in (select id from public.app_users where email <> keep);

  -- 3) email-keyed rows
  delete from public.user_permissions where email <> keep;
  delete from public.invites          where email <> keep;

  -- 4) finally the members themselves
  delete from public.app_users where email <> keep;
end $$;

-- 5) remove their Supabase Auth logins so they can no longer sign in
delete from auth.users where email <> 'wanjiku@ignis.africa';
