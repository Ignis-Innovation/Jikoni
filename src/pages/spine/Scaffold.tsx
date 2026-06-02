import { supabase } from "@/lib/supabase";
import { useData } from "@/lib/useData";
import { ModuleScaffold } from "@/components/data/ModuleScaffold";

/** Generic spine-area page: live row counts for a set of tables. */
export function Scaffold({
  group, title, blurb, tables, softDelete = true,
}: {
  group: string; title: string; blurb: string; tables: string[]; softDelete?: boolean;
}) {
  const { data } = useData(async () => {
    return Promise.all(
      tables.map(async (n) => {
        let q = supabase.from(n).select("*", { count: "exact", head: true });
        if (softDelete) q = q.is("deleted_at", null);
        const { count } = await q;
        return { name: n, rows: count ?? 0 };
      })
    );
  }, [title]);

  return <ModuleScaffold group={group} title={title} blurb={blurb} tables={data ?? tables.map((n) => ({ name: n, rows: 0 }))} />;
}

export function Org() {
  return <Scaffold group="Spine — Phase 1B" title="Organisation Model"
    blurb="Institutions, departments, projects, locations, cost centers every module tags against."
    tables={["institutions", "departments", "projects", "locations", "cost_centers"]} />;
}
export function Coa() {
  return <Scaffold group="Spine — Phase 1C" title="Chart of Accounts"
    blurb="Account hierarchy, fiscal periods, opening balances."
    tables={["accounts", "fiscal_periods", "opening_balances"]} />;
}
export function Approvals() {
  return <Scaffold group="Spine — Phase 1G" title="Approvals Engine"
    blurb="One configurable approval system reused by every module."
    tables={["approval_chains", "approval_steps", "approval_requests", "approval_actions"]} softDelete={false} />;
}
