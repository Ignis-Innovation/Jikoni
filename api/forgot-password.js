// Vercel serverless function: self-service "Forgot password".
// A signed-out user submits their email; if it belongs to a real Jikoni user we
// email them a set-password link and they land on the SetPassword screen. This is
// the public sibling of api/invite.js — no caller auth, so it never reveals whether
// an email is registered (no user enumeration) and never mints an account for an
// unknown email. Server-only: service-role key + SMTP creds stay off the browser.
//
// Requires the same env vars as api/invite.js:
//   NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY
//   SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASS, SMTP_FROM, optional INVITE_REDIRECT_URL
import { createClient } from "@supabase/supabase-js";
import nodemailer from "nodemailer";

// One generic reply for every outcome — an existing user is never told "no such
// email", and an attacker can't probe which addresses are registered.
const GENERIC = { ok: true, message: "If that email is registered, a reset link is on its way." };

export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !serviceKey) return res.status(500).json({ error: "Server not configured" });

  const email = String((req.body || {}).email || "").trim().toLowerCase();
  if (!email) return res.status(400).json({ error: "An email is required" });

  const admin = createClient(url, serviceKey, { auth: { persistSession: false } });

  // 1) Only send to a real, still-active Jikoni user. We look up app_users rather
  // than letting generateLink(type:invite) create an account for any address.
  const { data: user } = await admin
    .from("app_users")
    .select("name, state, status")
    .ilike("email", email)
    .maybeSingle();
  // Banned/exited users get the same generic reply but no link.
  if (!user || user.state === "exited" || user.status === "banned") {
    return res.status(200).json(GENERIC);
  }

  // 2) Generate a set-password link. Recovery works for anyone with an auth account;
  // if they were invited but never activated (no auth user yet), fall back to invite.
  const redirectTo = process.env.INVITE_REDIRECT_URL || "https://app.ignis-innovation.com/";
  let link;
  const recovery = await admin.auth.admin.generateLink({ type: "recovery", email, options: { redirectTo } });
  if (recovery.error) {
    const invite = await admin.auth.admin.generateLink({ type: "invite", email, options: { redirectTo } });
    if (invite.error) return res.status(200).json(GENERIC); // can't help, but don't leak why
    link = invite.data?.properties?.action_link;
  } else {
    link = recovery.data?.properties?.action_link;
  }
  if (!link) return res.status(200).json(GENERIC);

  // 3) Email it via the same SMTP transport the invite flow uses.
  if (!process.env.SMTP_HOST) return res.status(500).json({ error: "SMTP not configured" });
  const transport = nodemailer.createTransport({
    host: process.env.SMTP_HOST,
    port: Number(process.env.SMTP_PORT) || 587,
    requireTLS: true,
    auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS },
  });
  const name = user.name || "";
  try {
    await transport.sendMail({
      from: process.env.SMTP_FROM || process.env.SMTP_USER,
      to: email,
      subject: "Reset your Jikoni Tool password",
      text: `Hi ${name},\n\nWe got a request to reset your Jikoni Tool password. Click the link below to set a new one and sign in:\n\n${link}\n\nIf you didn't ask for this, you can ignore this email — your password stays the same.\n\n— Ignis Innovation`,
      html: `<p>Hi ${name},</p><p>We got a request to reset your <strong>Jikoni Tool</strong> password. Click below to set a new one and sign in:</p><p><a href="${link}">Set a new password</a></p><p>If you didn't ask for this, you can ignore this email — your password stays the same.</p><p>— Ignis Innovation</p>`,
    });
  } catch (e) {
    return res.status(502).json({ error: "Email not sent: " + e.message });
  }

  return res.status(200).json(GENERIC);
}
