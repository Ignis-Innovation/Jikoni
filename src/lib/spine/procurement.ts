"use server";
import { getCurrentUser } from "@/lib/spine/auth";
import { createClient } from "@/lib/supabase/server";
import { submitForApproval } from "@/lib/spine/approvals";
import { revalidatePath } from "next/cache";

type Result = { ok: boolean; message: string; id?: string };

async function guard(perm: string) {
  const me = await getCurrentUser();
  if (!me) return { me: null, denied: { ok: false, message: "Not authenticated." } as Result };
  if (!me.isSuperAdmin && !me.permissions.has(perm)) {
    return { me, denied: { ok: false, message: "Permission denied." } as Result };
  }
  return { me, denied: null };
}

export type LineInput = {
  item_desc: string;
  qty: number;
  uom_code?: string | null;
  est_unit_price_minor: number;
  account_id?: string | null;
};

/** Replace a requisition's lines and recompute its total. */
export async function saveRequisitionLines(reqId: string, lines: LineInput[]): Promise<Result> {
  const { denied } = await guard("procurement.edit");
  if (denied) return denied;
  const supabase = await createClient();

  await supabase.from("requisition_lines").delete().eq("req_id", reqId);
  if (lines.length) {
    const rows = lines.map((l) => ({
      req_id: reqId,
      item_desc: l.item_desc,
      qty: l.qty,
      uom_code: l.uom_code ?? null,
      est_unit_price_minor: l.est_unit_price_minor,
      account_id: l.account_id ?? null,
    }));
    const { error } = await supabase.from("requisition_lines").insert(rows);
    if (error) return { ok: false, message: error.message };
  }
  const total = lines.reduce((s, l) => s + Math.round(l.qty * l.est_unit_price_minor), 0);
  await supabase.from("requisitions").update({ total_minor: total }).eq("id", reqId);

  revalidatePath(`/procurement/requisitions/${reqId}`);
  return { ok: true, message: "Lines saved." };
}

/** Submit a draft requisition into the spine approvals engine. */
export async function submitRequisition(reqId: string): Promise<Result> {
  const { denied } = await guard("procurement.edit");
  if (denied) return denied;
  const supabase = await createClient();

  const { data: req } = await supabase
    .from("requisitions")
    .select("id, code, total_minor, status")
    .eq("id", reqId)
    .single();
  if (!req) return { ok: false, message: "Requisition not found." };
  if (req.status !== "draft") return { ok: false, message: `Already ${req.status}.` };

  const sub = await submitForApproval({
    entityType: "requisitions",
    entityId: reqId,
    module: "procurement",
    amountMinor: req.total_minor ?? 0,
    label: req.code ?? "Requisition",
  });
  if (!sub.ok) return { ok: false, message: sub.message };

  await supabase
    .from("requisitions")
    .update({ status: "pending_approval", approval_request_id: sub.requestId })
    .eq("id", reqId);

  revalidatePath(`/procurement/requisitions/${reqId}`);
  revalidatePath("/procurement");
  return { ok: true, message: "Submitted for approval." };
}

/** Convert an approved requisition into a PO, carrying its lines (PRD §2E). */
export async function convertRequisitionToPO(reqId: string, vendorPartyId?: string): Promise<Result> {
  const { denied } = await guard("procurement.create");
  if (denied) return denied;
  const supabase = await createClient();

  const { data: req } = await supabase
    .from("requisitions")
    .select("id, status, total_minor, currency_code, project_id")
    .eq("id", reqId)
    .single();
  if (!req) return { ok: false, message: "Requisition not found." };
  if (req.status !== "approved") return { ok: false, message: "Only approved requisitions convert to a PO." };

  const { data: po, error: poErr } = await supabase
    .from("purchase_orders")
    .insert({
      vendor_party_id: vendorPartyId ?? null,
      requisition_id: reqId,
      status: "draft",
      total_minor: req.total_minor ?? 0,
      currency_code: req.currency_code ?? "KES",
      project_id: req.project_id ?? null,
    })
    .select("id")
    .single();
  if (poErr) return { ok: false, message: poErr.message };

  const { data: lines } = await supabase
    .from("requisition_lines")
    .select("item_desc, qty, est_unit_price_minor, account_id")
    .eq("req_id", reqId);
  if (lines?.length) {
    await supabase.from("po_lines").insert(
      lines.map((l) => ({
        po_id: po.id,
        item_desc: l.item_desc,
        qty_ordered: l.qty,
        qty_received: 0,
        unit_price_minor: l.est_unit_price_minor,
        account_id: l.account_id,
      }))
    );
  }
  await supabase.from("requisitions").update({ status: "converted" }).eq("id", reqId);

  revalidatePath("/procurement");
  return { ok: true, message: "Converted to PO.", id: po.id };
}

/** Issue a PO to the vendor. */
export async function issuePO(poId: string): Promise<Result> {
  const { denied } = await guard("procurement.edit");
  if (denied) return denied;
  const supabase = await createClient();
  const { error } = await supabase.from("purchase_orders").update({ status: "issued" }).eq("id", poId);
  if (error) return { ok: false, message: error.message };
  revalidatePath(`/procurement/pos/${poId}`);
  return { ok: true, message: "PO issued." };
}

