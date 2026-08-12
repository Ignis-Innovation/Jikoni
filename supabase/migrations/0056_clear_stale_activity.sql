-- ============================================================
-- 0056 — Clear the last of the demo/test activity so the app is a true clean slate
--   * all notifications (every row is test data from the demo period — they were
--     driving the stale "recent activity" feed on Home: kimani match exception,
--     PR-209 approval, "Testing item" petty cash, TSK-213 task)
--   * PR-209 "steam repair" requisition (its PO/invoice were already removed)
--   * TSK-213 "Share excel sheet…" task
--   * reset budget-line commitments/actuals (no live transactions remain)
-- Idempotent; on a fresh rebuild these tables are empty so it is a no-op.
-- ============================================================
delete from public.notifications;
delete from public.requisitions;                 -- only PR-209 remained, a test row
delete from public.tasks;                         -- only TSK-213 remained, a test row
update public.budget_lines set committed = 0, actual = 0 where committed <> 0 or actual <> 0;
