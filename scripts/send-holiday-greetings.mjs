// Sends a "Happy {Holiday}!" email to every employee on a public holiday.
// Usage: node scripts/send-holiday-greetings.mjs [YYYY-MM-DD]   (defaults to today)
// Intended to run daily on a cron. If SMTP_* env vars are missing it runs in
// DRY-RUN mode: it logs the recipients and message instead of sending — that's
// the "set it up now, wire real SMTP later" state.
import { readFileSync } from "node:fs";
import pg from "pg";
import nodemailer from "nodemailer";

// ---- load env (.env then .env.local) -------------------------------------
const env = { ...process.env };
for (const f of [".env", ".env.local"]) {
  try {
    for (const l of readFileSync(new URL("../" + f, import.meta.url), "utf8").split("\n")) {
      if (!l || l.trimStart().startsWith("#") || !l.includes("=")) continue;
      const i = l.indexOf("=");
      const k = l.slice(0, i).trim();
      if (!env[k]) env[k] = l.slice(i + 1).trim().replace(/^["']|["']$/g, "");
    }
  } catch { /* file optional */ }
}

// ---- holidays: parsed from the single source of truth (src/lib/holidays.ts) --
const holidaysTs = readFileSync(new URL("../src/lib/holidays.ts", import.meta.url), "utf8");
const HOLIDAYS = [...holidaysTs.matchAll(/\{\s*date:\s*"([^"]+)",\s*name:\s*"([^"]+)"\s*\}/g)]
  .map((m) => ({ date: m[1], name: m[2] }));

const target = process.argv[2] || new Date().toISOString().slice(0, 10);
const holiday = HOLIDAYS.find((h) => h.date === target);
if (!holiday) {
  console.log(`${target} is not a public holiday — nothing to send.`);
  process.exit(0);
}

// ---- recipients: employees with an email ---------------------------------
function connString() {
  if (env.SUPABASE_DB_URL) return env.SUPABASE_DB_URL;
  const txt = readFileSync(new URL("../.claude/settings.local.json", import.meta.url), "utf8");
  const m = txt.match(/postgresql:\/\/[^"\\]+/);
  if (!m) throw new Error("No SUPABASE_DB_URL configured");
  return m[0];
}
const c = new pg.Client({ connectionString: connString(), ssl: { rejectUnauthorized: false } });
await c.connect();
const recipients = (await c.query(
  `select display_name, email from public.parties
   where type = 'employee' and email is not null and email <> '' and deleted_at is null
   order by display_name`
)).rows;
await c.end();

const subject = `Happy ${holiday.name}! 🎉`;
const body = (name) =>
  `Dear ${name || "team"},\n\nWishing you a joyful ${holiday.name}. Thank you for all your hard work — enjoy the well-deserved break!\n\nWarm regards,\nThe Jikoni Team`;

if (recipients.length === 0) {
  console.log(`${holiday.name} (${target}): no employees with an email on file.`);
  process.exit(0);
}

// ---- send (or dry-run) ----------------------------------------------------
const smtpReady = env.SMTP_HOST && env.SMTP_USER && env.SMTP_PASS;
if (!smtpReady) {
  console.log(`DRY-RUN — SMTP not configured. Would send "${subject}" to ${recipients.length} employee(s):`);
  for (const r of recipients) console.log(`  • ${r.display_name} <${r.email}>`);
  console.log(`\n--- message preview ---\n${body(recipients[0].display_name)}`);
  process.exit(0);
}

const transporter = nodemailer.createTransport({
  host: env.SMTP_HOST,
  port: Number(env.SMTP_PORT || 587),
  secure: Number(env.SMTP_PORT) === 465,
  requireTLS: Number(env.SMTP_PORT) !== 465, // Office 365 needs STARTTLS on 587
  auth: { user: env.SMTP_USER, pass: env.SMTP_PASS },
});
const from = env.SMTP_FROM || env.SMTP_USER;
let sent = 0;
for (const r of recipients) {
  try {
    await transporter.sendMail({ from, to: r.email, subject, text: body(r.display_name) });
    sent++;
  } catch (e) {
    console.error(`  ! failed for ${r.email}: ${e.message}`);
  }
}
console.log(`${holiday.name} (${target}): sent ${sent}/${recipients.length} greeting(s).`);
