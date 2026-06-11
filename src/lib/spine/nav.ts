// Navigation model. Each item declares the module-permission prefix that gates
// its visibility (PRD §1.7: nav is permission-filtered). Resource-backed items
// are generated from the registry so adding a resource adds its nav entry.
import { RESOURCES } from "@/lib/spine/resources";

export type NavItem = {
  label: string;
  href: string;
  module: string; // permission prefix, e.g. "parties"
  enabled: boolean;
};

export type NavGroup = {
  label: string;
  items: NavItem[];
};

// Fixed spine + settings items.
const SPINE: NavGroup = {
  label: "Spine",
  items: [
    { label: "Parties", href: "/parties", module: "parties", enabled: true },
    { label: "Organisation", href: "/org", module: "org", enabled: true },
    { label: "Chart of Accounts", href: "/coa", module: "coa", enabled: true },
    { label: "Approvals", href: "/approvals", module: "approvals", enabled: true },
    { label: "Payment Approvals", href: "/finance/payment-approvals", module: "payments", enabled: true },
    { label: "Audit Log", href: "/audit", module: "audit", enabled: true },
  ],
};

const SETTINGS: NavGroup = {
  label: "Settings",
  items: [
    { label: "Users", href: "/settings/users", module: "identity", enabled: true },
    { label: "Roles", href: "/settings/roles", module: "identity", enabled: true },
    { label: "Reference Data", href: "/settings/reference", module: "refdata", enabled: true },
  ],
};

// Procure-to-Pay has dedicated workflow pages (lines, approvals, GRN, match),
// so it's a hand-built group rather than generic resource lists.
const PROCUREMENT: NavGroup = {
  label: "Procure-to-Pay",
  items: [
    { label: "Overview", href: "/procurement", module: "procurement", enabled: true },
    { label: "Vendors", href: "/r/vendors", module: "procurement", enabled: true },
    { label: "Requisitions", href: "/procurement/requisitions", module: "procurement", enabled: true },
    { label: "Purchase Orders", href: "/procurement/pos", module: "procurement", enabled: true },
    { label: "Payables", href: "/procurement/invoices", module: "finance", enabled: true },
  ],
};

// Sales CRM (Phase 12) — dedicated workflow pages (order wizard, aging, targets),
// so it's a hand-built group. Invoices/Payments read the revenue spine; the rest
// are gated on the 'sales' module. RLS is the real guard either way.
const SALES: NavGroup = {
  label: "Sales",
  items: [
    { label: "Dashboard", href: "/sales", module: "sales", enabled: true },
    { label: "Accounts", href: "/sales/accounts", module: "sales", enabled: true },
    { label: "Products", href: "/sales/products", module: "sales", enabled: true },
    { label: "Inventory", href: "/sales/inventory", module: "sales", enabled: true },
    { label: "Place Order", href: "/sales/orders/new", module: "sales", enabled: true },
    { label: "Orders", href: "/sales/orders", module: "sales", enabled: true },
    { label: "Invoices", href: "/sales/invoices", module: "revenue", enabled: true },
    { label: "Payments", href: "/sales/payments", module: "revenue", enabled: true },
    { label: "Targets", href: "/sales/targets", module: "sales", enabled: true },
  ],
};

// Build remaining resource-backed groups in a stable, phase-ordered sequence.
const GROUP_ORDER = [
  "Revenue",
  "People",
  "Assets",
  "Projects",
  "CRM",
  "Intelligence",
  "Field & Portals",
  "Business Development",
];

const resourceGroups: NavGroup[] = GROUP_ORDER.map((g) => ({
  label: g,
  items: RESOURCES.filter((r) => r.group === g).map((r) => ({
    label: r.title,
    href: `/r/${r.slug}`,
    module: r.module,
    enabled: true,
  })),
})).filter((g) => g.items.length > 0);

// CRM group: pin the Pipeline board on top and route Engagements to its
// dedicated page (timeline + follow-ups) instead of the generic resource list.
const crmGroup = resourceGroups.find((g) => g.label === "CRM");
if (crmGroup) {
  crmGroup.items = crmGroup.items.map((i) => (i.href === "/r/engagements" ? { ...i, href: "/crm/engagements" } : i));
  crmGroup.items.unshift({ label: "Pipeline", href: "/crm/pipeline", module: "crm", enabled: true });
}

// People (HR) group. The generic "/r/leave" resource duplicates the
// self-service Leave Application in Workspace, so drop it from the HR nav and
// give HR the workflow screens instead: assign tasks + approve leave.
const peopleGroup = resourceGroups.find((g) => g.label === "People");
if (peopleGroup) {
  peopleGroup.items = peopleGroup.items.filter((i) => i.href !== "/r/leave");
  peopleGroup.items.push({ label: "Assign Task", href: "/hr/assign-task", module: "people", enabled: true });
  peopleGroup.items.push({ label: "Leave Approvals", href: "/hr/leave-approvals", module: "people", enabled: true });
}

// Personal workspace — available to every authenticated user (module "*").
// Tasks and Leave are user-scoped via RLS, so they need no module permission.
const WORKSPACE: NavGroup = {
  label: "Workspace",
  items: [
    { label: "Tasks", href: "/tasks", module: "*", enabled: true },
    { label: "Leave Application", href: "/leave", module: "*", enabled: true },
    { label: "Payment Requests", href: "/payment-requests", module: "*", enabled: true },
  ],
};

export const NAV: NavGroup[] = [
  {
    label: "Overview",
    items: [
      { label: "Home", href: "/", module: "*", enabled: true },
      // Calendar is company-wide (module "*"): every role sees it.
      { label: "Calendar", href: "/calendar", module: "*", enabled: true },
    ],
  },
  WORKSPACE,
  SPINE,
  SALES,
  PROCUREMENT,
  ...resourceGroups,
  SETTINGS,
];

// Per-role nav allow-lists. A role listed here sees ONLY these hrefs (module
// permissions still apply as a safety net via RLS). Roles NOT listed here fall
// back to the default module-permission filter (see AppLayout). This lets a role
// show a single item from a group (e.g. just Leave) without the whole group.
// All Sales-section hrefs (the hand-built SALES group above), reused by the
// sales roles below so adding a Sales page only needs one edit there + here.
const SALES_HREFS = SALES.items.map((i) => i.href);

const PARTNER_MANAGER_HREFS = ["/", "/calendar", "/tasks", "/leave", "/payment-requests", "/crm/pipeline", "/crm/engagements", "/r/opportunities", "/r/partners"];

export const ROLE_NAV: Record<string, string[]> = {
  partner_manager: PARTNER_MANAGER_HREFS,
  // Sales Manager = the Partner Manager experience PLUS the full Sales section.
  sales_manager: [...PARTNER_MANAGER_HREFS, ...SALES_HREFS],
  sales_rep: ["/", "/calendar", "/tasks", "/leave", "/payment-requests", ...SALES_HREFS],
  inventory_clerk: ["/", "/calendar", "/tasks", "/leave", "/sales/products", "/sales/inventory"],
};
