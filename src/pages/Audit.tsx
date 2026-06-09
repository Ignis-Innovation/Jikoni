import { supabase } from "@/lib/supabase";
import { useAuth, can } from "@/lib/auth";
import { useData } from "@/lib/useData";
import { Badge } from "@/components/ui/primitives";

const tone: Record<string, "green" | "amber" | "red"> = { insert: "green", update: "amber", delete: "red" };

export default function Audit() {
  const { user } = useAuth();
  const { data: rows, loading } = useData(async () => {
    const { data } = await supabase
      .from("audit_log")
      .select("id, action, table_name, record_id, created_at")
      .order("created_at", { ascending: false })
      .limit(100);
    return data ?? [];
  }, []);

  if (!can(user, "audit.view")) return <p className="text-sm text-muted-foreground">You don&apos;t have access to the Audit Log.</p>;

  return (
    <div className="mx-auto max-w-5xl">
      <div className="mb-5">
        <p className="text-xs text-muted-foreground">Spine</p>
        <h1 className="text-xl font-semibold tracking-tight text-foreground">Audit Log</h1>
        <p className="text-sm text-muted-foreground">Immutable who-did-what-when. Append-only — no app path can edit these rows.</p>
      </div>
      <div className="overflow-hidden rounded-xl border border-border bg-card">
        <table className="w-full text-[15px]">
          <thead>
            <tr className="border-b border-border bg-muted/50 text-left text-xs uppercase tracking-wider text-muted-foreground">
              <th className="px-5 py-3.5 font-medium">When</th>
              <th className="px-5 py-3.5 font-medium">Action</th>
              <th className="px-5 py-3.5 font-medium">Table</th>
              <th className="px-5 py-3.5 font-medium">Record</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {(rows ?? []).map((r) => (
              <tr key={r.id} className="hover:bg-muted/50">
                <td className="px-5 py-3.5 text-xs text-muted-foreground">{new Date(r.created_at).toLocaleString("en-GB")}</td>
                <td className="px-5 py-3.5"><Badge tone={tone[r.action] ?? "zinc"}>{r.action}</Badge></td>
                <td className="px-5 py-3.5 font-mono text-xs text-foreground">{r.table_name}</td>
                <td className="px-5 py-3.5 font-mono text-[11px] text-muted-foreground">{r.record_id?.slice(0, 8)}</td>
              </tr>
            ))}
            {!loading && (!rows || rows.length === 0) && (
              <tr><td colSpan={4} className="px-4 py-10 text-center text-sm text-muted-foreground">No audit entries yet.</td></tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
