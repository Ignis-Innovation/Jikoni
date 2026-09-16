// Claim↔advance link test — proves an expense claim can optionally carry a travel-advance
// ref (advance_code), that cej_json returns it, and that a null link is allowed. Rolled back.
import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const url = readFileSync(resolve(root, ".claude/settings.local.json"), "utf8").match(/postgres(?:ql)?:\/\/[^"'\\\s]+/)[0];
const c = new pg.Client({ connectionString: url, ssl: { rejectUnauthorized: false } });

let failures = 0;
function ok(cond, label, extra = "") { console.log(`${cond ? "PASS" : "FAIL"} — ${label}${extra ? " :: " + extra : ""}`); if (!cond) failures++; }
async function as(u) {
  await c.query("reset role");
  await c.query("select set_config('request.jwt.claims', json_build_object('sub',$1::text,'email',$2::text,'role','authenticated')::text, true)", [u.auth_id, u.email]);
  await c.query("set local role authenticated");
}

try {
  await c.connect();
  const staff = (await c.query("select u.id,u.auth_id,u.email from public.app_users u where auth_id is not null and not exists(select 1 from public.user_permissions p where p.email=lower(u.email) and p.module='users' and p.level>=3) limit 1")).rows[0];
  console.log(`claimant=${staff.email}\n`);

  await c.query("begin");
  await as(staff);
  const lines = JSON.stringify([{ category: "meals", detail: "own-pocket lunch", amount: 2000, isPerDiem: false }]);

  // 1. claim linked to a travel advance
  const linked = (await c.query("select public.submit_expense_claim($1,$2,$3::jsonb,$4) as j", ["Out-of-pocket extra for Kitui", null, lines, "ADV-999"])).rows[0].j;
  ok(linked.advance === "ADV-999", "claim stores the linked advance ref", "advance=" + linked.advance);
  ok(Number(linked.total) === 2000, "linked claim total = 2000", "total=" + linked.total);

  // 2. cej_json reads it back independently
  const readback = (await c.query("select public.cej_json($1) as j", [linked.id])).rows[0].j;
  ok(readback.advance === "ADV-999", "cej_json returns the advance link", "advance=" + readback.advance);

  // 3. a claim with NO advance link is allowed (advance is null)
  const unlinked = (await c.query("select public.submit_expense_claim($1,$2,$3::jsonb,$4) as j", ["Normal claim", null, lines, null])).rows[0].j;
  ok(unlinked.advance === null, "claim with no link stores null advance", "advance=" + JSON.stringify(unlinked.advance));

  // 4. editing can set/clear the link
  const edited = (await c.query("select public.edit_expense_claim($1,$2,$3,$4::jsonb,$5) as j", [unlinked.id, "Normal claim", null, lines, "ADV-777"])).rows[0].j;
  ok(edited.advance === "ADV-777", "edit can attach an advance link", "advance=" + edited.advance);

  await c.query("reset role");
  await c.query("rollback");
  console.log(`\n${failures} failing assertion(s)`);
  if (failures === 0) console.log("LINK_TESTS_PASS");
  await c.end();
  process.exit(failures === 0 ? 0 : 1);
} catch (e) {
  console.error("ERR", e.message);
  try { await c.query("rollback"); await c.end(); } catch { /* ignore */ }
  process.exit(1);
}
