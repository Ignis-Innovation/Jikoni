// Vercel serverless: start the Google OAuth consent flow (Gmail + Drive).
// Redirects the browser to Google's consent screen. The callback (api/google-callback)
// exchanges the code for tokens and stores them server-side.
//
// Requires: GOOGLE_OAUTH_CLIENT_ID, APP_URL. The redirect URI
//   ${APP_URL}/api/google-callback  must be registered in the Google Cloud console.
export default async function handler(req, res) {
  const clientId = process.env.GOOGLE_OAUTH_CLIENT_ID;
  const appUrl = process.env.APP_URL;
  if (!clientId || !appUrl) {
    return res.status(500).send("Google OAuth is not configured yet (missing GOOGLE_OAUTH_CLIENT_ID / APP_URL).");
  }
  const redirectUri = `${appUrl}/api/google-callback`;
  const scope = [
    "https://www.googleapis.com/auth/gmail.readonly",
    "https://www.googleapis.com/auth/drive",
    "https://www.googleapis.com/auth/userinfo.email",
  ].join(" ");
  const state = Math.random().toString(36).slice(2);
  const params = new URLSearchParams({
    client_id: clientId,
    redirect_uri: redirectUri,
    response_type: "code",
    scope,
    access_type: "offline",
    prompt: "consent",
    include_granted_scopes: "true",
    state,
  });
  res.writeHead(302, { Location: `https://accounts.google.com/o/oauth2/v2/auth?${params}` });
  res.end();
}
