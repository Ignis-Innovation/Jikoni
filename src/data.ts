// Illustrative demo data — ported verbatim from the Jikoni_19 prototype.
// This is the "build open" phase: everything on one spine, wired to real
// records module by module in later phases.

export type Entity = "Kenya" | "Uganda" | "Consolidated";

export const flagColors: Record<Entity, string[]> = {
  Kenya: ["#000", "#bb0000", "#006600"],
  Uganda: ["#000", "#fcdc04", "#d90000"],
  Consolidated: ["#12A3BE"],
};

export interface PulseStat {
  k: string;
  tick: string;
  v: string;
  d: string;
  dc: "up" | "down" | "flat";
}

// Home dashboard pulse stats have no live source yet — start empty until wired
// to real aggregates. The Pulse strip renders its own "no metrics" placeholder.
export const pulseData: Record<Entity, PulseStat[]> = {
  Kenya: [],
  Uganda: [],
  Consolidated: [],
};

export const teamColors: Record<string, string> = {
  Dennis: "#E2632A",
  Brian: "#12A3BE",
  Joan: "#3C8A5E",
  Wilson: "#6D28D9",
  Elizabeth: "#B91C1C",
  Wanjiku: "#0e7d91",
  Lily: "#A16207",
};

export interface WeekTask {
  id: string;
  t: string;
  s: string;
  o: string;
  p: string;
  pl: string;
}

// Seeded demo rows removed — these start empty and fill from real data.
// My Week loads from the tasks table via bootstrap; the Status Board and the
// fundraise pipeline have no live source yet, so their views show empty states.
export const initialMyWeek: WeekTask[] = [];

export const burners: { t: string; s: string; st: string; pl: string; ring: string }[] = [];

export const funders: { n: string; ty: string; st: string; amt: string; stc: string }[] = [];

export interface EngRow {
  id: string;
  n: string;
  st: string;
  o: string;
  pl: string;
  plt: string;
}

// Only the pipeline labels are kept — the engagement rows themselves are read
// live from the DB (store.crm.engUp / engDown), not from here.
export const crmData: Record<"up" | "down", { title: string; meta: string; rows: EngRow[] }> = {
  up: {
    title: "Upstream engagements",
    meta: "funders · investors · TA · government",
    rows: [],
  },
  down: {
    title: "Downstream engagements",
    meta: "institutions · distributors · EPCs · manufacturers",
    rows: [],
  },
};

// The member roster is no longer hardcoded — User Management reads it live from
// public.app_users (see store.tsx loadFromDb / Member). Invite people to populate it.

export const roleMeta: Record<string, [string, string]> = {
  admin: ["admin", "Admin"],
  fin: ["fin", "Finance"],
  std: ["std", "Standard"],
  view: ["view", "View only"],
};

/* ----- access control model ----- */
export const accessModules = [
  { k: "finance", l: "Finance & Accounting" },
  { k: "procurement", l: "Procurement" },
  { k: "inventory", l: "Inventory & Assets" },
  { k: "hr", l: "Human Resources" },
  { k: "deploy", l: "Deployment & Carbon" },
  { k: "readiness", l: "Institution Readiness" },
  { k: "raise", l: "Fundraise & Diligence" },
  { k: "crm", l: "Partnerships CRM" },
  { k: "projects", l: "Projects & Programmes" },
  { k: "reports", l: "Reports & Board pack" },
  { k: "compliance", l: "Compliance & Governance" },
  { k: "dataroom", l: "Investor Data Room" },
  { k: "settings", l: "Settings" },
  { k: "users", l: "User Management" },
];

export const lvlName = ["No access", "View", "Edit", "Full"];
export const lvlClass = ["", "view", "edit", "full"];

export type Perms = Record<string, number>;
const allFull: Perms = Object.fromEntries(accessModules.map((m) => [m.k, 3]));