/** Receive goods against a PO: creates a GRN, updates received qty + PO status. */
export async function receivePO(
  poId: string,
  receipts: { po_line_id: string; qty: number; condition?: string }[]
): Promise<Result> {
  const { me, denied } = await guard("procurement.edit");
  if (denied) return denied;
  const supabase = await createClient();

  const { data: grn, error: grnErr } = await supabase
    .from("grns")
    .insert({ po_id: poId, received_by: me!.id, status: "received" })
    .select("id")
    .single();
  if (grnErr) return { ok: false, message: grnErr.message };

  // Record GRN lines and bump po_lines.qty_received.
  for (const r of receipts.filter((x) => x.qty > 0)) {
    await supabase.from("grn_lines").insert({
      grn_id: grn.id,
      po_line_id: r.po_line_id,
      qty_received: r.qty,
      condition: r.condition ?? "good",
    });
    const { data: line } = await supabase
      .from("po_lines")
      .select("qty_received")
      .eq("id", r.po_line_id)
      .single();
    await supabase
      .from("po_lines")
      .update({ qty_received: Number(line?.qty_received ?? 0) + r.qty })
      .eq("id", r.po_line_id);
  }

  // Recompute PO status from line fulfilment.
  const { data: lines } = await supabase
    .from("po_lines")
    .select("qty_ordered, qty_received")
    .eq("po_id", poId);
  const all = lines ?? [];
  const fully = all.every((l) => Number(l.qty_received) >= Number(l.qty_ordered));
  const any = all.some((l) => Number(l.qty_received) > 0);
  const status = fully ? "received" : any ? "partially_received" : "issued";
  await supabase.from("purchase_orders").update({ status }).eq("id", poId);

  revalidatePath(`/procurement/pos/${poId}`);
  return { ok: true, message: `Goods received — PO ${status.replace(/_/g, " ")}.`, id: grn.id };
}

/** Create a payable invoice draft from a PO (vendor portals also feed this). */
export async function createPayableFromPO(poId: string): Promise<Result> {
  const { denied } = await guard("finance.create");
  if (denied) return denied;
  const supabase = await createClient();
  const { data: po } = await supabase
    .from("purchase_orders")
    .select("id, vendor_party_id, total_minor, currency_code")
    .eq("id", poId)
    .single();
  if (!po) return { ok: false, message: "PO not found." };

  const { data: inv, error } = await supabase
    .from("payable_invoices")
    .insert({
      vendor_party_id: po.vendor_party_id,
      po_id: poId,
      amount_minor: po.total_minor ?? 0,
      currency_code: po.currency_code ?? "KES",
      status: "draft",
      match_status: "unmatched",
    })
    .select("id")
    .single();
  if (error) return { ok: false, message: error.message };
  revalidatePath(`/procurement/invoices/${inv.id}`);
  return { ok: true, message: "Payable invoice drafted.", id: inv.id };
}

/** Three-way match: invoice vs PO total vs goods actually received (PRD §2G). */
export async function matchInvoice(invoiceId: string): Promise<Result> {
  const { denied } = await guard("finance.edit");
  if (denied) return denied;
  const supabase = await createClient();

  const { data: inv } = await supabase
    .from("payable_invoices")
    .select("id, po_id, amount_minor")
    .eq("id", invoiceId)
    .single();
  if (!inv?.po_id) return { ok: false, message: "Invoice has no PO to match against." };

  const { data: po } = await supabase.from("purchase_orders").select("total_minor").eq("id", inv.po_id).single();
  const { data: lines } = await supabase.from("po_lines").select("qty_received, unit_price_minor").eq("po_id", inv.po_id);
  const received = (lines ?? []).reduce((s, l) => s + Number(l.qty_received) * Number(l.unit_price_minor), 0);
  const poTotal = Number(po?.total_minor ?? 0);
  const amt = Number(inv.amount_minor ?? 0);

  // 1% tolerance on both comparisons.
  const tol = (a: number, b: number) => Math.abs(a - b) <= Math.max(100, Math.round(b * 0.01));
  const matched = tol(amt, poTotal) && tol(amt, received);

  await supabase
    .from("payable_invoices")
    .update({ match_status: matched ? "matched" : "variance", status: matched ? "matched" : "draft" })
    .eq("id", invoiceId);

  revalidatePath(`/procurement/invoices/${invoiceId}`);
  return {
    ok: true,
    message: matched
      ? "Three-way match OK — invoice ready to schedule."
      : `Variance flagged: invoice ${amt / 100} vs PO ${poTotal / 100} vs received ${received / 100}.`,
  };
}

/** Pay a matched invoice via a one-off payment run (mock M-Pesa/bank ref). */
export async function payInvoice(invoiceId: string, method: "mpesa" | "bank"): Promise<Result> {
  const { denied } = await guard("finance.edit");
  if (denied) return denied;
  const supabase = await createClient();

  const { data: inv } = await supabase
    .from("payable_invoices")
    .select("id, vendor_party_id, amount_minor, status, match_status")
    .eq("id", invoiceId)
    .single();
  if (!inv) return { ok: false, message: "Invoice not found." };
  if (inv.match_status === "variance") return { ok: false, message: "Resolve the variance before paying." };

  const { data: run } = await supabase
    .from("payment_runs")
    .insert({ status: "executed", total_minor: inv.amount_minor })
    .select("id, code")
    .single();

  const ref = `${method.toUpperCase()}-${(run?.code ?? "PAY").replace(/[^0-9]/g, "")}-${invoiceId.slice(0, 6).toUpperCase()}`;
  await supabase.from("payments").insert({
    run_id: run?.id,
    payable_invoice_id: invoiceId,
    vendor_party_id: inv.vendor_party_id,
    method,
    amount_minor: inv.amount_minor,
    status: "paid",
    external_ref: ref,
  });
  await supabase.from("payable_invoices").update({ status: "paid" }).eq("id", invoiceId);

  revalidatePath(`/procurement/invoices/${invoiceId}`);
  return { ok: true, message: `Paid via ${method}. Ref ${ref}.` };
}
