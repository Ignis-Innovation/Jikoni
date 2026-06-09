// Applies migration 0030 (Partner Manager experience) to the live DB.
// Reads the Postgres connection string from SUPABASE_DB_URL, or extracts it from
// .claude/settings.local.json so the secret never has to be passed on the CLI.
// Idempotent — safe to re-run.
import { readFileSync } from "node:fs";
import pg from "pg";

function connString() {
  if (process.env.SUPABASE_DB_URL) return process.env.SUPABASE_DB_URL;
  const txt = readFileSync(new URL("../.claude/settings.local.json", import.meta.url), "utf8");
  const m = txt.match(/postgresql:\/\/[^"\\]+/);
  if (!m) throw new Error("No SUPABASE_DB_URL and none found in .claude/settings.local.json");
  return m[0];
}

const sql = readFileSync(new URL("../supabase/migrations/0030_partner_manager_experience.sql", import.meta.url), "utf8");

const c = new pg.Client({ connectionString: connString(), ssl: { rejectUnauthorized: false } });
await c.connect();
await c.query(sql);

const rows = (await c.query(`
  select r.key as role, array_agg(p.key order by p.key) as perms
  from public.roles r
  join public.role_permissions rp on rp.role_id = r.id
  join public.permissions p on p.id = rp.permission_id
  where r.key in ('partner_manager','hr')
  group by r.key order by r.key
`)).rows;
const lt = (await c.query(`select name from public.leave_types where deleted_at is null order by name`)).rows;
const col = (await c.query(`select 1 from information_schema.columns where table_name='engagements' and column_name='title'`)).rowCount;

console.log("engagements.title column present:", col === 1);
console.log("leave_types:", lt.map((r) => r.name).join(", "));
for (const r of rows) console.log(`${r.role}: ${r.perms.join(", ")}`);

await c.end();
