// Exercise the 0037 round (milestone money model, field activity, CRM tagging +
// notifications) inside a rolled-back transaction — nothing is kept.
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

  // 1) create a project with a numeric budget + dates
  let r = await rpc(`public.create_project('Smoke 0037 project', 'Charm Impact', 1000000, '2026-01-01'::date, '2026-12-31'::date, null, 'Setup')`);
  const pid = r.detail.id;
  console.log("— project:", r.name, "| budget:", r.detail.budget, "| budgetAmount:", r.detail.budgetAmount, "| timeline:", r.detail.timeline);

  // 2) add a milestone with an amount + dates
  r = await rpc(`public.add_project_milestone('${pid}'::uuid, 'Install pumps', 400000, '2026-02-01'::date, '2026-03-01'::date, 'todo')`);
  const m1 = r.detail.milestones.find((m) => m.t === "Install pumps");
  console.log("— milestone:", m1.t, "| amount:", m1.amount, "| start:", m1.start, "| end:", m1.end);

  // 3) over-budget milestone must be rejected (400k used + 700k > 1,000,000)
  try {
    await c.query("savepoint s1");
    await rpc(`public.add_project_milestone('${pid}'::uuid, 'Too big', 700000, null, null, 'todo')`);
    console.log("— over-budget: NOT BLOCKED (BUG)");
  } catch (e) {
    await c.query("rollback to s1");
    console.log("— over-budget blocked:", e.message);
  }

  // 4) completing the milestone → auto-drawdown + spent recognised
  r = await rpc(`public.set_milestone_status('${m1.id}'::uuid, 'done')`);
  const dd = r.detail.drawdowns.find((d) => d.t === "Install pumps");
  console.log("— completed → drawdown:", dd ? `${dd.t} ${dd.v} ${dd.s}` : "MISSING (BUG)", "| spent:", r.detail.spent, "| pct:", r.detail.pct, "| spentAmount:", r.detail.spentAmount);

  // 5) reopening pulls the drawdown back out
  r = await rpc(`public.set_milestone_status('${m1.id}'::uuid, 'todo')`);
  console.log("— reopened → drawdowns:", r.detail.drawdowns.length, "| spent:", r.detail.spent);

  // 6) field activity assignment
  r = await rpc(`public.create_field_activity('${pid}'::uuid, 'Peter Otieno', '+254700000000', 'peter@example.com', current_date, 'Fix the pipes at the test site')`);
  const [fa] = await q(`select assignee, phone, email, note, kind from field_activities where id = '${r.id}'::uuid`);
  console.log("— field activity:", fa.assignee, "|", fa.kind, "|", fa.note);

  // 7) partner with contact person
  r = await rpc(`public.create_partner('Smoke Partner Ltd', 'Bank', 'KE', null, 'Active', 'Jane Wanjiru', 'jane@partner.co', '+254711111111')`);
  console.log("— partner:", r.name, "| contact:", r.contactName, r.email, r.phone);

  // 8) engagement tagging dennis → in-app notification for dennis
  r = await rpc(`public.create_engagement('Tagged engagement', null, 'Wanjiku', 'up', 'Intro call done', 'week', 'brian55mwangi@gmail.com')`);
  console.log("— engagement:", r.id, "| taggedEmail:", r.taggedEmail);
  const [notif] = await q(`select title, body, link_view, link_ref, seen from notifications where recipient_email='brian55mwangi@gmail.com' and link_ref='${r.id}'`);
  console.log("— notification for dennis:", notif ? `"${notif.title}" | ${notif.link_view} → ${notif.link_ref} | seen=${notif.seen}` : "MISSING (BUG)");

  // 9) dennis marks his notifications seen
  await c.query(`select set_config('request.jwt.claims', $1, false)`,
    [JSON.stringify({ email: "brian55mwangi@gmail.com", role: "authenticated" })]);
  r = await rpc(`public.mark_notifications_seen(null)`);
  console.log("— dennis marked seen:", r.seen);
} finally {
  await c.query("rollback");
  await c.end();
  console.log("rolled back — no rows kept");
}
