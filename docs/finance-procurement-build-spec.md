# Jikoni ERP — Finance & Procurement Build Spec (End-to-End)

**Owner:** Ob (Brian Mwangi), Head of Technology, Ignis Innovation
**Purpose:** No-gap, no-loose-end reference for building out every tab. For each tab: what data it reads, every button, exactly what happens when it's pressed/approved (RPC, guards, what gets written, what journal posts, what state it moves to next), and what's still missing.
**How to read the tables:** `Button` → `Calls` (the RPC) → `Guard` (what can block it) → `Writes` (rows/state changed) → `Journal` (accounting entry, or "—" if none) → `Next state`.
**Convention for RPCs still to be built:** named in the same style as the existing ones (`verb_noun`), marked **[TO BUILD]**.

> This is the canonical guide for the Finance & Procurement build-out. Items marked **[TO BUILD]** / **[DEFERRED]** are pending. See PART E (loose ends) and PART F (open decisions) — several items are blocked until the decisions in PART F are answered.

---

## PART A — FINANCE & ACCOUNTING

### A1. Overview — read-only + 2 action buttons
Reads: `account_balances()` (Revenue/Expense/Cash/Net), `invoices_ap` (Payables, Match exceptions), plus a filtered "waiting on you" list built from any row where the current user is a valid next approver (per SoD).

| Button | Calls | Guard | Writes | Journal | Next state |
|---|---|---|---|---|---|
| Approve (on an approvals-waiting card) | `approve_ap_invoice` | approver ≠ `captured_by` | `invoices_ap.state`: matched → approved | — | Card moves to Payables tab, disappears from this list |
| Pay (on an approvals-waiting card) | `pay_invoice` | `assert_access('finance', 3)`; state must be `approved` | `payments` row; `invoices_ap.state` → paid; `vendors.open_pos` decremented | Dr 2000 AP 120,000 / Cr 1000 Cash 114,000 / Cr 2200 WHT 6,000 (WHT line only if applicable) | Invoice closed, cash + payables balances refresh everywhere (GL, Overview, Bank & Cash) |

**No gap here today** — this tab is fully wired.

---

### A2. General Ledger — read-only
Reads: `chart_of_accounts` + `account_balances()` for balances; `journal_entries` + `journal_lines` for the recent-entries list; trial balance summed client-side from the same balances.

No buttons write anything here by design — the GL is never hand-typed. The only addition worth building:

| Button | Calls | Guard | Writes | Journal | Next state |
|---|---|---|---|---|---|
| Export Trial Balance **[TO BUILD]** | `export_trial_balance` | none (read-only) | none | — | Downloads CSV/PDF of the current trial balance |

---

### A3. Payables — the 3-way-match engine
Reads: `invoices_ap` joined to `purchase_orders`.

