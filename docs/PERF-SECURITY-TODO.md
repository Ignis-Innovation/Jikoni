# Performance & Security — tracked follow-ups

## RLS: wrap `auth.uid()` in `(select auth.uid())` — future-proofing (NOT urgent)

**Status:** deferred by decision (2026-09-08). Not a current bottleneck.

**Why deferred:** measured `bootstrap()` server-side execution = **~26 ms**; a bare
`select 1` round-trip to the hosted DB = **~306 ms**. Today's login/write latency is
**network round-trip count**, not RLS CPU. Row counts are tiny, so per-row policy
evaluation is negligible.

**What to do when tables grow (audit_log, notifications, tasks, weekly_reports,
petty_cash_requests, leave_applications reaching tens of thousands of rows):**
- In every `create policy ... using (...) / with check (...)` clause, replace bare
  `auth.uid()` with `(select auth.uid())` and bare
  `current_setting('request.jwt.claims', true)` reads with a `(select …)` wrapper so
  Postgres evaluates them **once per query** (InitPlan) instead of **once per row**.
- Prefer simple indexed column checks over `EXISTS`/`IN (SELECT …)` subqueries in
  policies; where a subquery is unavoidable, make sure the joined column is indexed.
- There are ~44 policies and ~102 bare `auth.uid()` occurrences (most are inside
  `SECURITY DEFINER` function bodies — those are fine, evaluated once per call; only
  the ones in policy `USING`/`WITH CHECK` clauses matter).
- Verify with `EXPLAIN (ANALYZE)` before/after on the largest table.

Reference: Supabase RLS performance guide — "wrap functions in a subquery".

## Optimistic UI (open offer)

`createTask` and the IRENA budget already do targeted local inserts (instant).
Other creates now refresh in the **background** (instant feedback, row appears after
one insert round-trip). If a specific "Add" screen still feels a beat slower than the
rest, wire **true optimistic insert** (insert the row into local state immediately,
roll back on RPC error) for that exact handler.

## LLM latency audit (done — 2026-09-08)

No live LLM/Anthropic/OpenAI calls exist in the app. The "Claude API" entry in
Settings stores a key for future use; `api/screen-cv.js` does **local** text
extraction (pdf-parse + mammoth + regex), **no external AI**. Nothing to optimise.
Re-run this audit if/when receipt-OCR or CV screening starts calling Anthropic.
