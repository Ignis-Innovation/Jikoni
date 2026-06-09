// Quick DB sanity check: prints counts of key tables
import { readFileSync } from "node:fs";
import pg from "pg";

function connString() {
  if (process.env.SUPABASE_DB_URL) return process.env.SUPABASE_DB_URL;
  try {
    const txt = readFileSync(new URL("../.claude/settings.local.json", import.meta.url), "utf8");
    const m = txt.match(/postgresql:\/\/[^"\\\s]+/);
    if (m) return m[0];
  } catch (e) {}
  throw new Error('No SUPABASE_DB_URL configured');
}

const c = new pg.Client({ connectionString: connString(), ssl: { rejectUnauthorized: false } });
await c.connect();
const q = async (s) => (await c.query(s)).rows[0].cnt;
const tables = [
  "users",
  "parties",
  "assets",
  "projects",
  "engagements",
  "requisitions",
];
for (const t of tables) {
  try {
    const r = await c.query(`select count(*)::int as cnt from public.${t}`);
    console.log(`${t}: ${r.rows[0].cnt}`);
  } catch (e) {
    console.log(`${t}: (error) ${e.message}`);
  }
}
await c.end();
