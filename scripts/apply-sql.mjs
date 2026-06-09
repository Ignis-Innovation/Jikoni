// Runs a .sql file against the live DB. Usage: node scripts/apply-sql.mjs <path>
// Reads SUPABASE_DB_URL, or extracts the connection string from
// .claude/settings.local.json so the secret never hits the CLI. Idempotent SQL only.
import { readFileSync } from "node:fs";
import pg from "pg";

const file = process.argv[2];
if (!file) { console.error("Usage: node scripts/apply-sql.mjs <path-to-.sql>"); process.exit(1); }

function connString() {
  if (process.env.SUPABASE_DB_URL) return process.env.SUPABASE_DB_URL;
  const txt = readFileSync(new URL("../.claude/settings.local.json", import.meta.url), "utf8");
  const m = txt.match(/postgresql:\/\/[^"\\]+/);
  if (!m) throw new Error("No SUPABASE_DB_URL configured");
  return m[0];
}

const sql = readFileSync(file, "utf8");
const c = new pg.Client({ connectionString: connString(), ssl: { rejectUnauthorized: false } });
await c.connect();
await c.query(sql);
console.log(`Applied ${file}`);
await c.end();
