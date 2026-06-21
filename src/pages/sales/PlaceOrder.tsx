import { useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { supabase } from "@/lib/supabase";
import { useAuth, can } from "@/lib/auth";
import { useData } from "@/lib/useData";
import { sendSalesEmail, startMpesaPush } from "@/lib/salesApi";
import { Button, Input, Label, Select, Card, PageHeader, Badge } from "@/components/ui/primitives";
import { Stepper } from "@/components/ui/Stepper";
import { formatMoney } from "@/lib/utils";
import { ShoppingCart, Trash2, Plus } from "lucide-react";

const STEPS = ["Account", "Products", "Review", "Payment"];

type Account = { party_id: string; parties: { display_name: string; email: string | null } | null };
type Product = { id: string; name: string; code: string | null; price_minor: number; qty_on_hand: number };
type Line = { product_id: string; qty: number };

export default function PlaceOrder() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [step, setStep] = useState(0);
  const [accountId, setAccountId] = useState("");
  const [lines, setLines] = useState<Line[]>([]);
  const [method, setMethod] = useState<"cash" | "mpesa" | "credit">("cash");
  const [phone, setPhone] = useState("");
  const [dueDate, setDueDate] = useState("");
  const [status, setStatus] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const { data: accounts } = useData(async () => {
    const { data } = await supabase
      .from("customer_profiles")
      .select("party_id, parties(display_name, email)")
      .eq("approval_status", "approved").is("deleted_at", null);
    return (data ?? []) as unknown as Account[];
  }, []);

  const { data: products } = useData(async () => {
    const { data } = await supabase
      .from("inventory")
      .select("qty_on_hand, products!inner(id, name, code, price_minor, active, deleted_at)")
      .gt("qty_on_hand", 0);
    return (data ?? [])
      .map((r: Record<string, unknown>) => {
        const p = r.products as Record<string, unknown>;
        return { id: p.id, name: p.name, code: p.code, price_minor: p.price_minor, qty_on_hand: r.qty_on_hand, active: p.active, deleted_at: p.deleted_at };
      })
      .filter((p) => p.active && !p.deleted_at) as unknown as Product[];
  }, []);

  const productById = useMemo(() => new Map((products ?? []).map((p) => [p.id, p])), [products]);
  const total = lines.reduce((s, l) => s + (productById.get(l.product_id)?.price_minor ?? 0) * l.qty, 0);
  const account = (accounts ?? []).find((a) => a.party_id === accountId);

  function addLine() {
    const first = (products ?? []).find((p) => !lines.some((l) => l.product_id === p.id));
    if (first) setLines((ls) => [...ls, { product_id: first.id, qty: 1 }]);
  }
  function updateLine(i: number, patch: Partial<Line>) {
    setLines((ls) => ls.map((l, idx) => (idx === i ? { ...l, ...patch } : l)));
  }

  const linesValid = lines.length > 0 && lines.every((l) => {
    const p = productById.get(l.product_id);
    return p && l.qty > 0 && l.qty <= Number(p.qty_on_hand);
  });

  async function confirm() {
    setBusy(true); setStatus(null);
    const payload = lines.map((l) => ({
      product_id: l.product_id, qty: l.qty,
      unit_price_minor: productById.get(l.product_id)?.price_minor ?? 0,
    }));
    const { data: invoiceId, error } = await supabase.rpc("place_sales_order", {
      p_customer_party_id: accountId,
      p_payment_method: method,
      p_lines: payload,
      p_due_date: method === "credit" ? (dueDate || null) : null,
      p_currency: "KES",
    });
    if (error) { setBusy(false); setStatus(`Error: ${error.message}`); return; }

    const email = account?.parties?.email;
    const { data: inv } = await supabase.from("receivable_invoices").select("code").eq("id", invoiceId).single();

    if (method === "cash") {
      if (email) sendSalesEmail(email, "order_paid", { account_name: account?.parties?.display_name, invoice_code: inv?.code, amount: formatMoney(total) }).catch(() => {});
      setBusy(false); navigate("/sales/orders"); return;
    }
    if (method === "credit") {
      if (email) sendSalesEmail(email, "order_unpaid", { account_name: account?.parties?.display_name, invoice_code: inv?.code, amount: formatMoney(total), due_date: dueDate }).catch(() => {});
      setBusy(false); navigate("/sales/invoices"); return;
    }
    // M-Pesa: trigger STK push, then poll the transaction.
    try {
      setStatus("Sending STK push — check the customer's phone…");
      await startMpesaPush(invoiceId as string, phone);
      await pollMpesa(invoiceId as string);
    } catch (e) {
      setBusy(false); setStatus(`M-Pesa error: ${(e as Error).message}`);
    }
  }

  async function pollMpesa(invoiceId: string) {
    for (let i = 0; i < 24; i++) { // ~2 min at 5s
      await new Promise((r) => setTimeout(r, 5000));
      const { data } = await supabase
        .from("mpesa_transactions").select("status").eq("invoice_id", invoiceId)
        .order("created_at", { ascending: false }).limit(1).maybeSingle();
      if (data?.status === "success") { setBusy(false); navigate("/sales/payments"); return; }
      if (data?.status === "failed") { setBusy(false); setStatus("Payment failed or was cancelled. The order is recorded as unpaid."); return; }
    }
    setBusy(false); setStatus("Still waiting on M-Pesa. Check Payments shortly — the callback will settle it.");
  }

  if (!can(user, "sales.create")) return <p className="text-sm text-muted-foreground">No access.</p>;

  return (
    <div className="w-full">
      <PageHeader eyebrow="Sales" title="Place order" icon={ShoppingCart} />
      <div className="mb-6 flex justify-center"><Stepper steps={STEPS} current={step} /></div>

      <Card>
        {/* Step 1 — account */}
        {step === 0 && (
          <div className="space-y-3">
            <Label required>Select an approved account</Label>
            <Select value={accountId} onChange={(e) => setAccountId(e.target.value)}>
              <option value="">— choose —</option>
              {(accounts ?? []).map((a) => <option key={a.party_id} value={a.party_id}>{a.parties?.display_name}</option>)}
            </Select>
            {(accounts ?? []).length === 0 && <p className="text-xs text-ember">No approved accounts yet. Approve an account first.</p>}
            <div className="flex justify-end"><Button disabled={!accountId} onClick={() => setStep(1)}>Next</Button></div>
          </div>
        )}

        {/* Step 2 — products */}
        {step === 1 && (
          <div className="space-y-3">
            {lines.map((l, i) => {
              const p = productById.get(l.product_id);
              const over = p && l.qty > Number(p.qty_on_hand);
              return (
                <div key={i} className="flex items-end gap-2">
                  <div className="flex-1">
                    <Label>Product</Label>
                    <Select value={l.product_id} onChange={(e) => updateLine(i, { product_id: e.target.value })}>
                      {(products ?? []).map((pr) => <option key={pr.id} value={pr.id}>{pr.name} ({Number(pr.qty_on_hand)} in stock)</option>)}
                    </Select>
                  </div>
                  <div className="w-24">
                    <Label>Qty</Label>
                    <Input type="number" min={1} value={l.qty} onChange={(e) => updateLine(i, { qty: Number(e.target.value) })} className={over ? "border-destructive" : ""} />
                  </div>
                  <div className="w-28 pb-2 text-right text-sm">{formatMoney((p?.price_minor ?? 0) * l.qty)}</div>
                  <Button variant="ghost" size="icon" onClick={() => setLines((ls) => ls.filter((_, idx) => idx !== i))}><Trash2 className="h-4 w-4" /></Button>
                </div>
              );
            })}
            <Button variant="outline" size="sm" onClick={addLine} disabled={(products ?? []).length === 0 || lines.length >= (products ?? []).length}>
              <Plus className="h-4 w-4" /> Add product
            </Button>
            {lines.some((l) => { const p = productById.get(l.product_id); return p && l.qty > Number(p.qty_on_hand); }) && (
              <p className="text-xs text-destructive">A line exceeds available stock.</p>
            )}
            <div className="flex justify-between pt-2">
              <Button variant="outline" onClick={() => setStep(0)}>Back</Button>
              <Button disabled={!linesValid} onClick={() => setStep(2)}>Next</Button>
            </div>
          </div>
        )}

        {/* Step 3 — review */}
        {step === 2 && (
          <div className="space-y-3">
            <p className="text-sm text-muted-foreground">Account: <strong className="text-foreground">{account?.parties?.display_name}</strong></p>
            <div className="rounded-lg border border-border divide-y divide-border">
              {lines.map((l, i) => { const p = productById.get(l.product_id); return (
                <div key={i} className="flex justify-between px-3 py-2 text-sm">
                  <span>{p?.name} × {l.qty}</span><span>{formatMoney((p?.price_minor ?? 0) * l.qty)}</span>
                </div>
              ); })}
              <div className="flex justify-between px-3 py-2 text-sm font-semibold"><span>Total</span><span>{formatMoney(total)}</span></div>
            </div>
            <div className="flex justify-between pt-2">
              <Button variant="outline" onClick={() => setStep(1)}>Back</Button>
              <Button onClick={() => setStep(3)}>Next</Button>
            </div>
          </div>
        )}

        {/* Step 4 — payment */}
        {step === 3 && (
          <div className="space-y-3">
            <Label>Payment method</Label>
            <div className="flex gap-2">
              {(["cash", "mpesa", "credit"] as const).map((m) => (
                <Button key={m} variant={method === m ? "primary" : "outline"} size="sm" onClick={() => setMethod(m)}>
                  {m === "mpesa" ? "M-Pesa" : m[0].toUpperCase() + m.slice(1)}
                </Button>
              ))}
            </div>
            {method === "mpesa" && <div><Label required>Customer phone</Label><Input value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="07XX XXX XXX" /></div>}
            {method === "credit" && <div><Label required>Due date</Label><Input type="date" value={dueDate} onChange={(e) => setDueDate(e.target.value)} /></div>}

            <div className="flex items-center justify-between rounded-lg bg-muted/50 px-3 py-2">
              <span className="text-sm text-muted-foreground">Grand total</span>
              <span className="text-lg font-semibold">{formatMoney(total)}</span>
            </div>

            {status && <p className="text-sm text-ember">{status}</p>}
            <div className="flex justify-between pt-2">
              <Button variant="outline" onClick={() => setStep(2)} disabled={busy}>Back</Button>
              <Button
                onClick={confirm}
                disabled={busy || (method === "mpesa" && !phone) || (method === "credit" && !dueDate)}
              >
                {busy ? "Processing…" : method === "mpesa" ? "Confirm & charge M-Pesa" : method === "cash" ? "Confirm & take cash" : "Confirm on credit"}
              </Button>
            </div>
          </div>
        )}
      </Card>
    </div>
  );
}
