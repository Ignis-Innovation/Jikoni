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

  if (!can(user, "procurement.view")) return <p className="text-sm text-zinc-500">No access.</p>;

  return (
    <div className="mx-auto max-w-5xl">
      <div className="mb-5 flex items-center justify-between">
        <div>
          <p className="text-xs text-zinc-400">Procure-to-Pay</p>
          <h1 className="text-xl font-semibold tracking-tight text-zinc-900">Requisitions</h1>
          <p className="text-sm text-zinc-500">Request → budget check → approval routing.</p>
        </div>
        {can(user, "procurement.create") && <NewRequisition />}
      </div>
      <div className="overflow-hidden rounded-xl border border-zinc-200 bg-white">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-zinc-200 bg-zinc-50 text-left text-xs uppercase tracking-wider text-zinc-500">
              <th className="px-4 py-2.5 font-medium">Code</th>
              <th className="px-4 py-2.5 font-medium">Total</th>
              <th className="px-4 py-2.5 font-medium">Need by</th>
              <th className="px-4 py-2.5 font-medium">Status</th>
              <th className="px-4 py-2.5 font-medium">Created</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-zinc-100">
            {(rows ?? []).map((r) => (
              <tr key={r.id} className="hover:bg-zinc-50">
                <td className="px-4 py-2.5 font-medium text-emerald-700"><Link to={`/procurement/requisitions/${r.id}`}>{r.code ?? "—"}</Link></td>
                <td className="px-4 py-2.5">{formatMoney(r.total_minor, r.currency_code)}</td>
                <td className="px-4 py-2.5 text-zinc-600">{formatDate(r.need_by_date)}</td>
                <td className="px-4 py-2.5"><Badge tone={TONE[r.status] ?? "zinc"}>{r.status?.replace(/_/g, " ")}</Badge></td>
                <td className="px-4 py-2.5 text-zinc-500">{formatDate(r.created_at)}</td>
              </tr>
            ))}
            {(!rows || rows.length === 0) && (
              <tr><td colSpan={5} className="px-4 py-12 text-center text-sm text-zinc-400">No requisitions yet.</td></tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
