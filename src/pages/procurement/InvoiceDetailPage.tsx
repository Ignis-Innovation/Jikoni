import { useParams } from "react-router-dom";
import { supabase } from "@/lib/supabase";
import { useAuth, can } from "@/lib/auth";
import { useData } from "@/lib/useData";
import { InvoiceDetail } from "@/components/procurement/InvoiceDetail";

export default function InvoiceDetailPage() {
  const { id } = useParams<{ id: string }>();
  const { user } = useAuth();
  const { data, loading, reload } = useData(async () => {
    const { data: inv } = await supabase
      .from("payable_invoices")
      .select("id, code, amount_minor, currency_code, status, match_status, invoice_no, po_id, parties:vendor_party_id(display_name)")
      .eq("id", id).single();

    let poTotal = 0, received = 0, poCode: string | null = null;
    if (inv?.po_id) {
      const [{ data: po }, { data: lines }] = await Promise.all([
        supabase.from("purchase_orders").select("total_minor, code").eq("id", inv.po_id).single(),
        supabase.from("po_lines").select("qty_received, unit_price_minor").eq("po_id", inv.po_id),
      ]);
      poTotal = Number(po?.total_minor ?? 0);
      poCode = po?.code ?? null;
      received = (lines ?? []).reduce((s, l) => s + Number(l.qty_received) * Number(l.unit_price_minor), 0);
    }
    return { inv, poTotal, received, poCode };
  }, [id]);

  if (!can(user, "finance.view")) return <p className="text-sm text-zinc-500">No access.</p>;
  if (loading) return <p className="text-sm text-zinc-400">Loading…</p>;
  if (!data?.inv) return <p className="text-sm text-zinc-500">Invoice not found.</p>;

  return (
    <InvoiceDetail
      invoice={{
        id: data.inv.id, code: data.inv.code, amount_minor: data.inv.amount_minor, currency_code: data.inv.currency_code,
        status: data.inv.status, match_status: data.inv.match_status, invoice_no: data.inv.invoice_no,
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        vendor_name: (data.inv as any).parties?.display_name ?? null,
        po_id: data.inv.po_id, po_code: data.poCode,
      }}
      poTotal={data.poTotal}
      received={data.received}
      caps={{ finance: can(user, "finance.edit") }}
      onChanged={reload}
    />
  );
}
