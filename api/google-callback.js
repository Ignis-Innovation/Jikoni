// Vercel serverless: Google OAuth callback. Exchanges the auth code for tokens,
// stores them in public.oauth_connections via the service role (tokens never reach
// the browser), then redirects back into the app.
//
// Requires: GOOGLE_OAUTH_CLIENT_ID, GOOGLE_OAUTH_CLIENT_SECRET, APP_URL,
//   NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY
import { createClient } from "@supabase/supabase-js";

export default async function handler(req, res) {
  const appUrl = process.env.APP_URL || "";
  const done = (status) => { res.writeHead(302, { Location: `${appUrl}/?connected=${status}` }); res.end(); };

  const { code, error } = req.query || {};
  if (error || !code) return done("google_error");

  const clientId = process.env.GOOGLE_OAUTH_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_OAUTH_CLIENT_SECRET;
  const svc = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  if (!clientId || !clientSecret || !svc || !url) return done("google_error");

  try {
    const tokenRes = await fetch("https://oauth2.googleapis.com/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        code, client_id: clientId, client_secret: clientSecret,
        redirect_uri: `${appUrl}/api/google-callback`, grant_type: "authorization_code",
      }),
    });
    const tok = await tokenRes.json();
    if (!tok.access_token) return done("google_error");

    let email = null;
    try {
      const ui = await fetch("https://www.googleapis.com/oauth2/v2/userinfo", { headers: { Authorization: `Bearer ${tok.access_token}` } });
      email = (await ui.json())?.email ?? null;
    } catch { /* email is best-effort */ }

    const admin = createClient(url, svc, { auth: { persistSession: false } });
    await admin.from("oauth_connections").upsert({
      provider: "google",
      account_email: email,
      scopes: tok.scope ?? null,
      access_token: tok.access_token,
      refresh_token: tok.refresh_token ?? null,
      expiry: tok.expires_in ? new Date(Date.now() + tok.expires_in * 1000).toISOString() : null,
      updated_at: new Date().toISOString(),
    });
    return done("google");
  } catch {
    return done("google_error");
  }
}
