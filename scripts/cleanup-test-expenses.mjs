// One-off: remove the Expenses & Claims + Travel Advances TEST data before the production
// push. Also removes any project_expenses those accrued and recomputes the affected projects'
// spend, and resets the CLM/ADV/BILL ref counters so production starts at 001. COMMITS.
import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const url = readFileSync(resolve(root, ".claude/settings.local.json"), "utf8").match(/postgres(?:ql)?:\/\/[^"'\\\s]+/)[0];
const c = new pg.Client({ connectionString: url, ssl: { rejectUnauthorized: false } });

try {
  await c.connect();
  await c.query("begin");

  // which projects had advance/claim accruals — recompute them after we delete the rows
  const projects = (await c.query(
    "select distinct project_id from public.project_expenses where description like 'Advance ADV-%' or description like 'Claim CLM-%'"
  )).rows.map((r) => r.project_id);

  const pe = await c.query("delete from public.project_expenses where description like 'Advance ADV-%' or description like 'Claim CLM-%'");
  const adv = await c.query("delete from public.travel_advances");   // cascades travel_advance_lines
  const clm = await c.query("delete from public.expense_claims");    // cascades expense_claim_lines

  for (const pid of projects) await c.query("select public.recompute_project_money($1)", [pid]);

  await c.query("update public.ref_counters set n = 0 where kind in ('CLM','ADV','BILL')");

  await c.query("commit");
  console.log(`Deleted: ${clm.rowCount} claim(s), ${adv.rowCount} advance(s), ${pe.rowCount} project-expense row(s); recomputed ${projects.length} project(s); reset CLM/ADV/BILL counters.`);
  await c.end();
} catch (e) {
  console.error("ERR", e.message);
  try { await c.query("rollback"); await c.end(); } catch { /* ignore */ }
  process.exit(1);
}
