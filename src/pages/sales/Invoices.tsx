import { useState } from "react";
import { supabase } from "@/lib/supabase";
import { useAuth, can } from "@/lib/auth";
import { useData } from "@/lib/useData";
import { sendSalesEmail } from "@/lib/salesApi";
import { Button, Input, Label, Select, Badge, PageHeader, StatChip, Table, THead, TBody, TH, TR, TD } from "@/components/ui/primitives";
import { Modal } from "@/components/data/Modal";
import { formatMoney, formatDate } from "@/lib/utils";
import { Receipt } from "lucide-react";

type Invoice = {
  id: string; code: string | null; amount_minor: number; currency_code: string;
  status: string; invoice_date: string | null; due_date: string | null;
  customer_party_id: string;
  parties: { display_name: string; email: string | null } | null;
};

function ageDays(inv: Invoice) {
  const ref = inv.due_date || inv.invoice_date;
  if (!ref) return 0;
  return Math.floor((Date.now() - new Date(ref).getTime()) / 86_400_000);
}
function bucket(days: number) {
  if (days <= 30) return "0–30";
  if (days <= 60) return "31–60";
  return "60+";
}

export default function Invoices() {
  const { user } = useAuth();
  const [pay, setPay] = useState<Invoice | null>(null);
  const canRecord = can(user, "revenue.edit");

  const { data: rows, reload } = useData(async () => {
    const { data } = await supabase
      .from("receivable_invoices")
      .select("id, code, amount_minor, currency_code, status, invoice_date, due_date, customer_party_id, parties(display_name, email)")
      .neq("status", "paid").is("deleted_at", null)
      .order("due_date", { ascending: true }).limit(300);
    return (data ?? []) as unknown as Invoice[];
  }, []);

  if (!can(user, "revenue.view")) return <p className="text-sm text-muted-foreground">No access.</p>;

  const list = rows ?? [];
  const sumIn = (pred: (d: number) => boolean) =>
    list.filter((i) => pred(ageDays(i))).reduce((s, i) => s + i.amount_minor, 0);

  async function remind(inv: Invoice) {
    if (!inv.parties?.email) return alert("No contact email on this account.");
    await sendSalesEmail(inv.parties.email, "order_unpaid", {
      account_name: inv.parties.display_name, invoice_code: inv.code,
      amount: formatMoney(inv.amount_minor, inv.currency_code), due_date: inv.due_date ? formatDate(inv.due_date) : "",
    }).catch((e) => alert(e.message));
    alert("Reminder sent.");
  }

  return (
    <div className="mx-auto max-w-5xl">
      <PageHeader eyebrow="Sales" title="Unpaid invoices" subtitle="Outstanding receivables by age." icon={Receipt} />
      <div className="mb-4 flex flex-wrap gap-2">
        <StatChip label="0–30 days" value={formatMoney(sumIn((d) => d <= 30))} tone="green" />
        <StatChip label="31–60 days" value={formatMoney(sumIn((d) => d > 30 && d <= 60))} tone="amber" />
        <StatChip label="60+ days" value={formatMoney(sumIn((d) => d > 60))} tone="red" />
      </div>
      <Table>
        <THead><TH>Invoice</TH><TH>Account</TH><TH>Amount</TH><TH>Due</TH><TH>Age</TH><TH>Status</TH><TH /></THead>
        <TBody>
          {list.map((i) => {
            const d = ageDays(i);
            return (
              <TR key={i.id}>
                <TD className="font-medium text-foreground">{i.code ?? "—"}</TD>
                <TD>{i.parties?.display_name ?? "—"}</TD>
                <TD>{formatMoney(i.amount_minor, i.currency_code)}</TD>
                <TD>{formatDate(i.due_date)}</TD>
                <TD><Badge tone={d <= 30 ? "green" : d <= 60 ? "amber" : "red"}>{bucket(d)}</Badge></TD>
                <TD><Badge tone="amber">{i.status}</Badge></TD>
                <TD className="text-right">
                  <span className="flex justify-end gap-2">
                    <Button size="sm" variant="ghost" onClick={() => remind(i)}>Remind</Button>
                    {canRecord && <Button size="sm" variant="outline" onClick={() => setPay(i)}>Record payment</Button>}
                  </span>
                </TD>
              </TR>
            );
          })}
          {list.length === 0 && <TR><TD colSpan={7} className="py-12 text-center">No outstanding invoices. 🎉</TD></TR>}
        </TBody>
      </Table>

      {pay && <RecordPayment invoice={pay} onClose={() => setPay(null)} onDone={() => { setPay(null); reload(); }} />}
    </div>
  );
}

function RecordPayment({ invoice, onClose, onDone }: { invoice: Invoice; onClose: () => void; onDone: () => void }) {
  const [method, setMethod] = useState("cash");
  const [ref, setRef] = useState("");
  const [busy, setBusy] = useState(false);

  async function submit() {
    setBusy(true);
    const { error: rErr } = await supabase.from("customer_receipts").insert({
      customer_party_id: invoice.customer_party_id, invoice_id: invoice.id,
      amount_minor: invoice.amount_minor, method, external_ref: ref || null,
      received_date: new Date().toISOString().slice(0, 10),
    });
    if (rErr) { setBusy(false); return alert(rErr.message); }
    const { error: iErr } = await supabase.from("receivable_invoices").update({ status: "paid" }).eq("id", invoice.id);
    setBusy(false);
    if (iErr) return alert(iErr.message);
    onDone();
  }

  return (
    <Modal open title={`Record payment — ${invoice.code ?? ""}`} onClose={onClose}>
      <div className="space-y-3">
        <p className="text-sm text-muted-foreground">Amount due: <strong className="text-foreground">{formatMoney(invoice.amount_minor, invoice.currency_code)}</strong></p>
        <div><Label>Method</Label>
          <Select value={method} onChange={(e) => setMethod(e.target.value)}>
            <option value="cash">Cash</option><option value="mpesa">M-Pesa</option><option value="bank">Bank</option>
          </Select>
        </div>
        <div><Label>Reference (optional)</Label><Input value={ref} onChange={(e) => setRef(e.target.value)} placeholder="Txn / receipt no." /></div>
        <div className="flex justify-end gap-2 pt-2">
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button onClick={submit} disabled={busy}>{busy ? "Saving…" : "Mark paid"}</Button>
        </div>
      </div>
    </Modal>
  );
}
