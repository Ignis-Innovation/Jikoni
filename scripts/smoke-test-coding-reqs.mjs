// Coding + enriched requisition flow (draft → submit → withdraw) in a rolled-back txn.
import { readFileSync } from "node:fs";
import pg from "pg";

const root = "/home/brian/Desktop/jikoni";
const url = readFileSync(root + "/.claude/settings.local.json", "utf8")
  .match(/postgres(?:ql)?:\/\/[^"'\\\s]+/)[0];
const c = new pg.Client({ connectionString: url, ssl: { rejectUnauthorized: false } });
await c.connect();
const q = async (sql, ...a) => (await c.query(sql, a)).rows;
const rpc = async (call) => (await c.query(`select ${call} as r`)).rows[0].r;

try {
  await c.query("begin");
  const [me] = await q(`select auth_id from app_users where email='wanjiku@ignis.africa'`);
  await c.query(`select set_config('request.jwt.claims', $1, false)`,
    [JSON.stringify({ email: "wanjiku@ignis.africa", sub: me.auth_id, role: "authenticated" })]);

  // Coding: create a cost centre
  let r = await rpc(`public.upsert_cost_centre('Smoke Centre', 250000)`);
  console.log("— cost centre:", r.code, "| budget:", r.budget);
  const [bl] = await q(`select budget, committed from budget_lines where code='Smoke Centre'`);
  console.log("— budget_line row:", bl.budget, "committed", bl.committed);

  // Draft requisition (qty × unit price, project + justification) — no budget commit
  r = await rpc(`public.submit_requisition('Cookstove spares', 60000, 'Smoke Centre', 30, 'box', 2000, null, 'Maintenance batch', true)`);
  const pr = r.id;
  console.log("— draft req:", pr, "| status:", r.status, "| chip:", r.chipTxt);
  let [bl2] = await q(`select committed from budget_lines where code='Smoke Centre'`);
  const [rq] = await q(`select qty, unit, unit_price, justification, state from requisitions where ref='${pr}'`);
  console.log("— draft stored qty/unit/price:", rq.qty, rq.unit, rq.unit_price, "| committed still:", bl2.committed, "(0 = not committed)");

  // Submit the draft → commits budget + routes
  r = await rpc(`public.submit_requisition_final('${pr}')`);
  [bl2] = await q(`select committed from budget_lines where code='Smoke Centre'`);
  console.log("— after submit → status:", r.status, "| committed now:", bl2.committed);

  // Withdraw pending → back to draft, releases budget
  r = await rpc(`public.withdraw_requisition('${pr}')`);
  [bl2] = await q(`select committed from budget_lines where code='Smoke Centre'`);
  const [rq2] = await q(`select state from requisitions where ref='${pr}'`);
  console.log("— after withdraw → status:", r.status, "| req state:", rq2.state, "| committed released:", bl2.committed);

  // Discard the draft entirely
  r = await rpc(`public.withdraw_requisition('${pr}')`);
  const gone = (await q(`select 1 from requisitions where ref='${pr}'`)).length === 0;
  console.log("— discard draft → status:", r.status, "| row removed:", gone);
} finally {
  await c.query("rollback");
  await c.end();
  console.log("rolled back — no rows kept");
}
