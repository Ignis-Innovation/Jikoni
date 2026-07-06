// Provision auth accounts for pending invites (Phase 5 flow: invite → email → set password).
// Run server-side (service role). Creates the auth user with a temp password and, when SMTP
// creds are in .env.local, emails the invitee; the Phase 0 trigger links auth_id and marks
// the invite accepted on first sign-in.
// Usage: node scripts/provision-invites.mjs
import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { randomBytes } from "node:crypto";
import { createClient } from "@supabase/supabase-js";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const env = Object.fromEntries(
  readFileSync(resolve(root, ".env.local"), "utf8").split("\n")
    .filter((l) => l.includes("=") && !l.startsWith("#"))
    .map((l) => [l.slice(0, l.indexOf("=")).trim(), l.slice(l.indexOf("=") + 1).trim()])
);

const admin = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });

const { data: invites, error } = await admin.from("invites").select("email, name, role_key").eq("state", "sent");
if (error) { console.error(error.message); process.exit(1); }
if (!invites.length) { console.log("No pending invites."); process.exit(0); }

for (const inv of invites) {
  const password = randomBytes(9).toString("base64url");
  const { error: e } = await admin.auth.admin.createUser({ email: inv.email, password, email_confirm: true });
  if (e) { console.log(inv.email, "—", e.message); continue; }
  console.log(`${inv.email} — auth account created (temp password: ${password})`);
  if (env.SMTP_HOST) {
    try {
      const { default: nodemailer } = await import("nodemailer");
      const t = nodemailer.createTransport({
        host: env.SMTP_HOST, port: +env.SMTP_PORT || 587, requireTLS: true,
        auth: { user: env.SMTP_USER, pass: env.SMTP_PASS },
      });
      await t.sendMail({
        from: env.SMTP_FROM || env.SMTP_USER,
        to: inv.email,
        subject: "You've been invited to Jikoni",
        text: `Hi ${inv.name},\n\nYou've been added to Jikoni (${inv.role_key} access).\nSign in at ${env.APP_URL || "the app"} with this temporary password and change it:\n\n${password}\n\n— Jikoni`,
      });
      console.log(`  → invite email sent to ${inv.email}`);
    } catch (mailErr) {
      console.log(`  → email not sent (${mailErr.message}); share the temp password manually`);
    }
  }
}
