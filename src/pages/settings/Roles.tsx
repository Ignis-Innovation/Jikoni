import { supabase } from "@/lib/supabase";
import { useAuth, can } from "@/lib/auth";
import { useData } from "@/lib/useData";
import { Card, Badge } from "@/components/ui/primitives";

export default function Roles() {
  const { user } = useAuth();
  const { data: roles } = useData(async () => {
    const { data } = await supabase
      .from("roles")
      .select("key, name, description, is_system, role_permissions(permission_id)")
      .order("name");
    return data ?? [];
  }, []);

  if (!can(user, "identity.roles.view")) return <p className="text-sm text-muted-foreground">You don&apos;t have access to Roles.</p>;

  return (
    <div className="w-full">
      <div className="mb-5">
        <p className="text-xs text-muted-foreground">Settings</p>
        <h1 className="text-xl font-semibold tracking-tight text-foreground">Roles</h1>
        <p className="text-sm text-muted-foreground">RBAC roles live in the spine. Permissions are module + action pairs.</p>
      </div>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        {/* eslint-disable-next-line @typescript-eslint/no-explicit-any */}
        {((roles ?? []) as any[]).map((r) => (
          <Card key={r.key}>
            <div className="flex items-start justify-between">
              <div>
                <p className="font-medium text-foreground">{r.name}</p>
                <p className="font-mono text-xs text-muted-foreground">{r.key}</p>
              </div>
              {r.is_system && <Badge tone="zinc">system</Badge>}
            </div>
            <p className="mt-2 text-sm text-muted-foreground">{r.description}</p>
            <p className="mt-3 text-xs text-muted-foreground">{(r.role_permissions ?? []).length} permissions</p>
          </Card>
        ))}
      </div>
    </div>
  );
}
