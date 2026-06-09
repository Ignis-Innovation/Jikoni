import { Link } from "react-router-dom";
import { supabase } from "@/lib/supabase";
import { useAuth, can } from "@/lib/auth";
import { useData } from "@/lib/useData";
import { Card, Badge, PageHeader } from "@/components/ui/primitives";
import { Users, Truck, ShoppingCart, CheckCircle2, FolderKanban, ArrowUpRight, type LucideIcon } from "lucide-react";

// Friendly labels for the activity feed (instead of raw "table.action").
const NOUN: Record<string, string> = {
  parties: "Party", vendor_profiles: "Vendor", purchase_orders: "Purchase order",
  requisitions: "Requisition", payable_invoices: "Invoice", payments: "Payment",
  payment_runs: "Payment run", grns: "Goods receipt", engagements: "Engagement",
  engagement_updates: "CRM update", action_items: "Action item", opportunities: "Opportunity",
  contracts: "Contract", risks: "Risk", assets: "Asset", deployments: "Deployment",
  compliance_obligations: "Compliance item", impact_metrics: "Impact metric", projects: "Project",
  approval_requests: "Approval", leave_applications: "Leave request",
};
const VERB: Record<string, string> = { created: "added", updated: "updated", deleted: "removed" };

function humanizeEvent(ev: string): string | null {
  const [table, action] = ev.split(".");
  const noun = NOUN[table];
  if (!noun) return null; // hide internal/noise tables from the feed
  return `${noun} ${VERB[action] ?? action}`;
}
function ago(iso: string): string {
  const s = Math.floor((Date.now() - new Date(iso).getTime()) / 1000);
  if (s < 60) return "just now";
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  return `${Math.floor(s / 86400)}d ago`;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function count(table: string, mod?: (q: any) => any) {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let q: any = supabase.from(table).select("*", { count: "exact", head: true }).is("deleted_at", null);
  if (mod) q = mod(q);
  const { count } = await q;
  return count ?? 0;
}

export default function Home() {
  const { user } = useAuth();

  const { data, loading } = useData(async () => {
    const [parties, vendors, openPOs, activeProjects, pendingApprovals, impact, recentEvents, myApprovals, myActions] =
      await Promise.all([
        can(user, "parties.view") ? count("parties") : 0,
        can(user, "procurement.view") ? count("parties", (q) => q.eq("type", "vendor")) : 0,
        can(user, "procurement.view") ? count("purchase_orders", (q) => q.in("status", ["issued", "partially_received"])) : 0,
        can(user, "org.view") ? count("projects", (q) => q.eq("status", "active")) : 0,
        can(user, "approvals.view")
          ? supabase.from("approval_requests").select("*", { count: "exact", head: true }).eq("status", "pending").then((r) => r.count ?? 0)
          : 0,
        can(user, "intelligence.view")
          ? supabase.from("impact_metrics").select("value").is("deleted_at", null).ilike("type", "%CO%").maybeSingle().then((r) => Number(r.data?.value ?? 0))
          : 0,
        supabase.from("events").select("event, created_at").order("created_at", { ascending: false }).limit(40).then((r) => r.data ?? []),
        can(user, "approvals.act")
          ? supabase.from("approval_requests").select("id, entity_type").eq("status", "pending").order("created_at").limit(6).then((r) => r.data ?? [])
          : [],
        supabase
          .from("action_items")
          .select("id, description, due_date, status")
          .eq("owner_user_id", user?.id ?? "")
          .eq("status", "open")
          .is("deleted_at", null)
          .order("due_date", { ascending: true })
          .limit(6)
          .then((r) => r.data ?? []),
      ]);

    const feed = (recentEvents as { event: string; created_at: string }[])
      .map((e) => ({ label: humanizeEvent(e.event), at: e.created_at }))
      .filter((e) => e.label)
      .slice(0, 8);

    return { parties, vendors, openPOs, activeProjects, pendingApprovals, impact, feed, myApprovals, myActions };
  }, [user?.id]);

  const tiles: { label: string; value: number | undefined; perm: string; href: string; icon: LucideIcon; tone: string }[] = [
    { label: "Parties", value: data?.parties, perm: "parties.view", href: "/parties", icon: Users, tone: "text-blue-600 bg-blue-50" },
    { label: "Vendors", value: data?.vendors, perm: "procurement.view", href: "/r/vendors", icon: Truck, tone: "text-violet-600 bg-violet-50" },
    { label: "Open POs", value: data?.openPOs, perm: "procurement.view", href: "/procurement/pos", icon: ShoppingCart, tone: "text-amber-600 bg-amber-50" },
    { label: "Approvals due", value: data?.pendingApprovals, perm: "approvals.view", href: "/procurement", icon: CheckCircle2, tone: "text-rose-600 bg-rose-50" },
    { label: "Active projects", value: data?.activeProjects, perm: "org.view", href: "/org", icon: FolderKanban, tone: "text-emerald-600 bg-emerald-50" },
  ].filter((t) => can(user, t.perm));

  const dueLabel = (d: string | null) => {
    if (!d) return null;
    const days = Math.ceil((new Date(d).getTime() - Date.now()) / 86400000);
    if (days < 0) return <Badge tone="red">overdue</Badge>;
    if (days <= 3) return <Badge tone="amber">{days}d</Badge>;
    return <Badge tone="zinc">{days}d</Badge>;
  };

  return (
    <div className="mx-auto max-w-6xl space-y-8">
      <PageHeader
        eyebrow="Home"
        title={`Good day, ${user?.full_name?.split(" ")[0] ?? "there"}.`}
        subtitle="Where things stand across Jikoni, live."
      />

      <section>
        <h2 className="mb-3 text-xs font-semibold uppercase tracking-wider text-muted-foreground">Company Pulse</h2>
        <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-5">
          {tiles.map((t) => (
            <Link key={t.label} to={t.href} className="group">
              <Card className="p-4 transition-all hover:-translate-y-0.5 hover:border-primary/40 hover:shadow-md">
                <div className="flex items-start justify-between">
                  <span className={`flex h-9 w-9 items-center justify-center rounded-lg ${t.tone}`}>
                    <t.icon className="h-5 w-5" />
                  </span>
                  <ArrowUpRight className="h-4 w-4 text-muted-foreground opacity-0 transition-opacity group-hover:opacity-100" />
                </div>
                <p className="mt-3 text-2xl font-semibold text-foreground">{loading ? "…" : t.value}</p>
                <p className="text-xs text-muted-foreground">{t.label}</p>
              </Card>
            </Link>
          ))}
        </div>
      </section>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        <section>
          <h2 className="mb-3 text-xs font-semibold uppercase tracking-wider text-muted-foreground">My Week</h2>
          <Card>
            {(data?.myApprovals.length ?? 0) + (data?.myActions.length ?? 0) === 0 ? (
              <p className="py-6 text-center text-sm text-muted-foreground">Nothing needs you right now. 🎉</p>
            ) : (
              <ul className="divide-y divide-border">
                {data?.myApprovals.map((a) => (
                  <li key={a.id} className="flex items-center justify-between py-2.5 text-sm">
                    <span className="text-foreground">Approve {a.entity_type.replace(/_/g, " ")}</span>
                    <Link to="/procurement"><Badge tone="amber">review</Badge></Link>
                  </li>
                ))}
                {data?.myActions.map((a) => (
                  <li key={a.id} className="flex items-center justify-between gap-3 py-2.5 text-sm">
                    <span className="truncate text-foreground">{a.description}</span>
                    {dueLabel(a.due_date)}
                  </li>
                ))}
              </ul>
            )}
          </Card>
        </section>

        <section>
          <h2 className="mb-3 text-xs font-semibold uppercase tracking-wider text-muted-foreground">Recent activity</h2>
          <Card>
            {data && data.feed.length > 0 ? (
              <ul className="divide-y divide-border">
                {data.feed.map((e, i) => (
                  <li key={i} className="flex items-center justify-between py-2.5 text-sm">
                    <span className="text-foreground">{e.label}</span>
                    <span className="text-xs text-muted-foreground">{ago(e.at)}</span>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="py-6 text-center text-sm text-muted-foreground">No activity yet.</p>
            )}
          </Card>
        </section>
      </div>
    </div>
  );
}
