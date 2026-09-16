// Proves the advance-chase SELECTION: only advances still in 'issued' older than the chase
// window are picked — NOT recently-issued ones, NOT reconciled/settled ones. Mirrors the exact
// filter the api/advance-reminder.js handler uses (state='issued' AND issued_at < now()-Nd).
// Rolled back. Prints ADVREM_TESTS_PASS.
import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const url = readFileSync(resolve(root, ".claude/settings.local.json"), "utf8").match(/postgres(?:ql)?:\/\/[^"'\\\s]+/)[0];
const c = new pg.Client({ connectionString: url, ssl: { rejectUnauthorized: false } });
const CHASE_DAYS = 7;

let failures = 0;
const ok = (cond, label, extra = "") => { console.log(`${cond ? "PASS" : "FAIL"} — ${label}${extra ? " :: " + extra : ""}`); if (!cond) failures++; };

try {
  await c.connect();
  const holder = (await c.query("select id from public.app_users where auth_id is not null limit 1")).rows[0];
  const entity = (await c.query("select id from public.entities where code='KE'")).rows[0];

  await c.query("begin");
  const ins = async (ref, state, issuedDaysAgo) => c.query(
    `insert into public.travel_advances(ref, entity_id, holder_id, holder_name, purpose, amount, state, issued_at)
     values ($1,$2,$3,'T','chase test',10000,$4, case when $5::int is null then null else now() - ($5::int || ' days')::interval end)`,
    [ref, entity.id, holder.id, state, issuedDaysAgo]);
  await ins("ADV-CHASE-OLD", "issued", 10);       // issued 10 days ago → SHOULD be chased
  await ins("ADV-CHASE-NEW", "issued", 2);        // issued 2 days ago  → should NOT (too recent)
  await ins("ADV-CHASE-DONE", "reconciled", 10);  // reconciled          → should NOT (accounted for)

  // the exact selection the handler uses
  const picked = (await c.query(
    `select ref from public.travel_advances
     where state='issued' and issued_at < now() - ($1 || ' days')::interval
       and ref like 'ADV-CHASE-%' order by ref`, [CHASE_DAYS])).rows.map((r) => r.ref);

  ok(picked.includes("ADV-CHASE-OLD"), "chases an advance issued > 7 days & still 'issued'", picked.join(","));
  ok(!picked.includes("ADV-CHASE-NEW"), "does NOT chase a recently-issued advance (< 7 days)");
  ok(!picked.includes("ADV-CHASE-DONE"), "does NOT chase a reconciled advance");
  ok(picked.length === 1, "exactly one advance selected (positive control: filter works, not empty by accident)", "n=" + picked.length);

  await c.query("rollback");
  console.log(`\n${failures} failing assertion(s)`);
  if (failures === 0) console.log("ADVREM_TESTS_PASS");
  await c.end();
  process.exit(failures === 0 ? 0 : 1);
} catch (e) {
  console.error("ERR", e.message);
  try { await c.query("rollback"); await c.end(); } catch { /* ignore */ }
  process.exit(1);
}
