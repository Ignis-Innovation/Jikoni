import { requireUser } from "@/lib/spine/auth";
import { createClient } from "@/lib/supabase/server";
import { ModuleScaffold } from "@/components/data/ModuleScaffold";

export const dynamic = "force-dynamic";

export default async function OrgPage() {
  await requireUser();
  const supabase = await createClient();
  const names = ["institutions", "departments", "projects", "locations", "cost_centers"];
  const counts = await Promise.all(
    names.map(async (n) => {
      const { count } = await supabase.from(n).select("*", { count: "exact", head: true }).is("deleted_at", null);
      return { name: n, rows: count ?? 0 };
    })
  );
  return (
    <ModuleScaffold
      group="Spine — Phase 1B"
      title="Organisation Model"
      blurb="Institutions, departments, projects, locations, cost centers every module tags against."
      tables={counts}
    />
  );
}
