// Verify per-project delegation (migration 0075): global editors + project 'editor'
// members can edit a project's budget; viewers cannot; membership management is
// restricted to global editors; brian55mwangi is excluded from the roster.
// All inside a rolled-back transaction.
import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const url = readFileSync(resolve(root, ".claude/settings.local.json"), "utf8").match(/postgres(?:ql)?:\/\/[^"'\\\s]+/)[0];
const c = new pg.Client({ connectionString: url, ssl: { rejectUnauthorized: false } });
await c.connect();

let fails = 0;
const ok = (l, b, x = "") => { console.log(`${b ? "✓" : "✗ FAIL"} ${l}${x ? " — " + x : ""}`); if (!b) fails++; };
const as = (email) => c.query(`select set_config('request.jwt.claims',$1,true)`, [JSON.stringify({ email, role: "authenticated" })]);
const rpc = async (call, args = []) => (await c.query(`select ${call} as r`, args)).rows[0].r;

try {
  await c.query("begin");
  await c.query(`select set_config('jikoni.system_action','',true)`); // enforce the gates (not system)
  const [ir] = (await c.query(`select id, name from projects where lower(name) like '%irena%taita%'`)).rows;
  ok("IRENA project present", !!ir, ir?.name);
  const id = ir.id;

  const tryBudget = async (email) => {
    await as(email); await c.query("savepoint s");
    try { await c.query(`select public.add_project_budget_item($1,'probe',null,100)`, [id]); await c.query("release savepoint s"); return "OK"; }
    catch { await c.query("rollback to savepoint s"); return "DENIED"; }
  };

  // enforce_access must be on for gates to apply
  const flag = (await c.query(`select value from app_config where key='enforce_access'`)).rows[0]?.value;
  ok("enforce_access is ON", String(flag) === "true");

  ok("global editor jwanjiku CAN edit IRENA budget", (await tryBudget("jwanjiku@ignis-innovation.com")) === "OK");
  ok("non-member eooro is DENIED (view-only)", (await tryBudget("eooro@ignis-innovation.com")) === "DENIED");

  // grant eooro editor on IRENA (as global editor jwanjiku)
  await as("jwanjiku@ignis-innovation.com");
  await rpc(`public.set_project_member_role($1,'eooro@ignis-innovation.com','editor')`, [id]);
  ok("after grant, eooro CAN edit IRENA budget", (await tryBudget("eooro@ignis-innovation.com")) === "OK");

  // revoke back to viewer
  await as("jwanjiku@ignis-innovation.com");
  await rpc(`public.set_project_member_role($1,'eooro@ignis-innovation.com','viewer')`, [id]);
  ok("after revoke, eooro DENIED again", (await tryBudget("eooro@ignis-innovation.com")) === "DENIED");

  // a non-global-editor cannot manage membership
  await as("eooro@ignis-innovation.com");
  await c.query("savepoint s2"); let mgrDenied = false;
  try { await c.query(`select public.set_project_member_role($1,'wmungai@ignis-innovation.com','editor')`, [id]); }
  catch { mgrDenied = true; }
  await c.query("rollback to savepoint s2");
  ok("non-editor cannot manage IRENA membership", mgrDenied);

  // roster excludes brian55mwangi + invited; global editors show locked/editor
  await as("jwanjiku@ignis-innovation.com");
  const roster = await rpc(`public.list_project_members($1)`, [id]);
  ok("roster excludes brian55mwangi@gmail.com", !roster.some((m) => m.email.toLowerCase() === "brian55mwangi@gmail.com"), `${roster.length} listed`);
  ok("jwanjiku shows as locked editor in roster", roster.some((m) => m.email.toLowerCase() === "jwanjiku@ignis-innovation.com" && m.role === "editor" && m.locked));
  ok("a normal user defaults to viewer", roster.some((m) => m.role === "viewer"));

  // cannot set a global editor's role
  await c.query("savepoint s3"); let fixedDenied = false;
  try { await c.query(`select public.set_project_member_role($1,'dnderitu@ignis-innovation.com','viewer')`, [id]); }
  catch { fixedDenied = true; }
  await c.query("rollback to savepoint s3");
  ok("cannot change a global editor's fixed role", fixedDenied);

  // OTHER modules still globally locked for non-editors (0073 intact)
  await as("eooro@ignis-innovation.com");
  await c.query("savepoint s4"); let modLocked = false;
  try { await c.query(`select public.assert_access('finance', 2)`); } catch { modLocked = true; }
  await c.query("rollback to savepoint s4");
  ok("global module lock still blocks non-editors elsewhere (finance)", modLocked);

  await c.query("rollback");
  console.log(`\n${fails ? `✗ ${fails} failed` : "✓ all irena-members checks passed"}`);
  process.exitCode = fails ? 1 : 0;
} catch (e) { console.error("ERROR:", e.message); process.exitCode = 1; } finally { await c.end(); }
