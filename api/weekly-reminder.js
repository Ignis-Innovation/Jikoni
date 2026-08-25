// Vercel serverless: the Thursday weekly-report reminder.
//   * cron    : Authorization: Bearer <CRON_SECRET> (or ?secret / x-cron-secret) → every active
//               user who has NOT submitted a weekly report for the current week is emailed AND
//               gets an in-app bell notification. People who already submitted get nothing.
//   * ?dry=1  : compute + return the recipient list (masked count) WITHOUT sending or belling.
//   * ?test=<email> : send ONE reminder to that address only (SMTP path check) — no bells,
//               no broad send. For verifying the wiring without nudging real staff.
// Wired to a Thursday-morning Vercel cron (see vercel.json) — submissions are due Thursday 5pm,
// so this is the same-day "please submit today" nudge.
//
// Requires: NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY,
//   SMTP_HOST/PORT/USER/PASS/FROM, CRON_SECRET, (optional) INVITE_REDIRECT_URL
import { createClient } from "@supabase/supabase-js";
import nodemailer from "nodemailer";

// Where staff sign in — same destination as the invite email.
const APP_LINK = process.env.INVITE_REDIRECT_URL || "https://app.ignis-innovation.com/";

// Monday of the current week, YYYY-MM-DD (matches Postgres date_trunc('week')).
function currentMonday() {
  const x = new Date();
  x.setUTCDate(x.getUTCDate() - ((x.getUTCDay() + 6) % 7));
  return `${x.getUTCFullYear()}-${String(x.getUTCMonth() + 1).padStart(2, "0")}-${String(x.getUTCDate()).padStart(2, "0")}`;
}

export default async function handler(req, res) {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const svc = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !svc) return res.status(500).json({ error: "Server not configured" });

  // Vercel Cron sends `Authorization: Bearer <CRON_SECRET>`; also accept header/query for manual runs.
  const bearer = (req.headers.authorization || "").replace(/^Bearer\s+/i, "");
  const secret = req.headers["x-cron-secret"] || req.query.secret || bearer;
  if (!process.env.CRON_SECRET || secret !== process.env.CRON_SECRET) return res.status(401).json({ error: "Unauthorized" });

  const dry = req.query.dry === "1" || req.query.dry === "true";
  const testTo = typeof req.query.test === "string" ? req.query.test : null;

  const buildTransport = () => nodemailer.createTransport({
    host: process.env.SMTP_HOST, port: Number(process.env.SMTP_PORT) || 587, requireTLS: true,
    auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS },
  });
  const body = (name) => ({
    subject: "Weekly report reminder",
    text:
      `Hi ${name},\n\nHope you're doing well. Just a friendly reminder to submit your weekly report — ` +
      `five tight lines for your track (pipeline, technology or leadership). Keep it tight.\n\n` +
      `Kindly sign in to Jikoni and submit it here:\n${APP_LINK}\n\n— Ignis Innovation`,
    html:
      `<p>Hi ${name},</p><p>Hope you're doing well. Just a friendly reminder to submit your ` +
      `<strong>weekly report</strong> — five tight lines for your track (pipeline, technology or leadership). Keep it tight.</p>` +
      `<p>Kindly sign in to Jikoni and submit it here:</p><p><a href="${APP_LINK}">Sign in to Jikoni</a></p>` +
      `<p>— Ignis Innovation</p>`,
  });

  // test mode: send exactly one reminder to the given address (SMTP wiring check)
  if (testTo) {
    if (!process.env.SMTP_HOST) return res.status(500).json({ error: "SMTP not configured" });
    const m = body("there");
    try {
      await buildTransport().sendMail({ from: process.env.SMTP_FROM || process.env.SMTP_USER, to: testTo, ...m });
    } catch (e) {
      return res.status(502).json({ error: "Email not sent: " + e.message });
    }
    return res.status(200).json({ ok: true, mode: "test", sentTo: testTo });
  }

  const admin = createClient(url, svc, { auth: { persistSession: false } });
  const weekStart = currentMonday();

  // who has already submitted for this week, and every active user
  const [{ data: submitted }, { data: users }] = await Promise.all([
    admin.from("weekly_reports").select("author_id").eq("week_start", weekStart),
    admin.from("app_users").select("id,name,email").eq("state", "active"),
  ]);
  const done = new Set((submitted || []).map((r) => r.author_id));
  const missing = (users || []).filter((u) => !done.has(u.id) && u.email);

  if (!missing.length) return res.status(200).json({ ok: true, sent: 0, notified: 0, weekStart, note: "Everyone has submitted" });

  // dry run: report who WOULD be nudged, without sending or belling anyone
  if (dry) {
    const mask = (e) => e.slice(0, 3) + "…@…";
    return res.status(200).json({ ok: true, mode: "dry", weekStart, would_notify: missing.length, recipients: missing.map((u) => mask(u.email)) });
  }

  // in-app bells (one insert for all missing users)
  const rows = missing.map((u) => ({
    recipient_email: (u.email || "").toLowerCase(),
    kind: "weekly_report_due",
    title: "Your weekly report is due",
    body: "Please submit this week's report in the Staff Portal.",
    link_view: "staffportal",
    link_ref: null,
  }));
  const { error: notifyErr } = await admin.from("notifications").insert(rows);
  const notified = notifyErr ? 0 : rows.length;

  // emails
  if (!process.env.SMTP_HOST) return res.status(200).json({ ok: true, sent: 0, notified, note: "SMTP not configured — bells only" });
  const transport = buildTransport();

  let sent = 0;
  for (const u of missing) {
    try {
      await transport.sendMail({ from: process.env.SMTP_FROM || process.env.SMTP_USER, to: u.email, ...body(u.name) });
      sent++;
    } catch { /* skip a single failure, keep going */ }
  }
  return res.status(200).json({ ok: true, sent, notified, weekStart });
}
