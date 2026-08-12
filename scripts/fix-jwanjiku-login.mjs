// Diagnose + fix the jwanjiku login. The login error is auth-level, so we use the
// Supabase Admin API (which a raw SQL email update can't do): rename the auth
// email properly, confirm it, clear any exit-flow ban, and set the password. Then
// sync the app_users/permissions email so the app finds the user after sign-in.
// Idempotent — safe to re-run.
// Usage: node scripts/fix-jwanjiku-login.mjs [password]
import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { createClient } from "@supabase/supabase-js";
import pg from "pg";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const OLD = "wanjiku@ignis.africa";
const NEW = "jwanjiku@ignis-innovation.com";
const PASSWORD = process.argv[2] || "Jikoni-2026!";

const env = Object.fromEntries(
  readFileSync(resolve(root, ".env.local"), "utf8").split("\n")
    .filter((l) => l.includes("=") && !l.startsWith("#"))
    .map((l) => [l.slice(0, l.indexOf("=")).trim(), l.slice(l.indexOf("=") + 1).trim()])
);
const admin = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });

const dbUrl = readFileSync(resolve(root, ".claude/settings.local.json"), "utf8").match(/postgres(?:ql)?:\/\/[^"'\\\s]+/)[0];
const c = new pg.Client({ connectionString: dbUrl, ssl: { rejectUnauthorized: false } });
await c.connect();

// 1) find the person by either email in app_users → get their auth_id
const row = (await c.query(
  `select id, auth_id, email, status, state from public.app_users where lower(email) in ($1,$2) limit 1`,
  [OLD, NEW])).rows[0];

if (!row) {
  console.log(`No app_users row for ${OLD} or ${NEW}. Nothing to fix here — the account may have been deleted.`);
  await c.end();
  process.exit(0);
}
console.log("app_users:", JSON.stringify(row));

// 2) inspect the auth account
if (row.auth_id) {
  const { data: got } = await admin.auth.admin.getUserById(row.auth_id);
  const u = got?.user;
  console.log("auth BEFORE:", u ? JSON.stringify({ email: u.email, confirmed: u.email_confirmed_at, banned_until: u.banned_until }) : "(no auth user for this auth_id)");
}

// 3) fix auth: rename email, confirm it, clear any ban, set the password
if (row.auth_id) {
  const { data: fixed, error } = await admin.auth.admin.updateUserById(row.auth_id, {
    email: NEW, email_confirm: true, ban_duration: "none", password: PASSWORD,
  });
  if (error) console.log("auth update ERROR:", error.message);
  else console.log("auth AFTER:", JSON.stringify({ email: fixed.user.email, confirmed: fixed.user.email_confirmed_at, banned_until: fixed.user.banned_until }));
} else {
  // no auth account at all → create one, confirmed, with the password
  const { data: created, error } = await admin.auth.admin.createUser({ email: NEW, password: PASSWORD, email_confirm: true });
  if (error) console.log("auth create ERROR:", error.message);
  else console.log("auth CREATED:", created.user.email, "— linking to app_users on next sign-in");
}

// 4) sync the app-side email everywhere it is stored, and un-suspend the member
await c.query(`update public.app_users set email=$1, status=case when status='off' then 'on' else status end, state='active' where lower(email)=$2`, [NEW, OLD]);
await c.query(`update public.user_permissions set email=$1 where email=$2`, [NEW, OLD]);
await c.query(`update public.invites set email=$1 where email=$2`, [NEW, OLD]);
await c.query(`update public.notifications set recipient_email=$1 where recipient_email=$2`, [NEW, OLD]);

const after = (await c.query(`select email, status, state, auth_id from public.app_users where lower(email)=$1`, [NEW])).rows[0];
console.log("app_users AFTER:", JSON.stringify(after));
await c.end();
console.log(`\nDone. Log in with ${NEW} / ${PASSWORD}`);
