// Exercise the interactive Projects RPCs (milestones, drawdowns, field activity,
// state) inside a rolled-back transaction — nothing is kept.
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

  const [proj] = await q(`select id, name, state from projects order by created_at limit 1`);
  const pid = proj.id;
  console.log("— project:", proj.name, "| state =", proj.state);

  // add + toggle a milestone
  let r = await rpc(`public.add_project_milestone('${pid}'::uuid, 'Smoke-test milestone', 'todo')`);
  const newMs = r.detail.milestones.find((m) => m.t === "Smoke-test milestone");
  console.log("— milestone added:", newMs.t, "| id ok:", !!newMs.id);
  r = await rpc(`public.set_milestone_status('${newMs.id}'::uuid, 'done')`);
  console.log("— milestone now:", r.detail.milestones.find((m) => m.id === newMs.id).s);

  // add + receive a drawdown
  r = await rpc(`public.add_project_drawdown('${pid}'::uuid, 'Smoke tranche', 'KES 500,000', 'Requested')`);
  const newDd = r.detail.drawdowns.find((d) => d.t === "Smoke tranche");
  console.log("— drawdown added:", newDd.t, newDd.v, "| status:", newDd.s);
  r = await rpc(`public.set_drawdown_status('${newDd.id}'::uuid, 'Received')`);
  console.log("— drawdown now:", r.detail.drawdowns.find((d) => d.id === newDd.id).s);

  // log field activity → field summary recomputed
  r = await rpc(`public.log_field_activity('${pid}'::uuid, 'install', 'Makueni', '2 units')`);
  console.log("— field summary:", r.detail.field);

  // advance state along the machine
  r = await rpc(`public.set_project_state('${pid}'::uuid, 'active')`);
  console.log("— state → active | status:", r.detail.status, "| state:", r.detail.state);

  // illegal transition must be blocked
  try {
    await c.query("savepoint s1");
    await rpc(`public.set_project_state('${pid}'::uuid, 'closed')`);
    console.log("— illegal transition: NOT BLOCKED (BUG)");
  } catch (e) {
    await c.query("rollback to s1");
    console.log("— illegal transition blocked:", e.message);
  }
  // bad status value must be blocked
  try {
    await c.query("savepoint s2");
    await rpc(`public.set_milestone_status('${newMs.id}'::uuid, 'bogus')`);
    console.log("— bad status: NOT BLOCKED (BUG)");
  } catch (e) {
    await c.query("rollback to s2");
    console.log("— bad status blocked:", e.message);
  }
} finally {
  await c.query("rollback");
  await c.end();
  console.log("rolled back — no rows kept");
}
