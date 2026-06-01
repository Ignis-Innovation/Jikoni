import { notFound } from "next/navigation";
import { requireUser, can } from "@/lib/spine/auth";
import { createClient } from "@/lib/supabase/server";
import { PODetail } from "@/components/procurement/PODetail";

export const dynamic = "force-dynamic";

export default async function PODetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const user = await requireUser();
  if (!can(user, "procurement.view")) return <p className="text-sm text-zinc-500">No access.</p>;
  const supabase = await createClient();

  const { data: po } = await supabase
    .from("purchase_orders")
    .select("id, code, status, total_minor, currency_code, vendor_party_id, parties:vendor_party_id(display_name)")
    .eq("id", id)
    .single();
  if (!po) notFound();

  const [{ data: lines }, { data: invoice }] = await Promise.all([
    supabase.from("po_lines").select("id, item_desc, qty_ordered, qty_received, unit_price_minor").eq("po_id", id),
    supabase.from("payable_invoices").select("id").eq("po_id", id).is("deleted_at", null).maybeSingle(),
  ]);

  return (
    <PODetail
      po={{
        id: po.id, code: po.code, status: po.status, total_minor: po.total_minor, currency_code: po.currency_code,
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        vendor_name: (po as any).parties?.display_name ?? null,
      }}
      lines={(lines ?? []).map((l) => ({
        id: l.id, item_desc: l.item_desc, qty_ordered: Number(l.qty_ordered),
        qty_received: Number(l.qty_received), unit_price_minor: Number(l.unit_price_minor),
      }))}
      existingInvoiceId={invoice?.id ?? null}
      caps={{ edit: can(user, "procurement.edit"), finance: can(user, "finance.create") }}
    />
  );
}
