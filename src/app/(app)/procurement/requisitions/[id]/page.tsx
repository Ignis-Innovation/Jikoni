import { notFound } from "next/navigation";
import { requireUser, can } from "@/lib/spine/auth";
import { createClient } from "@/lib/supabase/server";
import { RequisitionDetail } from "@/components/procurement/RequisitionDetail";

export const dynamic = "force-dynamic";

export default async function RequisitionDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const user = await requireUser();
  if (!can(user, "procurement.view")) return <p className="text-sm text-zinc-500">No access.</p>;
  const supabase = await createClient();

  const { data: req } = await supabase
    .from("requisitions")
    .select("id, code, status, total_minor, currency_code, need_by_date, approval_request_id")
    .eq("id", id)
    .single();
  if (!req) notFound();

  const [{ data: lines }, { data: vendors }] = await Promise.all([
    supabase.from("requisition_lines").select("id, item_desc, qty, est_unit_price_minor").eq("req_id", id),
    supabase.from("parties").select("id, display_name").eq("type", "vendor").is("deleted_at", null).order("display_name"),
  ]);

  return (
    <RequisitionDetail
      req={req}
      initialLines={(lines ?? []).map((l) => ({
        item_desc: l.item_desc, qty: Number(l.qty), est_unit_price_minor: Number(l.est_unit_price_minor),
      }))}
      vendors={vendors ?? []}
      caps={{ edit: can(user, "procurement.edit"), create: can(user, "procurement.create") }}
    />
  );
}
