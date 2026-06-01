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

// Build resource-backed groups in a stable, phase-ordered sequence.
const GROUP_ORDER = [
  "Procure-to-Pay",
  "Revenue",
  "People",
  "Assets",
  "Projects",
  "CRM",
  "Intelligence",
  "Governance",
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

export const NAV: NavGroup[] = [
  { label: "Overview", items: [{ label: "Home", href: "/", module: "*", enabled: true }] },
  SPINE,
  ...resourceGroups,
  SETTINGS,
];
