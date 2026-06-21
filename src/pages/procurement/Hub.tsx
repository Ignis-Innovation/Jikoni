import { Link } from "react-router-dom";
import { supabase } from "@/lib/supabase";
import { useAuth, can } from "@/lib/auth";
import { useData } from "@/lib/useData";
import { Card, Badge } from "@/components/ui/primitives";
import { ApprovalsInbox, type PendingItem } from "@/components/procurement/ApprovalsInbox";

async function countBy(table: string, col: string, val: string) {
  const { count } = await supabase.from(table).select("*", { count: "exact", head: true }).is("deleted_at", null).eq(col, val);
  return count ?? 0;
}

export default function Hub() {
  const { user } = useAuth();
  const { data, reload } = useData(async () => {
    const [reqDraft, reqPending, reqApproved, poIssued, poReceived, invMatched, paid] = await Promise.all([
      countBy("requisitions", "status", "draft"),
      countBy("requisitions", "status", "pending_approval"),
      countBy("requisitions", "status", "approved"),
      countBy("purchase_orders", "status", "issued"),
      countBy("purchase_orders", "status", "received"),
      countBy("payable_invoices", "status", "matched"),
      countBy("payable_invoices", "status", "paid"),
    ]);

    let pending: PendingItem[] = [];
    if (can(user, "approvals.act")) {
      const { data: reqs } = await supabase
        .from("approval_requests")
        .select("id, entity_type, entity_id, created_at, requested_by")
        .eq("status", "pending").order("created_at", { ascending: true }).limit(20);
      const requesterIds = [...new Set((reqs ?? []).map((r) => r.requested_by).filter(Boolean))] as string[];
      const reqIds = (reqs ?? []).filter((r) => r.entity_type === "requisitions").map((r) => r.entity_id);
      const [{ data: users }, { data: requisitions }] = await Promise.all([
        requesterIds.length ? supabase.from("users").select("id, full_name").in("id", requesterIds) : Promise.resolve({ data: [] as { id: string; full_name: string | null }[] }),
        reqIds.length ? supabase.from("requisitions").select("id, code").in("id", reqIds) : Promise.resolve({ data: [] as { id: string; code: string | null }[] }),
      ]);
      const nameById = new Map((users ?? []).map((u) => [u.id, u.full_name]));
      const codeById = new Map((requisitions ?? []).map((r) => [r.id, r.code]));
      pending = (reqs ?? []).map((r) => ({
        id: r.id, entity_type: r.entity_type,
        label: codeById.get(r.entity_id) ?? `${r.entity_type} ${r.entity_id.slice(0, 8)}`,
        requested_by_name: r.requested_by ? nameById.get(r.requested_by) ?? null : null,
        created_at: r.created_at,
      }));
    }
    return { reqDraft, reqPending, reqApproved, poIssued, poReceived, invMatched, paid, pending };
  }, [user?.id]);

  if (!can(user, "procurement.view") && !can(user, "finance.view")) {
    return <p className="text-sm text-muted-foreground">You don&apos;t have access to Procurement.</p>;
  }

  const stages = [
    { label: "Requisitions — draft", value: data?.reqDraft ?? 0, href: "/procurement/requisitions" },
    { label: "Awaiting approval", value: data?.reqPending ?? 0, href: "/procurement/requisitions" },
    { label: "Approved (to convert)", value: data?.reqApproved ?? 0, href: "/procurement/requisitions" },
    { label: "POs issued", value: data?.poIssued ?? 0, href: "/procurement/pos" },
    { label: "POs received", value: data?.poReceived ?? 0, href: "/procurement/pos" },
    { label: "Invoices matched", value: data?.invMatched ?? 0, href: "/procurement/invoices" },
    { label: "Invoices paid", value: data?.paid ?? 0, href: "/procurement/invoices" },
  ];

  return (
    <div className="w-full space-y-8">
      <div>
        <p className="text-xs text-muted-foreground">Phase 2</p>
        <h1 className="text-2xl font-semibold tracking-tight text-foreground">Procure-to-Pay</h1>
        <p className="text-sm text-muted-foreground">Requisition → approval → PO → GRN → invoice match → payment — all on spine services.</p>
      </div>

      <section>
        <h2 className="mb-3 text-xs font-semibold uppercase tracking-wider text-muted-foreground">Pipeline</h2>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4 lg:grid-cols-7">
          {stages.map((s) => (
            <Link key={s.label} to={s.href}>
              <Card className="p-4 transition-colors hover:border-primary/40">
                <p className="text-2xl font-semibold text-foreground">{s.value}</p>
                <p className="mt-1 text-[11px] leading-tight text-muted-foreground">{s.label}</p>
              </Card>
            </Link>
          ))}
        </div>
      </section>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        <section>
          <div className="mb-3 flex items-center justify-between">
            <h2 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Awaiting my approval</h2>
            {(data?.pending.length ?? 0) > 0 && <Badge tone="amber">{data?.pending.length}</Badge>}
          </div>
          <Card><ApprovalsInbox items={data?.pending ?? []} onChanged={reload} /></Card>
        </section>
        <section>
          <h2 className="mb-3 text-xs font-semibold uppercase tracking-wider text-muted-foreground">Quick links</h2>
          <Card>
            <ul className="space-y-2 text-sm">
              <li><Link to="/procurement/requisitions" className="text-primary hover:underline">Requisitions</Link> — raise &amp; submit for approval</li>
              <li><Link to="/procurement/pos" className="text-primary hover:underline">Purchase Orders</Link> — issue, receive goods (GRN)</li>
              <li><Link to="/procurement/invoices" className="text-primary hover:underline">Payables</Link> — three-way match &amp; pay</li>
              <li><Link to="/r/vendors" className="text-primary hover:underline">Vendors</Link> — registry</li>
            </ul>
          </Card>
        </section>
      </div>
    </div>
  );
}
