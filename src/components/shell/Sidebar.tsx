"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/utils";
import type { NavGroup } from "@/lib/spine/nav";
import { Lock } from "lucide-react";

export function Sidebar({ groups }: { groups: NavGroup[] }) {
  const pathname = usePathname();
  return (
    <aside className="flex h-full w-60 shrink-0 flex-col border-r border-zinc-200 bg-white">
      <div className="flex h-14 items-center gap-2 border-b border-zinc-200 px-5">
        <div className="flex h-7 w-7 items-center justify-center rounded-md bg-emerald-600 text-sm font-bold text-white">J</div>
        <span className="text-sm font-semibold tracking-tight text-zinc-900">Jikoni</span>
      </div>
      <nav className="flex-1 overflow-y-auto px-3 py-4">
        {groups.map((group) => (
          <div key={group.label} className="mb-5">
            <p className="mb-1 px-2 text-[10px] font-semibold uppercase tracking-wider text-zinc-400">{group.label}</p>
            <ul className="space-y-0.5">
              {group.items.map((item) => {
                const active = item.href === "/" ? pathname === "/" : pathname.startsWith(item.href);
                if (!item.enabled) {
                  return (
                    <li key={item.href}>
                      <span className="flex cursor-not-allowed items-center justify-between rounded-md px-2 py-1.5 text-sm text-zinc-300" title="Not yet built">
                        {item.label}
                        <Lock className="h-3 w-3" />
                      </span>
                    </li>
                  );
                }
                return (
                  <li key={item.href}>
                    <Link
                      href={item.href}
                      className={cn(
                        "flex items-center rounded-md px-2 py-1.5 text-sm font-medium transition-colors",
                        active ? "bg-emerald-50 text-emerald-700" : "text-zinc-600 hover:bg-zinc-100"
                      )}
                    >
                      {item.label}
                    </Link>
                  </li>
                );
              })}
            </ul>
          </div>
        ))}
      </nav>
    </aside>
  );
}
