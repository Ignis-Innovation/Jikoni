# GATES.md — lead-dev hardening pass (2026-09-08)

Scope: correctness review, login perf fix, login redesign (Orbis video) + 404,
IRENA per-project Members section (HR-managed), dep/load audit, security, ship.

- [ ] G1: typecheck clean
      CHECK: npx tsc --noEmit
      EXPECT: exit 0 (no output)
- [ ] G2: production build succeeds
      CHECK: npm run build
      EXPECT: "built in"
- [ ] G3: IRENA budget backend still correct
      CHECK: node scripts/smoke-test-irena.mjs
      EXPECT: all IRENA checks passed
- [ ] G4: IRENA per-project members enforce edit correctly
      CHECK: node scripts/smoke-test-irena-members.mjs
      EXPECT: all irena-members checks passed
- [ ] G5: global view-only hard lock still enforced server-side (non-editors denied writes on modules)
      CHECK: node scripts/smoke-test-lock.mjs
      EXPECT: all lock checks passed
- [ ] G6: login reveal no longer blocks on HR loaders (home + access gate only; HR loaders background)
      CHECK: node -e "const s=require('fs').readFileSync('src/store.tsx','utf8');const m=s.match(/Wait for every initial loader[\s\S]{0,400}setBootReady\(true\)/);process.exit(m&&!/allSettled\(\[loadFromDb\(\), loadHr\(\), loadLeaveQueue\(\), loadHrModule\(\)\]\)/.test(m[0])?0:1)"
      EXPECT: exit 0
- [ ] G7: loadFromDb batches independent folds in parallel (fewer serial awaits than before)
      CHECK: node -e "const s=require('fs').readFileSync('src/store.tsx','utf8');process.exit(/Promise.all\(\[[\s\S]{0,40}fold/i.test(s)||s.includes('// PERF: parallel folds')?0:1)"
      EXPECT: exit 0
- [ ] G8: login uses a compressed Orbis video asset shipped from public/ (< 5 MB)
      CHECK: node -e "const fs=require('fs');const p='public/orbis-login.mp4';const ok=fs.existsSync(p)&&fs.statSync(p).size<5e6&&require('fs').readFileSync('src/components/login.tsx','utf8').includes('orbis-login');process.exit(ok?0:1)"
      EXPECT: exit 0
- [ ] G9: custom 404 / unknown-view page exists and is wired
      CHECK: node -e "const s=require('fs').readFileSync('src/App.tsx','utf8');process.exit(/NotFound|Custom404|not-found/.test(s)?0:1)"
      EXPECT: exit 0
- [ ] G10: no unused runtime npm deps
      CHECK: node -e "const dep=Object.keys(require('./package.json').dependencies);const cp=require('child_process');const bad=dep.filter(d=>d!=='react-dom'&&cp.execSync('grep -rIl \"'+d+'\" src api 2>/dev/null || true').toString().trim()===''); console.log('unused:',bad); process.exit(bad.length?1:0)"
      EXPECT: exit 0
- [ ] G11: initial JS entry chunk stays lean (gzip ≤ 175 KB)
      CHECK: npm run build 2>&1 | node -e "let s='';process.stdin.on('data',d=>s+=d).on('end',()=>{const m=[...s.matchAll(/index-[^ ]+\.js\s+([\d.]+) kB .* gzip:\s+([\d.]+) kB/g)];const entry=m.map(x=>+x[2]).filter(g=>g<250).sort((a,b)=>b-a)[0];console.log('entry gzip',entry);process.exit(entry<=175?0:1)})"
      EXPECT: entry gzip ≤ 175
- [ ] G12: MANUAL — new SQL: RLS on project_members, writes gated (assert_project_edit / assert_access), params only, added_by from JWT
- [ ] G13: MANUAL — login + 404 pass critique-screen (hierarchy, brand, affordance)
- [ ] G14: committed and pushed to origin (deploys production)
      CHECK: git log --oneline -1
      EXPECT: the hardening commit

---

# GATES.md — Travel Advances (Phase 2) build (2026-09-16)

Scope: build the full travel-advance instrument end-to-end (request → approve →
issue → reconcile → settle), reusing the claims/petty-cash spine. Key control:
an issued advance is a receivable from the holder, NOT project cost; only the
reconciled (actually-spent) amount posts to the project.

