"use client";
import { createClient } from "@/lib/supabase/client";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { Bell, LogOut, Search } from "lucide-react";

export function Topbar({ user }: { user: { full_name: string | null; email: string } }) {
  const router = useRouter();
  const [menuOpen, setMenuOpen] = useState(false);

  async function signOut() {
    const supabase = createClient();
    await supabase.auth.signOut();
    router.push("/login");
    router.refresh();
  }

  const initials = (user.full_name ?? user.email)
    .split(" ")
    .map((s) => s[0])
    .slice(0, 2)
    .join("")
    .toUpperCase();

  return (
    <header className="flex h-14 shrink-0 items-center justify-between border-b border-zinc-200 bg-white px-5">
      <div className="relative w-80 max-w-full">
        <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-zinc-400" />
        <input
          placeholder="Search…"
          className="h-9 w-full rounded-md border border-zinc-200 bg-zinc-50 pl-9 pr-3 text-sm outline-none focus:border-emerald-500 focus:bg-white"
        />
      </div>
      <div className="flex items-center gap-3">
        <button className="relative text-zinc-500 hover:text-zinc-800" aria-label="Notifications">
          <Bell className="h-5 w-5" />
        </button>
        <div className="relative">
          <button
            onClick={() => setMenuOpen((v) => !v)}
            className="flex h-8 w-8 items-center justify-center rounded-full bg-emerald-600 text-xs font-semibold text-white"
          >
            {initials}
          </button>
          {menuOpen && (
            <div className="absolute right-0 top-10 z-20 w-56 rounded-lg border border-zinc-200 bg-white p-1.5 shadow-lg">
              <div className="px-2 py-2">
                <p className="text-sm font-medium text-zinc-900">{user.full_name ?? "—"}</p>
                <p className="truncate text-xs text-zinc-500">{user.email}</p>
              </div>
              <hr className="my-1 border-zinc-100" />
              <button
                onClick={signOut}
                className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-sm text-zinc-700 hover:bg-zinc-100"
              >
                <LogOut className="h-4 w-4" /> Sign out
              </button>
            </div>
          )}
        </div>
      </div>
    </header>
  );
}
