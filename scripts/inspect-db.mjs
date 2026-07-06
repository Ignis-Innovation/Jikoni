// List public tables with row counts, plus auth user count — read-only survey.
import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const raw = readFileSync(resolve(root, ".claude/settings.local.json"), "utf8");
const url = raw.match(/postgres(?:ql)?:\/\/[^"'\\\s]+/)[0];
const client = new pg.Client({ connectionString: url, ssl: { rejectUnauthorized: false } });
await client.connect();

const t = await client.query(`
  select relname as table, n_live_tup as est_rows
  from pg_stat_user_tables where schemaname='public' order by relname`);
console.log("PUBLIC TABLES (" + t.rows.length + "):");
for (const r of t.rows) console.log(`  ${r.table}  ~${r.est_rows}`);

const f = await client.query(`
  select p.proname from pg_proc p join pg_namespace n on n.oid=p.pronamespace
  where n.nspname='public' order by 1`);
console.log("PUBLIC FUNCTIONS (" + f.rows.length + "):", f.rows.map(r => r.proname).join(", "));

const u = await client.query(`select count(*) c, max(created_at) latest from auth.users`);
console.log("AUTH USERS:", u.rows[0].c, "latest:", u.rows[0].latest);

await client.end();
