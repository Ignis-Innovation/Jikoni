# Jikoni — The Ignis Innovation Operating System

One system, one shared database (the **spine**). Every business module references
spine entities by ID — never duplicates them. Built per the Jikoni PRD.

**Stack:** Supabase (Postgres + Auth + Storage + Realtime) · Next.js 16 (App Router) ·
React 19 · TypeScript · Tailwind v4 · Vercel-ready.

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

### ⏳ Not yet built
Phases 2–11 (Procure-to-Pay, Revenue, People, Assets, Projects, CRM, Intelligence,
Governance, Field/Mobile, BD). Nav shows them locked until their phase lands.

---

## Setup

```bash
npm install
cp .env.example .env.local   # fill in Supabase URL + keys (already done locally)
npm run dev                  # http://localhost:3000
```

**First login (seeded super_admin):** `sureantony@gmail.com` / `Draggonne..1`
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
