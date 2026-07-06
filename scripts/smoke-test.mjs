// Exercise the Phase 1 engines inside a rolled-back transaction.
import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const url = readFileSync(resolve(root, ".claude/settings.local.json"), "utf8")
  .match(/postgres(?:ql)?:\/\/[^"'\\\s]+/)[0];
const c = new pg.Client({ connectionString: url, ssl: { rejectUnauthorized: false } });
await c.connect();

const q = async (sql, ...args) => (await c.query(sql, args)).rows;
const rpc = async (call) => (await c.query(`select ${call} as r`)).rows[0].r;

try {
  await c.query("begin");
  // enforce_access is on since Phase 5 — impersonate a real user
  const [me] = await q(`select auth_id from app_users where email='wanjiku@ignis.africa'`);
  await c.query(`select set_config('request.jwt.claims', $1, false)`,
    [JSON.stringify({ email: "wanjiku@ignis.africa", sub: me.auth_id, role: "authenticated" })]);

  console.log("— budget check (within):", (await rpc(`public.budget_check('Operations', 10000)`)).chipTxt);
  console.log("— budget check (over 80):", (await rpc(`public.budget_check('Deployment', 150000)`)).chipTxt);
  console.log("— budget check (exceeds):", (await rpc(`public.budget_check('Admin', 900000)`)).chipTxt);
  console.log("— routing 3k:", (await rpc(`public.route_approval(3000)`)).label);
  console.log("— routing 80k:", (await rpc(`public.route_approval(80000)`)).label);
  console.log("— routing 400k:", (await rpc(`public.route_approval(400000)`)).label);
  console.log("— routing 900k:", (await rpc(`public.route_approval(900000)`)).label);

  const req = await rpc(`public.submit_requisition('Test cooker spares', 142000, 'Operations')`);
  console.log("— requisition:", req.id, req.status, req.chipTxt, "| committed:",
    (await q(`select committed from budget_lines where code='Operations'`))[0].committed);

  const app = await rpc(`public.approve_requisition('${req.id}')`);
  console.log("— approved:", app.id, app.status);

  // sanctions gate must block the in-screening vendor
  let blocked = "NOT BLOCKED (BUG)";
  await c.query("savepoint s1");
  try { await rpc(`public.raise_po('${req.id}', 'Mombasa Freight Co.', 'Standard · 7 days')`); }
  catch (e) { blocked = e.message; await c.query("rollback to s1"); }
  console.log("— sanctions gate:", blocked);

  const po = await rpc(`public.raise_po('${req.id}', 'Nakuru Fabricators', 'Express · 3 days')`);
  console.log("— PO:", po.id, po.vendor, po.delivery);

  // chain gate: invoice before GRN → exception (partial goods)
  const inv1 = await rpc(`public.capture_ap_invoice('${po.id}', 142000)`);
  console.log("— invoice pre-GRN:", inv1.id, "match:", inv1.match);

  const grn = await rpc(`public.submit_grn('${po.id}', 'full', 100, 'test receipt')`);
  console.log("— GRN:", grn.id, "coverage:", grn.totalPct + "%");

  const rematch = await rpc(`public.three_way_match((select id from invoices_ap where ref='${inv1.id}'))`);
  console.log("— re-match after GRN:", rematch.state);

  const pay = await rpc(`public.pay_invoice('${inv1.id}', 'mpesa')`);
  console.log("— payment:", pay.id, "journal:", pay.journal, "| Operations now:",
    JSON.stringify((await q(`select committed, actual from budget_lines where code='Operations'`))[0]));

  const balance = await q(`select coalesce(sum(debit),0) d, coalesce(sum(credit),0) c from journal_lines`);
  console.log("— GL balanced:", balance[0].d === balance[0].c, `(${balance[0].d} / ${balance[0].c})`);

  const si = await rpc(`public.submit_sales_invoice('Makueni County VTCs', 'test', 100000, 'week30')`);
  console.log("— sales invoice:", si.id, "total:", si.tot, si.pillTxt);

  const task = await rpc(`public.save_task('Test task', 'Joan', 'nweek', 'linked')`);
  console.log("— task:", task.id, task.pl);

  const proj = await rpc(`public.create_project_from_eng('ENG-012')`);
  console.log("— project from eng:", proj.name, "created:", proj.created);

  // illegal transition must be rejected
  let illegal = "NOT BLOCKED (BUG)";
  await c.query("savepoint s2");
  try { await c.query(`update requisitions set state='submitted' where ref='${req.id}'`); }
  catch (e) { illegal = e.message; await c.query("rollback to s2"); }
  console.log("— illegal transition:", illegal);

  // audit trail written?
  const audit = await q(`select action, record_ref from audit_log order by id desc limit 12`);
  console.log("— audit rows this run:", audit.map(a => a.action).join(", "));

  const boot = await rpc(`public.bootstrap()`);
  console.log("— bootstrap keys:", Object.keys(boot).join(", "));
  console.log("— bootstrap reqs[0]:", JSON.stringify(boot.reqs[0]));
  console.log("— bootstrap tasks:", boot.tasks.length, "| projects:", Object.keys(boot.projects).length,
    "| budgetLines.Operations:", JSON.stringify(boot.budgetLines["Operations"]));
} finally {
  await c.query("rollback");
  console.log("(rolled back — nothing persisted)");
  await c.end();
}