export const roleTemplates: Record<string, Perms> = {
  admin: { ...allFull },
  fin: { finance: 3, procurement: 3, inventory: 3, hr: 1, deploy: 1, readiness: 0, raise: 0, crm: 1, projects: 2, reports: 2, compliance: 2, dataroom: 0, settings: 0, users: 0 },
  std: { finance: 0, procurement: 1, inventory: 1, hr: 0, deploy: 1, readiness: 1, raise: 1, crm: 3, projects: 1, reports: 1, compliance: 1, dataroom: 0, settings: 0, users: 0 },
  view: { finance: 0, procurement: 0, inventory: 0, hr: 0, deploy: 1, readiness: 1, raise: 0, crm: 1, projects: 0, reports: 1, compliance: 1, dataroom: 0, settings: 0, users: 0 },
};

// Super admin = anyone whose live grant gives full (level 3) access to the "users"
// module. Derived from perms at read time (see Users.tsx / AccessDrawer), not a list.

// Who may open User Management at all: anyone with a "users" grant (level >= 1).
// In practice these are the admin-type roles (MD, HR, Head of IT) — everyone else
// has users:0 and the module is hidden from the sidebar and blocked on direct nav.
export function canManageUsers(perms: Record<string, Perms>, email?: string | null): boolean {
  return (perms[email ?? ""]?.users ?? 0) >= 1;
}

// least-privilege grants, set per person (not just by role)
export const initialPerms: Record<string, Perms> = {
  "dennis@ignis.africa": { ...allFull },
  "wanjiku@ignis.africa": { ...allFull },
  "brian@ignis.africa": { finance: 1, procurement: 1, inventory: 3, hr: 1, deploy: 3, readiness: 2, raise: 1, crm: 1, projects: 2, reports: 2, compliance: 2, dataroom: 1, settings: 3, users: 3 },
  "joan@ignis.africa": { finance: 3, procurement: 3, inventory: 3, hr: 2, deploy: 1, readiness: 1, raise: 0, crm: 1, projects: 2, reports: 2, compliance: 2, dataroom: 0, settings: 0, users: 0 },
  "wilson@ignis.africa": { finance: 0, procurement: 0, inventory: 1, hr: 0, deploy: 1, readiness: 1, raise: 2, crm: 3, projects: 1, reports: 1, compliance: 1, dataroom: 0, settings: 0, users: 0 },
  "elizabeth@ignis.africa": { finance: 0, procurement: 0, inventory: 1, hr: 0, deploy: 1, readiness: 2, raise: 0, crm: 3, projects: 1, reports: 1, compliance: 1, dataroom: 0, settings: 0, users: 0 },
  "lily@ignis.africa": { finance: 0, procurement: 0, inventory: 0, hr: 0, deploy: 1, readiness: 0, raise: 0, crm: 1, projects: 0, reports: 1, compliance: 1, dataroom: 0, settings: 0, users: 0 },
};

/* ----- vendor records ----- */
export interface VendorDetail {
  cat: string;
  country: string;
  rating: string;
  tax: string;
  screen: string;
  bank: string;
  since: string;
  spend: string;
  openPOs: number;
  timeline: { d: string; ev: string; note: string }[];
  contracts: { name: string; type: string; expiry: string; status: string }[];
  docs: string[];
}

// Vendor records live in the DB (public.vendors) — no seeded demo detail here.
export const vendorDetails: Record<string, VendorDetail> = {};


/* ----- project records ----- */
export interface ProjectDetail {
  id?: string;
  state?: string;
  funder: string;
  status: string;
  budget: string;
  spent: string;
  pct: string;
  budgetAmount?: number;   // numeric budget in KES (drives the milestone-total cap)
  spentAmount?: number;    // sum of completed-milestone amounts, recognised as spend
  startDate?: string;
  endDate?: string;
  timeline: string;
  team: string;
  location?: string;       // free-text site/location; feeds the field-activity email
  createdByMe?: boolean;   // caller created this project (or has full projects access) → can edit/delete
  milestones: { id?: string; t: string; s: "done" | "now" | "todo"; amount?: number; start?: string; end?: string }[];
  drawdowns: { id?: string; t: string; v: string; s: string }[];
  reporting: string;
  field: string;
  // legacy seed docs are plain strings; uploaded docs are { name, path } objects
  docs: (string | { name: string; path: string })[];
}

