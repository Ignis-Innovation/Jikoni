import { useState } from "react";
import { supabase } from "@/lib/supabase";
import { useAuth, can } from "@/lib/auth";
import { useData } from "@/lib/useData";
import { Button, Input, Label, Badge, PageHeader, Table, THead, TBody, TH, TR, TD } from "@/components/ui/primitives";
import { Modal } from "@/components/data/Modal";
import { formatMoney } from "@/lib/utils";
import { Package, Plus } from "lucide-react";

type Product = {
  id: string; code: string | null; name: string;
  cost_minor: number; price_minor: number; currency_code: string; active: boolean;
};

export default function Products() {
  const { user } = useAuth();
  const [editing, setEditing] = useState<Product | "new" | null>(null);
  const canEdit = can(user, "sales.edit") || can(user, "sales.create");

  const { data: rows, reload } = useData(async () => {
    const { data } = await supabase
      .from("products")
      .select("id, code, name, cost_minor, price_minor, currency_code, active")
      .is("deleted_at", null).order("created_at", { ascending: false }).limit(300);
    return (data ?? []) as Product[];
  }, []);

  async function toggleActive(p: Product) {
    const { error } = await supabase.from("products").update({ active: !p.active }).eq("id", p.id);
    if (error) return alert(error.message);
    reload();
  }

  if (!can(user, "sales.view")) return <p className="text-sm text-muted-foreground">No access.</p>;

  return (
    <div className="mx-auto max-w-5xl">
      <PageHeader
        eyebrow="Sales" title="Products" subtitle="Catalogue — SKU, cost and selling price." icon={Package}
        actions={canEdit && <Button onClick={() => setEditing("new")}><Plus className="h-4 w-4" /> New product</Button>}
      />
      <Table>
        <THead><TH>SKU</TH><TH>Name</TH><TH>Cost</TH><TH>Price</TH><TH>Status</TH><TH /></THead>
        <TBody>
          {(rows ?? []).map((p) => (
            <TR key={p.id}>
              <TD className="font-medium text-foreground">{p.code ?? "—"}</TD>
              <TD>{p.name}</TD>
              <TD>{formatMoney(p.cost_minor, p.currency_code)}</TD>
              <TD>{formatMoney(p.price_minor, p.currency_code)}</TD>
              <TD><Badge tone={p.active ? "green" : "zinc"}>{p.active ? "active" : "inactive"}</Badge></TD>
              <TD className="text-right">
                {canEdit && (
                  <span className="flex justify-end gap-2">
                    <Button size="sm" variant="outline" onClick={() => setEditing(p)}>Edit</Button>
                    <Button size="sm" variant="ghost" onClick={() => toggleActive(p)}>{p.active ? "Disable" : "Enable"}</Button>
                  </span>
                )}
              </TD>
            </TR>
          ))}
          {(!rows || rows.length === 0) && <TR><TD colSpan={6} className="py-12 text-center">No products yet.</TD></TR>}
        </TBody>
      </Table>

      {editing && <ProductForm product={editing === "new" ? null : editing} onClose={() => setEditing(null)} onDone={() => { setEditing(null); reload(); }} />}
    </div>
  );
}

function ProductForm({ product, onClose, onDone }: { product: Product | null; onClose: () => void; onDone: () => void }) {
  const [form, setForm] = useState({
    name: product?.name ?? "",
    cost: product ? String(product.cost_minor / 100) : "",
    price: product ? String(product.price_minor / 100) : "",
  });
  const [busy, setBusy] = useState(false);
  const set = (k: string, v: string) => setForm((f) => ({ ...f, [k]: v }));

  async function submit() {
    if (!form.name.trim()) return alert("Name is required");
    setBusy(true);
    const payload = {
      name: form.name.trim(),
      cost_minor: Math.round(Number(form.cost || 0) * 100),
      price_minor: Math.round(Number(form.price || 0) * 100),
    };
    const q = product
      ? supabase.from("products").update(payload).eq("id", product.id)
      : supabase.from("products").insert(payload);
    const { error } = await q;
    setBusy(false);
    if (error) return alert(error.message);
    onDone();
  }

  return (
    <Modal open title={product ? "Edit product" : "New product"} onClose={onClose}>
      <div className="space-y-3">
        <div><Label required>Name</Label><Input value={form.name} onChange={(e) => set("name", e.target.value)} /></div>
        <div className="grid grid-cols-2 gap-3">
          <div><Label>Cost (KES)</Label><Input type="number" value={form.cost} onChange={(e) => set("cost", e.target.value)} /></div>
          <div><Label>Price (KES)</Label><Input type="number" value={form.price} onChange={(e) => set("price", e.target.value)} /></div>
        </div>
        <p className="text-xs text-muted-foreground">A SKU code is generated automatically. Stock is managed under Inventory.</p>
        <div className="flex justify-end gap-2 pt-2">
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button onClick={submit} disabled={busy}>{busy ? "Saving…" : "Save"}</Button>
        </div>
      </div>
    </Modal>
  );
}
