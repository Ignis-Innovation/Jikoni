// One-off, idempotent admin script for the Sales CRM module (migration 0035).
// Creates the sales_rep + inventory_clerk roles and grants module permissions,
// and extends the existing sales_manager role to act as the Sales Lead.
// Uses the service-role key (server-only, bypasses RLS). Safe to re-run.
//   node scripts/apply-sales-roles.mjs
import { readFileSync } from "node:fs";
import { createClient } from "@supabase/supabase-js";

const env = {};
for (const file of [".env", ".env.local"]) {
  let text;
  try { text = readFileSync(new URL("../" + file, import.meta.url), "utf8"); } catch { continue; }
  for (const l of text.split("\n")) {
    if (!l || l.trimStart().startsWith("#") || !l.includes("=")) continue;
    const i = l.indexOf("=");
    env[l.slice(0, i).trim()] = l.slice(i + 1).trim().replace(/^["']|["']$/g, "");
  }
}

const url = env.VITE_SUPABASE_URL || env.NEXT_PUBLIC_SUPABASE_URL;
const key = env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !key) throw new Error("Missing SUPABASE url or service role key in .env");

const db = createClient(url, key, { auth: { persistSession: false } });

// role key -> { def, grants: [{module, actions}] }
const ROLES = {
  sales_rep: {
    def: { key: "sales_rep", name: "Sales Rep", description: "Accounts, place order, invoices, own targets", is_system: true },
    grants: [
      { module: "sales", actions: ["view", "create", "edit"] },
      { module: "revenue", actions: ["view", "create"] },
      { module: "parties", actions: ["view", "create"] },
    ],
  },
  inventory_clerk: {
    def: { key: "inventory_clerk", name: "Inventory Clerk", description: "Products & stock", is_system: true },
    grants: [
      // 'create' is needed to write inventory_movements rows on restock.
      { module: "sales", actions: ["view", "create", "edit"] },
      { module: "refdata", actions: ["view"] },
    ],
  },
  // Reuse the existing sales_manager (0029) as the Sales Lead: full sales + revenue.
  sales_manager: {
    def: { key: "sales_manager", name: "Sales Manager", description: "Revenue, CRM, sales lead", is_system: true },
    grants: [
      { module: "sales", actions: ["view", "create", "edit", "delete"] },
      { module: "revenue", actions: ["view", "create", "edit"] },
    ],
  },
};

for (const { def, grants } of Object.values(ROLES)) {
  const { error: roleErr } = await db.from("roles").upsert(def, { onConflict: "key" });
  if (roleErr) throw roleErr;

  const { data: role, error: getRoleErr } = await db
    .from("roles").select("id").eq("key", def.key).single();
  if (getRoleErr) throw getRoleErr;

  const modules = grants.map((g) => g.module);
  const { data: perms, error: permErr } = await db
    .from("permissions").select("id, key, module, action").in("module", modules);
  if (permErr) throw permErr;

  const wanted = perms.filter((p) =>
    grants.some((g) => g.module === p.module && g.actions.includes(p.action))
  );
  const rows = wanted.map((p) => ({ role_id: role.id, permission_id: p.id }));
  if (rows.length) {
    const { error: grantErr } = await db
      .from("role_permissions")
      .upsert(rows, { onConflict: "role_id,permission_id", ignoreDuplicates: true });
    if (grantErr) throw grantErr;
  }

  console.log(`${def.key} (${role.id}) → ${rows.length} permissions:`);
  console.log("  " + wanted.map((p) => p.key).sort().join("\n  "));
}
