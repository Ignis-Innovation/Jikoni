import { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { Button, Input, Badge, Card, Select } from "@/components/ui/primitives";
import { Stepper } from "@/components/ui/Stepper";
import { formatMoney } from "@/lib/utils";
import { Trash2, Plus, ArrowLeft } from "lucide-react";
import { saveRequisitionLines, submitRequisition, convertRequisitionToPO, type LineInput } from "@/lib/spine/procurement";

const REQ_STEPS = ["Draft", "Approval", "Approved", "Converted"];
const REQ_STEP_IDX: Record<string, number> = { draft: 0, pending_approval: 1, approved: 2, converted: 3, rejected: 1 };

type Req = {
  id: string; code: string | null; status: string; total_minor: number;
  currency_code: string; need_by_date: string | null;
};

const TONE: Record<string, "zinc" | "amber" | "green" | "red" | "blue"> = {
  draft: "zinc", pending_approval: "amber", approved: "green", rejected: "red", converted: "blue",
};

export function RequisitionDetail({
  req, initialLines, vendors, caps, onChanged,
}: {
  req: Req;
  initialLines: LineInput[];
  vendors: { id: string; display_name: string }[];
  caps: { edit: boolean; create: boolean };
  onChanged: () => void;
}) {
  const navigate = useNavigate();
  const [lines, setLines] = useState<LineInput[]>(initialLines.length ? initialLines : []);
  const [vendor, setVendor] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const editable = req.status === "draft" && caps.edit;

  const total = lines.reduce((s, l) => s + Math.round((l.qty || 0) * (l.est_unit_price_minor || 0)), 0);

  function setLine(i: number, patch: Partial<LineInput>) {
    setLines((ls) => ls.map((l, idx) => (idx === i ? { ...l, ...patch } : l)));
  }
  function addLine() {
    setLines((ls) => [...ls, { item_desc: "", qty: 1, est_unit_price_minor: 0 }]);
  }

  async function run(fn: () => Promise<{ ok: boolean; message: string; id?: string }>, after?: (id?: string) => void) {
    setBusy(true); setMsg(null);
    const res = await fn();
    setBusy(false); setMsg(res.message);
    if (res.ok) { after?.(res.id); onChanged(); }
  }

  return (
    <div className="mx-auto max-w-4xl space-y-6">
      <Link to="/procurement/requisitions" className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground">
        <ArrowLeft className="h-3.5 w-3.5" /> Requisitions
      </Link>
      <div className="flex items-center justify-between">
        <div>
          <p className="text-xs text-muted-foreground">Procure-to-Pay · Requisition</p>
          <h1 className="flex items-center gap-3 text-xl font-semibold tracking-tight text-foreground">
            {req.code ?? "Draft"}
            <Badge tone={TONE[req.status] ?? "zinc"}>{req.status.replace(/_/g, " ")}</Badge>
          </h1>
        </div>
        <div className="text-right">
          <p className="text-xs text-muted-foreground">Total</p>
          <p className="text-lg font-semibold text-foreground">{formatMoney(total, req.currency_code)}</p>
        </div>
      </div>

      <Card className="px-5 py-4">
        <Stepper steps={REQ_STEPS} current={REQ_STEP_IDX[req.status] ?? 0} />
      </Card>

      <Card>
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-sm font-semibold text-foreground">Line items</h2>
          {editable && <Button size="sm" variant="outline" onClick={addLine}><Plus className="h-3.5 w-3.5" /> Add line</Button>}
        </div>
        <table className="w-full text-[15px]">
          <thead>
            <tr className="text-left text-xs uppercase tracking-wider text-muted-foreground">
              <th className="pb-2 font-medium">Item</th>
              <th className="pb-2 font-medium w-20">Qty</th>
              <th className="pb-2 font-medium w-36">Unit price</th>
              <th className="pb-2 font-medium w-32 text-right">Line total</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {lines.map((l, i) => (
              <tr key={i} className="border-t border-border">
                <td className="py-2.5 pr-2">
                  <Input value={l.item_desc} disabled={!editable} onChange={(e) => setLine(i, { item_desc: e.target.value })} placeholder="Description" />
                </td>
                <td className="py-2.5 pr-2">
                  <Input type="number" value={l.qty} disabled={!editable} onChange={(e) => setLine(i, { qty: Number(e.target.value) })} />
                </td>
                <td className="py-2.5 pr-2">
                  <Input type="number" step="0.01" value={l.est_unit_price_minor / 100} disabled={!editable}
                    onChange={(e) => setLine(i, { est_unit_price_minor: Math.round(Number(e.target.value) * 100) })} />
                </td>
                <td className="py-2.5 text-right text-foreground">{formatMoney(Math.round(l.qty * l.est_unit_price_minor), req.currency_code)}</td>
                <td className="py-2.5 pl-2 text-right">
                  {editable && (
                    <button onClick={() => setLines((ls) => ls.filter((_, idx) => idx !== i))} className="text-muted-foreground hover:text-red-600">
                      <Trash2 className="h-4 w-4" />
                    </button>
                  )}
                </td>
              </tr>
            ))}
            {lines.length === 0 && (
              <tr><td colSpan={5} className="py-6 text-center text-sm text-muted-foreground">No lines yet.</td></tr>
            )}
          </tbody>
        </table>
        {editable && (
          <div className="mt-4">
            <Button disabled={busy} onClick={() => run(() => saveRequisitionLines(req.id, lines.filter((l) => l.item_desc.trim())))}>
              {busy ? "Saving…" : "Save lines"}
            </Button>
          </div>
        )}
      </Card>

      {/* Workflow actions reflect status (PRD §2D/§2E). */}
      <Card>
        <h2 className="mb-3 text-sm font-semibold text-foreground">Workflow</h2>
        <div className="flex flex-wrap items-center gap-2">
          {req.status === "draft" && caps.edit && (
            <Button disabled={busy || lines.length === 0} onClick={() => run(() => submitRequisition(req.id))}>
              Submit for approval
            </Button>
          )}
          {req.status === "pending_approval" && (
            <p className="text-sm text-amber-700">Waiting on an approver — see the Procurement hub inbox.</p>
          )}
          {req.status === "approved" && caps.create && (
            <div className="flex items-center gap-2">
              <Select value={vendor} onChange={(e) => setVendor(e.target.value)} className="w-56">
                <option value="">Select vendor…</option>
                {vendors.map((v) => <option key={v.id} value={v.id}>{v.display_name}</option>)}
              </Select>
              <Button disabled={busy || !vendor}
                onClick={() => run(() => convertRequisitionToPO(req.id, vendor), (id) => id && navigate(`/procurement/pos/${id}`))}>
                Convert to PO
              </Button>
            </div>
          )}
          {req.status === "converted" && <p className="text-sm text-blue-700">Converted to a purchase order.</p>}
          {req.status === "rejected" && <p className="text-sm text-red-700">Rejected.</p>}
        </div>
        {msg && <p className="mt-3 text-xs text-muted-foreground">{msg}</p>}
      </Card>
    </div>
  );
}
