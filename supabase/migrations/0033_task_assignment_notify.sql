-- ============================================================================
-- 0033_task_assignment_notify.sql — track task-assignment email delivery.
-- When HR assigns a task to a team member, the row sits with notified_at = null
-- until scripts/send-task-assignments.mjs emails the assignee (then stamps it),
-- so an assignee is mailed exactly once. Idempotent: safe to re-run.
-- ============================================================================

alter table public.tasks add column if not exists notified_at timestamptz;

-- Helps the mailer find the un-notified assigned tasks quickly.
create index if not exists tasks_pending_notify_idx
  on public.tasks (created_at)
  where notified_at is null and assigned_by is not null;
