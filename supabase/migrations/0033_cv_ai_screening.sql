-- ============================================================
-- Jikoni — Recruitment: AI CV screening
-- Eligibility so far trusts only what the applicant typed into the form.
-- This adds columns to hold an AI verdict: HR triggers a read of the actual
-- uploaded CV (via the /api/screen-cv serverless function, which calls Claude),
-- and the model reports whether the CV genuinely evidences the job's required
-- skills / experience / education. The verdict is stored here so it shows,
-- ranked, in the HR Recruitment view. Idempotent.
-- ============================================================

alter table public.candidates add column if not exists ai_verdict     text
  check (ai_verdict in ('strong','possible','weak'));
alter table public.candidates add column if not exists ai_summary     text;
alter table public.candidates add column if not exists ai_checked     jsonb not null default '[]'::jsonb;  -- [{requirement, evidenced, note}]
alter table public.candidates add column if not exists ai_concerns    jsonb not null default '[]'::jsonb;  -- [string]
alter table public.candidates add column if not exists ai_screened_at timestamptz;
