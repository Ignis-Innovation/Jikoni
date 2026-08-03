// Exercise the v2 control-gap fixes inside a rolled-back transaction — nothing kept.
import { readFileSync } from "node:fs";
import pg from "pg";

const root = "/home/brian/Desktop/jikoni";
const url = readFileSync(root + "/.claude/settings.local.json", "utf8")
  .match(/postgres(?:ql)?:\/\/[^"'\\\s]+/)[0];
const c = new pg.Client({ connectionString: url, ssl: { rejectUnauthorized: false } });
await c.connect();
const q = async (sql, ...args) => (await c.query(sql, args)).rows;
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

  await rpc(`public.create_vendor('V2 Vendor', 'Fabrication', 'Kenya', 'A00X', 'Equity OLD-123')`);
  await rpc(`public.screen_vendor('V2 Vendor', 'cleared', 'ok')`);

  // helper to get an approved PO
  const mkPO = async (amt) => {
    const pr = (await rpc(`public.submit_requisition('Item ${amt}', ${amt}, 'Operations')`)).id;
    await rpc(`public.approve_requisition('${pr}')`);
    return (await rpc(`public.raise_po('${pr}', 'V2 Vendor', 'Standard · 7 days')`)).id;
  };

  // #3 duplicate invoice check
  const po1 = await mkPO(100000);
  await rpc(`public.submit_grn('${po1}', 1, 'ok')`);
  await rpc(`public.capture_ap_invoice('${po1}', 100000)`);
  await expectBlock("#3 duplicate invoice", `public.capture_ap_invoice('${po1}', 100000)`);

  // #6 over-delivery held
  const po2 = await mkPO(50000);
  await rpc(`public.submit_grn('${po2}', 0.6, 'part 1')`);
  await expectBlock("#6 over-delivery", `public.submit_grn('${po2}', 0.6, 'part 2')`);
  const g = await rpc(`public.submit_grn('${po2}', 0.4, 'balance')`); // 60+40 = 100 ok
  console.log("— #6 completing to full ok:", g.received + "/" + g.ordered);

  // #5 configurable match tolerance: set tolerance to 0, then a 1-shilling diff must hold
  await rpc(`public.set_app_config('match_tolerance_pct', '0'::jsonb)`);
  const po3 = await mkPO(70000);
  await rpc(`public.submit_grn('${po3}', 1, 'ok')`);
  let r = await rpc(`public.capture_ap_invoice('${po3}', 70001)`);
  console.log("— #5 tolerance 0 → 1sh diff match:", r.match, "(expect exception)");
  await rpc(`public.set_app_config('match_tolerance_pct', '0.5'::jsonb)`); // restore

  // #4 PO amendment beyond tolerance → re-approval blocks capture until approved
  const po4 = await mkPO(100000);
  r = await rpc(`public.amend_po('${po4}', 120000, 'Express · 3 days', 'price rise')`);
  console.log("— #4 amend +20% → reapproval:", r.reapproval, "deltaPct:", r.deltaPct);
  await rpc(`public.submit_grn('${po4}', 1, 'ok')`);
  await expectBlock("#4 capture while amend pending", `public.capture_ap_invoice('${po4}', 120000)`);
  await rpc(`public.approve_po_amendment('${po4}')`);
  r = await rpc(`public.capture_ap_invoice('${po4}', 120000)`);
  console.log("— #4 after amendment approved → capture match:", r.match);

  // #2 vendor bank-detail change → callback verification, requester ≠ verifier
  r = await rpc(`public.request_vendor_bank_change('V2 Vendor', 'KCB NEW-999')`);
  const chId = r.id;
  let [vb] = await q(`select bank from vendors where name='V2 Vendor'`);
  console.log("— #2 after request, live bank still:", vb.bank, "(unchanged)");
  await expectBlock("#2 same-user verify", `public.approve_vendor_bank_change('${chId}'::uuid, 'called 0700...')`);
  // verify as a different finance user (brian)
  await c.query(`select set_config('request.jwt.claims', $1, false)`,
    [JSON.stringify({ email: "brian55mwangi@gmail.com", role: "authenticated" })]);
  const [brian] = await q(`select auth_id from app_users where email='brian55mwangi@gmail.com'`);
  await c.query(`select set_config('request.jwt.claims', $1, false)`,
    [JSON.stringify({ email: "brian55mwangi@gmail.com", sub: brian.auth_id, role: "authenticated" })]);
  await expectBlock("#2 verify without callback note", `public.approve_vendor_bank_change('${chId}'::uuid, '')`);
  r = await rpc(`public.approve_vendor_bank_change('${chId}'::uuid, 'Called +254700 — spoke to J. Mwangi')`);
  [vb] = await q(`select bank from vendors where name='V2 Vendor'`);
  console.log("— #2 after callback verify, live bank now:", vb.bank);

  // #1 notifications fired for approvers/exceptions
  const [{ n }] = await q(`select count(*)::int n from notifications where kind in ('req_approval','match_exception','po_amend','vendor_bank_change')`);
  console.log("— #1 notifications generated:", n);
} finally {
  await c.query("rollback");
  await c.end();
  console.log("rolled back — no rows kept");
}
