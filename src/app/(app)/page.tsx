import { requireUser, can } from "@/lib/spine/auth";
import { createClient } from "@/lib/supabase/server";
import { Card, Badge } from "@/components/ui/primitives";
import { formatDate } from "@/lib/utils";

export const dynamic = "force-dynamic";

async function count(table: string, filter?: (q: any) => any) {
  const supabase = await createClient();
  let q = supabase.from(table).select("*", { count: "exact", head: true }).is("deleted_at", null);
  if (filter) q = filter(q);
  const { count } = await q;
  return count ?? 0;
}

export default async function HomePage() {
  const user = await requireUser();
  const supabase = await createClient();

  // --- Company Pulse (live tiles) ---
  const [parties, pendingApprovals, openProjects] = await Promise.all([
    can(user, "parties.view") ? count("parties") : Promise.resolve(0),
    can(user, "approvals.view")
      ? (async () => {
          const { count } = await supabase
            .from("approval_requests")
            .select("*", { count: "exact", head: true })
            .eq("status", "pending");
          return count ?? 0;
        })()
      : Promise.resolve(0),
    can(user, "org.view") ? count("projects", (q) => q.eq("status", "active")) : Promise.resolve(0),
  ]);

  // --- My Week: this user's pending approval requests ---
  const { data: myApprovals } = await supabase
    .from("approval_requests")
    .select("id, entity_type, status, created_at")
    .eq("status", "pending")
    .order("created_at", { ascending: true })
    .limit(8);

  // --- Status Board: latest events from the bus ---
  const { data: recentEvents } = await supabase
    .from("events")
    .select("event, table_name, created_at")
    .order("created_at", { ascending: false })
    .limit(8);

  const pulse = [
    { label: "Parties", value: parties, perm: "parties.view" },
    { label: "Approvals awaiting", value: pendingApprovals, perm: "approvals.view" },
    { label: "Active projects", value: openProjects, perm: "org.view" },
  ].filter((t) => can(user, t.perm));

  return (
    <div className="mx-auto max-w-6xl space-y-8">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight text-zinc-900">
          Good day, {user.full_name?.split(" ")[0] ?? "there"}.
        </h1>
        <p className="text-sm text-zinc-500">Here&apos;s where things stand across Jikoni, live.</p>
      </div>

      {/* Company Pulse */}
      <section>
        <h2 className="mb-3 text-xs font-semibold uppercase tracking-wider text-zinc-400">Company Pulse</h2>
        <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-5">
          {pulse.map((t) => (
            <Card key={t.label} className="p-4">
              <p className="text-xs text-zinc-500">{t.label}</p>
              <p className="mt-1 text-2xl font-semibold text-zinc-900">{t.value}</p>
            </Card>
          ))}
        </div>
      </section>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        {/* My Week */}
        <section>
          <h2 className="mb-3 text-xs font-semibold uppercase tracking-wider text-zinc-400">My Week</h2>
          <Card>
            {myApprovals && myApprovals.length > 0 ? (
              <ul className="divide-y divide-zinc-100">
                {myApprovals.map((a) => (
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

        {/* Status Board */}
        <section>
          <h2 className="mb-3 text-xs font-semibold uppercase tracking-wider text-zinc-400">Status Board · Recent activity</h2>
          <Card>
            {recentEvents && recentEvents.length > 0 ? (
              <ul className="divide-y divide-zinc-100">
                {recentEvents.map((e, i) => (
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
