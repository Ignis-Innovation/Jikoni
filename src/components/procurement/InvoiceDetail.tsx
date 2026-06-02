import { useState } from "react";
import { Button, Badge, Card, Select } from "@/components/ui/primitives";
import { formatMoney } from "@/lib/utils";
import { matchInvoice, payInvoice } from "@/lib/spine/procurement";

type Invoice = {
  id: string; code: string | null; amount_minor: number; currency_code: string;
  status: string; match_status: string; invoice_no: string | null;
  vendor_name: string | null; po_id: string | null; po_code: string | null;
};

const TONE: Record<string, "zinc" | "amber" | "green" | "blue"> = {
  draft: "zinc", matched: "blue", approved: "blue", scheduled: "amber", paid: "green",
};
const MTONE: Record<string, "zinc" | "green" | "red"> = { unmatched: "zinc", matched: "green", variance: "red" };

export function InvoiceDetail({
  invoice, poTotal, received, caps, onChanged,
}: {
  invoice: Invoice; poTotal: number; received: number; caps: { finance: boolean };
  onChanged: () => void;
}) {
  const [method, setMethod] = useState<"mpesa" | "bank">("mpesa");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  async function run(fn: () => Promise<{ ok: boolean; message: string }>) {
    setBusy(true); setMsg(null);
    const res = await fn();
    setBusy(false); setMsg(res.message);
    if (res.ok) onChanged();
  }

  const cur = invoice.currency_code;
  const figures = [
    { label: "Invoice", value: invoice.amount_minor },
    { label: `PO ${invoice.po_code ?? ""}`, value: poTotal },
    { label: "Goods received", value: received },
  ];

  return (
    <div className="mx-auto max-w-4xl space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <p className="text-xs text-zinc-400">Procure-to-Pay · Payable</p>
          <h1 className="flex items-center gap-3 text-xl font-semibold tracking-tight text-zinc-900">
            {invoice.code ?? "Invoice"}
            <Badge tone={TONE[invoice.status] ?? "zinc"}>{invoice.status}</Badge>
            <Badge tone={MTONE[invoice.match_status] ?? "zinc"}>{invoice.match_status}</Badge>
          </h1>
          <p className="text-sm text-zinc-500">Vendor: {invoice.vendor_name ?? "—"}</p>
        </div>
        <div className="text-right">
          <p className="text-xs text-zinc-400">Amount</p>
          <p className="text-lg font-semibold text-zinc-900">{formatMoney(invoice.amount_minor, cur)}</p>
        </div>
      </div>

      {/* Three-way match panel (PRD §2G) */}
      <Card>
        <h2 className="mb-3 text-sm font-semibold text-zinc-900">Three-way match</h2>
        <div className="grid grid-cols-3 gap-3">
          {figures.map((f) => (
            <div key={f.label} className="rounded-lg border border-zinc-200 p-3">
              <p className="text-[11px] text-zinc-500">{f.label}</p>
              <p className="text-base font-semibold text-zinc-900">{formatMoney(f.value, cur)}</p>
            </div>
          ))}
        </div>
        {invoice.match_status === "variance" && (
          <p className="mt-3 rounded-md bg-red-50 px-3 py-2 text-xs text-red-700">
            Figures don&apos;t reconcile within tolerance — payment is blocked until resolved.
          </p>
        )}
        {caps.finance && invoice.po_id && invoice.status !== "paid" && (
          <Button className="mt-4" disabled={busy} onClick={() => run(() => matchInvoice(invoice.id))}>
            Run three-way match
          </Button>
        )}
      </Card>

      {/* Payment */}
      <Card>
        <h2 className="mb-3 text-sm font-semibold text-zinc-900">Payment</h2>
        {invoice.status === "paid" ? (
          <p className="text-sm text-emerald-700">Paid. ✓</p>
        ) : invoice.match_status === "matched" && caps.finance ? (
          <div className="flex items-center gap-2">
            <Select value={method} onChange={(e) => setMethod(e.target.value as "mpesa" | "bank")} className="w-40">
              <option value="mpesa">M-Pesa</option>
              <option value="bank">Bank</option>
            </Select>
            <Button disabled={busy} onClick={() => run(() => payInvoice(invoice.id, method))}>Pay now</Button>
          </div>
        ) : (
          <p className="text-sm text-zinc-500">Invoice must pass the three-way match before it can be paid.</p>
        )}
        {msg && <p className="mt-3 text-xs text-zinc-500">{msg}</p>}
      </Card>
    </div>
  );
}
