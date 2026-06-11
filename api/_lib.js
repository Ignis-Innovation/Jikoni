// Shared helpers for the Sales CRM serverless functions (Vercel Node runtime).
// Files prefixed with "_" are NOT exposed as routes. Env comes from Vercel
// project settings (process.env), mirroring the names in .env.example.
import { createClient } from "@supabase/supabase-js";
import nodemailer from "nodemailer";

// Service-role Supabase client — server-only, bypasses RLS. Never ship to browser.
export function admin() {
  const url = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error("Missing Supabase URL or service role key");
  return createClient(url, key, { auth: { persistSession: false } });
}

// Read a JSON body whether Vercel parsed it or handed us a raw stream.
export async function readJson(req) {
  if (req.body && typeof req.body === "object") return req.body;
  if (typeof req.body === "string" && req.body) { try { return JSON.parse(req.body); } catch { return {}; } }
  const chunks = [];
  for await (const c of req) chunks.push(c);
  if (!chunks.length) return {};
  try { return JSON.parse(Buffer.concat(chunks).toString("utf8")); } catch { return {}; }
}

// ---- Daraja (M-Pesa) -------------------------------------------------------
export function darajaBase() {
  return process.env.MPESA_ENV === "production"
    ? "https://api.safaricom.co.ke"
    : "https://sandbox.safaricom.co.ke";
}

export async function darajaToken() {
  const auth = Buffer.from(
    `${process.env.MPESA_CONSUMER_KEY}:${process.env.MPESA_CONSUMER_SECRET}`
  ).toString("base64");
  const r = await fetch(`${darajaBase()}/oauth/v1/generate?grant_type=client_credentials`, {
    headers: { Authorization: `Basic ${auth}` },
  });
  if (!r.ok) throw new Error(`Daraja token failed: ${r.status}`);
  const j = await r.json();
  return j.access_token;
}

// YYYYMMDDHHmmss in EAT — Daraja's expected timestamp format.
export function mpesaTimestamp(d = new Date()) {
  const p = (n) => String(n).padStart(2, "0");
  return (
    d.getUTCFullYear().toString() +
    p(d.getUTCMonth() + 1) + p(d.getUTCDate()) +
    p((d.getUTCHours() + 3) % 24) + p(d.getUTCMinutes()) + p(d.getUTCSeconds())
  );
}

// Normalise 07XXXXXXXX / +2547... / 2547... to 2547XXXXXXXX.
export function normalizePhone(raw) {
  let s = String(raw || "").replace(/\D/g, "");
  if (s.startsWith("0")) s = "254" + s.slice(1);
  if (s.startsWith("7") || s.startsWith("1")) s = "254" + s;
  return s;
}

// ---- Email (nodemailer + SMTP) --------------------------------------------
function transporter() {
  const port = Number(process.env.SMTP_PORT || 587);
  return nodemailer.createTransport({
    host: process.env.SMTP_HOST,
    port,
    secure: port === 465,
    requireTLS: port !== 465, // Office 365 needs STARTTLS on 587
    auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS },
  });
}

const BRAND = { green: "#059669", orange: "#ea580c" };

function shell(title, bodyHtml) {
  return `<div style="font-family:system-ui,Segoe UI,Arial,sans-serif;max-width:560px;margin:0 auto;color:#18181b">
    <div style="background:${BRAND.green};color:#fff;padding:18px 24px;border-radius:12px 12px 0 0;font-size:18px;font-weight:600">${title}</div>
    <div style="border:1px solid #e4e4e7;border-top:none;border-radius:0 0 12px 12px;padding:24px">${bodyHtml}</div>
    <p style="color:#71717a;font-size:12px;text-align:center;margin-top:16px">Sent by Jikoni Sales · <a style="color:${BRAND.orange}" href="${appUrl()}">jikoni.app</a></p>
  </div>`;
}

function appUrl() {
  return (process.env.APP_URL || "https://app.jikoni.app").replace(/\/+$/, "");
}

// The four transactional templates ported from Ignis (green/orange brand).
export function renderTemplate(template, data = {}) {
  const name = data.contact_name || data.account_name || "there";
  switch (template) {
    case "account_created":
      return {
        subject: `We've received your account — ${data.account_name || ""}`.trim(),
        html: shell("Account received", `<p>Hi ${name},</p>
          <p>Your account <strong>${data.account_name || ""}</strong> has been created and is awaiting approval. We'll email you the moment it's approved.</p>`),
      };
    case "account_approved":
      return {
        subject: `Your account is approved — ${data.account_name || ""}`.trim(),
        html: shell("Account approved", `<p>Hi ${name},</p>
          <p>Good news — <strong>${data.account_name || ""}</strong> is approved. You can now place orders with us.</p>`),
      };
    case "order_paid":
      return {
        subject: `Payment received — invoice ${data.invoice_code || ""}`.trim(),
        html: shell("Payment received", `<p>Hi ${name},</p>
          <p>We've received your payment of <strong>${data.amount || ""}</strong> for invoice <strong>${data.invoice_code || ""}</strong>. Thank you!</p>
          ${data.items_html || ""}`),
      };
    case "order_unpaid":
      return {
        subject: `Invoice ${data.invoice_code || ""} — due ${data.due_date || ""}`.trim(),
        html: shell("Invoice issued", `<p>Hi ${name},</p>
          <p>Invoice <strong>${data.invoice_code || ""}</strong> for <strong>${data.amount || ""}</strong> is due on <strong>${data.due_date || ""}</strong>.</p>
          ${data.items_html || ""}
          <p style="margin-top:16px"><a style="background:${BRAND.orange};color:#fff;padding:10px 16px;border-radius:8px;text-decoration:none" href="${appUrl()}/sales/invoices">View invoice</a></p>`),
      };
    default:
      throw new Error(`Unknown template: ${template}`);
  }
}

export async function sendMail({ to, template, data, subject, html }) {
  if (!process.env.SMTP_HOST || !process.env.SMTP_USER || !process.env.SMTP_PASS) {
    console.log(`[email] DRY-RUN (SMTP not configured) → ${to} (${template || subject})`);
    return { dryRun: true };
  }
  const rendered = template ? renderTemplate(template, data) : { subject, html };
  const from = process.env.SMTP_FROM || process.env.SMTP_USER;
  await transporter().sendMail({ from, to, subject: rendered.subject, html: rendered.html });
  return { sent: true };
}
