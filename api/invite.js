// Vercel serverless function: send an invitee an email with a link to set their
// password and sign in. Called by the "Invite member" flow after invite_user has
// recorded the invite + permissions. Server-only: uses the service-role key and
// the SMTP creds, which never reach the browser.
//
// Requires these env vars (Vercel project settings + .env.local for `vercel dev`):
//   NEXT_PUBLIC_SUPABASE_URL, NEXT_PUBLIC_SUPABASE_ANON_KEY, SUPABASE_SERVICE_ROLE_KEY
//   SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASS, SMTP_FROM, APP_URL
import { createClient } from "@supabase/supabase-js";
import nodemailer from "nodemailer";

export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !serviceKey) return res.status(500).json({ error: "Server not configured" });

  // 1) authenticate the caller and confirm they may manage users
  const token = (req.headers.authorization || "").replace(/^Bearer\s+/i, "");
  if (!token) return res.status(401).json({ error: "Not signed in" });
  const caller = createClient(url, anon, { auth: { persistSession: false } });
  const { data: who, error: whoErr } = await caller.auth.getUser(token);
  if (whoErr || !who?.user?.email) return res.status(401).json({ error: "Invalid session" });

  const admin = createClient(url, serviceKey, { auth: { persistSession: false } });
  const { data: perm } = await admin
    .from("user_permissions")
    .select("level")
    .eq("email", who.user.email)
    .eq("module", "users")
    .maybeSingle();
  if (!perm || perm.level < 2) return res.status(403).json({ error: "You can't invite members" });

  // 2) validate input
  const { name, email } = req.body || {};
  if (!email) return res.status(400).json({ error: "An email is required" });

  // 3) generate a set-password action link (invite for new users, recovery for existing).
  // After the invitee clicks, Supabase redirects them here to set their password.
  // Points at the branded app domain; override with INVITE_REDIRECT_URL if needed.
  // NOTE: this URL must be in the Supabase Auth "Redirect URLs" allow-list AND the
  // domain must serve the app (Vercel custom domain), or the link won't land.
  const redirectTo = process.env.INVITE_REDIRECT_URL || "https://app.ignis-innovation.com/";
  let link;
  const inviteLink = await admin.auth.admin.generateLink({ type: "invite", email, options: { redirectTo } });
  if (inviteLink.error) {
    // already has an auth account → send a set-password (recovery) link instead
    const recovery = await admin.auth.admin.generateLink({ type: "recovery", email, options: { redirectTo } });
    if (recovery.error) return res.status(400).json({ error: recovery.error.message });
    link = recovery.data?.properties?.action_link;
  } else {
    link = inviteLink.data?.properties?.action_link;
  }
  if (!link) return res.status(500).json({ error: "Could not generate the invite link" });

  // 4) email it via SMTP (Office 365)
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
      to: email,
      subject: "You've been invited to Jikoni Tool",
      text: `Hi ${name || ""},\n\nYou've been added to Jikoni Tool. Click the link below to set your password and sign in — that password is what you'll use from then on:\n\n${link}\n\nYou'll only see the modules you've been given access to.\n\n— Ignis Innovation`,
      html: `<p>Hi ${name || ""},</p><p>You've been added to <strong>Jikoni Tool</strong>. Click below to set your password and sign in — that password is what you'll use from then on:</p><p><a href="${link}">Set my password &amp; sign in</a></p><p>You'll only see the modules you've been given access to.</p><p>— Ignis Innovation</p>`,
    });
  } catch (e) {
    return res.status(502).json({ error: "Email not sent: " + e.message });
  }

  return res.status(200).json({ ok: true });
}
