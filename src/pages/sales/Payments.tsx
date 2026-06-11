import { useState } from "react";
import { supabase } from "@/lib/supabase";
import { useAuth, can } from "@/lib/auth";
import { useData } from "@/lib/useData";
import { Badge, Select, PageHeader, Table, THead, TBody, TH, TR, TD } from "@/components/ui/primitives";
import { formatMoney, formatDate } from "@/lib/utils";
import { Wallet } from "lucide-react";

type Receipt = {
  id: string; code: string | null; amount_minor: number; method: string | null;
  external_ref: string | null; received_date: string | null;
  parties: { display_name: string } | null;
  receivable_invoices: { code: string | null } | null;
};

export default function Payments() {
  const { user } = useAuth();
  const [method, setMethod] = useState("all");

  const { data: rows } = useData(async () => {
    const { data } = await supabase
      .from("customer_receipts")
      .select("id, code, amount_minor, method, external_ref, received_date, parties(display_name), receivable_invoices(code)")
      .is("deleted_at", null).order("received_date", { ascending: false }).limit(300);
    return (data ?? []) as unknown as Receipt[];
  }, []);

  if (!can(user, "revenue.view")) return <p className="text-sm text-muted-foreground">No access.</p>;

  const list = (rows ?? []).filter((r) => method === "all" || (r.method ?? "") === method);

  return (
    <div className="mx-auto max-w-5xl">
      <PageHeader
        eyebrow="Sales" title="Payment history" subtitle="All receipts across cash, M-Pesa and bank." icon={Wallet}
        actions={
          <Select value={method} onChange={(e) => setMethod(e.target.value)} className="w-36">
            <option value="all">All methods</option><option value="cash">Cash</option><option value="mpesa">M-Pesa</option><option value="bank">Bank</option>
          </Select>
        }
      />
      <Table>
        <THead><TH>Receipt</TH><TH>Account</TH><TH>Invoice</TH><TH>Method</TH><TH>Reference</TH><TH>Amount</TH><TH>Date</TH></THead>
        <TBody>
          {list.map((r) => (
            <TR key={r.id}>
              <TD className="font-medium text-foreground">{r.code ?? "—"}</TD>
              <TD>{r.parties?.display_name ?? "—"}</TD>
              <TD>{r.receivable_invoices?.code ?? "—"}</TD>
              <TD><Badge tone={r.method === "mpesa" ? "green" : "blue"}>{r.method ?? "—"}</Badge></TD>
              <TD>{r.external_ref ?? "—"}</TD>
              <TD>{formatMoney(r.amount_minor)}</TD>
              <TD>{formatDate(r.received_date)}</TD>
            </TR>
          ))}
          {list.length === 0 && <TR><TD colSpan={7} className="py-12 text-center">No payments recorded.</TD></TR>}
        </TBody>
      </Table>
    </div>
  );
}
