import { supabase } from "@/lib/supabase";
import { useAuth, can } from "@/lib/auth";
import { useData } from "@/lib/useData";
import { Card, Badge } from "@/components/ui/primitives";
import { formatDate } from "@/lib/utils";

async function countTable(table: string, eq?: [string, string]) {
  let q = supabase.from(table).select("*", { count: "exact", head: true }).is("deleted_at", null);
  if (eq) q = q.eq(eq[0], eq[1]);
  const { count } = await q;
  return count ?? 0;
}

export default function Home() {
  const { user } = useAuth();

  const { data, loading } = useData(async () => {
    const [parties, pendingApprovals, activeProjects, recentEvents] = await Promise.all([
      can(user, "parties.view") ? countTable("parties") : 0,
      can(user, "approvals.view")
        ? supabase.from("approval_requests").select("*", { count: "exact", head: true }).eq("status", "pending").then((r) => r.count ?? 0)
        : 0,
      can(user, "org.view") ? countTable("projects", ["status", "active"]) : 0,
      supabase.from("events").select("event, created_at").order("created_at", { ascending: false }).limit(8).then((r) => r.data ?? []),
    ]);
    const myApprovals = can(user, "approvals.act")
      ? (await supabase.from("approval_requests").select("id, entity_type").eq("status", "pending").order("created_at", { ascending: true }).limit(8)).data ?? []
      : [];
    return { parties, pendingApprovals, activeProjects, recentEvents, myApprovals };
  }, [user?.id]);

  const pulse = [
    { label: "Parties", value: data?.parties ?? 0, perm: "parties.view" },
    { label: "Approvals awaiting", value: data?.pendingApprovals ?? 0, perm: "approvals.view" },
    { label: "Active projects", value: data?.activeProjects ?? 0, perm: "org.view" },
  ].filter((t) => can(user, t.perm));

  return (
    <div className="mx-auto max-w-6xl space-y-8">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight text-zinc-900">
          Good day, {user?.full_name?.split(" ")[0] ?? "there"}.
        </h1>
        <p className="text-sm text-zinc-500">Here&apos;s where things stand across Jikoni, live.</p>
      </div>

      <section>
        <h2 className="mb-3 text-xs font-semibold uppercase tracking-wider text-zinc-400">Company Pulse</h2>
        <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-5">
          {pulse.map((t) => (
            <Card key={t.label} className="p-4">
              <p className="text-xs text-zinc-500">{t.label}</p>
              <p className="mt-1 text-2xl font-semibold text-zinc-900">{loading ? "…" : t.value}</p>
            </Card>
          ))}
        </div>
      </section>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        <section>
          <h2 className="mb-3 text-xs font-semibold uppercase tracking-wider text-zinc-400">My Week</h2>
          <Card>
            {data && data.myApprovals.length > 0 ? (
              <ul className="divide-y divide-zinc-100">
                {data.myApprovals.map((a) => (
                  <li key={a.id} className="flex items-center justify-between py-2 text-sm">
                    <span className="text-zinc-700">Approval · {a.entity_type}</span>
                    <Badge tone="amber">pending</Badge>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="py-6 text-center text-sm text-zinc-400">Nothing needs you right now. 🎉</p>
            )}
          </Card>
        </section>

        <section>
          <h2 className="mb-3 text-xs font-semibold uppercase tracking-wider text-zinc-400">Status Board · Recent activity</h2>
          <Card>
            {data && data.recentEvents.length > 0 ? (
              <ul className="divide-y divide-zinc-100">
                {data.recentEvents.map((e, i) => (
                  <li key={i} className="flex items-center justify-between py-2 text-sm">
                    <span className="font-mono text-xs text-zinc-600">{e.event}</span>
                    <span className="text-xs text-zinc-400">{formatDate(e.created_at)}</span>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="py-6 text-center text-sm text-zinc-400">No activity yet.</p>
            )}
          </Card>
        </section>
      </div>
    </div>
  );
}
