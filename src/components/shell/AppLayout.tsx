import { Navigate, Outlet } from "react-router-dom";
import { useAuth, hasModule } from "@/lib/auth";
import { Sidebar } from "@/components/shell/Sidebar";
import { Topbar } from "@/components/shell/Topbar";
import { NAV } from "@/lib/spine/nav";

export function AppLayout() {
  const { loading, user } = useAuth();

  if (loading) {
    return (
      <div className="flex h-screen items-center justify-center bg-zinc-50">
        <div className="flex items-center gap-2 text-sm text-zinc-400">
          <div className="h-4 w-4 animate-spin rounded-full border-2 border-emerald-500 border-t-transparent" />
          Loading Jikoni…
        </div>
      </div>
    );
  }
  if (!user) return <Navigate to="/login" replace />;

  // Permission-filter the nav (PRD §1.2 / §1.7).
  const groups = NAV.map((g) => ({
    ...g,
    items: g.items.filter((i) => i.module === "*" || hasModule(user, i.module)),
  })).filter((g) => g.items.length > 0);

  return (
    <div className="flex h-screen w-full overflow-hidden bg-zinc-50">
      <Sidebar groups={groups} />
      <div className="flex min-w-0 flex-1 flex-col">
        <Topbar user={{ full_name: user.full_name, email: user.email }} />
        <main className="flex-1 overflow-y-auto p-6">
          <Outlet />
        </main>
      </div>
    </div>
  );
}
