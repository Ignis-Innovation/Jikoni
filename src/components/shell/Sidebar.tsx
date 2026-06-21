import { useEffect, useState } from "react";
import { Link, useLocation } from "react-router-dom";
import { cn } from "@/lib/utils";
import type { NavGroup } from "@/lib/spine/nav";
import {
  Home, Users, Building2, Calculator, CheckCircle2, ScrollText, ShoppingCart, FileText,
  ClipboardList, Receipt, Truck, UserRound, CalendarDays, Package, Flag, Handshake,
  Target, FileSignature, ShieldAlert, CalendarCheck, LifeBuoy, BarChart3, Leaf, Lightbulb,
  ShieldCheck, Database, Lock, Circle, Columns3, ListTodo, UserPlus, ClipboardCheck,
  Wallet, Banknote, Boxes, ChevronDown,
  type LucideIcon,
} from "lucide-react";

const ICONS: Record<string, LucideIcon> = {
  "/": Home,
  "/tasks": ListTodo,
  "/leave": CalendarCheck,
  "/payment-requests": Wallet,
  "/finance/payment-approvals": Banknote,
  "/hr/assign-task": UserPlus,
  "/hr/leave-approvals": ClipboardCheck,
  "/parties": Users,
  "/org": Building2,
  "/coa": Calculator,
  "/approvals": CheckCircle2,
  "/audit": ScrollText,
  "/sales": BarChart3,
  "/sales/accounts": Building2,
  "/sales/products": Package,
  "/sales/inventory": Boxes,
  "/sales/orders/new": ShoppingCart,
  "/sales/orders": ClipboardList,
  "/sales/invoices": Receipt,
  "/sales/payments": Banknote,
  "/sales/targets": Target,
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
  "/r/milestones": Flag,
  "/crm/pipeline": Columns3,
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

/* The Ignis flame — the brand mark used in the sidebar header. */
function FlameMark({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" className={className} aria-hidden>
      <path
        d="M12 2c1 3-1 4-1 6 0 1.5 1 2.2 1 2.2S14 9 14 7c2 1.5 4 4 4 7a6 6 0 1 1-12 0c0-2 1-3.5 2-4.5.2 1.2 1 2 1 2 .3-3 2-4.5 3-9.5Z"
        fill="#fff"
      />
    </svg>
  );
}

export function Sidebar({ groups }: { groups: NavGroup[] }) {
  const { pathname } = useLocation();

  const isActive = (href: string) => (href === "/" ? pathname === "/" : pathname.startsWith(href));
  const groupIsActive = (group: NavGroup) => group.items.some((i) => isActive(i.href));

  // Collapsible groups so the rail doesn't feel crowded. A group starts open
  // when it holds the current route; toggling is remembered while mounted, and
  // navigating into a collapsed group auto-expands it.
  const [open, setOpen] = useState<Record<string, boolean>>(() =>
    Object.fromEntries(groups.map((g) => [g.label, groupIsActive(g)]))
  );
  useEffect(() => {
    setOpen((prev) => {
      const next = { ...prev };
      for (const g of groups) if (groupIsActive(g)) next[g.label] = true;
      return next;
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pathname]);

  const toggle = (label: string) => setOpen((p) => ({ ...p, [label]: !p[label] }));

  return (
    <aside className="flex h-full w-64 shrink-0 flex-col bg-sidebar text-sidebar-foreground">
      <div className="flex h-14 items-center gap-3 px-5">
        <div
          className="flex h-9 w-9 shrink-0 items-center justify-center rounded-[9px]"
          style={{
            background: "radial-gradient(circle at 50% 120%, var(--ember) 0%, #8a2f12 70%)",
            boxShadow: "0 0 18px -4px var(--ember)",
          }}
        >
          <FlameMark className="h-[18px] w-[18px]" />
        </div>
        <div className="leading-tight">
          <p className="font-display text-lg font-bold tracking-tight text-white">Jikoni</p>
          <p className="text-[9.5px] uppercase tracking-[0.14em] text-sidebar-muted">Ignis Operating System</p>
        </div>
      </div>

      <nav className="flex-1 overflow-y-auto px-3 py-3">
        {groups.map((group) => {
          const isOpen = open[group.label] ?? false;
          return (
          <div key={group.label} className="mb-1.5">
            <button
              type="button"
              onClick={() => toggle(group.label)}
              className="flex w-full items-center justify-between rounded-[9px] px-2.5 pb-1.5 pt-3 text-[9px] font-semibold uppercase tracking-[0.13em] text-sidebar-muted transition-colors hover:text-sidebar-foreground"
            >
              <span>{group.label}</span>
              <ChevronDown className={cn("h-3.5 w-3.5 transition-transform", !isOpen && "-rotate-90")} />
            </button>
            <ul className={cn("space-y-0.5", !isOpen && "hidden")}>
              {group.items.map((item) => {
                const active = item.href === "/" ? pathname === "/" : pathname.startsWith(item.href);
                const Icon = ICONS[item.href] ?? Circle;
                if (!item.enabled) {
                  return (
                    <li key={item.href}>
                      <span
                        className="flex cursor-not-allowed items-center gap-3 rounded-[9px] px-2.5 py-2 text-[13.5px] text-sidebar-muted/50"
                        title="Not yet built"
                      >
                        <Icon className="h-[17px] w-[17px]" />
                        <span className="flex-1 truncate">{item.label}</span>
                        <Lock className="h-3 w-3" />
                      </span>
                    </li>
                  );
                }
                return (
                  <li key={item.href} className="relative">
                    {active && (
                      <span
                        className="absolute -left-3 bottom-2 top-2 w-[3px] rounded-r-[3px] bg-ember"
                        style={{ boxShadow: "0 0 10px var(--ember)" }}
                      />
                    )}
                    <Link
                      to={item.href}
                      className={cn(
                        "group flex items-center gap-3 rounded-[9px] px-2.5 py-2 text-[13.5px] font-medium transition-colors",
                        active
                          ? "bg-sidebar-accent text-white"
                          : "text-sidebar-foreground/75 hover:bg-[#211913] hover:text-white"
                      )}
                    >
                      <Icon className={cn("h-[17px] w-[17px] shrink-0 opacity-90", active && "text-white")} />
                      <span className="truncate">{item.label}</span>
                    </Link>
                  </li>
                );
              })}
            </ul>
          </div>
          );
        })}
      </nav>

      <div className="mx-4 border-t border-sidebar-border px-1 py-3">
        <p className="text-[10px] text-sidebar-muted">One shared spine · modules by reference</p>
      </div>
    </aside>
  );
}
