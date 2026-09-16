// E1 reimbursement-claim flow test (rolled back). Proves the spec: file → submit → cannot
// approve own → approve (posts to project actuals) → reimburse (separate, no re-post); per-diem
// computed days×rate. Also measures the deliberate deviations: no GL journal; posts on approval;
// a receipt-less line does NOT block approval. Prints CLAIM_TESTS_PASS.
import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const url = readFileSync(resolve(root, ".claude/settings.local.json"), "utf8").match(/postgres(?:ql)?:\/\/[^"'\\\s]+/)[0];
const c = new pg.Client({ connectionString: url, ssl: { rejectUnauthorized: false } });

let failures = 0;
const ok = (cond, label, extra = "") => { console.log(`${cond ? "PASS" : "FAIL"} — ${label}${extra ? " :: " + extra : ""}`); if (!cond) failures++; };
async function as(u) {
  await c.query("reset role");
  await c.query("select set_config('request.jwt.claims', json_build_object('sub',$1::text,'email',$2::text,'role','authenticated')::text, true)", [u.auth_id, u.email]);
  await c.query("set local role authenticated");
}
async function expectThrow(fn, label) {
  await c.query("savepoint sp");
  try { await fn(); ok(false, label, "no exception raised"); await c.query("release savepoint sp"); }
  catch { ok(true, label); await c.query("rollback to savepoint sp"); }
}
const claimRows = async (ref) => Number((await c.query("select count(*)::int n from public.project_expenses where description like 'Claim ' || $1 || ' %'", [ref])).rows[0].n);
const claimAmt = async (ref) => (await c.query("select amount from public.project_expenses where description like 'Claim ' || $1 || ' %' limit 1", [ref])).rows[0]?.amount;
const journalRows = async (ref) => Number((await c.query("select count(*)::int n from public.journal_entries where source_ref = $1", [ref])).rows[0].n);

try {
  await c.connect();
  const claimant = (await c.query("select u.id,u.auth_id,u.email from public.app_users u where auth_id is not null and not exists(select 1 from public.user_permissions p where p.email=lower(u.email) and p.module='users' and p.level>=3) limit 1")).rows[0];
  const approver = (await c.query("select u.id,u.auth_id,u.email from public.app_users u join public.user_permissions p on p.email=lower(u.email) where u.auth_id is not null and ((p.module='users' and p.level>=3) or (p.module='hr' and p.level>=2)) and u.id<>$1 limit 1", [claimant.id])).rows[0];
  const project = (await c.query("select name from public.projects limit 1")).rows[0].name;
  console.log(`claimant=${claimant.email} approver=${approver.email} project=${project}\n`);

  await c.query("begin");

  // E1-G1 + E1-G5: file a claim — receipted line 1500 + per-diem 2 days × 1000 (computed = 2000)
  await as(claimant);
  const lines = JSON.stringify([
    { category: "transport", detail: "matatu", amount: 1500, isPerDiem: false, receiptPath: "r/x.jpg" },
    { isPerDiem: true, perDiemDays: 2, perDiemRate: 1000 },
  ]);
  let j = (await c.query("select public.submit_expense_claim($1,$2,$3::jsonb,$4) as j", ["Voi field visit", project, lines, null])).rows[0].j;
  const ref = j.id;
  ok(j.state === "pending" && j.approverRole === "hr", "file → submitted (pending), routed", `${ref} ${j.state}/${j.approverRole}`);
  ok(Number(j.total) === 3500, "E1-G1: claim total computed = 3500 (1500 + 2×1000 per-diem)", "total=" + j.total);
  const pd = j.lines.find((l) => l.isPerDiem);
  ok(pd && Number(pd.amount) === 2000, "E1-G5: per-diem amount computed = days × rate = 2000", "perdiem=" + pd?.amount);

  // E1-G2: claimant cannot approve own
  await expectThrow(() => c.query("select public.decide_expense_claim($1,true,null)", [ref]), "E1-G2: claimant cannot approve own claim");

  // pre-approval: not yet posted to project
  await c.query("reset role");
  ok(await claimRows(ref) === 0, "before approval: not yet in project actuals", "rows=" + await claimRows(ref));

  // E1-G3: approve → posts to project actuals
  await as(approver);
  j = (await c.query("select public.decide_expense_claim($1,true,null) as j", [ref])).rows[0].j;
  ok(j.state === "approved", "approve → approved", j.state);
  await c.query("reset role");
  ok(await claimRows(ref) === 1 && Number(await claimAmt(ref)) === 3500, "E1-G3: approval posts the total to project actuals (3500)", "rows=" + await claimRows(ref) + " amt=" + await claimAmt(ref));
  // E1-DEV2 (measured): no GL journal is written for the claim
  ok(await journalRows(ref) === 0, "E1-DEV2: posts to actuals only — NO GL journal (design choice)", "journalRows=" + await journalRows(ref));

  // E1-G4: reimburse is a separate Finance step and does not re-post
  const before = await claimRows(ref);
  await as(approver);   // approver here is a global editor → passes assert_access('finance',2)
  j = (await c.query("select public.mark_claim_paid($1,$2) as j", [ref, "MPESA-CLM"])).rows[0].j;
  ok(j.state === "paid", "reimburse → paid (separate step)", j.state);
  await c.query("reset role");
  ok(await claimRows(ref) === before, "E1-G4: mark-paid does NOT re-post to the project", "rows=" + await claimRows(ref));

  // E1-DEV5 (measured): a receipt-less expense line does NOT block approval (flagged only)
  await as(claimant);
  const noReceipt = JSON.stringify([{ category: "meals", detail: "lunch", amount: 800, isPerDiem: false }]);
  const nr = (await c.query("select public.submit_expense_claim($1,$2,$3::jsonb,$4) as j", ["No-receipt claim", null, noReceipt, null])).rows[0].j;
  await as(approver);
  const nrDecided = (await c.query("select public.decide_expense_claim($1,true,null) as j", [nr.id])).rows[0].j;
  ok(nrDecided.state === "approved", "E1-DEV5: receipt-less line is flagged but does NOT block approval", nrDecided.state);

  await c.query("reset role");
  await c.query("rollback");
  console.log(`\n${failures} failing assertion(s)`);
  if (failures === 0) console.log("CLAIM_TESTS_PASS");
  await c.end();
  process.exit(failures === 0 ? 0 : 1);
} catch (e) {
  console.error("ERR", e.message);
  try { await c.query("rollback"); await c.end(); } catch { /* ignore */ }
  process.exit(1);
}
