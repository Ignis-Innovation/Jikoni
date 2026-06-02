import { useParams } from "react-router-dom";
import { supabase } from "@/lib/supabase";
import { useAuth, can } from "@/lib/auth";
import { useData } from "@/lib/useData";
import { RequisitionDetail } from "@/components/procurement/RequisitionDetail";

export default function RequisitionDetailPage() {
  const { id } = useParams<{ id: string }>();
  const { user } = useAuth();
  const { data, loading, reload } = useData(async () => {
    const { data: req } = await supabase
      .from("requisitions")
      .select("id, code, status, total_minor, currency_code, need_by_date, approval_request_id")
      .eq("id", id).single();
    const [{ data: lines }, { data: vendors }] = await Promise.all([
      supabase.from("requisition_lines").select("id, item_desc, qty, est_unit_price_minor").eq("req_id", id),
      supabase.from("parties").select("id, display_name").eq("type", "vendor").is("deleted_at", null).order("display_name"),
    ]);
    return { req, lines: lines ?? [], vendors: vendors ?? [] };
  }, [id]);

  if (!can(user, "procurement.view")) return <p className="text-sm text-zinc-500">No access.</p>;
  if (loading) return <p className="text-sm text-zinc-400">Loading…</p>;
  if (!data?.req) return <p className="text-sm text-zinc-500">Requisition not found.</p>;

  return (
    <RequisitionDetail
      req={data.req}
      initialLines={data.lines.map((l) => ({ item_desc: l.item_desc, qty: Number(l.qty), est_unit_price_minor: Number(l.est_unit_price_minor) }))}
      vendors={data.vendors}
      caps={{ edit: can(user, "procurement.edit"), create: can(user, "procurement.create") }}
      onChanged={reload}
    />
  );
}
