import Link from "next/link";
import { requireUser, can } from "@/lib/spine/auth";
import { createClient } from "@/lib/supabase/server";
import { Card, Badge } from "@/components/ui/primitives";
import { ApprovalsInbox, type PendingItem } from "@/components/procurement/ApprovalsInbox";

export const dynamic = "force-dynamic";

async function countBy(table: string, col: string, val: string) {
  const supabase = await createClient();
  const { count } = await supabase
    .from(table)
    .select("*", { count: "exact", head: true })
    .is("deleted_at", null)
    .eq(col, val);
  return count ?? 0;
}

export default async function ProcurementHub() {
  const user = await requireUser();
  if (!can(user, "procurement.view") && !can(user, "finance.view")) {
    return <p className="text-sm text-zinc-500">You don&apos;t have access to Procurement.</p>;
  }
  const supabase = await createClient();

  // Pipeline tiles across the loop.
  const [reqDraft, reqPending, reqApproved, poIssued, poReceived, invMatched, paid] = await Promise.all([
    countBy("requisitions", "status", "draft"),
    countBy("requisitions", "status", "pending_approval"),
    countBy("requisitions", "status", "approved"),
    countBy("purchase_orders", "status", "issued"),
    countBy("purchase_orders", "status", "received"),
    countBy("payable_invoices", "status", "matched"),
    countBy("payable_invoices", "status", "paid"),
  ]);

  // Approvals awaiting this user.
  let pending: PendingItem[] = [];
  if (can(user, "approvals.act")) {
    const { data: reqs } = await supabase
      .from("approval_requests")
      .select("id, entity_type, entity_id, created_at, requested_by")
      .eq("status", "pending")
      .order("created_at", { ascending: true })
      .limit(20);

    const requesterIds = [...new Set((reqs ?? []).map((r) => r.requested_by).filter(Boolean))] as string[];
    const reqIds = (reqs ?? []).filter((r) => r.entity_type === "requisitions").map((r) => r.entity_id);
    const [{ data: users }, { data: requisitions }] = await Promise.all([
      requesterIds.length ? supabase.from("users").select("id, full_name").in("id", requesterIds) : Promise.resolve({ data: [] }),
      reqIds.length ? supabase.from("requisitions").select("id, code, total_minor").in("id", reqIds) : Promise.resolve({ data: [] }),
    ]);
    const nameById = new Map((users ?? []).map((u) => [u.id, u.full_name]));
    const codeById = new Map((requisitions ?? []).map((r) => [r.id, r.code]));

    pending = (reqs ?? []).map((r) => ({
      id: r.id,
      entity_type: r.entity_type,
      label: codeById.get(r.entity_id) ?? `${r.entity_type} ${r.entity_id.slice(0, 8)}`,
      requested_by_name: r.requested_by ? nameById.get(r.requested_by) ?? null : null,
      created_at: r.created_at,
    }));
  }

  const stages = [
    { label: "Requisitions — draft", value: reqDraft, href: "/procurement/requisitions" },
    { label: "Awaiting approval", value: reqPending, href: "/procurement/requisitions" },
    { label: "Approved (to convert)", value: reqApproved, href: "/procurement/requisitions" },
    { label: "POs issued", value: poIssued, href: "/procurement/pos" },
    { label: "POs received", value: poReceived, href: "/procurement/pos" },
    { label: "Invoices matched", value: invMatched, href: "/procurement/invoices" },
    { label: "Invoices paid", value: paid, href: "/procurement/invoices" },
  ];

  return (
    <div className="mx-auto max-w-6xl space-y-8">
      <div>
        <p className="text-xs text-zinc-400">Phase 2</p>
        <h1 className="text-2xl font-semibold tracking-tight text-zinc-900">Procure-to-Pay</h1>
        <p className="text-sm text-zinc-500">Requisition → approval → PO → GRN → invoice match → payment — all on spine services.</p>
      </div>

      <section>
        <h2 className="mb-3 text-xs font-semibold uppercase tracking-wider text-zinc-400">Pipeline</h2>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4 lg:grid-cols-7">
          {stages.map((s) => (
            <Link key={s.label} href={s.href}>
              <Card className="p-4 transition-colors hover:border-emerald-300">
                <p className="text-2xl font-semibold text-zinc-900">{s.value}</p>
                <p className="mt-1 text-[11px] leading-tight text-zinc-500">{s.label}</p>
              </Card>
            </Link>
          ))}
        </div>
      </section>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        <section>
          <div className="mb-3 flex items-center justify-between">
            <h2 className="text-xs font-semibold uppercase tracking-wider text-zinc-400">Awaiting my approval</h2>
            {pending.length > 0 && <Badge tone="amber">{pending.length}</Badge>}
          </div>
          <Card><ApprovalsInbox items={pending} /></Card>
        </section>
        <section>
          <h2 className="mb-3 text-xs font-semibold uppercase tracking-wider text-zinc-400">Quick links</h2>
          <Card>
            <ul className="space-y-2 text-sm">
              <li><Link href="/procurement/requisitions" className="text-emerald-700 hover:underline">Requisitions</Link> — raise & submit for approval</li>
              <li><Link href="/procurement/pos" className="text-emerald-700 hover:underline">Purchase Orders</Link> — issue, receive goods (GRN)</li>
              <li><Link href="/procurement/invoices" className="text-emerald-700 hover:underline">Payables</Link> — three-way match & pay</li>
              <li><Link href="/r/vendors" className="text-emerald-700 hover:underline">Vendors</Link> — registry</li>
            </ul>
          </Card>
        </section>
      </div>
    </div>
  );
}