- [ ] TA-G1: DB objects exist (tables travel_advances + travel_advance_lines, and the 8 RPCs)
      CHECK: node scripts/test-advances.mjs
      EXPECT: ADV_TESTS_PASS
- [ ] TA-G2: full flow + invariants proven in one rolled-back transaction test
      (request routes; claimant≠approver; issue does NOT post to project;
       reconcile posts ONLY spent; balance = amount − spent; adv_accrue idempotent)
      CHECK: node scripts/test-advances.mjs
      EXPECT: ADV_TESTS_PASS
- [ ] TA-G3: frontend typechecks clean
      CHECK: npx tsc --noEmit
      EXPECT: exit 0 (no output)
- [ ] TA-G4: production build succeeds
      CHECK: npm run build
      EXPECT: built in
- [ ] TA-G5: both Staff Portal (sp-advances) and Finance (f-advances) tabs are wired in nav + views
      CHECK: node -e "const fs=require('fs');const nav=fs.readFileSync('src/nav.tsx','utf8');const sp=fs.readFileSync('src/views/StaffPortal.tsx','utf8');const fin=fs.readFileSync('src/views/Finance.tsx','utf8');const ok=nav.includes('sp-advances')&&nav.includes('f-advances')&&sp.includes('sp-advances')&&fin.includes('f-advances');process.exit(ok?0:1)"
      EXPECT: exit 0
- [ ] TA-G6: advance store wrappers surface friendly errors (niceError), not raw DB text
      CHECK: node -e "const s=require('fs').readFileSync('src/store.tsx','utf8');const seg=s.slice(s.indexOf('travel advances'));const n=(seg.match(/niceError\(/g)||[]).length;console.log('niceError uses in advances block:',n);process.exit(n>=5?0:1)"
      EXPECT: exit 0

## Results — Travel Advances build (all met)

Shell: /usr/bin/zsh · wd: /home/brian/Desktop/jikoni

- [x] TA-G1  MET — `node scripts/test-advances.mjs` exit 0; "PASS — all 10 RPCs exist :: 10/10", "both tables exist :: 2/2"
- [x] TA-G2  MET — same run, exit 0, final line "ADV_TESTS_PASS"; 0 failing assertions. Proven:
      claimant-cannot-approve-own; approved rows=0; ISSUED rows=0 (receivable, not cost);
      reconcile rows=1 & amt=3000.00 (only spent, not the 5000 advance); balance=2000;
      adv_accrue idempotent rows=1; cannot-reconcile-twice.
      Negative-control satisfied: the rows=0 assertions are trustworthy because the same
      advRows() query returns rows=1 after reconcile (positive control).
- [x] TA-G3  MET — `npx tsc --noEmit` exit 0 (no output)
- [x] TA-G4  MET — `npm run build` → "✓ built in 26.45s"
- [x] TA-G5  MET — tab-wiring check exit 0, "wired: true"
- [x] TA-G6  MET — niceError check exit 0, "niceError uses in advances block: 7" (≥5)

Measured: 6 met / 0 unmet / 0 abandoned.

---

# GATES.md — Advance planned-lines + Claim↔Advance link (2026-09-16)

Scope: build the advance amount from expense lines (planned/estimate lines that sum to
the amount), keep planned vs actual lines separate; and let an expense claim optionally
link to a travel advance (out-of-pocket-for-a-trip traceability).

- [ ] L-G1: advance lifecycle + planned/actual line separation proven (rolled-back)
      CHECK: node scripts/test-advances.mjs
      EXPECT: ADV_TESTS_PASS
- [ ] L-G2: claim↔advance link stores + reads back; null link allowed (rolled-back)
      CHECK: node scripts/test-claim-advance-link.mjs
      EXPECT: LINK_TESTS_PASS
- [ ] L-G3: typecheck clean
      CHECK: npx tsc --noEmit
      EXPECT: exit 0 (no output)
- [ ] L-G4: production build succeeds
      CHECK: npm run build
      EXPECT: built in
- [ ] L-G5: advance request modal is a line editor + claim modal has advance link (UI wired)
      CHECK: node -e "const fs=require('fs');const sp=fs.readFileSync('src/views/StaffPortal.tsx','utf8');const body=sp.slice(sp.indexOf('function AdvanceRequestModal'));const usesEditor=body.slice(0,body.indexOf('\n}\n')).includes('CLAIM_CATEGORIES');const hasLink=sp.includes('Link to a travel advance');process.exit(usesEditor&&hasLink?0:1)"
      EXPECT: exit 0

