// Navigation model. Each item declares the module-permission prefix that gates
// its visibility (PRD §1.7: nav is permission-filtered). Phase 1 items are live;
// later-phase groups are listed but disabled until their modules are built.
export type NavItem = {
  label: string;
  href: string;
  module: string; // permission prefix, e.g. "parties"
  phase: number;
  enabled: boolean;
};

export type NavGroup = {
  label: string;
  items: NavItem[];
};

export const NAV: NavGroup[] = [
  {
    label: "Overview",
    items: [{ label: "Home", href: "/", module: "*", phase: 8, enabled: true }],
  },
  {
    label: "Spine",
    items: [
      { label: "Parties", href: "/parties", module: "parties", phase: 1, enabled: true },
      { label: "Organisation", href: "/org", module: "org", phase: 1, enabled: true },
      { label: "Chart of Accounts", href: "/coa", module: "coa", phase: 1, enabled: true },
      { label: "Approvals", href: "/approvals", module: "approvals", phase: 1, enabled: true },
      { label: "Audit Log", href: "/audit", module: "audit", phase: 1, enabled: true },
    ],
  },
  {
    label: "Procure-to-Pay",
    items: [
      { label: "Vendors", href: "/procurement/vendors", module: "procurement", phase: 2, enabled: false },
      { label: "Requisitions", href: "/procurement/requisitions", module: "procurement", phase: 2, enabled: false },
      { label: "Purchase Orders", href: "/procurement/pos", module: "procurement", phase: 2, enabled: false },
    ],
  },
  {
    label: "CRM",
    items: [
      { label: "Engagements", href: "/crm/engagements", module: "crm", phase: 7, enabled: false },
    ],
  },
  {
    label: "Settings",
    items: [
      { label: "Users", href: "/settings/users", module: "identity", phase: 1, enabled: true },
      { label: "Roles", href: "/settings/roles", module: "identity", phase: 1, enabled: true },
      { label: "Reference Data", href: "/settings/reference", module: "refdata", phase: 1, enabled: true },
    ],
  },
];
