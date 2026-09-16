// Send SAMPLE versions of the app's notification emails to one address, so you can preview
// the format without running the full UI flow. Content mirrors what recipients actually get:
//   1. Expense claim approved   (store.decideClaim → the claimant)
//   2. Travel advance approved  (store.decideAdvance → the holder)
//   3. Recurring bills reminder (api/bill-reminder.js → the Super Admins / Dennis)
// Uses the live SMTP settings from .env.local. Usage:
//   node scripts/send-sample-emails.mjs you@example.com
import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import nodemailer from "nodemailer";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
for (const line of readFileSync(resolve(root, ".env.local"), "utf8").split("\n")) {
  const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/i);
  if (!m) continue;
  let v = m[2].trim();
  if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1);
  if (!(m[1] in process.env)) process.env[m[1]] = v;
}

const to = process.argv[2];
if (!to) { console.error("Usage: node scripts/send-sample-emails.mjs <email>"); process.exit(1); }
if (!process.env.SMTP_HOST) { console.error("SMTP not configured in .env.local"); process.exit(1); }

const APP = process.env.INVITE_REDIRECT_URL || "https://app.ignis-innovation.com/";
const kes = (n) => "KES " + Math.round(n).toLocaleString();
const month = new Date().toLocaleString("en-GB", { month: "long", year: "numeric" });
const transport = nodemailer.createTransport({
  host: process.env.SMTP_HOST, port: Number(process.env.SMTP_PORT) || 587, requireTLS: true,
  auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS },
});
const from = process.env.SMTP_FROM || process.env.SMTP_USER;

// 1. Expense claim approved — matches store.decideClaim
const claim = {
  subject: "Expense claim approved — CLM-001",
  text: `Hi Brian,\n\nYour expense claim for Voi field visit (${kes(3500)}) has been approved.\n\nOpen Jikoni Tool → Staff Portal to see the details.`,
  html: `<p>Hi Brian,</p><p>Your expense claim for <strong>Voi field visit</strong> (${kes(3500)}) has been <strong>approved</strong>.</p><p>Open <a href="${APP}">Jikoni Tool → Staff Portal</a> to see the details.</p>`,
};
// 2. Travel advance approved — matches store.decideAdvance
const advance = {
  subject: "Travel advance approved — ADV-001",
  text: `Hi Brian,\n\nYour travel advance for Kitui field deployment (${kes(10000)}) has been approved. Finance will issue the cash; reconcile it with receipts on your return.\n\nOpen Jikoni Tool → Staff Portal to see the details.`,
  html: `<p>Hi Brian,</p><p>Your travel advance for <strong>Kitui field deployment</strong> (${kes(10000)}) has been <strong>approved</strong>. Finance will issue the cash; reconcile it with receipts on your return.</p><p>Open <a href="${APP}">Jikoni Tool → Staff Portal</a> to see the details.</p>`,
};
// 3. Recurring bills reminder — matches api/bill-reminder.js
const bills = [{ item: "Office rent", amount: 55000 }, { item: "Internet / fibre", amount: 12000 }, { item: "Zoom subscription", amount: 2500 }];
const total = bills.reduce((s, b) => s + b.amount, 0);
const rows = bills.map((b) => `<tr><td style="padding:2px 12px 2px 0">${b.item}</td><td style="padding:2px 0;text-align:right"><strong>${kes(b.amount)}</strong></td></tr>`).join("");
const bill = {
  subject: `Recurring bills to pay — ${month}`,
  text: `Hi Dennis,\n\nHere are the recurring bills for ${month}:\n\n${bills.map((b) => `  • ${b.item} — ${kes(b.amount)}`).join("\n")}\n\nTotal: ${kes(total)}\n\nOpen Jikoni → Finance → Recurring Bills to pay them:\n${APP}\n\n— Ignis Innovation`,
  html: `<p>Hi Dennis,</p><p>Here are the recurring bills for <strong>${month}</strong>:</p><table style="border-collapse:collapse">${rows}<tr><td style="padding:6px 12px 0 0;border-top:1px solid #ddd"><strong>Total</strong></td><td style="padding:6px 0 0;text-align:right;border-top:1px solid #ddd"><strong>${kes(total)}</strong></td></tr></table><p>Open <a href="${APP}">Jikoni → Finance → Recurring Bills</a> to pay them.</p><p>— Ignis Innovation</p>`,
};

for (const [label, m] of [["claim-approved", claim], ["advance-approved", advance], ["bill-reminder", bill]]) {
  try { await transport.sendMail({ from, to, ...m }); console.log(`sent: ${label} → ${to}`); }
  catch (e) { console.error(`FAILED: ${label} → ${e.message}`); }
}