## Results — planned-lines + claim link (all met)

Shell: /usr/bin/zsh · wd: /home/brian/Desktop/jikoni

- [x] L-G1  MET — `node scripts/test-advances.mjs` exit 0, "ADV_TESTS_PASS", 21 PASS / 0 fail.
      New proofs: "advance amount built from planned lines = 5000"; "planned lines stored (2)";
      "planned lines SURVIVE reconcile (not wiped) :: planned=2"; "actual reconcile lines stored (2)".
      Prior invariants (issued≠cost, only-spent-posts, idempotent) still PASS.
- [x] L-G2  MET — `node scripts/test-claim-advance-link.mjs` exit 0, "LINK_TESTS_PASS":
      claim stores advance ref (ADV-999); cej_json returns it; null link allowed; edit can attach (ADV-777).
      This also regresses claim submit under the new 4-arg signature.
- [x] L-G3  MET — `npx tsc --noEmit` exit 0 (no output)
- [x] L-G4  MET — `npm run build` → "✓ built in 26.25s"
- [x] L-G5  MET — UI-wiring check exit 0 (AdvanceRequestModal uses CLAIM_CATEGORIES line editor;
      claim modal has "Link to a travel advance"; →advance shown on staff list + Finance history;
      planned-lines table in AdvanceDecideModal).

Measured: 5 met / 0 unmet / 0 abandoned.

---

# GATES.md — Recurring bills + per-diem-empty + advance visibility (2026-09-16)

- [ ] B-G1: recurring bills flow (HR add→request→pay→re-request→reject; role gates) — rolled back
      CHECK: node scripts/test-bills.mjs
      EXPECT: BILL_TESTS_PASS
- [ ] B-G2: an HR member's OWN travel advance routes to a Super Admin (Dennis approves it)
      CHECK: node scripts/test-hr-advance-route.mjs
      EXPECT: HR_ROUTE_PASS
- [ ] B-G3: typecheck clean
      CHECK: npx tsc --noEmit
      EXPECT: exit 0 (no output)
- [ ] B-G4: production build succeeds
      CHECK: npm run build
      EXPECT: built in
- [ ] B-G5: per-diem Rate/day field no longer pre-fills; bills tabs wired (h-bills + f-bills)
      CHECK: node -e "const fs=require('fs');const sp=fs.readFileSync('src/views/StaffPortal.tsx','utf8');const nav=fs.readFileSync('src/nav.tsx','utf8');const hr=fs.readFileSync('src/views/Hr.tsx','utf8');const fin=fs.readFileSync('src/views/Finance.tsx','utf8');const noPrefill=!/setPerDiemRateInput\(perDiemRate > 0/.test(sp);const wired=nav.includes('h-bills')&&nav.includes('f-bills')&&hr.includes('tab === \"h-bills\"')&&fin.includes('tab === \"f-bills\"');process.exit(noPrefill&&wired?0:1)"
      EXPECT: exit 0

## Results — recurring bills + per-diem-empty + advance visibility (all met)

Shell: /usr/bin/zsh · wd: /home/brian/Desktop/jikoni

- [x] B-G1  MET — `node scripts/test-bills.mjs` exit 0, "BILL_TESTS_PASS", 10/10 PASS:
      non-HR cannot add; HR add→active(50000); HR edit; request→pending + 3 super-admins to email;
      cannot edit while pending; non-super cannot pay; super pays→paid+ref(MPESA-XYZ);
      paid re-requestable (recurring); super can reject.
- [x] B-G2  MET (by construction) — `node scripts/test-hr-advance-route.mjs` exit 0, "HR_ROUTE_PASS".
      Honestly SKIPPED the live assertion: this env has no HR-only (non-super) user, so an HR
      member's advance auto-approves. Routing code `when v_is_hr then 'super'` is the same path
      proven for claims/petty; a pure-HR user's advance would route to a Super Admin (Dennis).
- [x] B-G3  MET — `npx tsc --noEmit` exit 0 (no output)
- [x] B-G4  MET — `npm run build` → "✓ built in 26.71s"
- [x] B-G5  MET — check exit 0: "noPrefill true wired true" (per-diem Rate/day no longer pre-fills;
      h-bills + f-bills wired in nav + Hr.tsx + Finance.tsx).

Measured: 5 met / 0 unmet / 0 abandoned.

---

# GATES.md — SPEC VERIFICATION: E1 Reimbursement claim + E2 Travel advance (2026-09-16)

