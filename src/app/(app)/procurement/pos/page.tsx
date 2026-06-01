import Link from "next/link";
import { requireUser, can } from "@/lib/spine/auth";
import { createClient } from "@/lib/supabase/server";
import { Badge } from "@/components/ui/primitives";
import { formatMoney, formatDate } from "@/lib/utils";

export const dynamic = "force-dynamic";

const TONE: Record<string, "zinc" | "amber" | "green" | "blue"> = {
  draft: "zinc", issued: "blue", partially_received: "amber", received: "green", closed: "zinc",
};

export default async function POList() {
  const user = await requireUser();
  if (!can(user, "procurement.view")) return <p className="text-sm text-zinc-500">No access.</p>;
  const supabase = await createClient();
  const { data: rows } = await supabase
    .from("purchase_orders")
    .select("id, code, status, total_minor, currency_code, expected_date, created_at, vendor_party_id, parties:vendor_party_id(display_name)")
    .is("deleted_at", null)
    .order("created_at", { ascending: false })
    .limit(100);

  return (
    <div className="mx-auto max-w-5xl">
      <div className="mb-5">
        <p className="text-xs text-zinc-400">Procure-to-Pay</p>
        <h1 className="text-xl font-semibold tracking-tight text-zinc-900">Purchase Orders</h1>
        <p className="text-sm text-zinc-500">Issued to vendors, received via GRN. Create from an approved requisition.</p>
      </div>
      <div className="overflow-hidden rounded-xl border border-zinc-200 bg-white">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-zinc-200 bg-zinc-50 text-left text-xs uppercase tracking-wider text-zinc-500">
              <th className="px-4 py-2.5 font-medium">Code</th>
              <th className="px-4 py-2.5 font-medium">Vendor</th>
              <th className="px-4 py-2.5 font-medium">Total</th>
              <th className="px-4 py-2.5 font-medium">Status</th>
              <th className="px-4 py-2.5 font-medium">Created</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-zinc-100">
            {/* eslint-disable-next-line @typescript-eslint/no-explicit-any */}
            {((rows ?? []) as any[]).map((r) => (
              <tr key={r.id} className="hover:bg-zinc-50">
                <td className="px-4 py-2.5 font-medium text-emerald-700"><Link href={`/procurement/pos/${r.id}`}>{r.code ?? "—"}</Link></td>
                <td className="px-4 py-2.5 text-zinc-600">{r.parties?.display_name ?? "—"}</td>
                <td className="px-4 py-2.5">{formatMoney(r.total_minor, r.currency_code)}</td>
                <td className="px-4 py-2.5"><Badge tone={TONE[r.status] ?? "zinc"}>{r.status?.replace(/_/g, " ")}</Badge></td>
                <td className="px-4 py-2.5 text-zinc-500">{formatDate(r.created_at)}</td>
              </tr>
            ))}
            {(!rows || rows.length === 0) && (
              <tr><td colSpan={5} className="px-4 py-12 text-center text-sm text-zinc-400">No purchase orders yet. Convert an approved requisition.</td></tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
