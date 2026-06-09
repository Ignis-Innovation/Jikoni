// Emails team members when a task has been assigned to them (assigned_by set).
// Usage: node scripts/send-task-assignments.mjs
// Picks up tasks with notified_at = null, mails the assignee a "you've been
// assigned a task" note with a link to their Tasks board, then stamps
// notified_at so each task is mailed exactly once. Intended for a short cron.
// If SMTP_* env vars are missing it runs in DRY-RUN mode: it logs what it would
// send instead of sending — the "set it up now, wire real SMTP later" state.
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

function connString() {
  if (env.SUPABASE_DB_URL) return env.SUPABASE_DB_URL;
  const txt = readFileSync(new URL("../.claude/settings.local.json", import.meta.url), "utf8");
  const m = txt.match(/postgresql:\/\/[^"\\]+/);
  if (!m) throw new Error("No SUPABASE_DB_URL configured");
  return m[0];
}

const appUrl = (env.APP_URL || "https://app.jikoni.app").replace(/\/+$/, "");
const link = `${appUrl}/tasks`;

const c = new pg.Client({ connectionString: connString(), ssl: { rejectUnauthorized: false } });
await c.connect();

// Assigned (assigned_by set, and to someone other than the assigner) and not yet mailed.
const pending = (await c.query(
  `select t.id, t.title, t.description, t.due_date,
          u.full_name as assignee_name, u.email as assignee_email,
          a.full_name as assigner_name
   from public.tasks t
   join public.users u on u.id = t.assignee_id
   left join public.users a on a.id = t.assigned_by
   where t.notified_at is null
     and t.assigned_by is not null
     and t.assignee_id <> t.assigned_by
     and t.deleted_at is null
     and u.email is not null and u.email <> ''
   order by t.created_at`
)).rows;

if (pending.length === 0) {
  console.log("No task assignments awaiting notification.");
  await c.end();
  process.exit(0);
}

const subject = (t) => `You've been assigned a task: ${t.title}`;
const body = (t) => {
  const who = t.assigner_name ? ` by ${t.assigner_name}` : "";
  const due = t.due_date ? `\nDue: ${t.due_date}` : "";
  const desc = t.description ? `\n\n${t.description}` : "";
  return `Hi ${t.assignee_name || "there"},\n\nYou have been assigned a task${who}: "${t.title}".${due}${desc}\n\nOpen it here: ${link}\n\n— The Jikoni Team`;
};

const smtpReady = env.SMTP_HOST && env.SMTP_USER && env.SMTP_PASS;

if (!smtpReady) {
  console.log(`DRY-RUN — SMTP not configured. Would notify ${pending.length} assignee(s):`);
  for (const t of pending) console.log(`  • ${t.assignee_name} <${t.assignee_email}> — "${t.title}"`);
  console.log(`\n--- message preview ---\n${subject(pending[0])}\n\n${body(pending[0])}`);
  // Do NOT stamp notified_at in dry-run, so the real send still goes out later.
  await c.end();
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
for (const t of pending) {
  try {
    await transporter.sendMail({ from, to: t.assignee_email, subject: subject(t), text: body(t) });
    await c.query(`update public.tasks set notified_at = now() where id = $1`, [t.id]);
    sent++;
  } catch (e) {
    console.error(`  ! failed for ${t.assignee_email}: ${e.message}`);
  }
}
console.log(`Task assignments: sent ${sent}/${pending.length} notification(s).`);
await c.end();
