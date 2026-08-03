// Qty-based procure-to-pay + payables enrichment (invoice#/WHT/approve) + over-delivery,
// in a rolled-back transaction. enforce_sod is off so one user runs the chain.
import { readFileSync } from "node:fs";
import pg from "pg";

const root = "/home/brian/Desktop/jikoni";
const url = readFileSync(root + "/.claude/settings.local.json", "utf8")
  .match(/postgres(?:ql)?:\/\/[^"'\\\s]+/)[0];
const c = new pg.Client({ connectionString: url, ssl: { rejectUnauthorized: false } });
await c.connect();
const q = async (sql, ...a) => (await c.query(sql, a)).rows;
const rpc = async (call) => (await c.query(`select ${call} as r`)).rows[0].r;
const expectBlock = async (label, call) => {
  try { await c.query("savepoint sp"); await rpc(call); console.log("— " + label + ": NOT BLOCKED (BUG)"); }
  catch (e) { await c.query("rollback to sp"); console.log("— " + label + " blocked:", e.message.split("\n")[0]); }
};

try {
  await c.query("begin");
  const [me] = await q(`select auth_id from app_users where email='wanjiku@ignis.africa'`);
  await c.query(`select set_config('request.jwt.claims', $1, false)`,
    [JSON.stringify({ email: "wanjiku@ignis.africa", sub: me.auth_id, role: "authenticated" })]);
  await rpc(`public.create_vendor('Qty Vendor', 'Fabrication', 'Kenya', 'A00X', 'Equity 1')`);
  await rpc(`public.screen_vendor('Qty Vendor', 'cleared', 'ok')`);

  // #2 PO from approved req with editable qty × unit price (200 @ 500 = 100,000)
  const pr = (await rpc(`public.submit_requisition('Cookstoves', 100000, 'Operations', 200, 'pcs', 500, null, null, false)`)).id;
  await rpc(`public.approve_requisition('${pr}')`);
  let r = await rpc(`public.raise_po('${pr}', 'Qty Vendor', 'Standard · 7 days', 200, 500)`);
  const po = r.id;
  console.log("— PO:", po, "| qty:", r.qty, "| amount:", r.amt);

  // #3 partial GRN by quantity (120 of 200)
  r = await rpc(`public.submit_grn('${po}', 120, 'first load')`);
  console.log("— GRN partial:", r.received + "/" + r.ordered);

  // #3 over-delivery: 120 already + 100 more > 200 remaining(80) → must choose accept/reject
  await expectBlock("#3 over-delivery (no choice)", `public.submit_grn('${po}', 100, 'too many')`);
  r = await rpc(`public.submit_grn('${po}', 100, 'reject excess', 'reject')`);
  console.log("— GRN reject-excess capped:", r.received + "/" + r.ordered, "(took only the remaining 80)");

  // #1 capture invoice with number/date/currency/WHT
  r = await rpc(`public.capture_ap_invoice('${po}', 100000, 'INV-QV-001', current_date, 'KES', true)`);
  const inv = r.id;
  console.log("— invoice:", inv, "| match:", r.match, "| WHT computed:", r.wht);

  // #1 duplicate guard (same vendor + number + amount) — via a second PO
  const pr2 = (await rpc(`public.submit_requisition('More stoves', 100000, 'Operations', 200, 'pcs', 500, null, null, false)`)).id;
  await rpc(`public.approve_requisition('${pr2}')`);
  const po2 = (await rpc(`public.raise_po('${pr2}', 'Qty Vendor', 'Standard', 200, 500)`)).id;
  await rpc(`public.submit_grn('${po2}', 200, 'full')`);
  await expectBlock("#1 duplicate invoice", `public.capture_ap_invoice('${po2}', 100000, 'INV-QV-001', current_date, 'KES', false)`);

  // #1 pay requires Approve-for-Payment first
  await expectBlock("#1 pay before approval", `public.pay_invoice('${inv}', 'bank')`);
  // preparer ≠ approver: wanjiku captured it, so a different finance user must approve
  await expectBlock("#1 capturer approves own invoice", `public.approve_ap_invoice('${inv}')`);
  const [brian] = await q(`select auth_id from app_users where email='brian55mwangi@gmail.com'`);
  await c.query(`select set_config('request.jwt.claims', $1, false)`,
    [JSON.stringify({ email: "brian55mwangi@gmail.com", sub: brian.auth_id, role: "authenticated" })]);
  r = await rpc(`public.approve_ap_invoice('${inv}')`);
  console.log("— approved for payment (by a different user):", r.state);
  r = await rpc(`public.pay_invoice('${inv}', 'bank')`);
  const [pay] = await q(`select amount from payments where ref='${r.id}'`);
  console.log("— paid net (after 5% WHT):", pay.amount, "| journal:", r.journal);

  // WHT landed on the payable account
  const tb = await rpc(`public.account_balances()`);
  const wht = tb.find((a) => a.code === '2200');
  console.log("— WHT payable (2200) balance:", wht ? wht.balance : 0);
  const dr = tb.reduce((s, a) => s + Number(a.debit), 0), cr = tb.reduce((s, a) => s + Number(a.credit), 0);
  console.log("— trial balance balanced:", dr === cr, `(${dr}=${cr})`);
} finally {
  await c.query("rollback");
  await c.end();
  console.log("rolled back — no rows kept");
}
