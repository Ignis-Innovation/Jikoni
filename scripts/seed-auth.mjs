// Create Supabase Auth accounts for the team (Phase 0: login only).
// Reads SUPABASE_SERVICE_ROLE_KEY from .env.local — server-only, never in the app.
// Usage: node scripts/seed-auth.mjs [password]
import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { createClient } from "@supabase/supabase-js";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const env = Object.fromEntries(
  readFileSync(resolve(root, ".env.local"), "utf8").split("\n")
    .filter((l) => l.includes("=") && !l.startsWith("#"))
    .map((l) => [l.slice(0, l.indexOf("=")).trim(), l.slice(l.indexOf("=") + 1).trim()])
);

const url = env.NEXT_PUBLIC_SUPABASE_URL;
const admin = createClient(url, env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });
const password = process.argv[2] || "Jikoni-2026!";

const team = [
  "dennis@ignis.africa", "brian@ignis.africa", "joan@ignis.africa",
  "wilson@ignis.africa", "elizabeth@ignis.africa", "wanjiku@ignis.africa", "lily@ignis.africa",
];

for (const email of team) {
  const { error } = await admin.auth.admin.createUser({ email, password, email_confirm: true });
  console.log(email, error ? "— " + error.message : "— created");
}
