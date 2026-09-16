// Vercel serverless: the monthly recurring-bills reminder (1st of each month).
//   * cron    : Authorization: Bearer <CRON_SECRET> (or ?secret / x-cron-secret) → every Super
//               Admin is emailed AND gets an in-app bell listing the recurring bills to pay this
//               month (item + amount + total). If there are no recurring bills, nothing is sent.
//   * ?dry=1  : return the bill list + recipient count WITHOUT sending or belling.
//   * ?test=<email> : send ONE reminder to that address only (SMTP wiring check).
// Wired to a 1st-of-month Vercel cron (see vercel.json). HR keeps the bills; this nudges the
// Super Admins who pay them.
//
// Requires: NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY,
//   SMTP_HOST/PORT/USER/PASS/FROM, CRON_SECRET, (optional) INVITE_REDIRECT_URL
import { createClient } from "@supabase/supabase-js";
import nodemailer from "nodemailer";

const APP_LINK = process.env.INVITE_REDIRECT_URL || "https://app.ignis-innovation.com/";
const kes = (n) => "KES " + Math.round(Number(n) || 0).toLocaleString();
const monthLabel = () => new Date().toLocaleString("en-GB", { month: "long", year: "numeric" });

// Body built from the current bills list (item + amount, with a total).
function reminderBody(name, bills) {
  const total = bills.reduce((s, b) => s + Number(b.amount || 0), 0);
  const lines = bills.map((b) => `  • ${b.item} — ${kes(b.amount)}`).join("\n");
  const rows = bills.map((b) => `<tr><td style="padding:2px 12px 2px 0">${b.item}</td><td style="padding:2px 0;text-align:right"><strong>${kes(b.amount)}</strong></td></tr>`).join("");
  return {
    subject: `Recurring bills to pay — ${monthLabel()}`,
    text:
      `Hi ${name},\n\nHere are the recurring bills for ${monthLabel()}:\n\n${lines}\n\n` +
      `Total: ${kes(total)}\n\nOpen Jikoni → Finance → Recurring Bills to pay them:\n${APP_LINK}\n\n— Ignis Innovation`,
    html:
      `<p>Hi ${name},</p><p>Here are the recurring bills for <strong>${monthLabel()}</strong>:</p>` +
      `<table style="border-collapse:collapse">${rows}` +
      `<tr><td style="padding:6px 12px 0 0;border-top:1px solid #ddd"><strong>Total</strong></td><td style="padding:6px 0 0;text-align:right;border-top:1px solid #ddd"><strong>${kes(total)}</strong></td></tr></table>` +
      `<p>Open <a href="${APP_LINK}">Jikoni → Finance → Recurring Bills</a> to pay them.</p><p>— Ignis Innovation</p>`,
  };
}

export default async function handler(req, res) {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const svc = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !svc) return res.status(500).json({ error: "Server not configured" });

  const bearer = (req.headers.authorization || "").replace(/^Bearer\s+/i, "");
  const secret = req.headers["x-cron-secret"] || req.query.secret || bearer;
  if (!process.env.CRON_SECRET || secret !== process.env.CRON_SECRET) return res.status(401).json({ error: "Unauthorized" });

  const dry = req.query.dry === "1" || req.query.dry === "true";
  const testTo = typeof req.query.test === "string" ? req.query.test : null;

  const buildTransport = () => nodemailer.createTransport({
    host: process.env.SMTP_HOST, port: Number(process.env.SMTP_PORT) || 587, requireTLS: true,
    auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS },
  });

  const admin = createClient(url, svc, { auth: { persistSession: false } });

  // the recurring bills that recur monthly (on the list or paid last cycle — not in-flight or rejected)
  const { data: allBills } = await admin.from("recurring_bills").select("item,amount,state");
  const bills = (allBills || []).filter((b) => b.state === "active" || b.state === "paid");

  // test mode: one email to the given address using the real bill list
  if (testTo) {
    if (!process.env.SMTP_HOST) return res.status(500).json({ error: "SMTP not configured" });
    try {
      await buildTransport().sendMail({ from: process.env.SMTP_FROM || process.env.SMTP_USER, to: testTo, ...reminderBody("there", bills) });
    } catch (e) {
      return res.status(502).json({ error: "Email not sent: " + e.message });
    }
    return res.status(200).json({ ok: true, mode: "test", sentTo: testTo, bills: bills.length });
  }

  if (!bills.length) return res.status(200).json({ ok: true, sent: 0, notified: 0, note: "No recurring bills to remind about" });

  // recipients: Super Admins (users:3), active
  const { data: superPerms } = await admin.from("user_permissions").select("email").eq("module", "users").gte("level", 3);
  const superEmails = new Set((superPerms || []).map((r) => (r.email || "").toLowerCase()));
  const { data: users } = await admin.from("app_users").select("id,name,email").eq("state", "active");
  const recipients = (users || []).filter((u) => u.email && superEmails.has((u.email || "").toLowerCase()));

  if (!recipients.length) return res.status(200).json({ ok: true, sent: 0, notified: 0, note: "No Super Admin recipients" });

  if (dry) {
    const mask = (e) => e.slice(0, 3) + "…@…";
    return res.status(200).json({ ok: true, mode: "dry", month: monthLabel(), bills: bills.length, total: bills.reduce((s, b) => s + Number(b.amount || 0), 0), would_notify: recipients.map((u) => mask(u.email)) });
  }

  // in-app bells
  const total = bills.reduce((s, b) => s + Number(b.amount || 0), 0);
  const rows = recipients.map((u) => ({
    recipient_email: (u.email || "").toLowerCase(),
    kind: "recurring_bills_due",
    title: `Recurring bills for ${monthLabel()}`,
    body: `${bills.length} bill${bills.length === 1 ? "" : "s"} · ${kes(total)} — pay them in Finance → Recurring Bills.`,
    link_view: "finance",
    link_ref: null,
  }));
  const { error: notifyErr } = await admin.from("notifications").insert(rows);
  const notified = notifyErr ? 0 : rows.length;

  if (!process.env.SMTP_HOST) return res.status(200).json({ ok: true, sent: 0, notified, note: "SMTP not configured — bells only" });
  const transport = buildTransport();
  let sent = 0;
  for (const u of recipients) {
    try {
      await transport.sendMail({ from: process.env.SMTP_FROM || process.env.SMTP_USER, to: u.email, ...reminderBody(u.name, bills) });
      sent++;
    } catch { /* skip a single failure, keep going */ }
  }
  return res.status(200).json({ ok: true, sent, notified, month: monthLabel(), bills: bills.length });
}
