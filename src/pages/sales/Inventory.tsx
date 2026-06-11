import { useState } from "react";
import { supabase } from "@/lib/supabase";
import { useAuth, can } from "@/lib/auth";
import { useData } from "@/lib/useData";
import { Button, Input, Label, Badge, PageHeader, Table, THead, TBody, TH, TR, TD } from "@/components/ui/primitives";
import { Modal } from "@/components/data/Modal";
import { formatDate } from "@/lib/utils";
import { Boxes } from "lucide-react";

type Row = {
  product_id: string; qty_on_hand: number; reorder_level: number; last_restock_date: string | null;
  products: { name: string; code: string | null } | null;
};

export default function Inventory() {
  const { user } = useAuth();
  const [restock, setRestock] = useState<Row | null>(null);
  const canEdit = can(user, "sales.edit");

  const { data: rows, reload } = useData(async () => {
    const { data } = await supabase
      .from("inventory")
      .select("product_id, qty_on_hand, reorder_level, last_restock_date, products(name, code)")
      .order("qty_on_hand", { ascending: true })
      .limit(300);
    return (data ?? []) as unknown as Row[];
  }, []);

  if (!can(user, "sales.view")) return <p className="text-sm text-muted-foreground">No access.</p>;

  const low = (rows ?? []).filter((r) => Number(r.qty_on_hand) <= Number(r.reorder_level)).length;

  return (
    <div className="mx-auto max-w-5xl">
      <PageHeader eyebrow="Sales" title="Inventory" subtitle={low ? `${low} item(s) at or below reorder level.` : "Stock on hand per product."} icon={Boxes} />
      <Table>
        <THead><TH>SKU</TH><TH>Product</TH><TH>On hand</TH><TH>Reorder at</TH><TH>Last restock</TH><TH /></THead>
        <TBody>
          {(rows ?? []).map((r) => {
            const isLow = Number(r.qty_on_hand) <= Number(r.reorder_level);
            return (
              <TR key={r.product_id}>
                <TD className="font-medium text-foreground">{r.products?.code ?? "—"}</TD>
                <TD>{r.products?.name ?? "—"}</TD>
                <TD><Badge tone={isLow ? "red" : "green"}>{Number(r.qty_on_hand)}</Badge></TD>
                <TD>{Number(r.reorder_level)}</TD>
                <TD>{formatDate(r.last_restock_date)}</TD>
                <TD className="text-right">{canEdit && <Button size="sm" variant="outline" onClick={() => setRestock(r)}>Restock</Button>}</TD>
              </TR>
            );
          })}
          {(!rows || rows.length === 0) && <TR><TD colSpan={6} className="py-12 text-center">No products in stock. Add products first.</TD></TR>}
        </TBody>
      </Table>

      {restock && <RestockForm row={restock} onClose={() => setRestock(null)} onDone={() => { setRestock(null); reload(); }} />}
    </div>
  );
}

function RestockForm({ row, onClose, onDone }: { row: Row; onClose: () => void; onDone: () => void }) {
  const [qty, setQty] = useState("");
  const [reorder, setReorder] = useState(String(row.reorder_level));
  const [busy, setBusy] = useState(false);

  async function submit() {
    const add = Number(qty || 0);
    setBusy(true);
    const newQty = Number(row.qty_on_hand) + add;
    const { error } = await supabase.from("inventory").update({
      qty_on_hand: newQty,
      reorder_level: Number(reorder || 0),
      last_restock_date: add > 0 ? new Date().toISOString().slice(0, 10) : row.last_restock_date,
    }).eq("product_id", row.product_id);
    if (error) { setBusy(false); return alert(error.message); }
    if (add > 0) {
      await supabase.from("inventory_movements").insert({
        product_id: row.product_id, delta: add, reason: "restock", note: "Manual restock",
      });
    }
    setBusy(false);
    onDone();
  }

  return (
    <Modal open title={`Restock — ${row.products?.name ?? ""}`} onClose={onClose}>
      <div className="space-y-3">
        <p className="text-sm text-muted-foreground">Current on hand: <strong className="text-foreground">{Number(row.qty_on_hand)}</strong></p>
        <div><Label>Add quantity</Label><Input type="number" value={qty} onChange={(e) => setQty(e.target.value)} placeholder="0" /></div>
        <div><Label>Reorder level</Label><Input type="number" value={reorder} onChange={(e) => setReorder(e.target.value)} /></div>
        <div className="flex justify-end gap-2 pt-2">
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button onClick={submit} disabled={busy}>{busy ? "Saving…" : "Save"}</Button>
        </div>
      </div>
    </Modal>
  );
}
