import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { Button, Input, Badge, Card } from "@/components/ui/primitives";
import { formatMoney } from "@/lib/utils";
import { issuePO, receivePO, createPayableFromPO } from "@/lib/spine/procurement";

type PO = { id: string; code: string | null; status: string; total_minor: number; currency_code: string; vendor_name: string | null };
type Line = { id: string; item_desc: string; qty_ordered: number; qty_received: number; unit_price_minor: number };

const TONE: Record<string, "zinc" | "amber" | "green" | "blue"> = {
  draft: "zinc", issued: "blue", partially_received: "amber", received: "green", closed: "zinc",
};

export function PODetail({
  po, lines, existingInvoiceId, caps, onChanged,
}: {
  po: PO; lines: Line[]; existingInvoiceId: string | null;
  caps: { edit: boolean; finance: boolean };
  onChanged: () => void;
}) {
  const navigate = useNavigate();
  const [receiving, setReceiving] = useState(false);
  const [recv, setRecv] = useState<Record<string, number>>({});
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  async function run(fn: () => Promise<{ ok: boolean; message: string; id?: string }>, after?: (id?: string) => void) {
    setBusy(true); setMsg(null);
    const res = await fn();
    setBusy(false); setMsg(res.message);
    if (res.ok) { after?.(res.id); onChanged(); }
  }

  function doReceive() {
    const receipts = lines
      .map((l) => ({ po_line_id: l.id, qty: recv[l.id] ?? 0 }))
      .filter((r) => r.qty > 0);
    if (receipts.length === 0) { setMsg("Enter at least one received quantity."); return; }
    run(() => receivePO(po.id, receipts), () => { setReceiving(false); setRecv({}); });
  }

  return (
    <div className="mx-auto max-w-4xl space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <p className="text-xs text-muted-foreground">Procure-to-Pay · Purchase Order</p>
          <h1 className="flex items-center gap-3 text-xl font-semibold tracking-tight text-foreground">
            {po.code ?? "PO"}
            <Badge tone={TONE[po.status] ?? "zinc"}>{po.status.replace(/_/g, " ")}</Badge>
          </h1>
          <p className="text-sm text-muted-foreground">Vendor: {po.vendor_name ?? "—"}</p>
        </div>
        <div className="text-right">
          <p className="text-xs text-muted-foreground">Total</p>
          <p className="text-lg font-semibold text-foreground">{formatMoney(po.total_minor, po.currency_code)}</p>
        </div>
      </div>

      <Card>
        <h2 className="mb-3 text-sm font-semibold text-foreground">Lines</h2>
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left text-xs uppercase tracking-wider text-muted-foreground">
              <th className="pb-2 font-medium">Item</th>
              <th className="pb-2 font-medium w-24">Ordered</th>
              <th className="pb-2 font-medium w-24">Received</th>
              <th className="pb-2 font-medium w-32 text-right">Unit price</th>
              {receiving && <th className="pb-2 font-medium w-28">Receive now</th>}
            </tr>
          </thead>
          <tbody>
            {lines.map((l) => {
              const outstanding = l.qty_ordered - l.qty_received;
              return (
                <tr key={l.id} className="border-t border-border">
                  <td className="py-2 text-foreground">{l.item_desc}</td>
                  <td className="py-2 text-muted-foreground">{l.qty_ordered}</td>
                  <td className="py-2 text-muted-foreground">
                    {l.qty_received}
                    {l.qty_received >= l.qty_ordered ? <Badge tone="green" className="ml-2">full</Badge> : l.qty_received > 0 ? <Badge tone="amber" className="ml-2">partial</Badge> : null}
                  </td>
                  <td className="py-2 text-right text-muted-foreground">{formatMoney(l.unit_price_minor, po.currency_code)}</td>
                  {receiving && (
                    <td className="py-2">
                      <Input type="number" min={0} max={outstanding} value={recv[l.id] ?? ""} placeholder={`≤ ${outstanding}`}
                        onChange={(e) => setRecv((s) => ({ ...s, [l.id]: Math.min(outstanding, Number(e.target.value)) }))} />
                    </td>
                  )}
                </tr>
              );
            })}
            {lines.length === 0 && <tr><td colSpan={receiving ? 5 : 4} className="py-6 text-center text-sm text-muted-foreground">No lines.</td></tr>}
          </tbody>
        </table>
      </Card>

      <Card>
        <h2 className="mb-3 text-sm font-semibold text-foreground">Workflow</h2>
        <div className="flex flex-wrap items-center gap-2">
          {po.status === "draft" && caps.edit && (
            <Button disabled={busy} onClick={() => run(() => issuePO(po.id))}>Issue PO</Button>
          )}
          {(po.status === "issued" || po.status === "partially_received") && caps.edit && (
            receiving ? (
              <>
                <Button disabled={busy} onClick={doReceive}>Confirm receipt (GRN)</Button>
                <Button variant="ghost" onClick={() => setReceiving(false)}>Cancel</Button>
              </>
            ) : (
              <Button onClick={() => setReceiving(true)}>Receive goods</Button>
            )
          )}
          {(po.status === "received" || po.status === "partially_received") && caps.finance && (
            existingInvoiceId ? (
              <Button variant="outline" onClick={() => navigate(`/procurement/invoices/${existingInvoiceId}`)}>View payable invoice</Button>
            ) : (
              <Button disabled={busy} onClick={() => run(() => createPayableFromPO(po.id), (id) => id && navigate(`/procurement/invoices/${id}`))}>
                Create payable invoice
              </Button>
            )
          )}
        </div>
        {msg && <p className="mt-3 text-xs text-muted-foreground">{msg}</p>}
      </Card>
    </div>
  );
}