// A field-activity assignment — someone sent to check a site (folded in via loadFromDb).
export interface FieldActivity {
  id: string;
  project: string;
  assignee: string;
  phone: string | null;
  email: string | null;
  date: string;
  note: string | null;
}

// In-app notification (e.g. tagged on an engagement) — drives the bell + CRM badge.
export interface AppNotification {
  id: string;
  kind: string;
  title: string;
  body: string | null;
  linkView: string | null;
  linkRef: string | null;
  seen: boolean;
  createdAt: string;
}

// Projects load live from the DB (public.projects) via bootstrap — no seed rows.
export const initialProjectDetails: Record<string, ProjectDetail> = {};

/* ----- cross-links between modules ----- */
export const initialEngToProject: Record<string, string> = {};
export const initialProjectToEng: Record<string, string> = {};

/* ----- engagement records ----- */
export interface EngDetail {
  type?: string;
  priority?: string;
  next?: string;
  due?: string;
  value?: string;
  updates?: { d: string; ch: string; who: string; note: string }[];
  tasks?: { t: string; owner: string; due: string; pill: string }[];
  docs?: string[];
}

// Engagement detail (updates log, tasks, docs) is read live from the DB in the
// drawer — no seeded demo detail here.
export const engDetails: Record<string, EngDetail> = {};

// Engagement progress ladders (one rung per stage) + the channels an update can log.
// The ribbon in the engagement drawer and the Update form read from these; the
// log_engagement_note RPC validates the target stage against the matching ladder.
export const engStages: { up: string[]; down: string[] } = {
  up: ["Discovery", "Due diligence", "Negotiation", "Agreement", "Commitment", "Closed"],
  down: ["EOI", "Site visit", "Contracting", "Onboarding", "Active"],
};
export const engChannels = ["Email", "Call", "Meeting", "Field", "Note"];

export function findEng(id: string): (EngRow & { pipeline: "up" | "down" }) | null {
  for (const k of ["up", "down"] as const) {
    const r = crmData[k].rows.find((x) => x.id === id);
    if (r) return { ...r, pipeline: k };
  }
  return null;
}

/* ----- requisition budget lines & routing ----- */
// Budget-line definitions (config for requisition coding). Usage (`u`) starts at
// zero — real spend accrues as requisitions commit against each line.
export const budgetLines: Record<string, { b: number; u: number }> = {
  Deployment: { b: 1500000, u: 0 },
  Operations: { b: 800000, u: 0 },
  "Field / MRV": { b: 900000, u: 0 },
  "BD / Fundraise": { b: 700000, u: 0 },
  Admin: { b: 500000, u: 0 },
  "Project · Makueni VTC": { b: 3200000, u: 0 },
  "Project · Sierra Leone": { b: 1300000, u: 0 },
};

export const kes = (n: number) => "KES " + Math.round(n).toLocaleString();

// Fixed-asset categories for the register dropdown — the classes Jikoni actually holds.
export const assetCategories = [
  "Vehicles",
  "ICT & computers",
  "Furniture & fittings",
  "Office equipment",
  "Machinery & equipment",
  "Tools & field equipment",
  "Solar & power equipment",
  "Buildings",
  "Land",
  "Leasehold improvements",
];

