// Read-only preview of what migration 0055 would delete. Prints the actual rows
// matched by each pattern so you can verify before applying. Changes nothing.
// Usage:  node scripts/preview-cleanup-0055.mjs
import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const url = readFileSync(resolve(root, ".claude/settings.local.json"), "utf8")
  .match(/postgres(?:ql)?:\/\/[^"'\\\s]+/)[0];
const c = new pg.Client({ connectionString: url, ssl: { rejectUnauthorized: false } });
await c.connect();

const show = async (label, sql) => {
  try {
    const r = await c.query(sql);
    console.log(`\n=== ${label} (${r.rows.length}) ===`);
    for (const row of r.rows) console.log("  " + JSON.stringify(row));
  } catch (e) { console.log(`\n=== ${label} ERROR: ${e.message}`); }
};

// (a) the four pending users
await show("USERS to delete", `select email, name, state, role_key from public.app_users
  where lower(email) = any(array['bmwangi@ignis-innovation.com','eooro@ignis-innovation.com','wmungai@ignis-innovation.com','dnderitu@ignis-innovation.com'])`);

// (b) Kimani across finance & procurement
await show("Kimani vendors", `select name, country from public.vendors where name ilike '%kimani%'`);
await show("Kimani requisitions", `select ref, item, amount, state from public.requisitions where item ilike '%kimani%'`);
await show("Kimani purchase_orders", `select ref, vendor_name, amount, state from public.purchase_orders where vendor_name ilike '%kimani%'`);
await show("Kimani sales_invoices", `select ref, customer, description, total from public.sales_invoices where customer ilike '%kimani%' or description ilike '%kimani%'`);
await show("Kimani journal_entries", `select ref, memo from public.journal_entries where memo ilike '%kimani%'`);
await show("Kimani petty_cash", `select ref, item, requester_name, amount from public.petty_cash_requests where item ilike '%kimani%' or requester_name ilike '%kimani%'`);

// (c) testing item petty cash
await show("'Testing item' petty cash", `select ref, item, requester_name, amount, state from public.petty_cash_requests where lower(item) like '%testing item%'`);

// (d) all CRM
await show("CRM partners (ALL deleted)", `select name, type, owner_name, status from public.partners`);
await show("CRM opportunities (ALL deleted)", `select name, type, status from public.opportunities`);
await show("CRM engagements (ALL deleted)", `select ref, name, pipeline from public.engagements`);

// (e) inventory test items
await show("Inventory test items", `select sku, name, reorder_level, auto_req_ref from public.stock_items where sku in ('SKU-101','SKU-102') or name ~* '^test\\M'`);

await c.end();
console.log("\n(Preview only — nothing was changed.)");
