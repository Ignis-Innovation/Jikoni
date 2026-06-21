import { supabase } from "@/lib/supabase";
import { useAuth, can } from "@/lib/auth";
import { useData } from "@/lib/useData";
import { Badge, PageHeader, Table, THead, TBody, TH, TR, TD } from "@/components/ui/primitives";
import { formatMoney, formatDate, statusTone } from "@/lib/utils";
import { ClipboardList } from "lucide-react";

type Order = {
  id: string; code: string | null; status: string; fulfillment_status: string;
  payment_method: string | null; total_minor: number; currency_code: string; created_at: string;
  parties: { display_name: string } | null;
};

export default function Orders() {
  const { user } = useAuth();
  const { data: rows } = useData(async () => {
    const { data } = await supabase
      .from("sales_orders")
      .select("id, code, status, fulfillment_status, payment_method, total_minor, currency_code, created_at, parties(display_name)")
      .is("deleted_at", null).order("created_at", { ascending: false }).limit(200);
    return (data ?? []) as unknown as Order[];
  }, []);

  if (!can(user, "sales.view")) return <p className="text-sm text-muted-foreground">No access.</p>;

  return (
    <div className="w-full">
      <PageHeader eyebrow="Sales" title="Orders" subtitle="Sales orders and fulfillment." icon={ClipboardList} />
      <Table>
        <THead><TH>Order</TH><TH>Account</TH><TH>Method</TH><TH>Total</TH><TH>Fulfillment</TH><TH>Date</TH></THead>
        <TBody>
          {(rows ?? []).map((o) => (
            <TR key={o.id}>
              <TD className="font-medium text-foreground">{o.code ?? "—"}</TD>
              <TD>{o.parties?.display_name ?? "—"}</TD>
              <TD className="uppercase text-xs">{o.payment_method ?? "—"}</TD>
              <TD>{formatMoney(o.total_minor, o.currency_code)}</TD>
              <TD><Badge tone={statusTone(o.fulfillment_status)}>{o.fulfillment_status}</Badge></TD>
              <TD>{formatDate(o.created_at)}</TD>
            </TR>
          ))}
          {(!rows || rows.length === 0) && <TR><TD colSpan={6} className="py-12 text-center">No orders yet.</TD></TR>}
        </TBody>
      </Table>
    </div>
  );
}
