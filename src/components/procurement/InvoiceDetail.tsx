import { useState } from "react";
import { Link } from "react-router-dom";
import { Button, Badge, Card, Select } from "@/components/ui/primitives";
import { Stepper } from "@/components/ui/Stepper";
import { formatMoney } from "@/lib/utils";
import { ArrowLeft } from "lucide-react";
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
const INV_STEPS = ["Drafted", "Matched", "Paid"];
const INV_STEP_IDX: Record<string, number> = { draft: 0, matched: 1, approved: 1, scheduled: 1, paid: 2 };

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
    <div className="w-full space-y-6">
      <Link to="/procurement/invoices" className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground">
        <ArrowLeft className="h-3.5 w-3.5" /> Payables
      </Link>
      <div className="flex items-center justify-between">
        <div>
          <p className="text-xs text-muted-foreground">Procure-to-Pay · Payable</p>
          <h1 className="flex items-center gap-3 text-xl font-semibold tracking-tight text-foreground">
            {invoice.code ?? "Invoice"}
            <Badge tone={TONE[invoice.status] ?? "zinc"}>{invoice.status}</Badge>
            <Badge tone={MTONE[invoice.match_status] ?? "zinc"}>{invoice.match_status}</Badge>
          </h1>
          <p className="text-sm text-muted-foreground">Vendor: {invoice.vendor_name ?? "—"}</p>
        </div>
        <div className="text-right">
          <p className="text-xs text-muted-foreground">Amount</p>
          <p className="text-lg font-semibold text-foreground">{formatMoney(invoice.amount_minor, cur)}</p>
        </div>
      </div>

      <Card className="px-5 py-4">
        <Stepper steps={INV_STEPS} current={INV_STEP_IDX[invoice.status] ?? 0} />
      </Card>

      {/* Three-way match panel (PRD §2G) */}
      <Card>
        <h2 className="mb-3 text-sm font-semibold text-foreground">Three-way match</h2>
        <div className="grid grid-cols-3 gap-3">
          {figures.map((f) => (
            <div key={f.label} className="rounded-lg border border-border p-3">
              <p className="text-[11px] text-muted-foreground">{f.label}</p>
              <p className="text-base font-semibold text-foreground">{formatMoney(f.value, cur)}</p>
            </div>
          ))}
        </div>
        {invoice.match_status === "variance" && (
          <p className="mt-3 rounded-md bg-destructive/10 px-3 py-2 text-xs text-destructive">
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
        <h2 className="mb-3 text-sm font-semibold text-foreground">Payment</h2>
        {invoice.status === "paid" ? (
          <p className="text-sm text-primary">Paid. ✓</p>
        ) : invoice.match_status === "matched" && caps.finance ? (
          <div className="flex items-center gap-2">
            <Select value={method} onChange={(e) => setMethod(e.target.value as "mpesa" | "bank")} className="w-40">
              <option value="mpesa">M-Pesa</option>
              <option value="bank">Bank</option>
            </Select>
            <Button disabled={busy} onClick={() => run(() => payInvoice(invoice.id, method))}>Pay now</Button>
          </div>
        ) : (
          <p className="text-sm text-muted-foreground">Invoice must pass the three-way match before it can be paid.</p>
        )}
        {msg && <p className="mt-3 text-xs text-muted-foreground">{msg}</p>}
      </Card>
    </div>
  );
}
