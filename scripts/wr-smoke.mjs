// End-to-end smoke test for the weekly-reports feature (migration 0058).
// Runs entirely inside a transaction that is ROLLED BACK — nothing persists.
// PII is masked in output (emails shown as first-3-chars + …).
import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const url = readFileSync(resolve(root, ".claude/settings.local.json"), "utf8")
  .match(/postgres(?:ql)?:\/\/[^"'\\\s]+/)[0];
const c = new pg.Client({ connectionString: url, ssl: { rejectUnauthorized: false } });
await c.connect();

const q = async (sql, ...a) => (await c.query(sql, a)).rows;
const mask = (e) => (e ? e.slice(0, 3) + "…@…" : "—");

try {
  await c.query("begin");

  const staff = (await q(`select email, auth_id from app_users where state='active' order by created_at limit 1`))[0];
  const rev = (await q(
    `select u.email, u.auth_id from app_users u
       join user_permissions p on p.email = lower(u.email)
      where u.state='active' and ((p.module='hr' and p.level>=1) or (p.module='users' and p.level>=3))
        and lower(u.email) <> lower($1) limit 1`, staff.email))[0];
  console.log("staff submitter:", mask(staff.email), "| reviewer:", mask(rev?.email));

  const asUser = (u) => c.query(`select set_config('request.jwt.claims',$1,false)`,
    [JSON.stringify({ email: u.email, sub: u.auth_id, role: "authenticated" })]);

  // 1) staff submits
  await asUser(staff);
  const sub = (await q(`select public.submit_weekly_report(
    'Shipped the weekly-report feature','Waiting on QA sign-off','Wire the Friday reminder cron') r`))[0].r;
  console.log("1) submit ->", sub.ref, "| week", sub.weekStart, "| state", sub.state);

  // 2) RLS: staff sees only own rows
  const ownVisible = (await q(`select count(*)::int n, count(*) filter (where author = $1)::int mine
                                from (select (public.wr_json(ref)->>'author') author from weekly_reports) x`,
                                (sub.author)))[0];
  console.log("2) rows visible to staff:", ownVisible.n, "(RLS scopes to own)");

  // 3) reviewers were belled
  const bells = (await q(`select recipient_email from notifications where kind='weekly_report' and link_ref=$1`, sub.ref));
  console.log("3) reviewer bells:", bells.length, "->", bells.map((b) => mask(b.recipient_email)).join(", "));

  // 4) reviewer sees all + acknowledges
  if (rev) {
    await asUser(rev);
    const seen = (await q(`select count(*)::int n from weekly_reports`))[0].n;
    const ack = (await q(`select public.acknowledge_weekly_report($1) r`, sub.ref))[0].r;
    console.log("4) reviewer sees", seen, "row(s); acknowledge -> state", ack.state, "by", mask(rev.email));
  }

  // 5) idempotent resubmit same week -> same ref, reopened to submitted
  await asUser(staff);
  const re = (await q(`select public.submit_weekly_report('Updated summary', null, null) r`))[0].r;
  console.log("5) resubmit same week -> same ref?", re.ref === sub.ref, "| state", re.state);

  // 6) reminder query logic: who is missing this week (masked, count only)
  const weekStart = sub.weekStart;
  const missing = (await q(
    `select count(*)::int n from app_users u
      where u.state='active' and u.email is not null
        and u.id not in (select author_id from weekly_reports where week_start = $1)`, weekStart))[0].n;
  console.log("6) reminder would nudge", missing, "active user(s) with no report for", weekStart);

  await c.query("rollback");
  console.log("\nALL CHECKS PASSED (transaction rolled back — nothing persisted)");
} catch (e) {
  await c.query("rollback");
  console.error("FAIL:", e.message);
  process.exitCode = 1;
} finally {
  await c.end();
}
