import { requireUser, can } from "@/lib/spine/auth";
import { PartiesView } from "@/components/data/PartiesView";

export const dynamic = "force-dynamic";

export default async function PartiesPage() {
  const user = await requireUser();
  if (!can(user, "parties.view")) {
    return <p className="text-sm text-zinc-500">You don&apos;t have access to Parties.</p>;
  }
  return (
    <PartiesView
      caps={{
        create: can(user, "parties.create"),
        edit: can(user, "parties.edit"),
        del: can(user, "parties.delete"),
      }}
    />
  );
}
