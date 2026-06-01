// Apply SQL migrations in order to the Supabase Postgres database.
// Usage: SUPABASE_DB_URL="postgresql://postgres.<ref>:<pw>@aws-0-<region>.pooler.supabase.com:5432/postgres" \
//        node scripts/migrate.mjs
// (Get the pooler connection string from Supabase → Settings → Database.)
import pg from 'pg';
import { readFileSync, readdirSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const cs = process.env.SUPABASE_DB_URL;
if (!cs) { console.error('Set SUPABASE_DB_URL'); process.exit(1); }

const here = dirname(fileURLToPath(import.meta.url));
const dir = join(here, '..', 'supabase', 'migrations');
const files = readdirSync(dir).filter(f => /^\d+_.*\.sql$/.test(f)).sort();

const c = new pg.Client({ connectionString: cs, ssl: { rejectUnauthorized: false } });
await c.connect();
for (const f of files) {
  try {
    await c.query('begin');
    await c.query(readFileSync(join(dir, f), 'utf8'));
    await c.query('commit');
    console.log('✓', f);
  } catch (e) {
    await c.query('rollback');
    console.error('✗', f, '->', e.message);
    process.exitCode = 1;
    break;
  }
}
await c.end();
