// Vercel serverless function: email a teammate who was tagged on a record (e.g. a
// CRM engagement). Called after the in-app notification has already been written by
// the RPC — this is the email side. Server-only: SMTP creds never reach the browser.
//
// Requires these env vars (Vercel project settings + .env.local for `vercel dev`):
//   NEXT_PUBLIC_SUPABASE_URL, NEXT_PUBLIC_SUPABASE_ANON_KEY
//   SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASS, SMTP_FROM
import { createClient } from "@supabase/supabase-js";
import nodemailer from "nodemailer";

export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !anon) return res.status(500).json({ error: "Server not configured" });

  // 1) authenticate the caller — any signed-in user may notify a teammate
  const token = (req.headers.authorization || "").replace(/^Bearer\s+/i, "");
  if (!token) return res.status(401).json({ error: "Not signed in" });
  const caller = createClient(url, anon, { auth: { persistSession: false } });
  const { data: who, error: whoErr } = await caller.auth.getUser(token);
  if (whoErr || !who?.user?.email) return res.status(401).json({ error: "Invalid session" });

  // 2) validate input
  const { to, subject, text, html } = req.body || {};
  if (!to || !subject) return res.status(400).json({ error: "A recipient and subject are required" });

  // 3) email it via SMTP (Office 365)
  if (!process.env.SMTP_HOST) return res.status(500).json({ error: "SMTP not configured" });
  const transport = nodemailer.createTransport({
    host: process.env.SMTP_HOST,
    port: Number(process.env.SMTP_PORT) || 587,
    requireTLS: true,
    auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS },
  });
  try {
    await transport.sendMail({
      from: process.env.SMTP_FROM || process.env.SMTP_USER,
      to,
      subject,
      text: text || subject,
      html: html || `<p>${text || subject}</p>`,
    });
  } catch (e) {
    return res.status(502).json({ error: "Email not sent: " + e.message });
  }

  return res.status(200).json({ ok: true });
}
