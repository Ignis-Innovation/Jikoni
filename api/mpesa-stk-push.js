// POST /api/mpesa-stk-push — initiate a Safaricom STK Push for an AR invoice.
// Body: { invoice_id, phone }. Looks up the invoice amount server-side, fires the
// STK push via Daraja, and records a pending mpesa_transactions row keyed by the
// returned CheckoutRequestID (which /api/mpesa-callback later matches on).
import { admin, readJson, darajaBase, darajaToken, mpesaTimestamp, normalizePhone } from "./_lib.js";

export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });
  try {
    const { invoice_id, phone } = await readJson(req);
    if (!invoice_id || !phone) return res.status(400).json({ error: "Missing invoice_id or phone" });

    const db = admin();
    const { data: invoice, error } = await db
      .from("receivable_invoices")
      .select("id, code, amount_minor, status")
      .eq("id", invoice_id)
      .single();
    if (error || !invoice) return res.status(404).json({ error: "Invoice not found" });
    if (invoice.status === "paid") return res.status(409).json({ error: "Invoice already paid" });

    const amount = Math.max(1, Math.round(invoice.amount_minor / 100)); // Daraja wants whole KES
    const msisdn = normalizePhone(phone);
    const shortcode = process.env.MPESA_SHORTCODE;
    const timestamp = mpesaTimestamp();
    const password = Buffer.from(`${shortcode}${process.env.MPESA_PASSKEY}${timestamp}`).toString("base64");

    const token = await darajaToken();
    const stkRes = await fetch(`${darajaBase()}/mpesa/stkpush/v1/processrequest`, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        BusinessShortCode: shortcode,
        Password: password,
        Timestamp: timestamp,
        TransactionType: "CustomerPayBillOnline",
        Amount: amount,
        PartyA: msisdn,
        PartyB: shortcode,
        PhoneNumber: msisdn,
        CallBackURL: process.env.MPESA_CALLBACK_URL,
        AccountReference: invoice.code || invoice.id.slice(0, 8),
        TransactionDesc: `Invoice ${invoice.code || ""}`.trim(),
      }),
    });
    const stk = await stkRes.json();

    if (stk.ResponseCode !== "0") {
      return res.status(502).json({ error: stk.errorMessage || stk.ResponseDescription || "STK push failed", raw: stk });
    }

    await db.from("mpesa_transactions").insert({
      invoice_id: invoice.id,
      checkout_request_id: stk.CheckoutRequestID,
      merchant_request_id: stk.MerchantRequestID,
      phone: msisdn,
      amount_minor: invoice.amount_minor,
      status: "pending",
      raw: stk,
    });

    return res.status(200).json({ ok: true, checkout_request_id: stk.CheckoutRequestID });
  } catch (e) {
    console.error("mpesa-stk-push failed:", e);
    return res.status(500).json({ error: e.message });
  }
}
