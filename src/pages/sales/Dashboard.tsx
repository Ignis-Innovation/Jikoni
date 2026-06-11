import type { ComponentType, ReactNode } from "react";
import { Link } from "react-router-dom";
import { supabase } from "@/lib/supabase";
import { useAuth, can } from "@/lib/auth";
import { useData } from "@/lib/useData";
import { Card, PageHeader, Badge } from "@/components/ui/primitives";
import { formatMoney, formatDate, cn } from "@/lib/utils";
import {
  LayoutDashboard, TrendingUp, Receipt, Building2, Boxes, Trophy, Package,
  AlertTriangle, Activity, ShoppingCart, Wallet, UserPlus, ArrowRight,
} from "lucide-react";

type User = { id: string; full_name: string | null; email: string };
type Named = { display_name: string } | null;

// --- helpers ---------------------------------------------------------------
function monthKey(d: Date) { return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`; }
function monthLabel(d: Date) { return d.toLocaleString("en-GB", { month: "short" }); }
function lastMonths(n: number) {
  const out: { key: string; label: string }[] = [];
  const base = new Date();
  base.setDate(1);
  for (let i = n - 1; i >= 0; i--) {
    const d = new Date(base.getFullYear(), base.getMonth() - i, 1);
    out.push({ key: monthKey(d), label: monthLabel(d) });
  }
  return out;
}

export default function Dashboard() {
  const { user } = useAuth();

  const { data } = useData(async () => {
    const now = new Date();
    const monthStart = new Date(now.getFullYear(), now.getMonth(), 1).toISOString().slice(0, 10);

    const [paidQ, unpaidQ, newAcctQ, pendingQ, invStockQ, usersQ, linesQ, ordersQ, receiptsQ, acctFeedQ] =
      await Promise.all([
        supabase.from("receivable_invoices").select("amount_minor, created_by, invoice_date, customer_party_id, parties(display_name)").eq("status", "paid").is("deleted_at", null),
        supabase.from("receivable_invoices").select("amount_minor").neq("status", "paid").is("deleted_at", null),
        supabase.from("customer_profiles").select("party_id").gte("created_at", monthStart).is("deleted_at", null),
        supabase.from("customer_profiles").select("party_id").eq("approval_status", "pending").is("deleted_at", null),
        supabase.from("inventory").select("qty_on_hand, reorder_level, products!inner(name, price_minor)"),
        supabase.from("users").select("id, full_name, email"),
        supabase.from("sales_order_lines").select("qty, unit_price_minor, products(name)"),
        supabase.from("sales_orders").select("code, total_minor, payment_method, created_at, parties(display_name)").is("deleted_at", null).order("created_at", { ascending: false }).limit(6),
        supabase.from("customer_receipts").select("amount_minor, method, created_at, parties(display_name)").is("deleted_at", null).order("created_at", { ascending: false }).limit(6),
        supabase.from("customer_profiles").select("approval_status, created_at, parties(display_name)").is("deleted_at", null).order("created_at", { ascending: false }).limit(6),
      ]);

    const paid = (paidQ.data ?? []) as unknown as { amount_minor: number; created_by: string | null; invoice_date: string | null; customer_party_id: string; parties: Named }[];
    const users = (usersQ.data ?? []) as User[];
    const userName = (id: string | null) => users.find((u) => u.id === id)?.full_name || users.find((u) => u.id === id)?.email || (id ? id.slice(0, 8) : "—");

    // KPIs
    const monthSales = paid.filter((p) => p.invoice_date && p.invoice_date >= monthStart).reduce((s, p) => s + p.amount_minor, 0);
    const monthOrders = (ordersQ.data ?? []).length; // recent sample; headline count from feed
    const outstanding = (unpaidQ.data ?? []).reduce((s, r) => s + (r.amount_minor as number), 0);
    const outstandingCount = (unpaidQ.data ?? []).length;
    const newAccounts = (newAcctQ.data ?? []).length;
    const pendingAccounts = (pendingQ.data ?? []).length;

    const invStock = (invStockQ.data ?? []) as unknown as { qty_on_hand: number; reorder_level: number; products: { name: string; price_minor: number } }[];
    const stockValue = invStock.reduce((s, r) => s + Number(r.qty_on_hand) * (r.products?.price_minor ?? 0), 0);
    const lowStock = invStock
      .filter((r) => Number(r.qty_on_hand) <= Number(r.reorder_level))
      .map((r) => ({ name: r.products?.name ?? "—", qty: Number(r.qty_on_hand), reorder: Number(r.reorder_level) }))
      .sort((a, b) => a.qty - b.qty).slice(0, 6);

    // Revenue trend (6 months, paid invoices)
    const months = lastMonths(6);
    const byMonth = new Map(months.map((m) => [m.key, 0]));
    for (const p of paid) {
      if (!p.invoice_date) continue;
      const k = p.invoice_date.slice(0, 7);
      if (byMonth.has(k)) byMonth.set(k, byMonth.get(k)! + p.amount_minor);
    }
    const trend = months.map((m) => ({ label: m.label, value: byMonth.get(m.key) ?? 0 }));

    // Leaderboard (paid revenue by rep, all-time)
    const repTotals = new Map<string, number>();
    for (const p of paid) if (p.created_by) repTotals.set(p.created_by, (repTotals.get(p.created_by) ?? 0) + p.amount_minor);
    const leaderboard = [...repTotals.entries()].map(([id, total]) => ({ id, total, name: userName(id) }))
      .sort((a, b) => b.total - a.total).slice(0, 6);

    // Top accounts (paid revenue by customer)
    const acctTotals = new Map<string, { name: string; total: number }>();
    for (const p of paid) {
      const cur = acctTotals.get(p.customer_party_id) ?? { name: p.parties?.display_name ?? "—", total: 0 };
      cur.total += p.amount_minor;
      acctTotals.set(p.customer_party_id, cur);
    }
    const topAccounts = [...acctTotals.values()].sort((a, b) => b.total - a.total).slice(0, 5);

    // Top products (by revenue from order lines)
    const lines = (linesQ.data ?? []) as unknown as { qty: number; unit_price_minor: number; products: { name: string } | null }[];
    const prodTotals = new Map<string, { units: number; revenue: number }>();
    for (const l of lines) {
      const name = l.products?.name ?? "—";
      const cur = prodTotals.get(name) ?? { units: 0, revenue: 0 };
      cur.units += Number(l.qty);
      cur.revenue += Number(l.qty) * (l.unit_price_minor ?? 0);
      prodTotals.set(name, cur);
    }
    const topProducts = [...prodTotals.entries()].map(([name, v]) => ({ name, ...v }))
      .sort((a, b) => b.revenue - a.revenue).slice(0, 5);

    // Recent activity feed (orders + receipts + new accounts, merged)
    type Feed = { kind: "order" | "payment" | "account"; title: string; sub: string; amount?: number; ts: string };
    const feed: Feed[] = [];
    for (const o of (ordersQ.data ?? []) as unknown as { code: string | null; total_minor: number; payment_method: string | null; created_at: string; parties: Named }[])
      feed.push({ kind: "order", title: `Order ${o.code ?? ""}`.trim(), sub: `${o.parties?.display_name ?? "—"} · ${o.payment_method ?? "—"}`, amount: o.total_minor, ts: o.created_at });
    for (const r of (receiptsQ.data ?? []) as unknown as { amount_minor: number; method: string | null; created_at: string; parties: Named }[])
      feed.push({ kind: "payment", title: `Payment received`, sub: `${r.parties?.display_name ?? "—"} · ${r.method ?? "—"}`, amount: r.amount_minor, ts: r.created_at });
    for (const a of (acctFeedQ.data ?? []) as unknown as { approval_status: string; created_at: string; parties: Named }[])
      feed.push({ kind: "account", title: `Account ${a.approval_status}`, sub: a.parties?.display_name ?? "—", ts: a.created_at });
    feed.sort((a, b) => (a.ts < b.ts ? 1 : -1));

    return {
      monthSales, monthOrders, outstanding, outstandingCount, newAccounts, pendingAccounts,
      stockValue, lowStock, trend, leaderboard, topAccounts, topProducts, feed: feed.slice(0, 10),
    };
  }, []);

  if (!can(user, "sales.view")) return <p className="text-sm text-muted-foreground">No access.</p>;

  const trendMax = Math.max(1, ...(data?.trend ?? []).map((t) => t.value));
  const lbMax = Math.max(1, ...(data?.leaderboard ?? []).map((r) => r.total));
  const accMax = Math.max(1, ...(data?.topAccounts ?? []).map((a) => a.total));
  const prodMax = Math.max(1, ...(data?.topProducts ?? []).map((p) => p.revenue));

  return (
    <div className="mx-auto max-w-6xl">
      <PageHeader eyebrow="Sales" title="Sales dashboard" subtitle="Performance, pipeline and stock at a glance." icon={LayoutDashboard} />

      {/* KPI cards */}
      <div className="mb-6 grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Kpi icon={TrendingUp} tone="green" label="Sales this month" value={formatMoney(data?.monthSales ?? 0)} sub={`${data?.monthOrders ?? 0} recent orders`} />
        <Kpi icon={Receipt} tone="amber" label="Outstanding invoices" value={formatMoney(data?.outstanding ?? 0)} sub={`${data?.outstandingCount ?? 0} unpaid`} />
        <Kpi icon={Building2} tone="blue" label="New accounts" value={String(data?.newAccounts ?? 0)} sub={`${data?.pendingAccounts ?? 0} pending approval`} />
        <Kpi icon={Boxes} tone="zinc" label="Stock value" value={formatMoney(data?.stockValue ?? 0)} sub={`${data?.lowStock.length ?? 0} low-stock items`} />
      </div>

      {/* Revenue trend + low stock */}
      <div className="mb-4 grid grid-cols-1 gap-4 lg:grid-cols-3">
        <Card className="lg:col-span-2 p-5">
          <SectionTitle icon={TrendingUp}>Revenue trend · last 6 months</SectionTitle>
          <div className="mt-4 flex h-40 items-end gap-3">
            {(data?.trend ?? []).map((t) => (
              <div key={t.label} className="flex flex-1 flex-col items-center justify-end gap-1.5">
                <span className="text-[10px] text-muted-foreground">{t.value ? formatMoney(t.value).replace(/\.00$/, "") : ""}</span>
                <div className="flex w-full items-end justify-center" style={{ height: "100%" }}>
                  <div className="w-full max-w-10 rounded-t-md bg-primary/80 transition-all" style={{ height: `${Math.max(3, (t.value / trendMax) * 100)}%` }} />
                </div>
                <span className="text-xs font-medium text-muted-foreground">{t.label}</span>
              </div>
            ))}
            {(!data || data.trend.every((t) => t.value === 0)) && (
              <p className="m-auto text-sm text-muted-foreground">No paid revenue yet.</p>
            )}
          </div>
        </Card>

        <Card className="p-5">
          <SectionTitle icon={AlertTriangle}>Low-stock alerts</SectionTitle>
          <ul className="mt-3 space-y-2">
            {(data?.lowStock ?? []).map((l) => (
              <li key={l.name} className="flex items-center justify-between text-sm">
                <span className="truncate text-foreground">{l.name}</span>
                <Badge tone={l.qty <= 0 ? "red" : "amber"}>{l.qty} / {l.reorder}</Badge>
              </li>
            ))}
            {(data?.lowStock.length ?? 0) === 0 && <li className="text-sm text-muted-foreground">All products above reorder level. 🎉</li>}
          </ul>
        </Card>
      </div>

      {/* Leaderboard + top products */}
      <div className="mb-4 grid grid-cols-1 gap-4 lg:grid-cols-2">
        <Card className="p-5">
          <SectionTitle icon={Trophy}>Leaderboard · top reps</SectionTitle>
          <ul className="mt-3 space-y-3">
            {(data?.leaderboard ?? []).map((r, i) => (
              <li key={r.id}>
                <div className="mb-1 flex items-center justify-between text-sm">
                  <span className="flex items-center gap-2"><RankDot i={i} /> <span className="font-medium text-foreground">{r.name}</span></span>
                  <span className="text-muted-foreground">{formatMoney(r.total)}</span>
                </div>
                <Bar pct={(r.total / lbMax) * 100} />
              </li>
            ))}
            {(data?.leaderboard.length ?? 0) === 0 && <li className="text-sm text-muted-foreground">No paid invoices yet.</li>}
          </ul>
        </Card>

        <Card className="p-5">
          <SectionTitle icon={Package}>Top products · by revenue</SectionTitle>
          <ul className="mt-3 space-y-3">
            {(data?.topProducts ?? []).map((p) => (
              <li key={p.name}>
                <div className="mb-1 flex items-center justify-between text-sm">
                  <span className="font-medium text-foreground">{p.name}</span>
                  <span className="text-muted-foreground">{formatMoney(p.revenue)} · {p.units} u</span>
                </div>
                <Bar pct={(p.revenue / prodMax) * 100} tone="blue" />
              </li>
            ))}
            {(data?.topProducts.length ?? 0) === 0 && <li className="text-sm text-muted-foreground">No orders yet.</li>}
          </ul>
        </Card>
      </div>

      {/* Top accounts + activity feed */}
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <Card className="p-5">
          <SectionTitle icon={Building2}>Top accounts · by revenue</SectionTitle>
          <ul className="mt-3 space-y-3">
            {(data?.topAccounts ?? []).map((a) => (
              <li key={a.name}>
                <div className="mb-1 flex items-center justify-between text-sm">
                  <span className="font-medium text-foreground">{a.name}</span>
                  <span className="text-muted-foreground">{formatMoney(a.total)}</span>
                </div>
                <Bar pct={(a.total / accMax) * 100} tone="green" />
              </li>
            ))}
            {(data?.topAccounts.length ?? 0) === 0 && <li className="text-sm text-muted-foreground">No paid invoices yet.</li>}
          </ul>
        </Card>

        <Card className="p-5">
          <SectionTitle icon={Activity}>Recent activity</SectionTitle>
          <ul className="mt-3 divide-y divide-border">
            {(data?.feed ?? []).map((f, i) => (
              <li key={i} className="flex items-center gap-3 py-2">
                <FeedIcon kind={f.kind} />
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium text-foreground">{f.title}</p>
                  <p className="truncate text-xs text-muted-foreground">{f.sub}</p>
                </div>
                <div className="text-right">
                  {f.amount != null && <p className="text-sm font-medium">{formatMoney(f.amount)}</p>}
                  <p className="text-[10px] text-muted-foreground">{formatDate(f.ts)}</p>
                </div>
              </li>
            ))}
            {(data?.feed.length ?? 0) === 0 && <li className="py-2 text-sm text-muted-foreground">No recent activity.</li>}
          </ul>
        </Card>
      </div>

      <div className="mt-4 flex flex-wrap gap-4 text-sm">
        <Link to="/sales/orders/new" className="flex items-center gap-1 text-primary hover:underline">Place an order <ArrowRight className="h-3.5 w-3.5" /></Link>
        <Link to="/sales/invoices" className="flex items-center gap-1 text-primary hover:underline">Unpaid invoices <ArrowRight className="h-3.5 w-3.5" /></Link>
        <Link to="/sales/targets" className="flex items-center gap-1 text-primary hover:underline">Sales targets <ArrowRight className="h-3.5 w-3.5" /></Link>
      </div>
    </div>
  );
}

// --- small presentational helpers ------------------------------------------
const TONE_BG: Record<string, string> = { green: "bg-emerald-50 text-emerald-600", amber: "bg-amber-50 text-amber-600", blue: "bg-blue-50 text-blue-600", zinc: "bg-zinc-100 text-zinc-600" };

function Kpi({ icon: Icon, label, value, sub, tone }: { icon: ComponentType<{ className?: string }>; label: string; value: string; sub: string; tone: string }) {
  return (
    <Card className="p-4">
      <div className="flex items-start justify-between">
        <div className="min-w-0">
          <p className="text-xs text-muted-foreground">{label}</p>
          <p className="mt-1 truncate text-xl font-semibold tracking-tight text-foreground">{value}</p>
          <p className="mt-0.5 text-[11px] text-muted-foreground">{sub}</p>
        </div>
        <div className={cn("flex h-9 w-9 shrink-0 items-center justify-center rounded-lg", TONE_BG[tone])}><Icon className="h-5 w-5" /></div>
      </div>
    </Card>
  );
}

function SectionTitle({ icon: Icon, children }: { icon: ComponentType<{ className?: string }>; children: ReactNode }) {
  return <h2 className="flex items-center gap-2 text-sm font-semibold text-foreground"><Icon className="h-4 w-4 text-muted-foreground" /> {children}</h2>;
}

function Bar({ pct, tone = "primary" }: { pct: number; tone?: "primary" | "green" | "blue" }) {
  const bg = tone === "green" ? "bg-emerald-500" : tone === "blue" ? "bg-blue-500" : "bg-primary";
  return <div className="h-1.5 w-full overflow-hidden rounded-full bg-muted"><div className={cn("h-full rounded-full", bg)} style={{ width: `${Math.max(2, Math.min(100, pct))}%` }} /></div>;
}

function RankDot({ i }: { i: number }) {
  const tones = ["bg-amber-400", "bg-zinc-400", "bg-orange-400"];
  return <span className={cn("flex h-5 w-5 items-center justify-center rounded-full text-[10px] font-bold text-white", tones[i] ?? "bg-zinc-300")}>{i + 1}</span>;
}

function FeedIcon({ kind }: { kind: "order" | "payment" | "account" }) {
  const map = { order: ShoppingCart, payment: Wallet, account: UserPlus };
  const tone = { order: "bg-blue-50 text-blue-600", payment: "bg-emerald-50 text-emerald-600", account: "bg-amber-50 text-amber-600" }[kind];
  const Icon = map[kind];
  return <div className={cn("flex h-8 w-8 shrink-0 items-center justify-center rounded-full", tone)}><Icon className="h-4 w-4" /></div>;
}