// HR dropdowns — mirror the DB check constraints so the form can't post an invalid value.
export const contractTypes = [
  { value: "permanent", label: "Permanent" },
  { value: "fixed_term", label: "Fixed-term" },
  { value: "casual", label: "Casual" },
  { value: "consultant", label: "Consultant" },
];
export const hrDepartments = ["Operations", "Finance", "Partnerships", "Commercial / BD", "Tech", "Leadership", "Field"];
export const candidateStages = ["applied", "screened", "interviewed", "offer", "hired", "rejected"];

// Recruitment posting criteria (shared by the HR modal and the public careers page)
export const employmentTypes = [
  { value: "permanent", label: "Permanent" },
  { value: "fixed_term", label: "Fixed-term" },
  { value: "contract", label: "Contract" },
  { value: "casual", label: "Casual" },
];
export const educationLevels = [
  { value: "none", label: "No formal requirement" },
  { value: "certificate", label: "Certificate" },
  { value: "diploma", label: "Diploma" },
  { value: "degree", label: "Degree" },
  { value: "masters", label: "Master's" },
];
export const educationLabel = (v: string) => educationLevels.find((e) => e.value === v)?.label ?? v;
export const employmentLabel = (v: string) => employmentTypes.find((e) => e.value === v)?.label ?? v;

// Kenyan counties + a few common towns — powers the destination typeahead on dispatches.
// Free-text is still allowed (e.g. "Makueni VTC cluster"); this just suggests real places.
export const kenyaLocations = [
  "Mombasa", "Kwale", "Kilifi", "Tana River", "Lamu", "Taita Taveta",
  "Garissa", "Wajir", "Mandera", "Marsabit", "Isiolo", "Meru",
  "Tharaka Nithi", "Embu", "Kitui", "Machakos", "Makueni", "Nyandarua",
  "Nyeri", "Kirinyaga", "Murang'a", "Kiambu", "Turkana", "West Pokot",
  "Samburu", "Trans Nzoia", "Uasin Gishu", "Elgeyo Marakwet", "Nandi",
  "Baringo", "Laikipia", "Nakuru", "Narok", "Kajiado", "Kericho",
  "Bomet", "Kakamega", "Vihiga", "Bungoma", "Busia", "Siaya",
  "Kisumu", "Homa Bay", "Migori", "Kisii", "Nyamira", "Nairobi",
  "Thika", "Naivasha", "Eldoret", "Nyahururu", "Malindi", "Kitale",
];

export function reqRouting(a: number) {
  if (!a) return null;
  if (a < 5000) return { label: "Auto-approved", who: "clears without a signature", cls: "done", st: "Approved", stc: "done" };
  if (a <= 100000) return { label: "Single approver", who: "routes to Joan (Operations)", cls: "today", st: "Awaiting approval", stc: "today" };
  if (a <= 500000) return { label: "Dual approval", who: "Joan, then Dennis", cls: "today", st: "Awaiting approval", stc: "today" };
  return { label: "MD sign-off", who: "routes to Dennis (MD)", cls: "week", st: "MD review", stc: "week" };
}

export function reqBudgetState(code: string, a: number) {
  const L = budgetLines[code];
  const rem = L.b - L.u;
  const util = Math.round(((L.u + a) / L.b) * 100);
  if (a > rem)
    return { state: "exceeds", util, rem, bg: "var(--red-soft)", fg: "var(--red)", chip: "no", chipTxt: "exceeds",
      msg: `Exceeds budget — ${code} has only ${kes(rem)} left of ${kes(L.b)}.` };
  if (util >= 80)
    return { state: "over", util, rem, bg: "var(--ember-soft)", fg: "var(--ember)", chip: "no", chipTxt: "over 80%",
      msg: `Tight — this takes ${code} to ${util}% of its ${kes(L.b)} budget.` };
  return { state: "within", util, rem, bg: "var(--green-soft)", fg: "var(--green)", chip: "ok", chipTxt: "within",
    msg: `Within budget — ${kes(rem)} left of ${kes(L.b)}. This brings ${code} to ${util}%.` };
}
