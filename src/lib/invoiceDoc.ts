// Maps a stored sales invoice (or the invoice form) onto the PDF builder's input.
// Issued invoices use the bank/"from" details snapshotted at issue; drafts use the
// live Settings → Invoicing values (T&C too).
export const termsText = (cfg: Record<string, any>): string => String(cfg.invoice_terms_conditions ?? "").trim();
import type { SalesInvoice, BankDetails, FromDetails } from "../store";
import { downloadInvoicePdf, previewInvoicePdf, type InvoicePdfData } from "./invoicePdf";

export const bankFor = (cfg: Record<string, any>, currency: string): BankDetails | null =>
  (cfg[currency === "USD" ? "invoice_bank_usd" : "invoice_bank_kes"] as BankDetails) ?? null;
export const fromDetails = (cfg: Record<string, any>): FromDetails =>
  (cfg.invoice_from as FromDetails) ?? { company: "Ignis Innovation Limited", address: "Nairobi, Kenya", email: "info@ignis-innovation.com" };

export function invoiceToPdf(inv: SalesInvoice, cfg: Record<string, any>): InvoicePdfData {
  const draft = inv.state === "draft";
  return {
    number: inv.id, status: inv.status, invoiceDate: inv.invoiceDate, dueDate: inv.dueDate, terms: inv.terms,
    customer: inv.customer, billToAddress: inv.billToAddress, billToContact: inv.billToContact, billToEmail: inv.billToEmail,
    engagementRef: inv.engagementRef, poNumber: inv.poNumber, currency: inv.currency,
    lines: inv.lines, subtotal: inv.subtotal, vatApplicable: inv.vatApplicable, vatRate: inv.vatRate, vatInclusive: inv.vatInclusive, vat: inv.vat,
    total: inv.total, paid: inv.paid, notes: inv.notes,
    paymentDetails: inv.includePaymentDetails ? (draft ? bankFor(cfg, inv.currency) : inv.paymentDetails) : null,
    paymentNote: inv.includePaymentDetails ? String(cfg.invoice_payment_note ?? "") : null,
    from: (draft ? null : inv.fromDetails) ?? fromDetails(cfg),
    termsConditions: draft ? (inv.includeTerms ? termsText(cfg) || null : null) : inv.termsConditions,
  };
}
export const downloadInvoice = (inv: SalesInvoice, cfg: Record<string, any>) => downloadInvoicePdf(invoiceToPdf(inv, cfg));
export const previewInvoice = (inv: SalesInvoice, cfg: Record<string, any>) => previewInvoicePdf(invoiceToPdf(inv, cfg));

export const INVOICE_STATUS: Record<string, { l: string; cls: string }> = {
  draft: { l: "Draft", cls: "done" },
  issued: { l: "Issued", cls: "week" },
  partially_paid: { l: "Partially paid", cls: "today" },
  paid: { l: "Paid", cls: "done" },
  overdue: { l: "Overdue", cls: "over" },
  cancelled: { l: "Cancelled", cls: "done" },
};
export const money2 = (n: number) => n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
export const curMoney = (cur: string, n: number) => `${cur} ${money2(n)}`;

// Calendar dates in Nairobi time (the DB uses the same rule — public.ke_today()).
export const keToday = () => new Date().toLocaleDateString("en-CA", { timeZone: "Africa/Nairobi" });
export const addDaysIso = (iso: string, d: number) => {
  const t = new Date(iso + "T00:00:00Z"); t.setUTCDate(t.getUTCDate() + d); return t.toISOString().slice(0, 10);
};
