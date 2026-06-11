// GET /api/mpesa-health — verify M-Pesa wiring without exposing secrets.
// Reports which env vars are present and whether a Daraja OAuth token can be
// fetched with the configured consumer key/secret. Returns booleans only.
import { darajaToken, darajaBase } from "./_lib.js";

export default async function handler(_req, res) {
  const present = {
    MPESA_ENV: process.env.MPESA_ENV || "(unset)",
    MPESA_CONSUMER_KEY: Boolean(process.env.MPESA_CONSUMER_KEY),
    MPESA_CONSUMER_SECRET: Boolean(process.env.MPESA_CONSUMER_SECRET),
    MPESA_SHORTCODE: Boolean(process.env.MPESA_SHORTCODE),
    MPESA_PASSKEY: Boolean(process.env.MPESA_PASSKEY),
    MPESA_CALLBACK_URL: Boolean(process.env.MPESA_CALLBACK_URL),
    SUPABASE_SERVICE_ROLE_KEY: Boolean(process.env.SUPABASE_SERVICE_ROLE_KEY),
  };
  let tokenOk = false;
  let error = null;
  try {
    const t = await darajaToken();
    tokenOk = Boolean(t);
  } catch (e) {
    error = e.message;
  }
  res.status(tokenOk ? 200 : 502).json({ base: darajaBase(), present, tokenOk, error });
}
