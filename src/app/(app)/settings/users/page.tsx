import { requireUser, can } from "@/lib/spine/auth";
import { createClient } from "@/lib/supabase/server";
import { Badge } from "@/components/ui/primitives";
import { formatDate } from "@/lib/utils";
import { InviteUser } from "./InviteUser";

export const dynamic = "force-dynamic";

export default async function UsersPage() {
  const user = await requireUser();
  if (!can(user, "identity.users.view")) {
    return <p className="text-sm text-zinc-500">You don&apos;t have access to Users.</p>;
  }
  const supabase = await createClient();

  const { data: users } = await supabase
    .from("users")
    .select("id, full_name, email, status, last_login_at, user_roles(roles(key))")
    .is("deleted_at", null)
    .order("created_at", { ascending: true });

  const { data: roles } = await supabase.from("roles").select("key, name").order("name");

  const statusTone: Record<string, "green" | "amber" | "red"> = {
    active: "green",
    invited: "amber",
    suspended: "red",
  };

  return (
    <div className="mx-auto max-w-5xl">
      <div className="mb-5 flex items-center justify-between">
        <div>
          <p className="text-xs text-zinc-400">Settings</p>
          <h1 className="text-xl font-semibold tracking-tight text-zinc-900">Users</h1>
          <p className="text-sm text-zinc-500">Identity &amp; access — invite people and assign roles.</p>
        </div>
        {can(user, "identity.users.create") && <InviteUser roles={roles ?? []} />}
      </div>

      <div className="overflow-hidden rounded-xl border border-zinc-200 bg-white">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-zinc-200 bg-zinc-50 text-left text-xs uppercase tracking-wider text-zinc-500">
              <th className="px-4 py-2.5 font-medium">Name</th>
              <th className="px-4 py-2.5 font-medium">Email</th>
              <th className="px-4 py-2.5 font-medium">Roles</th>
              <th className="px-4 py-2.5 font-medium">Status</th>
              <th className="px-4 py-2.5 font-medium">Last login</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-zinc-100">
            {/* eslint-disable-next-line @typescript-eslint/no-explicit-any */}
            {((users ?? []) as any[]).map((u) => (
              <tr key={u.id} className="hover:bg-zinc-50">
                <td className="px-4 py-2.5 font-medium text-zinc-900">{u.full_name ?? "—"}</td>
                <td className="px-4 py-2.5 text-zinc-600">{u.email}</td>
                <td className="px-4 py-2.5">
                  <div className="flex flex-wrap gap-1">
                    {/* eslint-disable-next-line @typescript-eslint/no-explicit-any */}
                    {(u.user_roles ?? []).map((ur: any, i: number) => (
                      <Badge key={i} tone="blue">{ur.roles?.key}</Badge>
                    ))}
                  </div>
                </td>
                <td className="px-4 py-2.5"><Badge tone={statusTone[u.status] ?? "zinc"}>{u.status}</Badge></td>
                <td className="px-4 py-2.5 text-zinc-500">{u.last_login_at ? formatDate(u.last_login_at) : "—"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
