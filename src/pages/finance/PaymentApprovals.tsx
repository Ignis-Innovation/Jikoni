import { useState } from "react";
import { Check, X, Banknote } from "lucide-react";
import { supabase } from "@/lib/supabase";
import { useAuth, can } from "@/lib/auth";
import { useData } from "@/lib/useData";
import { Button, Badge, PageHeader, Table, THead, TH, TBody, TR, TD } from "@/components/ui/primitives";
import { cn, formatDate, formatMoney, statusTone } from "@/lib/utils";

type Filter = "pending" | "approved" | "all";
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Any = any;

const ORDER: Record<string, number> = { pending: 0, approved: 1, paid: 2, rejected: 3, cancelled: 4 };

export default function PaymentApprovals() {
  const { user } = useAuth();
  // Default to "all" so the full history (with status badges) stays on screen.
  const [filter, setFilter] = useState<Filter>("all");
  const canAct = can(user, "payments.edit");

  const { data, loading, reload } = useData(async () => {
    let q = supabase.from("payment_requests")
      .select("id, title, amount_minor, currency, request_date, description, status, decision_note, created_at, user_id, users:user_id(full_name, email)")
      .is("deleted_at", null);
    if (filter !== "all") q = q.eq("status", filter);
    const { data: rows } = await q.order("created_at", { ascending: false });
    return (rows ?? []) as Any[];
  }, [filter]);

  if (!can(user, "payments.view")) return <p className="text-sm text-muted-foreground">You don&apos;t have access to payment approvals.</p>;

  async function notifyRequester(row: Any, title: string, body?: string | null) {
    if (!row.user_id) return;
    await supabase.rpc("notify", {
      p_user_id: row.user_id, p_type: "payment.decided", p_title: title, p_body: body ?? null, p_link: "/payment-requests",
    });
  }

  async function approve(row: Any) {
    await supabase.from("payment_requests").update({
      status: "approved", decided_by: user?.id, decided_at: new Date().toISOString(),
    }).eq("id", row.id);
    await notifyRequester(row, `Your payment request "${row.title}" was approved`);
    reload();
  }

  async function reject(row: Any) {
    const reason = window.prompt("Reason for rejecting this payment request (optional):") ?? "";
    await supabase.from("payment_requests").update({
      status: "rejected", decided_by: user?.id, decided_at: new Date().toISOString(), decision_note: reason.trim() || null,
    }).eq("id", row.id);
    await notifyRequester(row, `Your payment request "${row.title}" was rejected`, reason.trim() || null);
    reload();
  }

  async function markPaid(row: Any) {
    await supabase.from("payment_requests").update({
      status: "paid", paid_by: user?.id, paid_at: new Date().toISOString(),
    }).eq("id", row.id);
    await notifyRequester(row, `Your payment "${row.title}" has been paid`, formatMoney(row.amount_minor, row.currency));
    reload();
  }

  const rows = [...(data ?? [])].sort((a, b) => (ORDER[a.status] ?? 9) - (ORDER[b.status] ?? 9));

  return (
    <div className="mx-auto max-w-5xl">
      <PageHeader
        eyebrow="Finance"
        icon={Banknote}
        title="Payment Approvals"
        subtitle="Review staff payment requests. Approve or reject, then mark as paid once cash is disbursed."
        actions={
          <div className="flex rounded-lg border border-border bg-card p-0.5">
            {(["pending", "approved", "all"] as Filter[]).map((f) => (
              <button key={f} onClick={() => setFilter(f)}
                className={cn("rounded-md px-3 py-1 text-sm font-medium capitalize transition-colors",
                  filter === f ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground")}>
                {f}
              </button>
            ))}
          </div>
        }
      />

      <Table>
        <THead>
          <TH>Requester</TH><TH>Payment</TH><TH>Amount</TH><TH>Date</TH><TH>Status</TH><TH></TH>
        </THead>
        <TBody>
          {rows.map((r) => (
            <TR key={r.id}>
              <TD className="font-medium text-foreground">{r.users?.full_name ?? r.users?.email ?? "—"}</TD>
              <TD>
                <span className="font-medium text-foreground">{r.title}</span>
                {r.description && <span className="block text-xs text-muted-foreground">{r.description}</span>}
              </TD>
              <TD>{formatMoney(r.amount_minor, r.currency)}</TD>
              <TD>{r.request_date ? formatDate(r.request_date) : "—"}</TD>
              <TD><Badge tone={statusTone(r.status)}>{r.status}</Badge></TD>
              <TD className="text-right">
                {canAct && r.status === "pending" && (
                  <div className="flex justify-end gap-1.5">
                    <Button size="sm" onClick={() => approve(r)}><Check className="h-3.5 w-3.5" /> Approve</Button>
                    <Button size="sm" variant="outline" onClick={() => reject(r)}><X className="h-3.5 w-3.5" /> Reject</Button>
                  </div>
                )}
                {canAct && r.status === "approved" && (
                  <Button size="sm" variant="secondary" onClick={() => markPaid(r)}><Banknote className="h-3.5 w-3.5" /> Mark paid</Button>
                )}
              </TD>
            </TR>
          ))}
          {!loading && rows.length === 0 && (
            <TR><TD className="py-10 text-center" colSpan={6}>{filter === "all" ? "No payment requests." : `No ${filter} requests.`}</TD></TR>
          )}
        </TBody>
      </Table>
    </div>
  );
}
