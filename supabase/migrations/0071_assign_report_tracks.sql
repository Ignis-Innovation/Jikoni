-- ============================================================
-- 0071 — Assign weekly-report tracks to the current roster
-- Dennis' "five lines" format is role-specific: the pipeline crew, the technology
-- lead and the CEO each answer a different five. Seed those tracks here so each
-- person's Staff Portal form shows the right prompts. Idempotent (match by email).
--   * Elizabeth Ooro, Wilson Mungai → pipeline
--   * Brian Mwangi                  → technology
--   * Dennis Nderitu                → leadership (five CEO dashboard numbers)
-- Anyone not listed keeps the free-text form (report_track stays null).
-- ============================================================

update public.app_users set report_track = 'pipeline'
  where lower(email) in ('eooro@ignis-innovation.com', 'wmungai@ignis-innovation.com');

update public.app_users set report_track = 'technology'
  where lower(email) = 'bmwangi@ignis-innovation.com';

update public.app_users set report_track = 'leadership'
  where lower(email) = 'dnderitu@ignis-innovation.com';
