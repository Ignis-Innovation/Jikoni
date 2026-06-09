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

// Comprehensive table check for all modules
const checks = [
  // Users (should have real users)
  { name: "users", category: "Core" },
  
  // HR Module
  { name: "employee_profiles", category: "HR" },
  { name: "leave_applications", category: "HR" },
  { name: "leave_types", category: "HR" },
  { name: "leave_balances", category: "HR" },
  { name: "attendance", category: "HR" },
  { name: "timesheet_entries", category: "HR" },
  
  // Partner/CRM Module
  { name: "parties", category: "Partner/CRM" },
  { name: "partner_profiles", category: "Partner/CRM" },
  { name: "engagements", category: "Partner/CRM" },
  { name: "opportunities", category: "Partner/CRM" },
  { name: "action_items", category: "Partner/CRM" },
  { name: "engagement_updates", category: "Partner/CRM" },
  
  // Finance Module
  { name: "accounts", category: "Finance" },
  { name: "fiscal_periods", category: "Finance" },
  { name: "opening_balances", category: "Finance" },
  
  // Procurement
  { name: "requisitions", category: "Procurement" },
  { name: "purchase_orders", category: "Procurement" },
  { name: "payable_invoices", category: "Procurement" },
];

const results = {};
for (const check of checks) {
  try {
    const r = await c.query(`select count(*)::int as cnt from public.${check.name}`);
    const cnt = r.rows[0].cnt;
    const status = cnt === 0 ? "✓ clean" : `⚠ ${cnt} rows`;
    if (!results[check.category]) results[check.category] = [];
    results[check.category].push({ name: check.name, count: cnt, status });
  } catch (e) {
    if (!results[check.category]) results[check.category] = [];
    results[check.category].push({ name: check.name, count: -1, status: "✗ error" });
  }
}

// Print results grouped by category
for (const [category, tables] of Object.entries(results)) {
  console.log(`\n${category}:`);
  for (const t of tables) {
    console.log(`  ${t.name.padEnd(30)} ${t.status}`);
  }
}

await c.end();
