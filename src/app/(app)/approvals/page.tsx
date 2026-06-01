import { requireUser } from "@/lib/spine/auth";
import { createClient } from "@/lib/supabase/server";
import { ModuleScaffold } from "@/components/data/ModuleScaffold";

export const dynamic = "force-dynamic";

export default async function ApprovalsPage() {
  await requireUser();
  const supabase = await createClient();
  const names = ["approval_chains", "approval_steps", "approval_requests", "approval_actions"];
  const counts = await Promise.all(
    names.map(async (n) => {
      const { count } = await supabase.from(n).select("*", { count: "exact", head: true });
      return { name: n, rows: count ?? 0 };
    })
  );
  return (
    <ModuleScaffold
      group="Spine — Phase 1G"
      title="Approvals Engine"
      blurb="One configurable approval system reused by every module. Chains route by amount band + type + department."
      tables={counts}
    />
  );
}