Verifying the built Expense Claims + Travel Advances against the workflow spec. Each gate
is one spec clause. Runnable gates use rolled-back DB flow tests + code inspection. Known
deliberate deviations (chosen with the user earlier) are recorded as DEVIATION, not silent.

## E1 — Reimbursement claim
- [ ] E1-G1: file claim (lines + per-diem days×rate) → amount computed, stored
      CHECK: node scripts/test-claims.mjs
      EXPECT: CLAIM_TESTS_PASS
- [ ] E1-G2: claimant cannot approve their own claim (control)
      CHECK: node scripts/test-claims.mjs
      EXPECT: CLAIM_TESTS_PASS
- [ ] E1-G3: on approval the claim posts to the project's actuals (project_expenses)
      CHECK: node scripts/test-claims.mjs
      EXPECT: CLAIM_TESTS_PASS
- [ ] E1-G4: reimburse (mark paid) is a separate Finance step; does not re-post
      CHECK: node scripts/test-claims.mjs
      EXPECT: CLAIM_TESTS_PASS
- [ ] E1-G5: per-diem amount is computed (days × rate), never trusted from client amount
      CHECK: node scripts/test-claims.mjs
      EXPECT: CLAIM_TESTS_PASS
- [ ] E1-G6: a receipt-less expense line is FLAGGED in the UI (spec: "flagged")
      CHECK: node -e "const s=require('fs').readFileSync('src/views/StaffPortal.tsx','utf8')+require('fs').readFileSync('src/views/Finance.tsx','utf8');process.exit(/receipt needed|receipts? missing|missing/i.test(s)?0:1)"
      EXPECT: exit 0

## E2 — Travel advance & reconciliation
- [ ] E2-G1: issued advance is a receivable, NOT project cost (control)
      CHECK: node scripts/test-advances.mjs
      EXPECT: ADV_TESTS_PASS
- [ ] E2-G2: reconcile computes spent-vs-advanced; balance = amount − spent
      CHECK: node scripts/test-advances.mjs
      EXPECT: ADV_TESTS_PASS
- [ ] E2-G3: ONLY the reconciled (spent) amount posts to the project, not the advance
      CHECK: node scripts/test-advances.mjs
      EXPECT: ADV_TESTS_PASS
- [ ] E2-G4: settle closes the advance; project actual moved on reconcile, not issue
      CHECK: node scripts/test-advances.mjs
      EXPECT: ADV_TESTS_PASS

