// Exercise the full procure-to-pay + payables/receivables spine end to end inside
// a rolled-back transaction — nothing is kept. enforce_sod is off, so one user runs
// the whole chain; enforce_access is on and wanjiku has procurement/finance level 3.
import { readFileSync } from "node:fs";
import pg from "pg";

const root = "/home/brian/Desktop/jikoni";
const url = readFileSync(root + "/.claude/settings.local.json", "utf8")
  .match(/postgres(?:ql)?:\/\/[^"'\\\s]+/)[0];
const c = new pg.Client({ connectionString: url, ssl: { rejectUnauthorized: false } });
await c.connect();
const q = async (sql, ...args) => (await c.query(sql, args)).rows;
const rpc = async (call) => (await c.query(`select ${call} as r`)).rows[0].r;

try {
  await c.query("begin");
  const [me] = await q(`select auth_id from app_users where email='wanjiku@ignis.africa'`);
  await c.query(`select set_config('request.jwt.claims', $1, false)`,
    [JSON.stringify({ email: "wanjiku@ignis.africa", sub: me.auth_id, role: "authenticated" })]);

  // 1) onboard + screen a vendor
  let r = await rpc(`public.create_vendor('Smoke Vendor Ltd', 'Fabrication', 'Kenya', 'A001234567X', 'Equity 001')`);
  console.log("— vendor:", r.name, "| screen:", r.screenStatus, "| state:", r.state);

  // 2) sanctions gate: a PO to an unscreened vendor must be blocked
  r = await rpc(`public.submit_requisition('Gate-test item', 50000, 'Operations')`);
  const gateReq = r.id;
  await rpc(`public.approve_requisition('${gateReq}')`);
  try {
    await c.query("savepoint s0");
    await rpc(`public.raise_po('${gateReq}', 'Smoke Vendor Ltd', 'Standard · 7 days')`);
    console.log("— sanctions gate: NOT BLOCKED (BUG)");
  } catch (e) {
    await c.query("rollback to s0");
    console.log("— sanctions gate blocked unscreened PO:", e.message.split("\n")[0]);
  }

  // now clear the vendor
  r = await rpc(`public.screen_vendor('Smoke Vendor Ltd', 'cleared', 'Manual sanctions + tax check')`);
  console.log("— screened → state:", r.state);

  // 3) requisition with a live budget check
  r = await rpc(`public.submit_requisition('200 clean cookstoves', 100000, 'Operations')`);
  const pr = r.id;
  console.log("— requisition:", pr, "| budget:", r.chipTxt, "| routing:", r.routing.label, "| status:", r.status);

  // 4) approve
  r = await rpc(`public.approve_requisition('${pr}')`);
  console.log("— approved:", r.status);

  // 5) raise PO (sanctions gate now passes)
  r = await rpc(`public.raise_po('${pr}', 'Smoke Vendor Ltd', 'Standard · 7 days')`);
  const po = r.id;
  console.log("— PO:", po, "| vendor:", r.vendor, "| amount:", r.amt);

  // 6) goods received (full)
  r = await rpc(`public.submit_grn('${po}', 1, '200 stoves, good condition')`);
  console.log("— GRN:", r.id, "| received:", r.received + "/" + r.ordered);

  // 7) capture supplier invoice → three-way match
  r = await rpc(`public.capture_ap_invoice('${po}', 100000)`);
  const inv = r.id;
  console.log("— invoice:", inv, "| match:", r.match);

  // 8) approve for payment (a different user than the capturer) then pay
  const [brian] = await q(`select auth_id from app_users where email='brian55mwangi@gmail.com'`);
  await c.query(`select set_config('request.jwt.claims', $1, false)`,
    [JSON.stringify({ email: "brian55mwangi@gmail.com", sub: brian.auth_id, role: "authenticated" })]);
  await rpc(`public.approve_ap_invoice('${inv}')`);
  r = await rpc(`public.pay_invoice('${inv}', 'bank')`);
  console.log("— payment:", r.id, "| journal:", r.journal);
  // back to wanjiku for the remaining steps
  await c.query(`select set_config('request.jwt.claims', $1, false)`,
    [JSON.stringify({ email: "wanjiku@ignis.africa", sub: me.auth_id, role: "authenticated" })]);

  // verify end state
  const [pod] = await q(`select state from purchase_orders where ref='${po}'`);
  const [invd] = await q(`select state from invoices_ap where ref='${inv}'`);
  const [bl] = await q(`select committed, actual from budget_lines where code='Operations'`);
  console.log("— PO state:", pod.state, "| invoice state:", invd.state, "| budget actual:", bl.actual);

  // 9) exception path: partial GRN + full invoice must hold as exception
  r = await rpc(`public.submit_requisition('Exception test', 80000, 'Operations')`);
  const pr2 = r.id; await rpc(`public.approve_requisition('${pr2}')`);
  const po2 = (await rpc(`public.raise_po('${pr2}', 'Smoke Vendor Ltd', 'Standard · 7 days')`)).id;
  await rpc(`public.submit_grn('${po2}', 0.4, 'part load')`);
  r = await rpc(`public.capture_ap_invoice('${po2}', 80000)`);
  console.log("— partial-GRN invoice match:", r.match, "(expect exception)");
  try {
    await c.query("savepoint s1");
    await rpc(`public.pay_invoice('${r.id}', 'bank')`);
    console.log("— paid an unmatched invoice: NOT BLOCKED (BUG)");
  } catch (e) {
    await c.query("rollback to s1");
    console.log("— payment blocked on exception:", e.message.split("\n")[0]);
  }

  // 10) receivables: sales invoice → receipt
  r = await rpc(`public.submit_sales_invoice('Kenyatta University', 'CESA install', 200000, 'week')`);
  const si = r.id;
  console.log("— sales invoice:", si, "| total:", r.tot, "(VAT incl.)");
  r = await rpc(`public.record_ar_receipt('${si}', 232000, 'bank')`);
  console.log("— receipt journal:", r.journal);

  // 11) trial balance from the ledger
  const tb = await rpc(`public.account_balances()`);
  const dr = tb.reduce((s, a) => s + Number(a.debit), 0);
  const cr = tb.reduce((s, a) => s + Number(a.credit), 0);
  console.log("— trial balance: accounts =", tb.length, "| debits =", dr, "| credits =", cr, "| balanced:", dr === cr);
} finally {
  await c.query("rollback");
  await c.end();
  console.log("rolled back — no rows kept");
}
