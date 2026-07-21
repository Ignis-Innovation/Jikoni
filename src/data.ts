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

export const pulseData: Record<Entity, PulseStat[]> = {
  Kenya: [
    { k: "Cash position", tick: "t-blue", v: "KES 4.2M", d: "+8% vs last wk", dc: "up" },
    { k: "Open POs", tick: "t-ember", v: "12", d: "3 awaiting you", dc: "flat" },
    { k: "Overdue invoices", tick: "t-red", v: "3", d: "KES 612k", dc: "down" },
    { k: "Critical CRM", tick: "t-ember", v: "8", d: "2 overdue", dc: "down" },
    { k: "Month burn", tick: "t-ember", v: "68%", d: "on budget", dc: "flat" },
    { k: "Days to summit", tick: "t-blue", v: "21", d: "9–10 Jul", dc: "flat" },
  ],
  Uganda: [
    { k: "Cash position", tick: "t-blue", v: "UGX 0", d: "entity in setup", dc: "flat" },
    { k: "Open POs", tick: "t-ember", v: "0", d: "pre-launch", dc: "flat" },
    { k: "Overdue invoices", tick: "t-red", v: "0", d: "—", dc: "flat" },
    { k: "Critical CRM", tick: "t-ember", v: "3", d: "Stanbic, FCDO, ERA", dc: "flat" },
    { k: "Month burn", tick: "t-ember", v: "—", d: "no ledger yet", dc: "flat" },
    { k: "Entry milestone", tick: "t-blue", v: "Aug", d: "Stanbic MOU", dc: "flat" },
  ],
  Consolidated: [
    { k: "Cash position", tick: "t-blue", v: "KES 4.2M", d: "+8% vs last wk", dc: "up" },
    { k: "Open POs", tick: "t-ember", v: "12", d: "3 awaiting you", dc: "flat" },
    { k: "Overdue invoices", tick: "t-red", v: "3", d: "KES 612k", dc: "down" },
    { k: "Critical CRM", tick: "t-ember", v: "11", d: "KE 8 · UG 3", dc: "down" },
    { k: "Month burn", tick: "t-ember", v: "68%", d: "on budget", dc: "flat" },
    { k: "Days to summit", tick: "t-blue", v: "21", d: "9–10 Jul", dc: "flat" },
  ],
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

export const initialMyWeek: WeekTask[] = [
  { id: "ENG-002", t: "IEA — confirm DSA signed, share Excel dataset", s: "Wilson copied", o: "Wanjiku", p: "over", pl: "Overdue" },
  { id: "ENG-026", t: "SEforALL — send Ethiopia ONStove brief", s: "", o: "Wanjiku", p: "over", pl: "Overdue" },
  { id: "ENG-021", t: "OSECC — lock 30-min call with Benson", s: "", o: "Wanjiku", p: "today", pl: "Today" },
  { id: "PCV-114", t: "Petty cash replenishment — approve Joan's float", s: "KES 48,200", o: "Wanjiku", p: "today", pl: "Today" },
  { id: "ENG-029", t: "Rockefeller — lock call with Betty", s: "", o: "Wanjiku", p: "week", pl: "This week" },
  { id: "BRD-Q2", t: "Q2 board pack — review before circulation", s: "", o: "Wanjiku", p: "week", pl: "This week" },
  { id: "TSK-206", t: "Makueni VTC — confirm 22 platform registrations", s: "", o: "Elizabeth", p: "today", pl: "Today" },
  { id: "TSK-207", t: "Cooker spares — raise PO for maintenance batch", s: "", o: "Joan", p: "week", pl: "This week" },
  { id: "TSK-208", t: "Stanbic Uganda — draft MOU redlines", s: "", o: "Wilson", p: "week", pl: "This week" },
];

export const burners = [
  { t: "Wave 1 Fund — manager decision pending", s: "SNV / Cygnum / UAP", st: "blocked", pl: "Blocked", ring: "cold" },
  { t: "Sierra Leone proposal", s: "PICREF submitted, awaiting feedback", st: "progress", pl: "Active", ring: "warm" },
  { t: "Makueni VTC onboarding", s: "63 institutions · 22 in platform", st: "progress", pl: "In progress", ring: "warm" },
  { t: "Africa Clean Cooking Summit", s: "Nairobi · 9–10 July · 3 weeks out", st: "ontrack", pl: "On track", ring: "on" },
  { t: "Charm Impact term sheet", s: "awaiting Charm response", st: "waiting", pl: "Waiting", ring: "cold" },
  { t: "Uganda entry — Stanbic", s: "confirmed ready to fund · MOU Aug", st: "ontrack", pl: "On track", ring: "on" },
];

export const funders = [
  { n: "Charm Impact", ty: "Blended", st: "Term sheet", amt: "$0.50M", stc: "blue" },
  { n: "EAIF", ty: "Concessional debt", st: "Negotiation", amt: "$0.80M", stc: "ember" },
  { n: "KIICO", ty: "Equity", st: "Materials", amt: "$0.55M", stc: "ember" },
  { n: "RPFF / AfDB", ty: "Concessional", st: "Discovery", amt: "$0.50M", stc: "ember" },
  { n: "FCDO", ty: "Grant / TA", st: "Discovery", amt: "$0.35M", stc: "ember" },
  { n: "Signum Capital", ty: "Equity", st: "Holding — wants anchor first", amt: "—", stc: "red" },
  { n: "UNDP / WAIIS", ty: "Programme", st: "Discovery", amt: "$0.30M", stc: "ember" },
];

export interface EngRow {
  id: string;
  n: string;
  st: string;
  o: string;
  pl: string;
  plt: string;
}

export const crmData: Record<"up" | "down", { title: string; meta: string; rows: EngRow[] }> = {
  up: {
    title: "Upstream engagements",
    meta: "funders · investors · TA · government",
    rows: [
      { id: "ENG-002", n: "IEA", st: "Materials", o: "Wilson", pl: "over", plt: "Overdue" },
      { id: "ENG-008", n: "EAIF", st: "Negotiation", o: "Wilson", pl: "today", plt: "Today" },
      { id: "ENG-012", n: "Charm Impact", st: "Term sheet", o: "Wilson", pl: "week", plt: "This week" },
      { id: "ENG-019", n: "Cygnum Capital", st: "Discovery", o: "Wilson", pl: "week", plt: "This week" },
      { id: "ENG-026", n: "SEforALL", st: "Materials", o: "Wilson", pl: "over", plt: "Overdue" },
      { id: "ENG-029", n: "Rockefeller", st: "Discovery", o: "Wilson", pl: "week", plt: "This week" },
    ],
  },
  down: {
    title: "Downstream engagements",
    meta: "institutions · distributors · EPCs · manufacturers",
    rows: [
      { id: "DST-004", n: "Makueni County VTCs", st: "Contracting", o: "Elizabeth", pl: "today", plt: "Today" },
      { id: "DST-007", n: "CLASP", st: "Site visit", o: "Elizabeth", pl: "week", plt: "This week" },
      { id: "DST-011", n: "Catholic Diocese — Machakos", st: "EOI", o: "Elizabeth", pl: "week", plt: "This week" },
      { id: "DST-015", n: "BURN Manufacturing", st: "Identification", o: "Elizabeth", pl: "done", plt: "Logged" },
      { id: "DST-018", n: "Kiambu institutions cluster", st: "Site visit", o: "Elizabeth", pl: "over", plt: "Overdue" },
    ],
  },
};

export interface User {
  n: string;
  e: string;
  role: string;
  rt: string;
  two: boolean;
  st: string;
  sl: string;
  c: string;
}

export const users: User[] = [
  { n: "Dennis", e: "dennis@ignis.africa", role: "admin", rt: "Managing Director", two: true, st: "active", sl: "Active now", c: "#E2632A" },
  { n: "Brian", e: "brian@ignis.africa", role: "admin", rt: "Platform / Tech", two: true, st: "active", sl: "12 min ago", c: "#12A3BE" },
  { n: "Joan", e: "joan@ignis.africa", role: "fin", rt: "Operations", two: true, st: "active", sl: "40 min ago", c: "#3C8A5E" },
  { n: "Wilson", e: "wilson@ignis.africa", role: "std", rt: "BD — Upstream CRM", two: true, st: "away", sl: "2 h ago", c: "#6D28D9" },
  { n: "Elizabeth", e: "elizabeth@ignis.africa", role: "std", rt: "Partnerships — Downstream", two: false, st: "away", sl: "Yesterday", c: "#B91C1C" },
  { n: "Wanjiku", e: "wanjiku@ignis.africa", role: "admin", rt: "Chief of Staff", two: true, st: "active", sl: "Active now", c: "#0e7d91" },
  { n: "Lily", e: "lily@ignis.africa", role: "view", rt: "Communications", two: false, st: "off", sl: "3 days ago", c: "#A16207" },
];

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
  fin: { finance: 3, procurement: 3, inventory: 3, hr: 1, deploy: 1, readiness: 0, raise: 0, crm: 1, projects: 2, reports: 2, dataroom: 0, settings: 0, users: 0 },
  std: { finance: 0, procurement: 1, inventory: 1, hr: 0, deploy: 1, readiness: 1, raise: 1, crm: 3, projects: 1, reports: 1, dataroom: 0, settings: 0, users: 0 },
  view: { finance: 0, procurement: 0, inventory: 0, hr: 0, deploy: 1, readiness: 1, raise: 0, crm: 1, projects: 0, reports: 1, dataroom: 0, settings: 0, users: 0 },
};

