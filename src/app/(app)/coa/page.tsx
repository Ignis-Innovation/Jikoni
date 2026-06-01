import { requireUser } from "@/lib/spine/auth";
import { createClient } from "@/lib/supabase/server";
import { ModuleScaffold } from "@/components/data/ModuleScaffold";

export const dynamic = "force-dynamic";

export default async function CoaPage() {
  await requireUser();
  const supabase = await createClient();
  const names = ["accounts", "fiscal_periods", "opening_balances"];
  const counts = await Promise.all(
    names.map(async (n) => {
      const { count } = await supabase.from(n).select("*", { count: "exact", head: true }).is("deleted_at", null);
      return { name: n, rows: count ?? 0 };
    })
  );
  return (
    <ModuleScaffold
      group="Spine — Phase 1C"
      title="Chart of Accounts"
      blurb="Account hierarchy, fiscal periods, opening balances. Every posting references a postable account."
      tables={counts}
    />
  );
}
