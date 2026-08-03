// Vercel serverless: connect Claude by storing an Anthropic API key in the vault
// (public.app_secrets, service-role only). Admin-only. Validates the key with a cheap
// call before saving so we never store a dud.
//
// Requires: NEXT_PUBLIC_SUPABASE_URL, NEXT_PUBLIC_SUPABASE_ANON_KEY, SUPABASE_SERVICE_ROLE_KEY
import { createClient } from "@supabase/supabase-js";

export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  const svc = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !anon || !svc) return res.status(500).json({ error: "Server not configured" });

  const token = (req.headers.authorization || "").replace(/^Bearer\s+/i, "");
  if (!token) return res.status(401).json({ error: "Not signed in" });
  const caller = createClient(url, anon, { auth: { persistSession: false } });
  const { data: who, error: whoErr } = await caller.auth.getUser(token);
  if (whoErr || !who?.user?.email) return res.status(401).json({ error: "Invalid session" });

  const admin = createClient(url, svc, { auth: { persistSession: false } });
  const { data: perm } = await admin.from("user_permissions").select("level").eq("email", who.user.email).eq("module", "users").maybeSingle();
  if (!perm || perm.level < 2) return res.status(403).json({ error: "You can't manage integrations" });

  const { key } = req.body || {};
  if (!key || !/^sk-ant/.test(key)) return res.status(400).json({ error: "That doesn't look like an Anthropic API key" });

  try {
    const r = await fetch("https://api.anthropic.com/v1/models", { headers: { "x-api-key": key, "anthropic-version": "2023-06-01" } });
    if (!r.ok) return res.status(400).json({ error: "Anthropic rejected that key" });
  } catch (e) {
    return res.status(502).json({ error: "Couldn't reach Anthropic: " + e.message });
  }

  const { error } = await admin.from("app_secrets").upsert({ key: "anthropic_api_key", value: key, updated_at: new Date().toISOString() });
  if (error) return res.status(500).json({ error: "Couldn't store the key" });
  return res.status(200).json({ ok: true, connected: true });
}
