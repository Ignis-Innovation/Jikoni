# Jikoni — The Ignis Innovation Operating System

One system, one shared database (the **spine**). Every business module references
spine entities by ID — never duplicates them. Built per the Jikoni PRD.

**Stack:** Supabase (Postgres + Auth + Storage + Realtime) · **Vite 7 + React 19 SPA** ·
React Router 7 · TypeScript · Tailwind v4.

> Migrated from Next.js to a Vite + React SPA for faster local dev/navigation.
> All former server actions are now client functions calling Supabase directly —
> **RLS enforces every permission server-side**, and the client only ever holds
> the anon key (the service_role key is never shipped to the browser).

---

## Status

### ✅ Phase 1 — The Spine (built & live)
The foundation every other module reads/writes. Applied to Supabase project
`jaqiscfiqzkmdvvubmzf` (eu-west-1).

| Area | What's in place |
|---|---|
| **1A Identity & Access** | `users` (mirrors `auth.users`), `roles`, `permissions`, `role_permissions`, `user_roles`. Helper fns `has_permission()`, `is_super_admin()`, `has_module_access()`. Auto-mirror trigger on signup. |
| **1B Organisation** | `institutions`, `departments`, `projects`, `locations`, `cost_centers`. |
| **1C Chart of Accounts** | `accounts`, `fiscal_periods`, `opening_balances`. |
| **1D Parties** | `parties` + `party_types` (multi-tag), `party_contacts`, `party_bank_details`. One party can be vendor **and** partner. |
| **1E Documents** | `documents` + `document_versions`, private `documents` Storage bucket. |
| **1F Audit Log** | `audit_log` (append-only) + generic trigger on every table — who/what/when/before/after. |
| **1G Approvals** | `approval_chains`, `approval_steps`, `approval_requests`, `approval_actions`. |
| **1H Notifications** | `notifications`, `notification_prefs`, `notify()` fan-out fn. |
| **1I Reference Data** | `currencies`, `tax_codes`, `units_of_measure`, `categories` (seeded). |
| **1J Event Bus** | `events` table + `emit_event()` trigger on every write (Realtime channel). |

**Cross-cutting (PRD Appendix B):** RLS on all 32 tables, permissions enforced
server-side, money as integer minor units + currency code, every write → audit
row + event, soft-delete everywhere (`deleted_at`).

### 🟢 App slice (built)
- Supabase auth: login, forgot/reset password, session middleware + route guard.
- App shell: permission-filtered left nav, top bar, sign-out.
- **Home Dashboard** (Phase 8A): Company Pulse / My Week / Status Board, live from spine.
- **Parties** module: full "Add button" contract — list, debounced search, type
  filter, slide-over create/edit, *Save & add another*, soft-delete, toasts.
- **Users**: list + invite (role assignment via permission-checked server action).
- **Roles**, **Reference Data**, **Audit Log** viewers. Org / CoA / Approvals scaffolds.

### ✅ Phases 2–11 — backbone built & live
The complete database for all 11 phases is applied and verified: **114 tables,
RLS on all 114, 19 permission modules, 69 permissions, ~315 event triggers.**
Every Phase 2–11 table gets the same spine guarantees (audit, events, timestamps,
RLS, auto human-codes) via the installer functions in `0014_module_helpers.sql`.

| Phase | Tables (examples) |
|---|---|
| **2 Procure-to-Pay** | vendor_profiles, requisitions, purchase_orders, grns, payable_invoices, payment_runs, petty_cash_*, expense_receipts |
| **3 Revenue** | customer_profiles, quotations, sales_orders, receivable_invoices (eTIMS), customer_receipts, credit_notes |
| **4 People** | employee_profiles, leave_*, attendance, timesheets, salary_structures, objectives, hr_checklists |
| **5 Assets** | assets (QR), asset_events, stock_*, work_orders, deployments |
| **6 Projects** | project_details, project_budgets, milestones, grants, drawdowns, field_activities |
| **7 CRM** | partner_profiles, engagements (upstream/downstream), engagement_updates, action_items, opportunities, eois |
| **8 Intelligence** | kpis, kpi_values, impact_metrics, alert_rules (Home Dashboard already live) |
| **9 Governance** | contracts, compliance_obligations, policies, risks, board_*, shareholding, dataroom_shares |
| **10 Field** | support_tickets, ticket_comments, public_impact_metrics view |
| **11 BD** | concepts, capability_snapshots |

**App:** a config-driven resource framework (`src/lib/spine/resources.ts` +
`ResourceView`) renders ~22 flagship modules across every phase with the full
Add-button contract (list, search, ref dropdowns, money handling, soft-delete) at
`/r/<slug>`. The nav is unlocked and permission-filtered. Remaining per-module
bespoke UX (PDFs, OCR, three-way match, eTIMS/M-Pesa/Daraja calls, Gantt/calendar
widgets, portals) layers onto this backbone.

---

## Setup

```bash
npm install
cp .env.example .env         # fill in VITE_SUPABASE_URL + VITE_SUPABASE_ANON_KEY (done locally)
npm run dev                  # Vite dev server (http://localhost:3000, or 3001 if busy)
npm run build && npm run preview   # production build + static preview
```

**First login (seeded super_admin):** `brian55mwangi@gmail.com` / `Draggonne..1`
→ change this password immediately.

### Applying database migrations
Migrations live in `supabase/migrations/` (numbered, run in order). They are
**already applied** to the live project. To re-run against a fresh database:

```bash
SUPABASE_DB_URL="postgresql://postgres.<ref>:<db-password>@aws-0-eu-west-1.pooler.supabase.com:5432/postgres" \
  node scripts/migrate.mjs
```

(`supabase/ALL_MIGRATIONS.sql` is the same content bundled for the SQL Editor.)

---

## Security notes
- `.env.local` is git-ignored. **The `service_role` key bypasses RLS — server-only.**
- Rotate the `service_role` key (Supabase → Settings → API) — it was shared in chat.
- The seeded admin password is a placeholder; reset it on first login.

## Architecture rules (non-negotiable)
1. Modules reference spine data by ID — never duplicate it.
2. Every write fires an event the spine logs.
3. Every module exposes a read API.


## M-Pesa (Daraja) — Sales module

STK Push is handled by Vercel serverless functions in `api/` (`mpesa-stk-push.js`,
`mpesa-callback.js`). **Credentials are NOT stored here** — they live in `.env.local`
(local, git-ignored) and in the Vercel project's Environment Variables (production):

```
MPESA_ENV, MPESA_CONSUMER_KEY, MPESA_CONSUMER_SECRET,
MPESA_SHORTCODE, MPESA_PASSKEY, MPESA_CALLBACK_URL
```

Sandbox uses Safaricom's public test Shortcode (`174379`) and LNM passkey. Swap in
real production values when going live. The `/api` routes also need
`SUPABASE_SERVICE_ROLE_KEY` and (for emails) the `SMTP_*` vars set in Vercel.