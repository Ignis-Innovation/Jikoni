// POST /api/send-email — transactional Sales emails (nodemailer + SMTP).
// Body: { to, template: 'account_created'|'account_approved'|'order_paid'|'order_unpaid', data }
// Called by the client after creating/approving an account or placing a credit
// order, and by the M-Pesa callback after a paid order. Falls back to dry-run if
// SMTP isn't configured (logs instead of sending) — same posture as the scripts.
import { readJson, sendMail } from "./_lib.js";

export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });
  try {
    const { to, template, data, subject, html } = await readJson(req);
    if (!to) return res.status(400).json({ error: "Missing 'to'" });
    if (!template && !html) return res.status(400).json({ error: "Missing 'template' or 'html'" });
    const result = await sendMail({ to, template, data, subject, html });
    return res.status(200).json({ ok: true, ...result });
  } catch (e) {
    console.error("send-email failed:", e);
    return res.status(500).json({ error: e.message });
  }
}
