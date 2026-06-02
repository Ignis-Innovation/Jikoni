import { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "@/lib/auth";
import { Bell, LogOut, Search, User } from "lucide-react";

export function Topbar({ user }: { user: { full_name: string | null; email: string } }) {
  const navigate = useNavigate();
  const { signOut } = useAuth();
  const [menuOpen, setMenuOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function onClick(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setMenuOpen(false);
    }
    document.addEventListener("mousedown", onClick);
    return () => document.removeEventListener("mousedown", onClick);
  }, []);

  async function handleSignOut() {
    await signOut();
    navigate("/login");
  }

  const initials = (user.full_name ?? user.email)
    .split(" ")
    .map((s) => s[0])
    .slice(0, 2)
    .join("")
    .toUpperCase();

  return (
    <header className="flex h-14 shrink-0 items-center justify-between border-b border-border bg-background/80 px-5 backdrop-blur">
      <div className="relative w-96 max-w-full">
        <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
        <input
          placeholder="Search…"
          className="h-9 w-full rounded-lg border border-input bg-muted/40 pl-9 pr-16 text-sm outline-none transition-colors focus:border-ring focus:bg-background focus:ring-2 focus:ring-ring"
        />
        <kbd className="pointer-events-none absolute right-2.5 top-1/2 -translate-y-1/2 rounded border border-border bg-background px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground">
          ⌘K
        </kbd>
      </div>

      <div className="flex items-center gap-2">
        <button
          className="relative flex h-9 w-9 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
          aria-label="Notifications"
        >
          <Bell className="h-[18px] w-[18px]" />
          <span className="absolute right-2 top-2 h-1.5 w-1.5 rounded-full bg-primary" />
        </button>

        <div className="relative" ref={ref}>
          <button
            onClick={() => setMenuOpen((v) => !v)}
            className="flex items-center gap-2 rounded-lg p-1 pr-2 transition-colors hover:bg-accent"
          >
            <span className="flex h-7 w-7 items-center justify-center rounded-full bg-primary text-xs font-semibold text-primary-foreground">
              {initials}
            </span>
            <span className="hidden text-sm font-medium text-foreground sm:block">{user.full_name ?? user.email}</span>
          </button>
          {menuOpen && (
            <div className="absolute right-0 top-11 z-30 w-60 rounded-xl border border-border bg-popover p-1.5 shadow-lg">
              <div className="flex items-center gap-2.5 px-2 py-2">
                <span className="flex h-9 w-9 items-center justify-center rounded-full bg-primary text-sm font-semibold text-primary-foreground">
                  {initials}
                </span>
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium text-foreground">{user.full_name ?? "—"}</p>
                  <p className="truncate text-xs text-muted-foreground">{user.email}</p>
                </div>
              </div>
              <hr className="my-1 border-border" />
              <button className="flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-sm text-foreground transition-colors hover:bg-accent">
                <User className="h-4 w-4 text-muted-foreground" /> Profile
              </button>
              <button
                onClick={handleSignOut}
                className="flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-sm text-foreground transition-colors hover:bg-accent"
              >
                <LogOut className="h-4 w-4 text-muted-foreground" /> Sign out
              </button>
            </div>
          )}
        </div>
      </div>
    </header>
  );
}
