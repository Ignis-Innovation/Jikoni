// Exercise the IRENA budget-item / expense RPCs (migration 0072) and confirm
// budget items drive budget_amount and expenses roll into spentAmount. All inside
// a rolled-back transaction so the live DB is untouched.
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
  // Bypass assert_access for the smoke run; set a claims email so added_by resolves.
  await c.query(`select set_config('jikoni.system_action','true',false)`);
  await c.query(`select set_config('request.jwt.claims', $1, false)`,
    [JSON.stringify({ email: "jwanjiku@ignis-innovation.com", role: "authenticated" })]);

  const [irena] = await q(`select id, name, budget_amount from projects where lower(name) like '%irena%' and lower(name) like '%taita%'`);
  check("IRENA – Taita Taveta project is seeded", !!irena, irena?.name);
  const id = irena.id;

  // --- budget item drives budget_amount + budgetItems ---
  let r = await rpc(`public.add_project_budget_item('${id}','LPG cylinders x40','Institutional refills', 450000)`);
  check("add_project_budget_item returns the project", r.name === irena.name);
  check("budgetItems now has 1 row", r.detail.budgetItems.length === 1, `${r.detail.budgetItems.length}`);
  check("budgetItem carries name + amount + addedBy", r.detail.budgetItems[0].name === "LPG cylinders x40" && r.detail.budgetItems[0].amount === 450000 && !!r.detail.budgetItems[0].addedBy, r.detail.budgetItems[0].addedBy);
  check("budgetAmount reflects allocation sum", Number(r.detail.budgetAmount) === 450000, `${r.detail.budgetAmount}`);

  // --- expense rolls into spentAmount ---
  r = await rpc(`public.add_project_expense('${id}','Site transport – March', 120000, date '2026-03-14')`);
  check("expenses now has 1 row", r.detail.expenses.length === 1, `${r.detail.expenses.length}`);
  check("expense carries description + amount + spentOn", r.detail.expenses[0].description === "Site transport – March" && r.detail.expenses[0].amount === 120000, r.detail.expenses[0].spentOn);
  check("spentAmount includes the expense", Number(r.detail.spentAmount) === 120000, `${r.detail.spentAmount}`);
  check("spent_txt / pct recomputed (120k of 450k ≈ 27%)", r.detail.spent === "KES 120,000" && r.detail.pct === "27%", `${r.detail.spent} · ${r.detail.pct}`);

  // --- a second expense adds up ---
  r = await rpc(`public.add_project_expense('${id}','Field allowances', 30000, null)`);
  check("spentAmount sums both expenses", Number(r.detail.spentAmount) === 150000, `${r.detail.spentAmount}`);

  // --- deletes reverse the sums ---
  const expId = r.detail.expenses.find((e) => e.description === "Field allowances").id;
  r = await rpc(`public.delete_project_expense('${expId}')`);
  check("delete_project_expense reverses the sum", Number(r.detail.spentAmount) === 120000, `${r.detail.spentAmount}`);
  const bId = r.detail.budgetItems[0].id;
  r = await rpc(`public.delete_project_budget_item('${bId}')`);
  check("delete_project_budget_item clears budgetAmount", Number(r.detail.budgetAmount) === 0 && r.detail.budgetItems.length === 0);

  // --- bootstrap surfaces the new keys ---
  const boot = await rpc(`public.bootstrap()`);
  const projJson = boot.projects[irena.name];
  check("bootstrap project carries budgetItems + expenses arrays", Array.isArray(projJson.budgetItems) && Array.isArray(projJson.expenses));

  // --- negative amount rejected ---
  await c.query("savepoint sp");
  let rejected = false;
  try { await rpc(`public.add_project_expense('${id}','bad', -5, null)`); } catch { rejected = true; }
  await c.query("rollback to savepoint sp");
  check("negative expense amount is rejected", rejected);

  await c.query("rollback");
  console.log(`\n${failures ? `✗ ${failures} check(s) failed` : "✓ all IRENA checks passed"}`);
  process.exitCode = failures ? 1 : 0;
} catch (e) {
  console.error("ERROR:", e.message);
  process.exitCode = 1;
} finally {
  await c.end();
}
