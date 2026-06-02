import { Link, useLocation } from "react-router-dom";
import { cn } from "@/lib/utils";
import type { NavGroup } from "@/lib/spine/nav";
import {
  Home, Users, Building2, Calculator, CheckCircle2, ScrollText, ShoppingCart, FileText,
  ClipboardList, Receipt, Truck, UserRound, CalendarDays, Package, Wrench, Flag, Handshake,
  Target, FileSignature, ShieldAlert, CalendarCheck, LifeBuoy, BarChart3, Leaf, Lightbulb,
  ShieldCheck, Database, Lock, Circle, type LucideIcon,
} from "lucide-react";

const ICONS: Record<string, LucideIcon> = {
  "/": Home,
  "/parties": Users,
  "/org": Building2,
  "/coa": Calculator,
  "/approvals": CheckCircle2,
  "/audit": ScrollText,
  "/procurement": ShoppingCart,
  "/procurement/requisitions": FileText,
  "/procurement/pos": ClipboardList,
  "/procurement/invoices": Receipt,
  "/r/vendors": Truck,
  "/r/customers": Building2,
  "/r/quotations": FileText,
  "/r/ar-invoices": Receipt,
  "/r/employees": UserRound,
  "/r/leave": CalendarDays,
  "/r/assets": Package,
  "/r/work-orders": Wrench,
  "/r/milestones": Flag,
  "/r/engagements": Handshake,
  "/r/opportunities": Target,
  "/r/contracts": FileSignature,
  "/r/risks": ShieldAlert,
  "/r/compliance": CalendarCheck,
  "/r/tickets": LifeBuoy,
  "/r/kpis": BarChart3,
  "/r/impact": Leaf,
  "/r/concepts": Lightbulb,
  "/settings/users": Users,
  "/settings/roles": ShieldCheck,
  "/settings/reference": Database,
};

export function Sidebar({ groups }: { groups: NavGroup[] }) {
  const { pathname } = useLocation();

  return (
    <aside className="flex h-full w-64 shrink-0 flex-col border-r border-sidebar-border bg-sidebar">
      <div className="flex h-14 items-center gap-2.5 border-b border-sidebar-border px-5">
        <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-primary text-base font-bold text-primary-foreground shadow-sm">
          J
        </div>
        <div className="leading-tight">
          <p className="text-sm font-semibold tracking-tight text-foreground">Jikoni</p>
          <p className="text-[10px] text-muted-foreground">Ignis Innovation OS</p>
        </div>
      </div>

      <nav className="flex-1 overflow-y-auto px-3 py-4">
        {groups.map((group) => (
          <div key={group.label} className="mb-5">
            <p className="mb-1.5 px-2 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground/70">
              {group.label}
            </p>
            <ul className="space-y-0.5">
              {group.items.map((item) => {
                const active = item.href === "/" ? pathname === "/" : pathname.startsWith(item.href);
                const Icon = ICONS[item.href] ?? Circle;
                if (!item.enabled) {
                  return (
                    <li key={item.href}>
                      <span
                        className="flex cursor-not-allowed items-center gap-2.5 rounded-lg px-2.5 py-1.5 text-sm text-muted-foreground/40"
                        title="Not yet built"
                      >
                        <Icon className="h-4 w-4" />
                        <span className="flex-1">{item.label}</span>
                        <Lock className="h-3 w-3" />
                      </span>
                    </li>
                  );
                }
                return (
                  <li key={item.href}>
                    <Link
                      to={item.href}
                      className={cn(
                        "group flex items-center gap-2.5 rounded-lg px-2.5 py-1.5 text-sm transition-colors",
                        active
                          ? "bg-primary/10 font-medium text-primary"
                          : "text-zinc-600 hover:bg-accent hover:text-accent-foreground"
                      )}
                    >
                      <Icon className={cn("h-4 w-4 shrink-0", active ? "text-primary" : "text-zinc-400 group-hover:text-zinc-600")} />
                      <span className="truncate">{item.label}</span>
                    </Link>
                  </li>
                );
              })}
            </ul>
          </div>
        ))}
      </nav>

      <div className="border-t border-sidebar-border px-4 py-3">
        <p className="text-[10px] text-muted-foreground">One shared spine · modules by reference</p>
      </div>
    </aside>
  );
}
