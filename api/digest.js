// Vercel serverless: the email digest. Two modes —
//   * cron  : ?secret=CRON_SECRET (or x-cron-secret header) → every active user who has
//             the Email digest turned on, emailed a summary. Wired to a weekly Vercel cron.
//   * me    : ?me=1 with a signed-in bearer → just the caller (the "Send me a digest now" button).
// Summary = your open tasks, unseen notifications, and approvals waiting. Sends via Gmail SMTP.
//
// Requires: NEXT_PUBLIC_SUPABASE_URL, NEXT_PUBLIC_SUPABASE_ANON_KEY, SUPABASE_SERVICE_ROLE_KEY,
//   SMTP_HOST/PORT/USER/PASS/FROM, CRON_SECRET
import { createClient } from "@supabase/supabase-js";
import nodemailer from "nodemailer";

const kes = (n) => "KES " + Number(n || 0).toLocaleString();

function compose(u, tasks, notifs, reqs) {
  const doneCount = (t) => (t.subtasks || []).filter((s) => s.done).length;
  const taskLines = tasks.map((t) => `• ${t.title} (${t.due_label}${t.subtasks?.length ? ` · ${doneCount(t)}/${t.subtasks.length}` : ""})`);
  const reqLines = reqs.map((r) => `• ${r.ref} — ${r.item} · ${kes(r.amount)}`);
  const notifLines = notifs.map((n) => `• ${n.title}`);
  const section = (title, lines, empty) => `${title}\n${lines.length ? lines.join("\n") : "  " + empty}\n`;
  const text =
    `Hi ${u.name},\n\nHere's your Jikoni digest.\n\n` +
    section(`OPEN TASKS (${tasks.length})`, taskLines, "Nothing open — nice.") + "\n" +
    section(`APPROVALS WAITING (${reqs.length})`, reqLines, "None waiting.") + "\n" +
    section(`UNREAD NOTIFICATIONS (${notifs.length})`, notifLines, "All caught up.") +
    `\nOpen Jikoni Tool to act on these.\n— Ignis Innovation`;
  const ul = (lines, empty) => lines.length ? `<ul>${lines.map((l) => `<li>${l.replace(/^• /, "")}</li>`).join("")}</ul>` : `<p style="color:#74695D">${empty}</p>`;
  const html =
    `<p>Hi ${u.name},</p><p>Here's your <strong>Jikoni</strong> digest.</p>` +
    `<h3>Open tasks (${tasks.length})</h3>${ul(taskLines, "Nothing open — nice.")}` +
    `<h3>Approvals waiting (${reqs.length})</h3>${ul(reqLines, "None waiting.")}` +
    `<h3>Unread notifications (${notifs.length})</h3>${ul(notifLines, "All caught up.")}` +
    `<p>Open <strong>Jikoni Tool</strong> to act on these.</p><p>— Ignis Innovation</p>`;
  return { text, html };
}

export default async function handler(req, res) {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  const svc = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !svc) return res.status(500).json({ error: "Server not configured" });
  const admin = createClient(url, svc, { auth: { persistSession: false } });

  let recipients = [];
  if (req.query.me) {
    const token = (req.headers.authorization || "").replace(/^Bearer\s+/i, "");
    if (!token) return res.status(401).json({ error: "Not signed in" });
    const caller = createClient(url, anon, { auth: { persistSession: false } });
    const { data: who } = await caller.auth.getUser(token);
    if (!who?.user?.email) return res.status(401).json({ error: "Invalid session" });
    const { data: u } = await admin.from("app_users").select("id,name,email").eq("email", who.user.email).maybeSingle();
    if (u) recipients = [u];
  } else {
    // Vercel Cron sends `Authorization: Bearer <CRON_SECRET>` when CRON_SECRET is set;
    // also accept an explicit header/query for manual triggering.
    const bearer = (req.headers.authorization || "").replace(/^Bearer\s+/i, "");
    const secret = req.headers["x-cron-secret"] || req.query.secret || bearer;
    if (!process.env.CRON_SECRET || secret !== process.env.CRON_SECRET) return res.status(401).json({ error: "Unauthorized" });
    const { data: cfg } = await admin.from("app_config").select("value").eq("key", "notif_email_digest").maybeSingle();
    const on = cfg?.value === true || cfg?.value === "true";
    if (!on) return res.status(200).json({ ok: true, sent: 0, note: "Email digest is turned off" });
    const { data: us } = await admin.from("app_users").select("id,name,email").eq("state", "active");
    recipients = us || [];
  }

  if (!process.env.SMTP_HOST) return res.status(500).json({ error: "SMTP not configured" });
  const transport = nodemailer.createTransport({
    host: process.env.SMTP_HOST, port: Number(process.env.SMTP_PORT) || 587, requireTLS: true,
    auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS },
  });

  let sent = 0;
  for (const u of recipients) {
    const [{ data: tasks }, { data: notifs }, { data: reqs }] = await Promise.all([
      admin.from("tasks").select("ref,title,due_label,subtasks").eq("owner_id", u.id).eq("state", "open").order("created_at", { ascending: false }).limit(25),
      admin.from("notifications").select("title,created_at").eq("recipient_email", (u.email || "").toLowerCase()).eq("seen", false).order("created_at", { ascending: false }).limit(25),
      admin.from("requisitions").select("ref,item,amount,state").in("state", ["submitted", "md_review"]).order("created_at", { ascending: false }).limit(25),
    ]);
    const { text, html } = compose(u, tasks || [], notifs || [], reqs || []);
    try {
      await transport.sendMail({ from: process.env.SMTP_FROM || process.env.SMTP_USER, to: u.email, subject: "Your Jikoni digest", text, html });
      sent++;
    } catch { /* skip a single failure, keep going */ }
  }
  return res.status(200).json({ ok: true, sent });
}