| Button | Calls | Guard | Writes | Journal | Next state |
|---|---|---|---|---|---|
| Capture invoice | `capture_ap_invoice` | Duplicate check (same vendor+invoice#+amount rejected); one live invoice per PO | `invoices_ap` row (`captured_by` = you) | Dr 5000 Expense (or budget line's account_code) / Cr 2000 AP, both = invoice amount | Runs `three_way_match` immediately → `matched` if PO+GRN tie out within 0.5%, else `exception` (+ `match_note`, finance notified) |
| Approve for Payment | `approve_ap_invoice` | `captured_by` ≠ approver (SoD) | state change only | — | matched → approved |
| Pay | `pay_invoice` | `assert_access('finance', 3)`, state = approved | `payments` row, PO `open_pos` decremented | Dr 2000 AP / Cr 1000 Cash (net) / Cr 2200 WHT (if applicable) | approved → paid |
| Resolve exception **[TO BUILD]** | `resolve_ap_exception` | finance role only | clears `match_note`, re-runs `three_way_match` | — | exception → matched or stays exception with updated note |

**Gap identified:** there's currently no button to act on an `exception` state — Finance can see it (via `match_note` + notification) but the trace doesn't show a resolve path. This needs building or the invoice is stuck forever once flagged.

---

### A4. Receivables
Reads: `sales_invoices`.

| Button | Calls | Guard | Writes | Journal | Next state |
|---|---|---|---|---|---|
| New invoice | `submit_sales_invoice` | none noted | `sales_invoices` row | Dr Receivable / Cr 4000 Income (at submission — confirm this posts immediately, not on receipt) | draft → issued |
| Record receipt | `record_ar_receipt` | none noted | receipt recorded, invoice marked paid | Dr 1000 Cash / Cr Receivable | issued → paid |
| File eTIMS **[TO BUILD]** | `file_etims_return` | finance role; invoice must be `issued` or `paid` | new `etims_filings` row: invoice_id, filed_by, filed_at, kra_reference (manual entry field) | — | Adds `etims_status: filed` badge on the invoice row |

**Decision needed (from earlier PRD, §6.2):** manual mark-as-filed (above) vs real KRA API call. Given no external linking is wanted, recommend the manual version — same audit-trail pattern as everything else, and it closes the loop without a new integration surface.

---

### A5. Bank & Cash — intentionally minimal
Reads: `account_balances()` for account 1000 only.

No transactional buttons — by design, since there's no bank feed. The only thing worth adding:

| Button | Calls | Guard | Writes | Journal | Next state |
|---|---|---|---|---|---|
| Record manual cash adjustment **[TO BUILD, optional]** | `post_cash_adjustment` | finance role, requires a reason field | new `journal_entries`/`journal_lines` pair | Dr/Cr 1000 Cash vs a "Cash adjustment" clearing account, amount + reason | Adjusts balance, fully auditable |

This is optional — only needed if you expect the ledger cash balance to ever drift from reality (e.g. bank charges, float top-ups not captured elsewhere) and want a controlled way to correct it without a bank feed.

---

### A6. Petty Cash
Reads: `petty_cash_requests`.

| Button | Calls | Guard | Writes | Journal | Next state |
|---|---|---|---|---|---|
| Approve | `decide_petty_cash_request` | HR/Finance only; can't decide your own request | `petty_cash_requests.state` → approved, `decided_by`, `decided_at` | *(confirm: does approval post a journal — Dr Expense/Cr Cash — or only disbursement does? This needs to be explicit or cash will look right in the ledger but wrong operationally)* | pending → approved |
| Reject | `decide_petty_cash_request` | same | state → rejected, reason required | — | pending → rejected |

**Gap identified:** the trace doesn't say whether approval posts a journal entry or whether disbursement is a separate step. If approval alone doesn't move cash, there needs to be a "Disburse" button that does — otherwise approved petty cash requests never hit the GL and Cash on Hand will overstate reality. Flagging this as a definite loose end to close before this tab is "done."

**Status note (implemented):** the approve/reject action is now an **in-app popup modal** (`PettyDecideModal` in `src/views/Finance.tsx`) with an optional note — no browser `prompt`/`alert`. Journal-on-approval vs separate disburse step is still an open decision (PART F #5).

---

### A7. Budgets & Costing
Reads: `budget_lines` (loaded at bootstrap).

Read-only today — committed/actual driven entirely by Requisitions and Payables actions. No buttons of its own, but this is the tab that Phase 2's budget-impact chip pulls from live everywhere else.

| Addition | Calls | Guard | Writes | Journal | Next state |
|---|---|---|---|---|---|
| Budget-impact chip on PO amendment approval **[TO BUILD]** | reads `budget_lines` for the req's cost centre | none (display only) | none | — | Shows "This will move Field/MRV to 94% utilised" before the approver clicks Approve |
| Budget-impact chip on invoice approval **[TO BUILD]** | same | none | none | — | Same, shown at `approve_ap_invoice` step |
| Set/edit budget line **[TO BUILD, if missing]** | `set_budget_line` | finance/MD only | `budget_lines` row created/updated | — | Line available for requisitions to check against |

**Gap identified:** the trace never shows how a `budget_lines` row is *created* in the first place — only how it's consumed (committed/actual). If there's no create/edit UI yet, budgets can only be seeded by someone writing directly to Postgres, which breaks the "frontend never writes rows directly" rule everywhere else. This needs a button. *(Note: `upsert_cost_centre` exists in the DB — surface it via a modal.)*

---

### A8. Reporting & Compliance — currently the biggest gap
Reads (once built): `account_balances()` for everything; `journal_lines` for period-filtered statements.

| Button | Calls | Guard | Writes | Journal | Next state |
|---|---|---|---|---|---|
| Generate P&L **[TO BUILD]** | `generate_pnl(period_start, period_end)` | finance role | none (pure read + render) | — | Renders Income − Expense by account, for the period, from `journal_lines` filtered by date |
| Generate Balance Sheet **[TO BUILD]** | `generate_balance_sheet(as_of_date)` | finance role | none | — | Renders Assets/Liabilities/Equity from `account_balances()` as of date |
| Generate Cash Flow **[TO BUILD]** | `generate_cash_flow(period_start, period_end)` | finance role | none | — | Derives from journal lines touching account 1000 in the period, grouped by counter-account (operating/investing-style grouping needs a mapping table — see gap below) |
| Generate Trial Balance **[TO BUILD]** | reuses GL's existing client-side logic | none | none | — | Exportable version of what GL already shows live |
| Generate Board Pack **[TO BUILD]** | `generate_board_pack(period)` | finance/MD | optional: saves a snapshot row for record-keeping | — | Bundles the above three + Overview KPIs into one exportable doc |
| File statutory return (PAYE/NSSF/SHIF) **[DEFERRED — needs decision]** | n/a | n/a | n/a | n/a | Blocked until payroll data source is decided (see Decision #1 below) |

**Gaps identified:**
1. Cash Flow needs every account tagged operating/investing/financing to group correctly — this mapping doesn't exist in `chart_of_accounts` yet and needs adding before Cash Flow can be built, not after.
2. Statutory returns need a payroll data source that may not exist in Jikoni at all — this is a scope decision, not just a build task (see below).
3. None of these buttons currently do anything but fire a toast — this is the single largest block of "not actually built" surface in the whole system.

---

## PART B — PROCUREMENT

### B1. Overview — read-only
Reads: `vendors`, `reqs`, `poRows`, `apInvoices`, `grns` already in store. No buttons — fully wired.

---

### B2. Vendors
Reads: `vendors` (+ `vendor_screenings`, `vendor_bank_changes`).

| Button | Calls | Guard | Writes | Journal | Next state |
|---|---|---|---|---|---|
| Add vendor | `create_vendor` | none noted | `vendors` row | — | New vendor, `screening_status: pending` |
| Clear screening | `screen_vendor` | must run before any PO can be raised to this vendor (hard gate) | `vendor_screenings` row | — | Vendor becomes PO-eligible |
| Change bank (request) | `request_vendor_bank_change` | any authorised user | `vendor_bank_changes` row, state `pending_verification` | — | Awaits approval |
| Change bank (approve) | `approve_vendor_bank_change` | **must be verified by phoning the number on file**, and the approver must not be the requester (anti-fraud) | `vendors.bank_details` updated, `vendor_bank_changes.state` → approved | — | New bank details live |

**No gap here** — this is one of the most tightly specified flows already (correctly, since vendor bank changes are the classic fraud vector).

---

### B3. Requisitions
Reads: `requisitions`; budget chip reads live `budget_lines`.

| Button | Calls | Guard | Writes | Journal | Next state |
|---|---|---|---|---|---|
| New | `submit_requisition` | `assert_access('procurement', 2)`; `budget_check` (rejects if it would exceed the line) | `requisitions` row, state `submitted`; `budget_lines.committed += amount` | — (encumbrance only, not an accounting entry) | Routed by `route_approval`: <5k auto-approve, ≤100k single approval, 100k–500k dual (two named approvers), >500k MD |
| Approve | `approve_requisition` | requester can never approve their own (SoD); routing above determines who/how many approvers needed | state updated per approval step | — | submitted → (awaiting next approver) → approved |
| Withdraw | `withdraw_requisition` **[confirm exists — not shown in trace]** | requester or approver, only while not yet converted to PO | state → withdrawn; `budget_lines.committed -= amount` (release the encumbrance) | — | Requisition closed, budget released |
| Raise PO | (part of `approve_requisition` flow, or separate `convert_to_po`) | requisition must be `approved` | `purchase_orders` row created, linked to requisition | — | requisition → converted; PO → open |

**Gap identified:** the trace never confirms a Withdraw path exists, or — critically — what happens to the committed budget if a requisition is rejected outright rather than approved. If rejection doesn't release `budget_lines.committed`, budget lines will accumulate phantom commitments over time and Budgets & Costing will slowly become inaccurate. This needs an explicit `reject_requisition` RPC that releases the encumbrance, mirrored on withdrawal. *(Note: `0040` has `withdraw_requisition` releasing committed — confirm rejection does the same.)*

---

### B4. Purchase Orders
Reads: `purchase_orders` with nested `goods_received_notes` to compute received qty.

| Button | Calls | Guard | Writes | Journal | Next state |
|---|---|---|---|---|---|
| New PO | (from an approved requisition — see B3) | requisition must be approved | `purchase_orders` row (state `open`) | — | open |
| Amend | `amend_po` | any authorised user | PO fields updated, flags re-approval | — | open → pending_amendment_approval |
| Approve amendment | `approve_po_amendment` | amender ≠ approver (SoD, assumed — confirm) | state cleared | — | pending_amendment_approval → open (with new terms) |
| Record GRN | opens the goods-received modal (see B5) | — | — | — | — |
| View related invoice(s) **[TO BUILD, Phase 2]** | reads `invoices_ap` filtered by `po_id` | none | none | — | Jumps to Payables filtered to this PO's invoice(s) |

---

### B5. Goods Received
Reads: `goods_received_notes`; match panel reads `invoices_ap` + `purchase_orders` + GRNs.

| Button | Calls | Guard | Writes | Journal | Next state |
|---|---|---|---|---|---|
| Record GRN | `submit_grn` | `assert_sod('goods receipt', requester)` — receiver ≠ requester | `goods_received_notes` row (qty_received, pct, state `received`) | — (no journal — receipt without invoice doesn't post) | PO shows part-received or closed depending on qty; over-delivery flags PO for re-approval |
| (Then the same Capture/Approve/Pay buttons as Payables, A3, apply once the invoice arrives) | | | | | |

**No new gap here** beyond what's already flagged in A3 (the exception-resolution path).

---

### B6. Sourcing / RFQ — currently empty, full flow to design

This doesn't exist yet. Proposed minimum viable flow, matching the guarded-RPC pattern used everywhere else:

| Button | Calls | Guard | Writes | Journal | Next state |
|---|---|---|---|---|---|
| Create RFQ **[TO BUILD]** | `create_rfq` | linked to a requisition (or standalone for pre-requisition sourcing) | `rfqs` row: item description, qty, deadline | — | draft |
| Invite vendors **[TO BUILD]** | `invite_rfq_vendor` | vendor must be screening-cleared (same gate as PO) | `rfq_invitations` rows | — | RFQ → open |
| Record quote **[TO BUILD]** | `submit_rfq_quote` | one quote per vendor per RFQ | `rfq_quotes` row (vendor, price, lead time) | — | — |
| Close RFQ **[TO BUILD]** | `close_rfq` | requires ≥ minimum quotes if a policy minimum is set (e.g. 3-quote rule for donor-funded spend — check against SDCS/TWG requirements) | RFQ state → closed | — | Quotes locked, ready to award |
| Award **[TO BUILD]** | `award_rfq` | awarder ≠ requester (SoD, consistent with rest of system) | selected quote marked won; creates a `requisitions` or `purchase_orders` row pre-filled from the quote | — | Feeds directly into the existing Requisition/PO flow — RFQ becomes the sourcing step *before* step 1 of the golden thread, not a parallel path |

**Decision needed:** confirm whether SDCS or other donor-funded procurement actually requires a minimum-quote rule before building `close_rfq`'s guard — this determines whether it's a hard block or just a warning.

---

### B7. Contracts — currently split across two places

Today: referenced in the Procurement tab list, but the actual registry lives in Compliance & Governance. This is a menu-vs-reality mismatch, not a missing feature.

**Two options, pick one:**

**Option 1 — Fix the menu (cheapest, recommended default):**
| Button | Calls | Guard | Writes | Journal | Next state |
|---|---|---|---|---|---|
| View contracts **[TO BUILD]** | deep-links to Compliance & Governance's existing contract registry, filtered to procurement-relevant contracts | none | none | — | — |

**Option 2 — Actually move/duplicate the registry into Procurement:**
Only worth doing if Procurement users need contract data without navigating away regularly. Would require deciding whether Compliance & Governance keeps ownership (Procurement gets a read-only mirror) or Procurement becomes the source of truth (bigger change, touches Compliance & Governance's existing views).

**Recommendation:** Option 1 unless there's a concrete workflow reason to duplicate/move data — moving a system of record is expensive and easy to get wrong (two places both claiming to own the same contract creates its own loose end).

---

## PART C — CROSS-MODULE CONNECTIVE TISSUE (Phase 2)

| Addition | Where | What it does |
|---|---|---|
| PO ↔ Invoice link | PO detail page, Invoice detail page | Both directions, one click — no new RPC, just a UI query using the existing `po_id` foreign key on `invoices_ap` |
| Budget-impact chip | PO amendment approval, invoice approval | Live read of `budget_lines`, rendered before the approve action — no write, pure display |

---

## PART D — FULL STATE MACHINES (for reference, so nothing is ambiguous)

**Requisition:** `draft → submitted → (awaiting/dual/MD per amount) → approved → converted` | side paths: `→ rejected` (must release committed budget — gap, see B3), `→ withdrawn` (same)

**Purchase Order:** `open → part-received → closed` | side path: `open → pending_amendment_approval → open`

**GRN:** `received` (terminal per delivery event — a PO can have multiple GRNs until fully received)

**AP Invoice:** `captured → matched → approved → paid` | side path: `captured → exception → (needs resolve_ap_exception, gap — see A3) → matched`

**Vendor:** `screening: pending → cleared` (gate for PO eligibility) | bank details: `pending_verification → approved`

**Petty Cash Request:** `pending → approved/rejected` | **gap:** unclear if `approved` alone moves cash or if a `disburse` step is needed (see A6)

**Budget Line:** `committed` (at requisition) → `actual` (at payment) | **gap:** creation path for a new budget line isn't specified (see A7)

---

## PART E — CONSOLIDATED LIST OF EVERY LOOSE END FOUND

1. **AP invoice exceptions have no resolve button** (A3) — invoices can get stuck in `exception` permanently.
2. **Petty cash approval vs disbursement is unclear** (A6) — risk of Cash on Hand overstating reality if approval doesn't move cash but nothing else does either.
3. **Budget line creation has no UI path** (A7) — currently must be seeded directly in Postgres, breaking the "no direct writes" rule. *(`upsert_cost_centre` exists — surface it.)*
4. **Cash Flow statement needs an operating/investing/financing tag on the chart of accounts** (A8) — doesn't exist yet, needed before that report can be built at all.
5. **Statutory returns need a payroll data source decision** (A8) — scope question, not a build task, blocks that sub-feature entirely until answered.
6. **Requisition rejection/withdrawal may not release committed budget** (B3) — needs an explicit RPC or budget lines drift over time.
7. **Contracts menu currently points to a tab that doesn't exist where it's advertised** (B7) — cheapest fix in this whole spec, do it early.
8. **Sourcing/RFQ is fully unbuilt** (B6) — full flow proposed above, needs the minimum-quote-rule decision before the guard on `close_rfq` can be finalized.

---

## PART F — OPEN DECISIONS (blocking specific items above)

1. Do statutory returns (PAYE/NSSF/SHIF) need to be generated inside Jikoni, or handled elsewhere? → blocks part of A8.
2. eTIMS: manual mark-as-filed or real KRA API? → blocks A4 (recommend manual, per your no-external-linking preference).
3. Contracts: fix the menu only, or actually move/mirror the registry into Procurement? → blocks B7 (recommend menu fix only).
4. Does SDCS or any donor-funded procurement require a minimum-quote rule? → blocks the guard logic in B6.
5. Does petty cash approval move cash, or is a separate disbursement step needed? → blocks A6, needs an answer from whoever built that RPC originally (confirm with Dennis/Wilson).
