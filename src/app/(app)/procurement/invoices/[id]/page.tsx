import { notFound } from "next/navigation";
import { requireUser, can } from "@/lib/spine/auth";
import { createClient } from "@/lib/supabase/server";
import { InvoiceDetail } from "@/components/procurement/InvoiceDetail";

export const dynamic = "force-dynamic";

export default async function InvoiceDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const user = await requireUser();
  if (!can(user, "finance.view")) return <p className="text-sm text-zinc-500">No access.</p>;
  const supabase = await createClient();

  const { data: inv } = await supabase
    .from("payable_invoices")
    .select("id, code, amount_minor, currency_code, status, match_status, invoice_no, po_id, parties:vendor_party_id(display_name)")
    .eq("id", id)
    .single();
  if (!inv) notFound();

  // Compute the three reference figures for the match panel.
  let poTotal = 0, received = 0, poCode: string | null = null;
  if (inv.po_id) {
    const [{ data: po }, { data: lines }] = await Promise.all([
      supabase.from("purchase_orders").select("total_minor, code").eq("id", inv.po_id).single(),
      supabase.from("po_lines").select("qty_received, unit_price_minor").eq("po_id", inv.po_id),
    ]);
    poTotal = Number(po?.total_minor ?? 0);
    poCode = po?.code ?? null;
    received = (lines ?? []).reduce((s, l) => s + Number(l.qty_received) * Number(l.unit_price_minor), 0);
  }

  return (
    <InvoiceDetail
      invoice={{
        id: inv.id, code: inv.code, amount_minor: inv.amount_minor, currency_code: inv.currency_code,
        status: inv.status, match_status: inv.match_status, invoice_no: inv.invoice_no,
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        vendor_name: (inv as any).parties?.display_name ?? null,
        po_id: inv.po_id, po_code: poCode,
      }}
      poTotal={poTotal}
      received={received}
      caps={{ finance: can(user, "finance.edit") }}
    />
  );
}
