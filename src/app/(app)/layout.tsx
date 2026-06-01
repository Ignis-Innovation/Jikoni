import { requireUser, hasModule } from "@/lib/spine/auth";
import { Sidebar } from "@/components/shell/Sidebar";
import { Topbar } from "@/components/shell/Topbar";
import { NAV } from "@/lib/spine/nav";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const user = await requireUser();

  // Permission-filter the nav (PRD §1.2 / §1.7): hide groups the user can't touch.
  const groups = NAV.map((g) => ({
    ...g,
    items: g.items.filter((i) => i.module === "*" || hasModule(user, i.module)),
  })).filter((g) => g.items.length > 0);

  return (
    <div className="flex h-screen w-full overflow-hidden bg-zinc-50">
      <Sidebar groups={groups} />
      <div className="flex min-w-0 flex-1 flex-col">
        <Topbar user={{ full_name: user.full_name, email: user.email }} />
        <main className="flex-1 overflow-y-auto p-6">{children}</main>
      </div>
    </div>
  );
}
