// Verify the global view-only hard lock (migration 0073): only the three editor
// accounts may perform module writes (assert_access level>=2); everyone else is
// denied, while self-service (own-auth RPCs) is unaffected. Rolled-back tx.
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
const tryModuleWrite = async (email, module) => {
  await as(email); await c.query("savepoint s");
  try { await c.query(`select public.assert_access($1,2)`, [module]); await c.query("release savepoint s"); return "ALLOWED"; }
  catch { await c.query("rollback to savepoint s"); return "DENIED"; }
};

try {
  await c.query("begin");
  await c.query(`select set_config('jikoni.system_action','',true)`);
  const flag = (await c.query(`select value from app_config where key='enforce_access'`)).rows[0]?.value;
  ok("enforce_access is ON", String(flag) === "true");

  for (const e of ["jwanjiku@ignis-innovation.com", "dnderitu@ignis-innovation.com", "brian55mwangi@gmail.com"])
    ok(`editor ${e} CAN write (finance)`, (await tryModuleWrite(e, "finance")) === "ALLOWED");
  for (const e of ["bmwangi@ignis-innovation.com", "eooro@ignis-innovation.com", "wmungai@ignis-innovation.com"])
    ok(`non-editor ${e} DENIED write (projects)`, (await tryModuleWrite(e, "projects")) === "DENIED");

  const g = (await c.query(`select count(*) n from user_permissions where lower(email) not in ('jwanjiku@ignis-innovation.com','dnderitu@ignis-innovation.com','brian55mwangi@gmail.com') and level>1`)).rows[0].n;
  ok("no non-editor grant above view remains", Number(g) === 0, g + " rows >1");

  await c.query("rollback");
  console.log(`\n${fails ? `✗ ${fails} failed` : "✓ all lock checks passed"}`);
  process.exitCode = fails ? 1 : 0;
} catch (e) { console.error("ERROR:", e.message); process.exitCode = 1; } finally { await c.end(); }
