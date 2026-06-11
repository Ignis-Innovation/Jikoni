// Thin client for the Sales serverless endpoints (Vercel /api/*). These run
// server-side (service-role + SMTP/Daraja secrets) — the browser only POSTs JSON.

export type EmailTemplate = "account_created" | "account_approved" | "order_paid" | "order_unpaid";

async function callApi<T = unknown>(path: string, body: unknown): Promise<T> {
  const res = await fetch(path, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  let json: Record<string, unknown> = {};
  try { json = await res.json(); } catch { /* empty body */ }
  if (!res.ok) throw new Error(String(json.error || `Request failed (${res.status})`));
  return json as T;
}

/** Fire a transactional email. Best-effort: callers should not block the UI on it. */
export function sendSalesEmail(to: string, template: EmailTemplate, data: Record<string, unknown>) {
  return callApi("/api/send-email", { to, template, data });
}

/** Kick off an M-Pesa STK push for an invoice; returns the CheckoutRequestID. */
export function startMpesaPush(invoice_id: string, phone: string) {
  return callApi<{ ok: boolean; checkout_request_id: string }>("/api/mpesa-stk-push", { invoice_id, phone });
}
