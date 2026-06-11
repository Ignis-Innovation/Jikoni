// Creates (or repairs) a test Sales Manager login on the live DB and assigns the
// sales_manager role. Uses the service-role key (admin API), email pre-confirmed
// so it's immediately usable. Idempotent. Mirrors create-test-pm.mjs.
//   node scripts/create-test-sales.mjs [email] [password]
import { readFileSync } from "node:fs";
import { createClient } from "@supabase/supabase-js";

const env = {};
for (const f of [".env", ".env.local"]) {
  try {
    for (const l of readFileSync(new URL("../" + f, import.meta.url), "utf8").split("\n")) {
      if (!l || l.trimStart().startsWith("#") || !l.includes("=")) continue;
      const i = l.indexOf("=");
      env[l.slice(0, i).trim()] = l.slice(i + 1).trim().replace(/^["']|["']$/g, "");
    }
  } catch { /* optional */ }
}

const url = env.VITE_SUPABASE_URL || env.NEXT_PUBLIC_SUPABASE_URL;
const key = env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !key) throw new Error("Missing Supabase URL or service role key");

const EMAIL = process.argv[2] || "sales@jikoni.app";
const PASSWORD = process.argv[3] || "Sales@2026!";
const FULL_NAME = "Test Sales Manager";
const ROLE_KEY = "sales_manager";

const db = createClient(url, key, { auth: { persistSession: false } });

let userId;
const { data: created, error } = await db.auth.admin.createUser({
  email: EMAIL, password: PASSWORD, email_confirm: true, user_metadata: { full_name: FULL_NAME },
});
if (error) {
  if (/registered|exists/i.test(error.message)) {
    const { data: existing } = await db.from("users").select("id").eq("email", EMAIL).single();
    userId = existing?.id;
    if (userId) await db.auth.admin.updateUserById(userId, { password: PASSWORD, email_confirm: true });
  } else {
    throw error;
  }
} else {
  userId = created.user?.id;
}
if (!userId) throw new Error("Could not resolve the user id");

await db.from("users").update({ full_name: FULL_NAME, status: "active" }).eq("id", userId);

const { data: role } = await db.from("roles").select("id").eq("key", ROLE_KEY).single();
if (!role) throw new Error(`${ROLE_KEY} role not found — run scripts/apply-sales-roles.mjs first`);
await db.from("user_roles").upsert({ user_id: userId, role_id: role.id }, { onConflict: "user_id,role_id" });

console.log("Test Sales Manager ready:");
console.log("  email:    " + EMAIL);
console.log("  password: " + PASSWORD);
console.log("  user id:  " + userId);
