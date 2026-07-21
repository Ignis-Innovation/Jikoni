// Exercise the staff-portal leave flow (apply_leave + my_hr_summary) inside a rolled-back transaction.
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

  const before = await rpc(`public.my_hr_summary()`);
  console.log("— balances:", before.leave.map(b => `${b.kind} ${b.entitled - b.used - b.reserved}/${b.entitled}`).join(", "));

  const app = await rpc(`public.apply_leave('annual', '2026-08-03'::date, '2026-08-05'::date, 'Family travel')`);
  console.log("— applied:", app.id, app.days, "days,", app.state);

  const after = await rpc(`public.my_hr_summary()`);
  const a = after.leave.find(b => b.kind === "annual");
  console.log("— annual after: reserved =", a.reserved, "| available =", a.entitled - a.used - a.reserved);
  console.log("— latest application:", JSON.stringify(after.applications[0]));

  // over-balance must be rejected
  try {
    await c.query("savepoint s1");
    await rpc(`public.apply_leave('compassionate', '2026-08-01'::date, '2026-08-30'::date, null)`);
    console.log("— over-balance: NOT BLOCKED (BUG)");
  } catch (e) {
    await c.query("rollback to s1");
    console.log("— over-balance blocked:", e.message);
  }
  // bad date order must be rejected
  try {
    await c.query("savepoint s2");
    await rpc(`public.apply_leave('annual', '2026-08-10'::date, '2026-08-08'::date, null)`);
    console.log("— reversed dates: NOT BLOCKED (BUG)");
  } catch (e) {
    await c.query("rollback to s2");
    console.log("— reversed dates blocked:", e.message);
  }
} finally {
  await c.query("rollback");
  await c.end();
  console.log("rolled back — no rows kept");
}
