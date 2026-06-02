import { useParams } from "react-router-dom";
import { supabase } from "@/lib/supabase";
import { useAuth, can } from "@/lib/auth";
import { useData } from "@/lib/useData";
import { PODetail } from "@/components/procurement/PODetail";

export default function PODetailPage() {
  const { id } = useParams<{ id: string }>();
  const { user } = useAuth();
  const { data, loading, reload } = useData(async () => {
    const { data: po } = await supabase
      .from("purchase_orders")
      .select("id, code, status, total_minor, currency_code, vendor_party_id, parties:vendor_party_id(display_name)")
      .eq("id", id).single();
    const [{ data: lines }, { data: invoice }] = await Promise.all([
      supabase.from("po_lines").select("id, item_desc, qty_ordered, qty_received, unit_price_minor").eq("po_id", id),
      supabase.from("payable_invoices").select("id").eq("po_id", id).is("deleted_at", null).maybeSingle(),
    ]);
    return { po, lines: lines ?? [], invoiceId: invoice?.id ?? null };
  }, [id]);

  if (!can(user, "procurement.view")) return <p className="text-sm text-muted-foreground">No access.</p>;
  if (loading) return <p className="text-sm text-muted-foreground">Loading…</p>;
  if (!data?.po) return <p className="text-sm text-muted-foreground">PO not found.</p>;

  return (
    <PODetail
      po={{
        id: data.po.id, code: data.po.code, status: data.po.status, total_minor: data.po.total_minor,
        currency_code: data.po.currency_code,
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        vendor_name: (data.po as any).parties?.display_name ?? null,
      }}
      lines={data.lines.map((l) => ({
        id: l.id, item_desc: l.item_desc, qty_ordered: Number(l.qty_ordered),
        qty_received: Number(l.qty_received), unit_price_minor: Number(l.unit_price_minor),
      }))}
      existingInvoiceId={data.invoiceId}
      caps={{ edit: can(user, "procurement.edit"), finance: can(user, "finance.create") }}
      onChanged={reload}
    />
  );
}
