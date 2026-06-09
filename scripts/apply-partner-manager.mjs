// One-off, idempotent admin script: create the partner_manager role and grant
// it parties/crm/procurement (view/create/edit) on the live DB. Uses the
// service-role key (server-only, bypasses RLS). Safe to re-run.
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

// 1. Upsert the role.
const { error: roleErr } = await db
  .from("roles")
  .upsert(
    {
      key: "partner_manager",
      name: "Partner Manager",
      description: "Partners/parties, CRM pipeline, procurement",
      is_system: true,
    },
    { onConflict: "key" }
  );
if (roleErr) throw roleErr;

const { data: role, error: getRoleErr } = await db
  .from("roles")
  .select("id")
  .eq("key", "partner_manager")
  .single();
if (getRoleErr) throw getRoleErr;

// 2. Find the permissions to grant.
const { data: perms, error: permErr } = await db
  .from("permissions")
  .select("id, key")
  .in("module", ["parties", "crm", "procurement"])
  .in("action", ["view", "create", "edit"]);
if (permErr) throw permErr;

// 3. Grant them (ignore rows that already exist).
const rows = perms.map((p) => ({ role_id: role.id, permission_id: p.id }));
const { error: grantErr } = await db
  .from("role_permissions")
  .upsert(rows, { onConflict: "role_id,permission_id", ignoreDuplicates: true });
if (grantErr) throw grantErr;

console.log(`partner_manager (${role.id}) granted ${rows.length} permissions:`);
console.log("  " + perms.map((p) => p.key).sort().join("\n  "));
