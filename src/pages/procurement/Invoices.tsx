import { Link } from "react-router-dom";
import { supabase } from "@/lib/supabase";
import { useAuth, can } from "@/lib/auth";
import { useData } from "@/lib/useData";
import { Badge } from "@/components/ui/primitives";
import { formatMoney } from "@/lib/utils";

const TONE: Record<string, "zinc" | "amber" | "green" | "blue"> = {
  draft: "zinc", matched: "blue", approved: "blue", scheduled: "amber", paid: "green",
};
const MTONE: Record<string, "zinc" | "green" | "red"> = { unmatched: "zinc", matched: "green", variance: "red" };

export default function Invoices() {
  const { user } = useAuth();
  const { data: rows } = useData(async () => {
    const { data } = await supabase
      .from("payable_invoices")
      .select("id, code, amount_minor, currency_code, status, match_status, parties:vendor_party_id(display_name)")
      .is("deleted_at", null).order("created_at", { ascending: false }).limit(100);
    return data ?? [];
  }, []);

  if (!can(user, "finance.view")) return <p className="text-sm text-zinc-500">No access.</p>;

  return (
    <div className="mx-auto max-w-5xl">
      <div className="mb-5">
        <p className="text-xs text-zinc-400">Procure-to-Pay</p>
        <h1 className="text-xl font-semibold tracking-tight text-zinc-900">Payables</h1>
        <p className="text-sm text-zinc-500">Vendor invoices, three-way match, payment.</p>
      </div>
      <div className="overflow-hidden rounded-xl border border-zinc-200 bg-white">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-zinc-200 bg-zinc-50 text-left text-xs uppercase tracking-wider text-zinc-500">
              <th className="px-4 py-2.5 font-medium">Code</th>
              <th className="px-4 py-2.5 font-medium">Vendor</th>
              <th className="px-4 py-2.5 font-medium">Amount</th>
              <th className="px-4 py-2.5 font-medium">Match</th>
              <th className="px-4 py-2.5 font-medium">Status</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-zinc-100">
            {/* eslint-disable-next-line @typescript-eslint/no-explicit-any */}
            {((rows ?? []) as any[]).map((r) => (
              <tr key={r.id} className="hover:bg-zinc-50">
                <td className="px-4 py-2.5 font-medium text-emerald-700"><Link to={`/procurement/invoices/${r.id}`}>{r.code ?? "—"}</Link></td>
                <td className="px-4 py-2.5 text-zinc-600">{r.parties?.display_name ?? "—"}</td>
                <td className="px-4 py-2.5">{formatMoney(r.amount_minor, r.currency_code)}</td>
                <td className="px-4 py-2.5"><Badge tone={MTONE[r.match_status] ?? "zinc"}>{r.match_status}</Badge></td>
                <td className="px-4 py-2.5"><Badge tone={TONE[r.status] ?? "zinc"}>{r.status}</Badge></td>
              </tr>
            ))}
            {(!rows || rows.length === 0) && (
              <tr><td colSpan={5} className="px-4 py-12 text-center text-sm text-zinc-400">No payables yet. Create one from a received PO.</td></tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