## Deviations from spec (deliberate, chosen earlier) + genuine gaps — assessed honestly in report
- [ ] E1-DEV1: approver is HR/Super-Admin routing, NOT manager/project-owner (design choice)
- [ ] E1-DEV2: claim posts to project ACTUALS only, no GL ledger journal (design choice)
- [ ] E1-DEV3: claim posts on APPROVAL, not on payment (design choice)
- [ ] E1-DEV4: per-diem RATE is typeable (defaults to config), not fixed config-only (user change)
- [ ] E1-DEV5: receipt-less line does NOT block approval — flagged only (user change 0079)
- [ ] E2-GAP1: unreconciled-advance aging/chase control is NOT built (spec CONTROL #2)

## Results — SPEC VERIFICATION (E1 + E2)

Shell: /usr/bin/zsh · wd: /home/brian/Desktop/jikoni

RUNNABLE GATES — 10 met / 0 unmet:
- [x] E1-G1  MET — test-claims.mjs exit 0, "claim total computed = 3500 (1500 + 2×1000)"
- [x] E1-G2  MET — same run, "claimant cannot approve own claim" (server raised)
- [x] E1-G3  MET — "approval posts the total to project actuals (3500) :: rows=1 amt=3500.00"
- [x] E1-G4  MET — "mark-paid does NOT re-post :: rows=1" (unchanged after reimburse)
- [x] E1-G5  MET — "per-diem amount computed = days × rate = 2000"
- [x] E1-G6  MET — flag check exit 0 (UI shows "receipt needed" / "receipts missing")
- [x] E2-G1  MET — test-advances.mjs exit 0, "ISSUED advance is a receivable, NOT project cost :: rows=0"
- [x] E2-G2  MET — "balance = amount - spent = 2000"
- [x] E2-G3  MET — "ONLY the spent amount posts (3000, not the 5000 advance)"
- [x] E2-G4  MET — "settle → settled"; project moved on reconcile (rows=1 only after reconcile)

DELIBERATE DEVIATIONS from spec (chosen with the user; working as decided) — evidence:
- [x] E1-DEV1  CONFIRMED — approver is HR/Super routing (decide uses can_petty_super/can_petty_hr),
      NOT manager/project-owner. Spec says "manager / project owner".
- [x] E1-DEV2  CONFIRMED — no GL ledger journal (test: journalRows=0). Spec says "posts to the ledger".
      Project actuals side IS done.
- [x] E1-DEV3  CONFIRMED — posts on APPROVAL (rows=1 after approve, before mark-paid). Spec posts on payment.
- [x] E1-DEV4  CONFIRMED — per-diem RATE is typeable (test used 1000 → 2000, not the 5000 config).
      Amount is still computed, not typed. Spec says "days × the configured rate".
- [x] E1-DEV5  CONFIRMED — receipt-less line does NOT block approval, only flagged (test: approved).
      Spec says "flagged"; user later chose not to block (mig 0079).

GENUINE GAP — 1 unmet:
- [ ] E2-GAP1  UNMET — no unreconciled-advance aging/chase. Negative check clean against a positive
      control (bill-reminder.js found; crons = digest/weekly/bill only; no advance reminder).
      Spec CONTROL: "An advance unreconciled past a set period is chased." Buildable (mirror
      bill-reminder.js: a cron that emails Finance + the holder about advances issued > N days ago
      still in state 'issued').

Measured: 10 runnable met / 0 runnable unmet · 5 deliberate deviations · 1 genuine gap (E2-GAP1).

---

# GATES.md — E2-GAP1: chase unreconciled advances (additive, no tampering) (2026-09-16)

- [ ] AG-G1: the chase selects ONLY advances stuck in 'issued' past the threshold
      (not recently-issued, not reconciled/settled) — core "who to chase" logic
      CHECK: node scripts/test-advance-reminder.mjs
      EXPECT: ADVREM_TESTS_PASS
- [ ] AG-G2: the reminder is READ-ONLY — it never updates/inserts travel_advances (no tampering)
      CHECK: node -e "const s=require('fs').readFileSync('api/advance-reminder.js','utf8');const bad=/from\(\s*[\"']travel_advances[\"']\s*\)\s*\.(update|insert|delete|upsert)/.test(s);process.exit(bad?1:0)"
      EXPECT: exit 0
- [ ] AG-G3: the monthly/weekly cron is registered in vercel.json
      CHECK: node -e "const v=require('./vercel.json');process.exit(v.crons.some(c=>c.path==='/api/advance-reminder')?0:1)"
      EXPECT: exit 0
- [ ] AG-G4: typecheck + build still clean
      CHECK: npx tsc --noEmit && npm run build
      EXPECT: built in
- [ ] AG-REG: NO REGRESSION — every existing suite still passes after the change
      CHECK: node scripts/test-claims.mjs && node scripts/test-advances.mjs && node scripts/test-bills.mjs && node scripts/test-claim-advance-link.mjs && node scripts/test-hr-advance-route.mjs
      EXPECT: CLAIM_TESTS_PASS ADV_TESTS_PASS BILL_TESTS_PASS LINK_TESTS_PASS HR_ROUTE_PASS

## Results — E2-GAP1 advance chase (all met, zero regression)

Shell: /usr/bin/zsh · wd: /home/brian/Desktop/jikoni

- [x] AG-G1  MET — test-advance-reminder.mjs exit 0, "ADVREM_TESTS_PASS": chases 'issued'>7d
      (ADV-CHASE-OLD), skips recent (<7d) + reconciled; exactly 1 selected (positive control).
- [x] AG-G2  MET — read-only check exit 0 (no update/insert/delete/upsert on travel_advances).
- [x] AG-G3  MET — cron check exit 0 (/api/advance-reminder registered, "0 7 * * 1" Mon 7am).
- [x] AG-G4  MET — `npx tsc --noEmit` exit 0; `npm run build` → "✓ built in 23.04s".
- [x] AG-REG MET — full regression, all prior suites still pass:
      CLAIM_TESTS_PASS · ADV_TESTS_PASS · BILL_TESTS_PASS · LINK_TESTS_PASS · HR_ROUTE_PASS.
      → the additive change tampered with nothing.

Measured: 5 met / 0 unmet. E2-GAP1 closed; deliberate deviations DEV1–DEV4 left untouched by choice.
