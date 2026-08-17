-- ============================================================
-- 0062 — Sub Admin: Human Resources at Full (not just Edit)
-- Sub Admins should also run the HR approvals — approving leave, running/approving
-- payroll and finalising exits — which are Full-level (3) actions. Compliance stays
-- Edit (2). Idempotent.
-- ============================================================

update public.role_templates set level = 3 where role_key = 'sub' and module = 'hr';

update public.user_permissions set level = 3
  where module = 'hr'
    and email in (select lower(email) from public.app_users where role_key = 'sub');
