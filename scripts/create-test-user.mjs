// Creates/repairs a test login with a given role. Idempotent.
// Usage: node scripts/create-test-user.mjs <email> <password> <role_key> [full_name]
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

const [EMAIL, PASSWORD, ROLE, FULL_NAME] = [process.argv[2], process.argv[3], process.argv[4], process.argv[5]];
if (!EMAIL || !PASSWORD || !ROLE) { console.error("Usage: node scripts/create-test-user.mjs <email> <password> <role_key> [full_name]"); process.exit(1); }
const name = FULL_NAME || `Test ${ROLE}`;

const db = createClient(url, key, { auth: { persistSession: false } });

let userId;
const { data: created, error } = await db.auth.admin.createUser({
  email: EMAIL, password: PASSWORD, email_confirm: true, user_metadata: { full_name: name },
});
if (error) {
  if (/registered|exists/i.test(error.message)) {
    const { data: existing } = await db.from("users").select("id").eq("email", EMAIL).single();
    userId = existing?.id;
    if (userId) await db.auth.admin.updateUserById(userId, { password: PASSWORD, email_confirm: true });
  } else throw error;
} else userId = created.user?.id;
if (!userId) throw new Error("Could not resolve user id");

await db.from("users").update({ full_name: name, status: "active" }).eq("id", userId);
const { data: role } = await db.from("roles").select("id").eq("key", ROLE).single();
if (!role) throw new Error(`role ${ROLE} not found`);
await db.from("user_roles").upsert({ user_id: userId, role_id: role.id }, { onConflict: "user_id,role_id" });

console.log(`Test ${ROLE} ready: ${EMAIL} / ${PASSWORD} (id ${userId})`);
