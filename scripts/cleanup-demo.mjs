// Cleanup demo/fake data previously seeded by scripts/seed-demo.mjs
// Usage: SUPABASE_DB_URL="postgresql://..." node scripts/cleanup-demo.mjs
import { readFileSync } from "node:fs";
import pg from "pg";

function connString() {
  if (process.env.SUPABASE_DB_URL) return process.env.SUPABASE_DB_URL;
  try {
    const txt = readFileSync(new URL("../.claude/settings.local.json", import.meta.url), "utf8");
    const m = txt.match(/postgresql:\/\/[^"\\\s]+/);
    if (m) return m[0];
  } catch (e) {
    // ignore
  }
  return null;
}

const cs = connString();
if (!cs) { console.error("Set SUPABASE_DB_URL or add it to .claude/settings.local.json"); process.exit(1); }
const c = new pg.Client({ connectionString: cs, ssl: { rejectUnauthorized: false } });
await c.connect();

const CLEAN = [
  "payments", "payment_runs", "grn_lines", "grns", "po_lines", "purchase_orders",
  "payable_invoice_lines", "payable_invoices", "requisition_lines", "requisitions",
  "petty_cash_vouchers", "petty_cash_replenishments", "petty_cash_floats", "expense_receipts",
  "approval_actions", "approval_requests",
  "engagement_updates", "action_items", "engagements", "opportunities", "partner_profiles",
  "eois", "institution_pipeline", "concepts", "capability_snapshots",
  "dunning_log", "customer_receipts", "credit_notes", "receivable_invoice_lines", "receivable_invoices",
  "so_milestones", "sales_orders", "quotation_lines", "quotations", "customer_profiles",
  "deployments", "asset_events", "maintenance_schedules", "work_orders", "stock_movements", "stock_levels", "stock_items", "assets",
  "contracts", "risks", "compliance_obligations", "policy_versions", "policies",
  "board_meetings", "resolutions", "board_members", "shareholding", "dataroom_shares",
  "impact_metrics", "kpi_values", "kpis", "alert_rules",
  "leave_applications", "leave_balances", "leave_types", "timesheet_entries", "attendance",
  "pay_components", "salary_structures", "hr_payroll_runs", "objectives", "performance_reviews",
  "one_on_ones", "hr_checklist_runs", "hr_checklists", "next_of_kin", "employee_profiles",
  "vendor_ratings", "vendor_profiles",
  "ticket_comments", "support_tickets",
  "party_bank_details", "party_contacts", "party_types", "parties",
  "project_team", "project_budgets", "milestones", "funder_reports", "drawdowns", "grants", "field_activities", "project_details",
  "cost_centers", "projects", "locations", "departments", "institutions",
];

console.log("Cleaning demo data — this will DELETE rows from many demo tables but WILL NOT touch the users table.");
console.log("If you want a dry-run first, set DRY_RUN=1 in the environment.");

const dry = !!process.env.DRY_RUN;

try {
  await c.query("set session_replication_role = 'replica'");
  for (const t of CLEAN) {
    try {
      if (dry) {
        const r = await c.query(`select count(*)::int as cnt from public.${t}`);
        console.log(`[DRY] ${t}: ${r.rows[0].cnt} rows`);
      } else {
        const res = await c.query(`delete from public.${t}`);
        console.log(`Deleted ${res.rowCount ?? 'unknown'} rows from ${t}`);
      }
    } catch (e) {
      console.warn(`skip ${t}:`, e.message);
    }
  }
} finally {
  try { await c.query("set session_replication_role = 'origin'"); } catch {}
  await c.end();
}

console.log("Cleanup complete. Verify your database state before continuing.");
