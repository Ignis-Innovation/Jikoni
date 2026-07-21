// Exercise the Phase 2–5 engines inside a rolled-back transaction.
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
const expectFail = async (label, call) => {
  await c.query("savepoint sp");
  try { await rpc(call); console.log(`— ${label}: NOT BLOCKED (BUG)`); }
  catch (e) { console.log(`— ${label}: blocked ✓ (${e.message.slice(0, 90)})`); await c.query("rollback to sp"); }
};
const impersonate = async (email) => {
  const [u] = await q(`select auth_id from app_users where email=$1`, email);
  await c.query(`select set_config('request.jwt.claims', $1, false)`,
    [JSON.stringify({ email, sub: u.auth_id, role: "authenticated" })]);
};

try {
  await c.query("begin");
  await impersonate("wanjiku@ignis.africa");

  console.log("=== Phase 2a: Inventory ===");
  const iss = await rpc(`public.issue_stock('SPR-KIT', 'Nairobi central store', 20, 'maintenance round')`);
  console.log("— issue 20 spares kits → on hand:", iss.onHand, "| auto-requisition:", iss.autoRequisition);
  const [autoReq] = await q(`select item, amount, budget_code, state from requisitions where ref=$1`, iss.autoRequisition);
  console.log("— auto-req detail:", JSON.stringify(autoReq));
  const rec = await rpc(`public.receive_stock('SPR-KIT', 'Nairobi central store', 20, null, null)`);
  console.log("— restock 20 → on hand:", rec.onHand, "| auto flag cleared:",
    (await q(`select auto_req_ref from stock_items where sku='SPR-KIT'`))[0].auto_req_ref === null);
  const tr = await rpc(`public.transfer_stock('CKR-40', 'Nairobi central store', 'Makueni site store', 5)`);
  console.log("— transfer:", JSON.stringify(tr));
  await expectFail("adjust without reason", `public.adjust_stock('CKR-40','Nairobi central store', 18, '')`);
  const adj = await rpc(`public.adjust_stock('CKR-40', 'Nairobi central store', 18, 'stock count variance')`);
  console.log("— adjustment:", JSON.stringify(adj));
  await expectFail("ledger edit", `(select 1 from (update stock_movements set qty=1 where true returning 1) x limit 1)`).catch(()=>{});
  await c.query("savepoint sl");
  try { await c.query(`update stock_movements set qty = 999`); console.log("— ledger edit: NOT BLOCKED (BUG)"); }
  catch (e) { console.log("— ledger edit: blocked ✓ (" + e.message.slice(0, 60) + ")"); await c.query("rollback to sl"); }
  const dsp = await rpc(`public.create_dispatch('Makueni VTC rollout', 'Makueni VTC cluster', '[{"sku":"CKR-40","qty":3},{"sku":"CYL-13","qty":6}]'::jsonb, null)`);
  console.log("— dispatch:", dsp.id, "lines:", JSON.stringify(dsp.lines));
  const dep = await rpc(`public.run_depreciation('2026-07')`);
  console.log("— depreciation:", JSON.stringify(dep));
  const dep2 = await rpc(`public.run_depreciation('2026-07')`);
  console.log("— depreciation re-run (same period):", dep2.assets, "assets (idempotent)");

  console.log("=== Phase 2a+: Inventory management (0013) ===");
  const ni = await rpc(`public.create_stock_item('CKR-60', 'Institutional cooker — 60L', 'Cookstoves', 'unit', 72000, 8, 12, 'Deployment')`);
  console.log("— new item:", ni.sku, "onHand:", ni.onHand, "(opens at zero)");
  await expectFail("duplicate SKU", `public.create_stock_item('CKR-60', 'dupe', null, 'unit', 1, 0, 0, null)`);
  const ui = await rpc(`public.update_stock_item('CKR-60', 15, 20, 75000)`);
  console.log("— item updated → reorder", ui.reorderLevel, "cost", ui.unitCost);
  const auto = await rpc(`public.create_stock_item(null, 'Unnamed spare part', 'Spares', 'unit', 500, 3, 6, null)`);
  console.log("— item with no SKU → auto-assigned:", auto.sku);
  await expectFail("item with no name", `public.create_stock_item(null, '', null, 'unit', 1, 0, 0, null)`);
  const nib = await rpc(`public.bootstrap()`);
  console.log("— new zero-stock item appears in bootstrap:", nib.inventory.items.some((i) => i.sku === 'CKR-60'));
  const sds = await rpc(`public.set_dispatch_state('${dsp.id}', 'delivered')`);
  console.log("— dispatch state advanced:", JSON.stringify(sds));
  await expectFail("invalid dispatch transition (delivered→dispatched)", `public.set_dispatch_state('${dsp.id}', 'dispatched')`);
  const da = await rpc(`public.dispose_asset('AST-098', 'end of life')`);
  console.log("— asset disposed:", JSON.stringify(da), "| state now:",
    (await q(`select state from assets where ref='AST-098'`))[0].state);
  await expectFail("dispose already-disposed asset", `public.dispose_asset('AST-098', null)`);

  console.log("=== Phase 2b: HR / Payroll ===");
  console.log("— calc 300k gross:", JSON.stringify(await rpc(`public.calc_payroll_item(300000)`)));
  const prl = await rpc(`public.prepare_payroll('2026-07')`);
  console.log("— prepared:", prl.id, "staff:", prl.staff, "gross:", prl.gross, "net:", prl.net);
  console.log("— approved:", JSON.stringify(await rpc(`public.approve_payroll('${prl.id}')`)));
  const posted = await rpc(`public.post_payroll('${prl.id}')`);
  console.log("— posted journal:", posted.journal, "| payment file rows:", posted.paymentFile.length,
    "| first:", JSON.stringify(posted.paymentFile[0]));
  const bal = await q(`select sum(debit) d, sum(credit) c from journal_lines`);
  console.log("— GL still balanced:", bal[0].d === bal[0].c);
  const lv = await rpc(`public.apply_leave('annual', '2026-08-03', '2026-08-05', 'family')`);
  console.log("— leave applied:", lv.id, lv.days, "days | reserved:",
    (await q(`select reserved from leave_balances b join app_users u on u.id=b.app_user_id where u.email='wanjiku@ignis.africa' and kind='annual'`))[0].reserved);
  console.log("— leave decided:", JSON.stringify(await rpc(`public.decide_leave('${lv.id}', true, null)`)));
  await expectFail("leave beyond balance", `public.apply_leave('annual', '2026-09-01', '2026-12-31', 'too long')`);
  const mine = await rpc(`public.my_hr_summary()`);
  console.log("— staff portal self-scope: payslips:", mine.payslips.length, "| leave rows:", mine.leave.length);

  console.log("=== Phase 3: Growth ===");
  const ts = await rpc(`public.issue_term_sheet('EAIF', 800000, 'concessional')`);
  const signed = await rpc(`public.sign_term_sheet('${ts.id}')`);
  console.log("— signed EAIF:", JSON.stringify(signed));
  await expectFail("dataroom open without grant", `public.log_dataroom_open('kiico@fund.example', 'Financial model v3')`);
  await rpc(`public.grant_dataroom('kiico@fund.example', 14)`);
  console.log("— dataroom open:", JSON.stringify(await rpc(`public.log_dataroom_open('kiico@fund.example', 'Financial model v3')`)));
  console.log("— access log rows:", (await q(`select count(*) n from dataroom_access_log`))[0].n);
  const proj = await rpc(`public.create_project_from_eng('ENG-008')`);
  console.log("— project from eng (normalized):", proj.name, "milestones:", proj.detail.milestones.length);

  console.log("=== Phase 4: Compliance & integrations ===");
  const sv = await rpc(`public.screen_vendor('Mombasa Freight Co.', 'cleared', 'OFAC/EU/UN lists — no match')`);
  console.log("— screened:", JSON.stringify(sv));
  const r1 = await rpc(`public.submit_requisition('Clearing services — pilot shipment', 30000, 'Operations')`);
  await rpc(`public.approve_requisition('${r1.id}')`);
  const po1 = await rpc(`public.raise_po('${r1.id}', 'Mombasa Freight Co.', 'Standard · 7 days')`);
  console.log("— PO to newly-cleared vendor:", po1.id, "✓ (gate passes after screening)");
  const si = await rpc(`public.submit_sales_invoice('CLASP', 'workshop', 50000, 'week')`);
  const [etims] = await q(`select control_no, state from etims_submissions where invoice_ref=$1`, si.id);
  console.log("— sales invoice", si.id, "→ eTIMS:", JSON.stringify(etims));
  const ob = await rpc(`public.mark_obligation_filed('PAYE remittance')`);
  console.log("— PAYE filed, next due:", ob.nextDue);

  console.log("=== Phase 5: Access & governance (enforce_access is ON) ===");
  await impersonate("lily@ignis.africa");   // view-only: procurement 0
  await expectFail("lily raises requisition", `public.submit_requisition('sneaky', 1000, 'Admin')`);
  await impersonate("wanjiku@ignis.africa");
  const inv = await rpc(`public.invite_user('Njeri Kamau', 'njeri@ignis.africa', 'fin')`);
  console.log("— invited:", inv.email, "role:", inv.role, "| perms rows:",
    (await q(`select count(*) n from user_permissions where email='njeri@ignis.africa'`))[0].n);
  console.log("— offboarded:", JSON.stringify(await rpc(`public.offboard_user('njeri@ignis.africa')`)),
    "| perms now all 0:", (await q(`select max(level) m from user_permissions where email='njeri@ignis.africa'`))[0].m === 0);
  await c.query(`update app_config set value='true'::jsonb where key='enforce_sod'`);
  const r2 = await rpc(`public.submit_requisition('SoD test', 60000, 'Admin')`);
  await expectFail("SoD: approve own requisition", `public.approve_requisition('${r2.id}')`);
  await expectFail("SoD: grant procurement+finance full", `public.save_access('wilson@ignis.africa', '{"procurement":3,"finance":3}'::jsonb)`);
  const boot = await rpc(`public.bootstrap()`);
  console.log("— bootstrap keys:", Object.keys(boot).join(", "));
  console.log("— inventory payload: items:", boot.inventory.items.length, "| movements:", boot.inventory.movements.length,
    "| assets:", boot.inventory.assets.length, "| dispatches:", boot.inventory.dispatches.length);
} finally {
  await c.query("rollback");
  console.log("(rolled back — nothing persisted)");
  await c.end();
}