// the super admins who can assign rights — Wanjiku is signed in as one
export const superAdmins = ["dennis@ignis.africa", "wanjiku@ignis.africa"];

// least-privilege grants, set per person (not just by role)
export const initialPerms: Record<string, Perms> = {
  "dennis@ignis.africa": { ...allFull },
  "wanjiku@ignis.africa": { ...allFull },
  "brian@ignis.africa": { finance: 1, procurement: 1, inventory: 3, hr: 1, deploy: 3, readiness: 2, raise: 1, crm: 1, projects: 2, reports: 2, dataroom: 1, settings: 3, users: 3 },
  "joan@ignis.africa": { finance: 3, procurement: 3, inventory: 3, hr: 2, deploy: 1, readiness: 1, raise: 0, crm: 1, projects: 2, reports: 2, dataroom: 0, settings: 0, users: 0 },
  "wilson@ignis.africa": { finance: 0, procurement: 0, inventory: 1, hr: 0, deploy: 1, readiness: 1, raise: 2, crm: 3, projects: 1, reports: 1, dataroom: 0, settings: 0, users: 0 },
  "elizabeth@ignis.africa": { finance: 0, procurement: 0, inventory: 1, hr: 0, deploy: 1, readiness: 2, raise: 0, crm: 3, projects: 1, reports: 1, dataroom: 0, settings: 0, users: 0 },
  "lily@ignis.africa": { finance: 0, procurement: 0, inventory: 0, hr: 0, deploy: 1, readiness: 0, raise: 0, crm: 1, projects: 0, reports: 1, dataroom: 0, settings: 0, users: 0 },
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

export const vendorDetails: Record<string, VendorDetail> = {
  "BURN Manufacturing": {
    cat: "Cookstoves", country: "Kenya", rating: "4.8", tax: "Compliant", screen: "Cleared", bank: "KCB ****4021", since: "Jan 2025", spend: "KES 3.9M", openPOs: 1,
    timeline: [
      { d: "Today", ev: "Delivery", note: "PO-059 partial delivery (60%) received; GRN-074 open pending the balance." },
      { d: "2 weeks ago", ev: "PO issued", note: "PO-059 — cooker batch, KES 640,000." },
      { d: "Mar 2026", ev: "Framework signed", note: "Cookstove supply framework agreed at fixed rates through Dec 2026." },
      { d: "Jan 2025", ev: "Onboarded", note: "Registered, tax-verified and sanctions-screened — cleared." },
    ],
    contracts: [{ name: "Cookstove supply framework", type: "Framework · agreed rates", expiry: "Dec 2026", status: "Active" }],
    docs: ["Cookstove supply framework (signed)", "Certificate of incorporation", "KRA PIN certificate", "Tax Compliance Certificate", "PO-059", "GRN-074", "Invoice INV-2291"],
  },
  "Nakuru Fabricators": {
    cat: "Fabrication", country: "Kenya", rating: "4.4", tax: "Compliant", screen: "Cleared", bank: "Equity ****7712", since: "Jun 2025", spend: "KES 0.9M", openPOs: 1,
    timeline: [
      { d: "This week", ev: "PO issued", note: "PO-061 — cooker spares, KES 142,000, due 8 Jul." },
      { d: "This week", ev: "Awarded", note: "Won RFQ-014 (score 92) — best value on lead time." },
      { d: "Jun 2025", ev: "Onboarded", note: "Registered, tax-verified and sanctions-screened." },
    ],
    contracts: [],
    docs: ["RFQ-014 quote", "KRA PIN certificate", "Tax Compliance Certificate", "PO-061"],
  },
  "Equity Logistics": {
    cat: "Transport", country: "Kenya", rating: "4.2", tax: "Compliant", screen: "Cleared", bank: "Equity ****3390", since: "Feb 2025", spend: "KES 1.4M", openPOs: 0,
    timeline: [
      { d: "2 weeks ago", ev: "Delivered", note: "PO-058 delivered in full; GRN-073 matched and closed." },
      { d: "Mar 2026", ev: "Framework signed", note: "Logistics framework agreed through Mar 2027." },
      { d: "Feb 2025", ev: "Onboarded", note: "Screened and approved." },
    ],
    contracts: [{ name: "Logistics framework", type: "Framework", expiry: "Mar 2027", status: "Active" }],
    docs: ["Logistics framework (signed)", "KRA PIN certificate", "Tax Compliance Certificate", "PO-058", "GRN-073"],
  },
  Safaricom: {
    cat: "Telecoms / data", country: "Kenya", rating: "4.6", tax: "Compliant", screen: "Cleared", bank: "—", since: "2024", spend: "KES 0.3M", openPOs: 0,
    timeline: [
      { d: "Recent", ev: "Match variance", note: "INV-2284 flagged — quantity mismatch vs PO-056; payment held pending resolution." },
      { d: "Sep 2025", ev: "Service agreement", note: "Data & connectivity agreement signed." },
    ],
    contracts: [{ name: "Data & connectivity", type: "Service agreement", expiry: "Sep 2026", status: "Renew soon" }],
    docs: ["Data & connectivity agreement", "KRA PIN certificate", "PO-056", "Invoice INV-2284 (disputed)"],
  },
  "Mombasa Freight Co.": {
    cat: "Clearing", country: "Kenya", rating: "—", tax: "Pending PIN", screen: "In screening", bank: "—", since: "Onboarding", spend: "KES 0", openPOs: 0,
    timeline: [
      { d: "This week", ev: "Onboarding", note: "Registration submitted; awaiting KRA PIN and sanctions screening before any award can be made." },
    ],
    contracts: [],
    docs: ["Registration form (submitted)"],
  },
};

/* ----- project records ----- */
export interface ProjectDetail {
  id?: string;
  state?: string;
  funder: string;
  status: string;
  budget: string;
  spent: string;
  pct: string;
  timeline: string;
  team: string;
  milestones: { id?: string; t: string; s: "done" | "now" | "todo" }[];
  drawdowns: { id?: string; t: string; v: string; s: string }[];
  reporting: string;
  field: string;
  docs: string[];
}

export const initialProjectDetails: Record<string, ProjectDetail> = {
  "Makueni VTC rollout": {
    funder: "Makueni County + grant", status: "On track", budget: "KES 3.2M", spent: "KES 1.9M", pct: "59%", timeline: "Jan–Dec 2026", team: "Elizabeth · field crew",
    milestones: [
      { t: "Phase 1 — 22 institutions onboarded", s: "done" },
      { t: "Phase 2 — platform registration (63)", s: "now" },
      { t: "Phase 3 — full deployment", s: "todo" },
    ],
    drawdowns: [
      { t: "Tranche 1", v: "KES 1.2M", s: "Received" },
      { t: "Tranche 2", v: "KES 1.0M", s: "On milestone 2" },
    ],
    reporting: "Quarterly · next 15 Jul", field: "48 site visits · 22 installs logged",
    docs: ["Grant agreement", "MoU — Makueni County", "Q1 narrative report", "M&E framework"],
  },
  "Sierra Leone (PICREF)": {
    funder: "PICREF grant", status: "Drawdown due", budget: "$240k", spent: "$61k", pct: "25%", timeline: "2026", team: "Wilson · partner",
    milestones: [
      { t: "Proposal accepted (PICREF)", s: "done" },
      { t: "Site selection sign-off", s: "now" },
      { t: "Inception report", s: "todo" },
    ],
    drawdowns: [
      { t: "Inception tranche", v: "$61k", s: "Received" },
      { t: "Tranche 2", v: "$80k", s: "Requested" },
    ],
    reporting: "Inception report · Aug", field: "—",
    docs: ["PICREF grant agreement", "Proposal (submitted)", "Budget"],
  },
  "Kiambu cluster": {
    funder: "Blended", status: "On track", budget: "KES 1.8M", spent: "KES 1.1M", pct: "61%", timeline: "2026", team: "Elizabeth · enumerators",
    milestones: [
      { t: "Site visits complete", s: "done" },
      { t: "Contracting", s: "now" },
      { t: "Deployment", s: "todo" },
    ],
    drawdowns: [{ t: "Tranche 1", v: "KES 1.1M", s: "Received" }],
    reporting: "Quarterly", field: "Readiness assessments complete",
    docs: ["Agreement", "Readiness scoring pack"],
  },
  "5-County data collection": {
    funder: "CCIQ / grant", status: "Active", budget: "KES 2.1M", spent: "KES 1.4M", pct: "67%", timeline: "2026", team: "12 enumerators",
    milestones: [
      { t: "Enumerators recruited & trained", s: "done" },
      { t: "Baseline data — 5 counties", s: "now" },
      { t: "Analysis & report", s: "todo" },
    ],
    drawdowns: [{ t: "Grant tranche 1", v: "KES 1.4M", s: "Received" }],
    reporting: "Mid-term review · Sep", field: "214 assessments · 5 counties",
    docs: ["Data-collection grant", "KoboToolbox XLSForm", "Enumerator rubric"],
  },
  "EPC 5-site pilot": {
    funder: "Grant", status: "Active", budget: "$19.8k", spent: "$6k", pct: "30%", timeline: "2026", team: "Field team",
    milestones: [
      { t: "5 sites selected", s: "done" },
      { t: "Installation", s: "now" },
      { t: "Monitoring & report", s: "todo" },
    ],
    drawdowns: [
      { t: "Tranche 1", v: "$6k", s: "Received" },
      { t: "Tranche 2", v: "$8k", s: "On milestone" },
    ],
    reporting: "Pilot report", field: "Installs underway",
    docs: ["EPC pilot grant budget", "Pilot plan"],
  },
};

/* ----- cross-links between modules ----- */
export const initialEngToProject: Record<string, string> = {
  "DST-004": "Makueni VTC rollout",
  "DST-018": "Kiambu cluster",
  "DST-011": "Makueni VTC rollout",
};
export const initialProjectToEng: Record<string, string> = {
  "Makueni VTC rollout": "DST-004",
  "Kiambu cluster": "DST-018",
};

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

export const engDetails: Record<string, EngDetail> = {
  "ENG-002": {
    type: "Convener / data", priority: "Critical", next: "Confirm DSA signed, then share the Excel dataset", due: "Overdue",
    updates: [
      { d: "Today", ch: "Email", who: "Wilson", note: "Chased DSA signature; dataset ready to share on confirmation." },
      { d: "3 days ago", ch: "Call", who: "Wilson", note: "Agreed scope of the data exchange ahead of the summit." },
    ],
    tasks: [
      { t: "Confirm DSA signed", owner: "Wilson", due: "Overdue", pill: "over" },
      { t: "Share Excel dataset", owner: "Wanjiku", due: "Today", pill: "today" },
    ],
    docs: ["Data Sharing Agreement (draft)", "Cooking-access dataset (xlsx)"],
  },
  "ENG-008": {
    type: "Concessional debt", priority: "High", next: "Prepare terms comparison for the concessional call next week", due: "This week", value: "$0.80M",
    updates: [{ d: "2 days ago", ch: "Meeting", who: "Wilson", note: "Discussed concessional terms; follow-up call scheduled." }],
    tasks: [{ t: "Prepare terms comparison", owner: "Wilson", due: "This week", pill: "week" }],
    docs: ["NDA", "Concept note"],
  },
  "ENG-012": {
    type: "Blended funder", priority: "High", next: "Review term-sheet terms and respond by Friday", due: "This week", value: "$0.50M",
    updates: [
      { d: "Today", ch: "Call", who: "Wilson", note: "Term sheet received; reviewing repayment and milestone conditions." },
      { d: "1 week ago", ch: "Email", who: "Wilson", note: "Shared the updated model and pipeline." },
    ],
    tasks: [{ t: "Review term sheet", owner: "Dennis", due: "This week", pill: "week" }],
    docs: ["Term sheet (draft)", "Financial model v3", "Pitch deck"],
  },
  "ENG-019": {
    type: "Equity investor", priority: "Medium", next: "Re-engage — no touch in 14 days", due: "This week",
    updates: [{ d: "16 days ago", ch: "Email", who: "Wilson", note: "Sent intro deck; awaiting response." }],
    tasks: [{ t: "Follow up with Cygnum", owner: "Wilson", due: "This week", pill: "week" }],
    docs: ["Intro deck"],
  },
  "ENG-026": {
    type: "Programme / convener", priority: "High", next: "Send the Ethiopia ONStove brief", due: "Overdue",
    updates: [{ d: "5 days ago", ch: "Call", who: "Wilson", note: "Discussed Ethiopia collaboration; brief requested." }],
    tasks: [{ t: "Send Ethiopia ONStove brief", owner: "Wilson", due: "Overdue", pill: "over" }],
    docs: ["Ethiopia brief (draft)"],
  },
  "DST-004": {
    type: "Institution", priority: "High", next: "Confirm remaining platform registrations (41 of 63)", due: "Today",
    updates: [
      { d: "Yesterday", ch: "Email", who: "Elizabeth", note: "22 of 63 institutions now registered on the platform." },
      { d: "1 week ago", ch: "Field", who: "Elizabeth", note: "Onboarding workshop held with the county." },
    ],
    tasks: [{ t: "Confirm 22 platform registrations", owner: "Elizabeth", due: "Today", pill: "today" }],
    docs: ["MoU", "Onboarding pack"],
  },
  "DST-011": {
    type: "Institution", priority: "Medium", next: "Move from signed EOI to scheduling a site visit", due: "This week",
    updates: [{ d: "3 days ago", ch: "Field", who: "Elizabeth", note: "EOI signed by the diocese." }],
    tasks: [{ t: "Schedule site visit", owner: "Elizabeth", due: "This week", pill: "week" }],
    docs: ["EOI (signed)"],
  },
  "DST-018": {
    type: "Institution cluster", priority: "Medium", next: "Site visit slipping — reconfirm date", due: "Stalled 16d",
    updates: [{ d: "16 days ago", ch: "Call", who: "Elizabeth", note: "Tentative site-visit window agreed; not yet confirmed." }],
    tasks: [{ t: "Reconfirm site visit", owner: "Elizabeth", due: "This week", pill: "week" }],
    docs: [],
  },
};

export function findEng(id: string): (EngRow & { pipeline: "up" | "down" }) | null {
  for (const k of ["up", "down"] as const) {
    const r = crmData[k].rows.find((x) => x.id === id);
    if (r) return { ...r, pipeline: k };
  }
  return null;
}

/* ----- requisition budget lines & routing ----- */
export const budgetLines: Record<string, { b: number; u: number }> = {
  Deployment: { b: 1500000, u: 1110000 },
  Operations: { b: 800000, u: 488000 },
  "Field / MRV": { b: 900000, u: 432000 },
  "BD / Fundraise": { b: 700000, u: 385000 },
  Admin: { b: 500000, u: 300000 },
  "Project · Makueni VTC": { b: 3200000, u: 1900000 },
  "Project · Sierra Leone": { b: 1300000, u: 330000 },
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
