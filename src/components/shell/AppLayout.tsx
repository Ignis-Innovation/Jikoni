import { Navigate, Outlet } from "react-router-dom";
import { useAuth, hasModule } from "@/lib/auth";
import { Sidebar } from "@/components/shell/Sidebar";
import { Topbar } from "@/components/shell/Topbar";
import { NAV, ROLE_NAV } from "@/lib/spine/nav";

export function AppLayout() {
  const { loading, user } = useAuth();

  if (loading) {
    return (
      <div className="flex h-screen items-center justify-center bg-muted/30">
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <div className="h-4 w-4 animate-spin rounded-full border-2 border-primary border-t-transparent" />
          Loading Jikoni…
        </div>
      </div>
    );
  }
  if (!user) return <Navigate to="/login" replace />;

  // Nav filtering: super admins see everything; roles with an explicit
  // ROLE_NAV allow-list see only those hrefs (so a role can show one item from a
  // group); everyone else falls back to the module-permission filter.
  const allowed = user.isSuperAdmin
    ? null
    : user.roles.reduce<Set<string> | null>((acc, role) => {
        const hrefs = ROLE_NAV[role];
        if (!hrefs) return acc;
        const set = acc ?? new Set<string>();
        for (const h of hrefs) set.add(h);
        return set;
      }, null);

  const groups = NAV.map((g) => ({
    ...g,
    items: g.items.filter((i) =>
      allowed ? allowed.has(i.href) : i.module === "*" || hasModule(user, i.module)
    ),
  })).filter((g) => g.items.length > 0);

  return (
    <div className="flex h-screen w-full overflow-hidden bg-background">
      <Sidebar groups={groups} />
      <div className="flex min-w-0 flex-1 flex-col">
        <Topbar user={{ full_name: user.full_name, email: user.email }} />
        <main className="flex-1 overflow-y-auto bg-muted/30 p-6 lg:p-8">
          <Outlet />
        </main>
      </div>
    </div>
  );
}
