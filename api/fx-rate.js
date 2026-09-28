// Vercel serverless: the live USD → KES rate.
//   * GET (anyone)  : returns { rate, date, source } fetched server-side — the browser can't call
//                     the FX provider directly (CSP connect-src is 'self' + Supabase only).
//   * cron          : Authorization: Bearer <CRON_SECRET> (or ?secret / x-cron-secret) → also writes
//                     the rate to Settings → Invoicing (app_config usd_kes_rate + usd_kes_rate_updated),
//                     unless "Update automatically" is switched off (usd_kes_rate_auto = false).
// Wired to a daily Vercel cron (see vercel.json).
//
// Requires: NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, CRON_SECRET
import { createClient } from "@supabase/supabase-js";

const SOURCE = "https://open.er-api.com/v6/latest/USD";

async function liveRate() {
  const r = await fetch(SOURCE);
  if (!r.ok) throw new Error(`FX provider returned ${r.status}`);
  const j = await r.json();
  const k = Number(j?.rates?.KES);
  if (!(k > 50 && k < 1000)) throw new Error("FX provider returned no usable KES rate");
  return { rate: Math.round(k * 100) / 100, date: j.time_last_update_utc || new Date().toUTCString() };
}

export default async function handler(req, res) {
  let fx;
  try { fx = await liveRate(); }
  catch (e) { return res.status(502).json({ error: e.message }); }

  const bearer = (req.headers.authorization || "").replace(/^Bearer\s+/i, "");
  const secret = req.headers["x-cron-secret"] || req.query.secret || bearer;
  const isCron = !!process.env.CRON_SECRET && secret === process.env.CRON_SECRET;
  if (!isCron) {
    res.setHeader("Cache-Control", "public, s-maxage=3600, stale-while-revalidate=86400");
    return res.status(200).json({ ...fx, source: "open.er-api.com" });
  }

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const svc = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !svc) return res.status(500).json({ error: "Server not configured" });
  const admin = createClient(url, svc, { auth: { persistSession: false } });

  const { data: auto } = await admin.from("app_config").select("value").eq("key", "usd_kes_rate_auto").maybeSingle();
  if (auto && auto.value === false) return res.status(200).json({ ok: true, updated: false, note: "Automatic updates are off", ...fx });

  const now = new Date().toISOString();
  const { error } = await admin.from("app_config").upsert([
    { key: "usd_kes_rate", value: fx.rate, updated_at: now },
    { key: "usd_kes_rate_updated", value: now, updated_at: now },
  ], { onConflict: "key" });
  if (error) return res.status(500).json({ error: error.message });
  return res.status(200).json({ ok: true, updated: true, ...fx });
}
