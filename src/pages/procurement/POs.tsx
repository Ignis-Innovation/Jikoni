import { Link } from "react-router-dom";
import { supabase } from "@/lib/supabase";
import { useAuth, can } from "@/lib/auth";
import { useData } from "@/lib/useData";
import { Badge } from "@/components/ui/primitives";
import { formatMoney, formatDate } from "@/lib/utils";

const TONE: Record<string, "zinc" | "amber" | "green" | "blue"> = {
  draft: "zinc", issued: "blue", partially_received: "amber", received: "green", closed: "zinc",
};

export default function POs() {
  const { user } = useAuth();
  const { data: rows } = useData(async () => {
    const { data } = await supabase
      .from("purchase_orders")
      .select("id, code, status, total_minor, currency_code, created_at, parties:vendor_party_id(display_name)")
      .is("deleted_at", null).order("created_at", { ascending: false }).limit(100);
    return data ?? [];
  }, []);

  if (!can(user, "procurement.view")) return <p className="text-sm text-muted-foreground">No access.</p>;

  return (
    <div className="mx-auto max-w-5xl">
      <div className="mb-5">
        <p className="text-xs text-muted-foreground">Procure-to-Pay</p>
        <h1 className="text-xl font-semibold tracking-tight text-foreground">Purchase Orders</h1>
        <p className="text-sm text-muted-foreground">Issued to vendors, received via GRN. Create from an approved requisition.</p>
      </div>
      <div className="overflow-hidden rounded-xl border border-border bg-card">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-border bg-muted/50 text-left text-xs uppercase tracking-wider text-muted-foreground">
              <th className="px-4 py-2.5 font-medium">Code</th>
              <th className="px-4 py-2.5 font-medium">Vendor</th>
              <th className="px-4 py-2.5 font-medium">Total</th>
              <th className="px-4 py-2.5 font-medium">Status</th>
              <th className="px-4 py-2.5 font-medium">Created</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {/* eslint-disable-next-line @typescript-eslint/no-explicit-any */}
            {((rows ?? []) as any[]).map((r) => (
              <tr key={r.id} className="hover:bg-muted/50">
                <td className="px-4 py-2.5 font-medium text-primary"><Link to={`/procurement/pos/${r.id}`}>{r.code ?? "—"}</Link></td>
                <td className="px-4 py-2.5 text-muted-foreground">{r.parties?.display_name ?? "—"}</td>
                <td className="px-4 py-2.5">{formatMoney(r.total_minor, r.currency_code)}</td>
                <td className="px-4 py-2.5"><Badge tone={TONE[r.status] ?? "zinc"}>{r.status?.replace(/_/g, " ")}</Badge></td>
                <td className="px-4 py-2.5 text-muted-foreground">{formatDate(r.created_at)}</td>
              </tr>
            ))}
            {(!rows || rows.length === 0) && (
              <tr><td colSpan={5} className="px-4 py-12 text-center text-sm text-muted-foreground">No purchase orders yet. Convert an approved requisition.</td></tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
