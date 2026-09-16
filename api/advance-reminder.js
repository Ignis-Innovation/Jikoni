// Vercel serverless: chase UNRECONCILED travel advances (the spec's debtor-follow-up control).
// An advance issued more than ADVANCE_CHASE_DAYS ago and still in state 'issued' is money owed
// by the holder with no accounting yet. Weekly, this emails + bells each holder to reconcile it,
// and bells Finance with the outstanding total. READ-ONLY — it never changes an advance.
//   * cron    : Authorization: Bearer <CRON_SECRET> (or ?secret / x-cron-secret)
//   * ?dry=1  : return who WOULD be chased, without sending or belling
//   * ?test=<email> : send one sample chase email to that address (SMTP wiring check)
//
// Requires: NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY,
//   SMTP_HOST/PORT/USER/PASS/FROM, CRON_SECRET, (optional) INVITE_REDIRECT_URL, ADVANCE_CHASE_DAYS
import { createClient } from "@supabase/supabase-js";
import nodemailer from "nodemailer";

const APP_LINK = process.env.INVITE_REDIRECT_URL || "https://app.ignis-innovation.com/";
// default 7 days; ADVANCE_CHASE_DAYS=0 is honoured (useful for testing — chases any issued advance)
const CHASE_DAYS = (() => { const n = Number(process.env.ADVANCE_CHASE_DAYS); return Number.isFinite(n) && n >= 0 ? n : 7; })();
const kes = (n) => "KES " + Math.round(Number(n) || 0).toLocaleString();
const daysAgo = (iso) => Math.floor((Date.now() - new Date(iso).getTime()) / 86400000);

function chaseBody(name, advances) {
  const total = advances.reduce((s, a) => s + Number(a.amount || 0), 0);
  const lines = advances.map((a) => `  • ${a.ref} — ${a.purpose} (${kes(a.amount)}, issued ${daysAgo(a.issued_at)} days ago)`).join("\n");
  const rows = advances.map((a) => `<tr><td style="padding:2px 12px 2px 0">${a.ref} — ${a.purpose}</td><td style="padding:2px 0;text-align:right"><strong>${kes(a.amount)}</strong> · ${daysAgo(a.issued_at)}d</td></tr>`).join("");
  return {
    subject: "Please reconcile your travel advance",
    text:
      `Hi ${name},\n\nThe following travel advance${advances.length === 1 ? " is" : "s are"} still open — please reconcile ` +
      `${advances.length === 1 ? "it" : "them"} with your receipts and per-diem so the balance can be settled:\n\n${lines}\n\n` +
      `Total outstanding: ${kes(total)}\n\nReconcile in Jikoni → Staff Portal → Travel Advances:\n${APP_LINK}\n\n— Ignis Innovation`,
    html:
      `<p>Hi ${name},</p><p>The following travel advance${advances.length === 1 ? " is" : "s are"} still open — please reconcile ` +
      `${advances.length === 1 ? "it" : "them"} with receipts and per-diem so the balance can be settled:</p>` +
      `<table style="border-collapse:collapse">${rows}` +
      `<tr><td style="padding:6px 12px 0 0;border-top:1px solid #ddd"><strong>Total outstanding</strong></td><td style="padding:6px 0 0;text-align:right;border-top:1px solid #ddd"><strong>${kes(total)}</strong></td></tr></table>` +
      `<p>Reconcile in <a href="${APP_LINK}">Jikoni → Staff Portal → Travel Advances</a>.</p><p>— Ignis Innovation</p>`,
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
  const cutoff = new Date(Date.now() - CHASE_DAYS * 86400000).toISOString();

  // the debtors: advances still 'issued' and older than the chase window (READ ONLY)
  const { data: stale } = await admin
    .from("travel_advances")
    .select("ref, purpose, amount, issued_at, holder:app_users!travel_advances_holder_id_fkey(name, email)")
    .eq("state", "issued")
    .lt("issued_at", cutoff)
    .order("issued_at", { ascending: true });

  const rows = (stale || []).map((a) => {
    const h = Array.isArray(a.holder) ? a.holder[0] : a.holder;
    return { ref: a.ref, purpose: a.purpose, amount: a.amount, issued_at: a.issued_at, holderName: h?.name || "there", holderEmail: (h?.email || "").toLowerCase() };
  }).filter((a) => a.holderEmail);

  if (testTo) {
    if (!process.env.SMTP_HOST) return res.status(500).json({ error: "SMTP not configured" });
    const sample = rows.length ? rows : [{ ref: "ADV-000", purpose: "Sample trip", amount: 10000, issued_at: cutoff }];
    try {
      await buildTransport().sendMail({ from: process.env.SMTP_FROM || process.env.SMTP_USER, to: testTo, ...chaseBody("there", sample) });
    } catch (e) {
      return res.status(502).json({ error: "Email not sent: " + e.message });
    }
    return res.status(200).json({ ok: true, mode: "test", sentTo: testTo, stale: rows.length });
  }

  if (!rows.length) return res.status(200).json({ ok: true, sent: 0, notified: 0, note: `No advances unreconciled past ${CHASE_DAYS} days` });

  // group by holder — one email + bell per holder listing their open advances
  const byHolder = new Map();
  for (const a of rows) { if (!byHolder.has(a.holderEmail)) byHolder.set(a.holderEmail, []); byHolder.get(a.holderEmail).push(a); }

  if (dry) {
    const mask = (e) => e.slice(0, 3) + "…@…";
    return res.status(200).json({ ok: true, mode: "dry", chaseDays: CHASE_DAYS, stale: rows.length, holders: [...byHolder.keys()].map(mask) });
  }

  // in-app bells: each holder (Staff Portal), plus a summary to Finance
  const total = rows.reduce((s, a) => s + Number(a.amount || 0), 0);
  const bells = [];
  for (const [email, list] of byHolder) {
    bells.push({ recipient_email: email, kind: "advance_reconcile_due", title: "Reconcile your travel advance",
      body: `${list.length} advance${list.length === 1 ? "" : "s"} · ${kes(list.reduce((s, a) => s + Number(a.amount || 0), 0))} still open.`,
      link_view: "staffportal", link_ref: list[0].ref });
  }
  const { data: finPerms } = await admin.from("user_permissions").select("email").eq("module", "finance").gte("level", 2);
  const { data: finUsers } = await admin.from("app_users").select("email").eq("state", "active");
  const finEmails = new Set((finPerms || []).map((r) => (r.email || "").toLowerCase()));
  for (const u of (finUsers || [])) {
    const e = (u.email || "").toLowerCase();
    if (e && finEmails.has(e)) bells.push({ recipient_email: e, kind: "advance_reconcile_due", title: "Unreconciled advances outstanding",
      body: `${rows.length} advance${rows.length === 1 ? "" : "s"} past ${CHASE_DAYS} days · ${kes(total)} owed.`, link_view: "finance", link_ref: null });
  }
  const { error: notifyErr } = await admin.from("notifications").insert(bells);
  const notified = notifyErr ? 0 : bells.length;

  if (!process.env.SMTP_HOST) return res.status(200).json({ ok: true, sent: 0, notified, note: "SMTP not configured — bells only" });
  const transport = buildTransport();
  let sent = 0;
  for (const [email, list] of byHolder) {
    try {
      await transport.sendMail({ from: process.env.SMTP_FROM || process.env.SMTP_USER, to: email, ...chaseBody(list[0].holderName, list) });
      sent++;
    } catch { /* skip one failure, keep going */ }
  }
  return res.status(200).json({ ok: true, sent, notified, chaseDays: CHASE_DAYS, stale: rows.length });
}
