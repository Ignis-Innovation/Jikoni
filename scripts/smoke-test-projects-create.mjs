// Exercise the standalone create_project RPC and confirm bootstrap() surfaces
// the new project — all inside a rolled-back transaction.
import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const url = readFileSync(resolve(root, ".claude/settings.local.json"), "utf8")
  .match(/postgres(?:ql)?:\/\/[^"'\\\s]+/)[0];
const c = new pg.Client({ connectionString: url, ssl: { rejectUnauthorized: false } });
await c.connect();

const q = async (sql, ...args) => (await c.query(sql, args)).rows;
const rpc = async (call) => (await c.query(`select ${call} as r`)).rows[0].r;

let failures = 0;
const check = (label, ok, extra = "") => {
  console.log(`${ok ? "✓" : "✗ FAIL"} ${label}${extra ? " — " + extra : ""}`);
  if (!ok) failures++;
};

try {
  await c.query("begin");
  const [me] = await q(`select auth_id from app_users where email='wanjiku@ignis.africa'`);
  await c.query(`select set_config('request.jwt.claims', $1, false)`,
    [JSON.stringify({ email: "wanjiku@ignis.africa", sub: me.auth_id, role: "authenticated" })]);

  // --- create a project ---
  const p = await rpc(`public.create_project('Smoke Test Project','Smoke Funder','KES 5.0M','2026 — Q4','Wanjiku','On track')`);
  check("create_project returns the name", p.name === "Smoke Test Project", p.name);
  check("create_project returns created=true", p.created === true);
  check("detail carries funder + budget + status", p.detail.funder === "Smoke Funder" && p.detail.budget === "KES 5.0M" && p.detail.status === "On track", `${p.detail.budget} · ${p.detail.status}`);
  check("detail carries an is_extra row id", !!p.detail.id);
  check("bare project — no placeholder milestones", p.detail.milestones.length === 0, `${p.detail.milestones.length} milestones`);
  check("bare project — no placeholder drawdowns", p.detail.drawdowns.length === 0, `${p.detail.drawdowns.length} drawdowns`);

  // a raised exception aborts the tx, so guard expected-failure calls with a savepoint
  const expectFail = async (call) => {
    await c.query("savepoint sp");
    try { await rpc(call); await c.query("release savepoint sp"); return false; }
    catch { await c.query("rollback to savepoint sp"); return true; }
  };

  // --- a blank name is rejected ---
  check("blank name is rejected", await expectFail(`public.create_project('   ',null,null,null,null,null)`));

  // --- a duplicate name is rejected ---
  check("duplicate project name is rejected", await expectFail(`public.create_project('Smoke Test Project',null,null,null,null,null)`));

  // --- bootstrap surfaces it in projects + extraProjects ---
  const boot = await rpc(`public.bootstrap()`);
  check("bootstrap projects includes the new project", !!boot.projects["Smoke Test Project"]);
  check("bootstrap extraProjects lists it", boot.extraProjects.some((x) => x.name === "Smoke Test Project"), `${boot.extraProjects.length} extra`);

  // --- audit trail written ---
  const [aud] = await q(`select count(*)::int n from audit_log where action='project.created' and record_ref='Smoke Test Project'`);
  check("create wrote to audit_log", aud.n >= 1, `${aud.n} rows`);

  await c.query("rollback");
  console.log(failures === 0 ? "\nALL PROJECT-CREATE SMOKE CHECKS PASSED" : `\n${failures} CHECK(S) FAILED`);
} catch (e) {
  console.error("ERROR:", e.message);
  failures++;
} finally {
  await c.end();
  process.exit(failures === 0 ? 0 : 1);
}
