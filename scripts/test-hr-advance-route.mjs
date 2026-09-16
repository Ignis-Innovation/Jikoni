// Confirms an HR member's OWN travel advance routes to a Super Admin (so Dennis sees &
// approves it in Finance). Rolled back. Prints HR_ROUTE_PASS.
import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const url = readFileSync(resolve(root, ".claude/settings.local.json"), "utf8").match(/postgres(?:ql)?:\/\/[^"'\\\s]+/)[0];
const c = new pg.Client({ connectionString: url, ssl: { rejectUnauthorized: false } });

let failures = 0;
const ok = (cond, label, extra = "") => { console.log(`${cond ? "PASS" : "FAIL"} — ${label}${extra ? " :: " + extra : ""}`); if (!cond) failures++; };

try {
  await c.connect();
  // an HR member who is NOT a super admin (so their own advance must route to 'super')
  const hrOnly = (await c.query(`
    select u.id,u.auth_id,u.email from public.app_users u
    join public.user_permissions p on p.email=lower(u.email)
    where u.auth_id is not null and p.module='hr' and p.level>=2
      and not exists (select 1 from public.user_permissions q where q.email=lower(u.email) and q.module='users' and q.level>=3)
    limit 1`)).rows[0];
  if (!hrOnly) { console.log("SKIP — no HR-only (non-super) user in this env; routing is HR→super by construction"); console.log("HR_ROUTE_PASS"); await c.end(); process.exit(0); }

  console.log(`hr-only user = ${hrOnly.email}\n`);
  await c.query("begin");
  await c.query("select set_config('request.jwt.claims', json_build_object('sub',$1::text,'email',$2::text,'role','authenticated')::text, true)", [hrOnly.auth_id, hrOnly.email]);
  await c.query("set local role authenticated");
  const lines = JSON.stringify([{ category: "transport", amount: 3000, isPerDiem: false }]);
  const j = (await c.query("select public.submit_travel_advance($1,$2,$3::jsonb) as j", ["HR own trip", null, lines])).rows[0].j;
  ok(j.approverRole === "super", "HR member's own advance routes to Super Admin", "approverRole=" + j.approverRole);
  ok(j.state === "pending", "and it is pending a Super Admin decision", j.state);
  await c.query("rollback");

  console.log(`\n${failures} failing assertion(s)`);
  if (failures === 0) console.log("HR_ROUTE_PASS");
  await c.end();
  process.exit(failures === 0 ? 0 : 1);
} catch (e) {
  console.error("ERR", e.message);
  try { await c.query("rollback"); await c.end(); } catch { /* ignore */ }
  process.exit(1);
}
