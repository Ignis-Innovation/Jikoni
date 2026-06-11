// POST /api/mpesa-callback — public webhook Safaricom calls with the STK result.
// Matches the pending mpesa_transactions row on CheckoutRequestID; on success it
// records a customer_receipt, flips the invoice to paid (a DB trigger then marks
// the order delivered), and emails the account contact an Order-Paid receipt.
// Always replies 200 so Safaricom doesn't retry a row we've already handled.
import { admin, readJson, sendMail } from "./_lib.js";

function metaValue(items, name) {
  const hit = (items || []).find((i) => i.Name === name);
  return hit ? hit.Value : null;
}

export default async function handler(req, res) {
  try {
    const body = await readJson(req);
    const cb = body?.Body?.stkCallback;
    if (!cb) return res.status(200).json({ ok: true, ignored: true });

    const db = admin();
    const checkoutId = cb.CheckoutRequestID;
    const resultCode = cb.ResultCode;

    const { data: tx } = await db
      .from("mpesa_transactions")
      .select("id, invoice_id, status")
      .eq("checkout_request_id", checkoutId)
      .maybeSingle();
    if (!tx) return res.status(200).json({ ok: true, unmatched: true });
    if (tx.status !== "pending") return res.status(200).json({ ok: true, already: tx.status });

    // Failure (user cancelled, timeout, insufficient funds, …).
    if (resultCode !== 0) {
      await db.from("mpesa_transactions").update({
        status: "failed", result_code: resultCode, result_desc: cb.ResultDesc, raw: body, updated_at: new Date().toISOString(),
      }).eq("id", tx.id);
      return res.status(200).json({ ok: true, status: "failed" });
    }

    // Success — pull receipt + amount from the callback metadata.
    const items = cb.CallbackMetadata?.Item || [];
    const mpesaReceipt = metaValue(items, "MpesaReceiptNumber");
    const amount = metaValue(items, "Amount");
    const amountMinor = amount != null ? Math.round(Number(amount) * 100) : null;

    let receiptId = null;
    if (tx.invoice_id) {
      const { data: invoice } = await db
        .from("receivable_invoices")
        .select("id, code, customer_party_id, amount_minor, currency_code")
        .eq("id", tx.invoice_id)
        .single();

      const { data: receipt } = await db.from("customer_receipts").insert({
        customer_party_id: invoice?.customer_party_id,
        invoice_id: tx.invoice_id,
        amount_minor: amountMinor ?? invoice?.amount_minor ?? 0,
        method: "mpesa",
        external_ref: mpesaReceipt,
        received_date: new Date().toISOString().slice(0, 10),
      }).select("id").single();
      receiptId = receipt?.id ?? null;

      // Flip invoice to paid → trigger marks the linked order delivered.
      await db.from("receivable_invoices").update({ status: "paid" }).eq("id", tx.invoice_id);

      // Order-Paid email to the account contact (best-effort; dry-runs if no SMTP).
      try {
        const { data: party } = await db
          .from("parties").select("display_name, email").eq("id", invoice?.customer_party_id).single();
        if (party?.email) {
          await sendMail({
            to: party.email,
            template: "order_paid",
            data: {
              account_name: party.display_name,
              invoice_code: invoice?.code,
              amount: new Intl.NumberFormat("en-KE", { style: "currency", currency: invoice?.currency_code || "KES" }).format((invoice?.amount_minor || 0) / 100),
            },
          });
        }
      } catch (mailErr) {
        console.error("order_paid email failed:", mailErr.message);
      }
    }

    await db.from("mpesa_transactions").update({
      status: "success",
      receipt_id: receiptId,
      mpesa_receipt: mpesaReceipt,
      result_code: resultCode,
      result_desc: cb.ResultDesc,
      raw: body,
      updated_at: new Date().toISOString(),
    }).eq("id", tx.id);

    return res.status(200).json({ ok: true, status: "success" });
  } catch (e) {
    console.error("mpesa-callback failed:", e);
    // Still 200 — log and move on so Safaricom doesn't hammer retries.
    return res.status(200).json({ ok: false, error: e.message });
  }
}
