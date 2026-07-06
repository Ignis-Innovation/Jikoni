// Apply a single SQL file to the hosted Supabase DB.
// Usage: node scripts/apply-sql.mjs supabase/migrations/NNNN_*.sql
// Resolves SUPABASE_DB_URL from .claude/settings.local.json so the password
// never appears on the command line or in output.
import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");

function dbUrl() {
  const raw = readFileSync(resolve(root, ".claude/settings.local.json"), "utf8");
  const m = raw.match(/postgres(?:ql)?:\/\/[^"'\\\s]+/);
  if (!m) throw new Error("SUPABASE_DB_URL not found in .claude/settings.local.json");
  return m[0];
}

const file = process.argv[2];
if (!file) {
  console.error("Usage: node scripts/apply-sql.mjs <path-to-sql-file>");
  process.exit(1);
}

const sql = readFileSync(resolve(root, file), "utf8");
const client = new pg.Client({ connectionString: dbUrl(), ssl: { rejectUnauthorized: false } });

try {
  await client.connect();
  await client.query(sql);
  console.log("Applied:", file);
} catch (e) {
  console.error("FAILED:", e.message, e.position ? "(position " + e.position + ")" : "");
  process.exitCode = 1;
} finally {
  await client.end();
}
