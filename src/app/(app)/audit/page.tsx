import { requireUser, can } from "@/lib/spine/auth";
import { createClient } from "@/lib/supabase/server";
import { Badge } from "@/components/ui/primitives";

export const dynamic = "force-dynamic";

export default async function AuditPage() {
  const user = await requireUser();
  if (!can(user, "audit.view")) {
    return <p className="text-sm text-zinc-500">You don&apos;t have access to the Audit Log.</p>;
  }
  const supabase = await createClient();
  const { data: rows } = await supabase
    .from("audit_log")
    .select("id, action, table_name, record_id, actor_user_id, created_at")
    .order("created_at", { ascending: false })
    .limit(100);

  const tone: Record<string, "green" | "amber" | "red"> = { insert: "green", update: "amber", delete: "red" };

  return (
    <div className="mx-auto max-w-5xl">
      <div className="mb-5">
        <p className="text-xs text-zinc-400">Spine</p>
        <h1 className="text-xl font-semibold tracking-tight text-zinc-900">Audit Log</h1>
        <p className="text-sm text-zinc-500">Immutable who-did-what-when. Append-only — no app path can edit these rows.</p>
      </div>
      <div className="overflow-hidden rounded-xl border border-zinc-200 bg-white">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-zinc-200 bg-zinc-50 text-left text-xs uppercase tracking-wider text-zinc-500">
              <th className="px-4 py-2.5 font-medium">When</th>
              <th className="px-4 py-2.5 font-medium">Action</th>
              <th className="px-4 py-2.5 font-medium">Table</th>
              <th className="px-4 py-2.5 font-medium">Record</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-zinc-100">
            {(rows ?? []).map((r) => (
              <tr key={r.id} className="hover:bg-zinc-50">
                <td className="px-4 py-2 text-xs text-zinc-500">{new Date(r.created_at).toLocaleString("en-GB")}</td>
                <td className="px-4 py-2"><Badge tone={tone[r.action] ?? "zinc"}>{r.action}</Badge></td>
                <td className="px-4 py-2 font-mono text-xs text-zinc-700">{r.table_name}</td>
                <td className="px-4 py-2 font-mono text-[11px] text-zinc-400">{r.record_id?.slice(0, 8)}</td>
              </tr>
            ))}
            {(!rows || rows.length === 0) && (
              <tr><td colSpan={4} className="px-4 py-10 text-center text-sm text-zinc-400">No audit entries yet.</td></tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
