import { useState } from "react";
import { Plus, Wallet } from "lucide-react";
import { supabase } from "@/lib/supabase";
import { useAuth } from "@/lib/auth";
import { useData } from "@/lib/useData";
import { Button, Input, Label, Textarea, Badge, Card, PageHeader, Table, THead, TH, TBody, TR, TD } from "@/components/ui/primitives";
import { Modal } from "@/components/data/Modal";
import { formatDate, formatMoney, statusTone } from "@/lib/utils";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Any = any;
const today = () => new Date().toISOString().slice(0, 10);
const blank = { title: "", amount: "", request_date: today(), description: "" };

export default function PaymentRequests() {
  const { user } = useAuth();
  const { data, loading, reload } = useData(async () => {
    const { data: rows } = await supabase
      .from("payment_requests")
      .select("id, title, amount_minor, currency, request_date, description, status, decision_note, created_at")
      .eq("user_id", user?.id).is("deleted_at", null).order("created_at", { ascending: false });
    return (rows ?? []) as Any[];
  }, [user?.id]);

  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({ ...blank });
  const [busy, setBusy] = useState(false);

  const requests = data ?? [];
  const amountMinor = Math.round(Number(form.amount || 0) * 100);
  const valid = form.title.trim() !== "" && amountMinor > 0 && form.request_date !== "";

  // Outstanding = what you've requested that hasn't been paid out or rejected yet.
  const pendingTotal = requests
    .filter((r) => r.status === "pending" || r.status === "approved")
    .reduce((n, r) => n + Number(r.amount_minor || 0), 0);

  const set = (k: keyof typeof blank, v: string) => setForm((f) => ({ ...f, [k]: v }));

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!valid) return;
    setBusy(true);
    await supabase.from("payment_requests").insert({
      user_id: user?.id,
      title: form.title.trim(),
      amount_minor: amountMinor,
      request_date: form.request_date,
      description: form.description.trim() || null,
      status: "pending",
    });
    // Let admins / HR know a request is waiting (in-app bell).
    await supabase.rpc("notify_payment_approvers", {
      p_type: "payment.requested",
      p_title: `Payment request: ${form.title.trim()}`,
      p_body: `${user?.full_name ?? user?.email ?? "Someone"} requested ${formatMoney(amountMinor)}.`,
      p_link: "/finance/payment-approvals",
    });
    setBusy(false); setOpen(false); setForm({ ...blank }); reload();
  }

  async function cancel(id: string) {
    await supabase.from("payment_requests").update({ status: "cancelled", deleted_at: new Date().toISOString() }).eq("id", id);
    reload();
  }

  return (
    <div className="w-full">
      <PageHeader
        eyebrow="Workspace"
        icon={Wallet}
        title="Payment Requests"
        subtitle="Request a payment or reimbursement. Admin or HR reviews it, then marks it paid once cash is disbursed."
        actions={<Button onClick={() => { setForm({ ...blank }); setOpen(true); }}><Plus className="h-4 w-4" /> New request</Button>}
      />

      <div className="mb-6 grid gap-3 sm:grid-cols-3">
        <Card className="p-4">
          <p className="text-sm font-medium text-foreground">Outstanding</p>
          <p className="mt-1 text-2xl font-semibold text-primary">{formatMoney(pendingTotal)}</p>
          <p className="text-xs text-muted-foreground">pending + approved, not yet paid</p>
        </Card>
        <Card className="p-4">
          <p className="text-sm font-medium text-foreground">Awaiting review</p>
          <p className="mt-1 text-2xl font-semibold text-foreground">{requests.filter((r) => r.status === "pending").length}</p>
          <p className="text-xs text-muted-foreground">requests pending a decision</p>
        </Card>
        <Card className="p-4">
          <p className="text-sm font-medium text-foreground">Paid</p>
          <p className="mt-1 text-2xl font-semibold text-foreground">{requests.filter((r) => r.status === "paid").length}</p>
          <p className="text-xs text-muted-foreground">disbursed to date</p>
        </Card>
      </div>

      <h2 className="mb-2 text-sm font-semibold text-foreground">My requests</h2>
      <Table>
        <THead>
          <TH>Payment</TH><TH>Amount</TH><TH>Date</TH><TH>Status</TH><TH></TH>
        </THead>
        <TBody>
          {requests.map((r) => (
            <TR key={r.id}>
              <TD className="font-medium text-foreground">
                {r.title}
                {r.description && <span className="block text-xs font-normal text-muted-foreground">{r.description}</span>}
                {r.status === "rejected" && r.decision_note && (
                  <span className="block text-xs font-normal text-destructive">Reason: {r.decision_note}</span>
                )}
              </TD>
              <TD>{formatMoney(r.amount_minor, r.currency)}</TD>
              <TD>{r.request_date ? formatDate(r.request_date) : "—"}</TD>
              <TD><Badge tone={statusTone(r.status)}>{r.status}</Badge></TD>
              <TD className="text-right">
                {r.status === "pending" && <Button size="sm" variant="ghost" onClick={() => cancel(r.id)}>Cancel</Button>}
              </TD>
            </TR>
          ))}
          {!loading && requests.length === 0 && (
            <TR><TD className="py-10 text-center" colSpan={5}>No payment requests yet.</TD></TR>
          )}
        </TBody>
      </Table>

      <Modal open={open} title="New payment request" onClose={() => setOpen(false)}>
        <form onSubmit={submit} className="space-y-4">
          <div>
            <Label required>Payment name</Label>
            <Input value={form.title} onChange={(e) => set("title", e.target.value)} placeholder="e.g. Fuel reimbursement" required />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label required>Amount (KES)</Label>
              <Input type="number" min="0" step="0.01" value={form.amount} onChange={(e) => set("amount", e.target.value)} placeholder="0.00" required />
            </div>
            <div>
              <Label required>Date</Label>
              <Input type="date" value={form.request_date} onChange={(e) => set("request_date", e.target.value)} required />
            </div>
          </div>
          <div>
            <Label>Short description</Label>
            <Textarea rows={3} value={form.description} onChange={(e) => set("description", e.target.value)} placeholder="What is this payment for?" />
          </div>
          <div className="flex gap-2 pt-1">
            <Button type="submit" disabled={busy || !valid}>{busy ? "Submitting…" : "Submit request"}</Button>
            <Button type="button" variant="ghost" onClick={() => setOpen(false)}>Cancel</Button>
          </div>
        </form>
      </Modal>
    </div>
  );
}
