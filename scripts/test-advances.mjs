// Travel-advance flow test — runs the whole lifecycle inside ONE transaction and
// rolls it back, so nothing persists. Proves the control invariants:
//   * a claimant cannot approve their own advance
//   * an ISSUED advance is a receivable, NOT project cost (no project_expenses row)
//   * reconcile posts ONLY the spent amount to the project
//   * balance = amount - spent
//   * adv_accrue is idempotent
// Prints ADV_TESTS_PASS only if every assertion holds.
import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const url = readFileSync(resolve(root, ".claude/settings.local.json"), "utf8").match(/postgres(?:ql)?:\/\/[^"'\\\s]+/)[0];
const c = new pg.Client({ connectionString: url, ssl: { rejectUnauthorized: false } });

let failures = 0;
function ok(cond, label, extra = "") { console.log(`${cond ? "PASS" : "FAIL"} — ${label}${extra ? " :: " + extra : ""}`); if (!cond) failures++; }
async function as(u) {
  await c.query("reset role");
  await c.query("select set_config('request.jwt.claims', json_build_object('sub',$1::text,'email',$2::text,'role','authenticated')::text, true)", [u.auth_id, u.email]);
  await c.query("set local role authenticated");
}
// Wrap in a savepoint so the expected exception only unwinds to the savepoint,
// not the whole (rolled-back) test transaction.
async function expectThrow(fn, label) {
  await c.query("savepoint sp");
  try { await fn(); ok(false, label, "no exception raised"); await c.query("release savepoint sp"); }
  catch { ok(true, label); await c.query("rollback to savepoint sp"); }
}
const advRows = async (ref) => Number((await c.query("select count(*)::int n from public.project_expenses where description like 'Advance ' || $1 || ' %'", [ref])).rows[0].n);
const advAmt  = async (ref) => (await c.query("select amount from public.project_expenses where description like 'Advance ' || $1 || ' %' limit 1", [ref])).rows[0]?.amount;

try {
  await c.connect();

  // objects exist
  const objs = (await c.query("select proname from pg_proc where proname in ('submit_travel_advance','decide_travel_advance','issue_travel_advance','reconcile_travel_advance','settle_travel_advance','adv_accrue','tadv_json','advance_write_lines','edit_travel_advance','delete_travel_advance')")).rows.map(r => r.proname);
  ok(objs.length === 10, "all 10 RPCs exist", objs.length + "/10");
  const tbls = (await c.query("select table_name from information_schema.tables where table_name in ('travel_advances','travel_advance_lines')")).rows.length;
  ok(tbls === 2, "both tables exist", tbls + "/2");

  const holder = (await c.query("select id,auth_id,email from public.app_users u where auth_id is not null and not exists(select 1 from public.user_permissions p where p.email=lower(u.email) and p.module='users' and p.level>=3) limit 1")).rows[0];
  const approver = (await c.query("select u.id,u.auth_id,u.email from public.app_users u join public.user_permissions p on p.email=lower(u.email) where u.auth_id is not null and ((p.module='users' and p.level>=3) or (p.module='hr' and p.level>=2)) and u.id<>$1 limit 1", [holder.id])).rows[0];
  const project = (await c.query("select name from public.projects limit 1")).rows[0].name;
  console.log(`holder=${holder.email} approver=${approver.email} project=${project}\n`);

  await c.query("begin");

  // 1. request (staff) — amount is BUILT from planned lines (transport 3000 + per-diem 2x1000 = 5000)
  await as(holder);
  const plannedLines = JSON.stringify([
    { category: "transport", detail: "fuel budget", amount: 3000, isPerDiem: false },
    { isPerDiem: true, perDiemDays: 2, perDiemRate: 1000 },
  ]);
  let j = (await c.query("select public.submit_travel_advance($1,$2,$3::jsonb) as j", ["Kitui field trip", project, plannedLines])).rows[0].j;
  const ref = j.id;
  ok(j.state === "pending" && j.approverRole === "hr", "request → pending, routed to HR", `${ref} ${j.state}/${j.approverRole}`);
  ok(Number(j.amount) === 5000, "advance amount built from planned lines = 5000", "amount=" + j.amount);
  ok((j.plannedLines || []).length === 2, "planned lines stored (2)", "planned=" + (j.plannedLines || []).length);

  // 2. claimant cannot approve own
  await expectThrow(() => c.query("select public.decide_travel_advance($1,true,null)", [ref]), "claimant cannot approve own advance");

  // 3. approve (HR)
  await as(approver);
  j = (await c.query("select public.decide_travel_advance($1,true,null) as j", [ref])).rows[0].j;
  ok(j.state === "approved", "approve → approved", j.state);
  await c.query("reset role");   // verification reads as owner so RLS on project_expenses can't mask true state
  ok(await advRows(ref) === 0, "approved advance is not yet project cost", "rows=" + await advRows(ref));

  // 4. issue (Finance) — becomes an open receivable, still NOT project cost
  await as(approver);
  j = (await c.query("select public.issue_travel_advance($1,$2) as j", [ref, "MPESA-TEST"])).rows[0].j;
  ok(j.state === "issued", "issue → issued", j.state);
  await c.query("reset role");
  ok(await advRows(ref) === 0, "ISSUED advance is a receivable, NOT project cost", "rows=" + await advRows(ref));

  // 5. reconcile (holder) — spent 3000 (transport 2000 + per-diem 1d x 1000)
  await as(holder);
  const lines = JSON.stringify([
    { category: "transport", detail: "fuel", amount: 2000, isPerDiem: false },
    { isPerDiem: true, perDiemDays: 1, perDiemRate: 1000 },
  ]);
  j = (await c.query("select public.reconcile_travel_advance($1,$2::jsonb) as j", [ref, lines])).rows[0].j;
  ok(j.state === "reconciled", "reconcile → reconciled", j.state);
  ok(Number(j.spent) === 3000, "spent computed = 3000", "spent=" + j.spent);
  ok(Number(j.balance) === 2000, "balance = amount - spent = 2000", "balance=" + j.balance);
  ok((j.plannedLines || []).length === 2, "planned lines SURVIVE reconcile (not wiped)", "planned=" + (j.plannedLines || []).length);
  ok((j.lines || []).length === 2, "actual reconcile lines stored (2)", "actual=" + (j.lines || []).length);
  await c.query("reset role");
  ok(await advRows(ref) === 1, "reconcile posts to project", "rows=" + await advRows(ref));
  ok(Number(await advAmt(ref)) === 3000, "ONLY the spent amount posts (3000, not the 5000 advance)", "amt=" + await advAmt(ref));

  // 6. adv_accrue idempotent (already owner)
  await c.query("select public.adv_accrue($1)", [ref]);
  ok(await advRows(ref) === 1, "adv_accrue is idempotent (no double-post)", "rows=" + await advRows(ref));

  // 7. cannot reconcile twice
  await as(holder);
  await expectThrow(() => c.query("select public.reconcile_travel_advance($1,$2::jsonb)", [ref, lines]), "cannot reconcile an already-reconciled advance");

  // 8. settle (Finance)
  await as(approver);
  j = (await c.query("select public.settle_travel_advance($1,$2) as j", [ref, "Balance returned"])).rows[0].j;
  ok(j.state === "settled", "settle → settled", j.state);

  await c.query("reset role");
  await c.query("rollback");
  console.log(`\n${failures} failing assertion(s)`);
  if (failures === 0) console.log("ADV_TESTS_PASS");
  await c.end();
  process.exit(failures === 0 ? 0 : 1);
} catch (e) {
  console.error("ERR", e.message);
  try { await c.query("rollback"); await c.end(); } catch { /* ignore */ }
  process.exit(1);
}
