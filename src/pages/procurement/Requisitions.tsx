import { Link } from "react-router-dom";
import { supabase } from "@/lib/supabase";
import { useAuth, can } from "@/lib/auth";
import { useData } from "@/lib/useData";
import { Badge } from "@/components/ui/primitives";
import { formatMoney, formatDate } from "@/lib/utils";
import { NewRequisition } from "@/components/procurement/NewRequisition";

const TONE: Record<string, "zinc" | "amber" | "green" | "red" | "blue"> = {
  draft: "zinc", pending_approval: "amber", approved: "green", rejected: "red", converted: "blue",
};

export default function Requisitions() {
  const { user } = useAuth();
  const { data: rows } = useData(async () => {
    const { data } = await supabase
      .from("requisitions")
      .select("id, code, status, total_minor, currency_code, need_by_date, created_at")
      .is("deleted_at", null).order("created_at", { ascending: false }).limit(100);
    return data ?? [];
  }, []);

  if (!can(user, "procurement.view")) return <p className="text-sm text-muted-foreground">No access.</p>;

  return (
    <div className="w-full">
      <div className="mb-5 flex items-center justify-between">
        <div>
          <p className="text-xs text-muted-foreground">Procure-to-Pay</p>
          <h1 className="text-xl font-semibold tracking-tight text-foreground">Requisitions</h1>
          <p className="text-sm text-muted-foreground">Request → budget check → approval routing.</p>
        </div>
        {can(user, "procurement.create") && <NewRequisition />}
      </div>
      <div className="overflow-hidden rounded-xl border border-border bg-card">
        <table className="w-full text-[15px]">
          <thead>
            <tr className="border-b border-border bg-muted/50 text-left text-xs uppercase tracking-wider text-muted-foreground">
              <th className="px-5 py-3.5 font-medium">Code</th>
              <th className="px-5 py-3.5 font-medium">Total</th>
              <th className="px-5 py-3.5 font-medium">Need by</th>
              <th className="px-5 py-3.5 font-medium">Status</th>
              <th className="px-5 py-3.5 font-medium">Created</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {(rows ?? []).map((r) => (
              <tr key={r.id} className="hover:bg-muted/50">
                <td className="px-5 py-4 font-medium text-primary"><Link to={`/procurement/requisitions/${r.id}`}>{r.code ?? "—"}</Link></td>
                <td className="px-5 py-4">{formatMoney(r.total_minor, r.currency_code)}</td>
                <td className="px-5 py-4 text-muted-foreground">{formatDate(r.need_by_date)}</td>
                <td className="px-5 py-4"><Badge tone={TONE[r.status] ?? "zinc"}>{r.status?.replace(/_/g, " ")}</Badge></td>
                <td className="px-5 py-4 text-muted-foreground">{formatDate(r.created_at)}</td>
              </tr>
            ))}
            {(!rows || rows.length === 0) && (
              <tr><td colSpan={5} className="px-4 py-12 text-center text-sm text-muted-foreground">No requisitions yet.</td></tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
