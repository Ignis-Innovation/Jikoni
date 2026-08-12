// Navigation config: module labels + sub-feature tabs, and the breadcrumb.
import { CrumbChev } from "./components/icons";
import { useApp } from "./store";

export const moduleLabels: Record<string, string> = {
  finance: "Finance & Accounting",
  procurement: "Procurement",
  inventory: "Inventory & Assets",
  hr: "Human Resources",
  staffportal: "Staff Portal",
  projects: "Projects & Programmes",
  crm: "Partnerships CRM",
  compliance: "Compliance & Governance",
};

export const subnavs: Record<string, { t: string; l: string }[]> = {
  finance: [
    { t: "f-gl", l: "General Ledger" },
    { t: "f-ap", l: "Payables" },
    { t: "f-ar", l: "Receivables" },
    { t: "f-bank", l: "Bank & Cash" },
    { t: "f-petty", l: "Petty Cash" },
    { t: "f-budget", l: "Budgets & Costing" },
    { t: "f-report", l: "Reporting & Compliance" },
  ],
  inventory: [
    { t: "i-items", l: "Stock Items" },
    { t: "i-move", l: "Moved stock" },
    { t: "i-dsp", l: "Dispatches" },
    { t: "i-assets", l: "Asset Register" },
  ],
  procurement: [
    { t: "p-vendors", l: "Vendors" },
    { t: "p-req", l: "Requisitions" },
    { t: "p-po", l: "Purchase Orders" },
    { t: "p-grn", l: "Goods Received" },
    { t: "p-contracts", l: "Contracts" },
  ],
  hr: [
    { t: "h-personnel", l: "Personnel Management" },
    { t: "h-leave", l: "Leave" },
    { t: "h-reports", l: "Weekly Reports" },
    { t: "h-pay", l: "Payroll" },
    { t: "h-appraisals", l: "Appraisals & KPIs" },
    { t: "h-certs", l: "Certifications" },
    { t: "h-feedback", l: "Employee Feedback" },
    { t: "h-recruit", l: "Recruitment" },
    { t: "h-exit", l: "Offboarding & Exit" },
    { t: "h-field", l: "Field Workforce" },
  ],
  staffportal: [
    { t: "sp-me", l: "This Month" },
    { t: "sp-reports", l: "Weekly Report" },
    { t: "sp-leave", l: "Leave" },
    { t: "sp-petty", l: "Petty Cash" },
    { t: "sp-perf", l: "Performance" },
    { t: "sp-files", l: "Documents" },
    { t: "sp-fb", l: "Give Feedback" },
    { t: "sp-exit", l: "Exit" },
  ],
  projects: [
    { t: "pr-projects", l: "Projects" },
    { t: "pr-budget", l: "Budgets" },
    { t: "pr-milestones", l: "Milestones" },
    { t: "pr-grants", l: "Grants & Drawdowns" },
    { t: "pr-field", l: "Field Activity" },
  ],
  crm: [
    { t: "cr-eng", l: "Engagements" },
    { t: "cr-partners", l: "Partners" },
    { t: "cr-opps", l: "Opportunities" },
  ],
  compliance: [
    { t: "c-policies", l: "Policies & Manuals" },
    { t: "c-docs", l: "Company Documents" },
    { t: "c-cal", l: "Compliance Calendar" },
    { t: "c-risk", l: "Risk Register" },
    { t: "c-contracts", l: "Contracts" },
  ],
};

export function Crumb({ view }: { view: string }) {
  const { tabs } = useApp();
  const tab = tabs[view];
  // Inventory, HR, Projects & CRM drop their "Overview" subnav entry — the module
  // lands on the overview tab directly, so fall back to that label for the breadcrumb.
  const overviewTab = view === "inventory" ? "i-over" : view === "hr" ? "h-over"
    : view === "projects" ? "pr-over" : view === "crm" ? "cr-over"
    : view === "finance" ? "f-over" : view === "procurement" ? "p-over" : null;
  const label = subnavs[view]?.find((s) => s.t === tab)?.l || (tab === overviewTab ? "Overview" : "");
  return (
    <div className="crumb">
      {moduleLabels[view]} <CrumbChev /> <b>{label}</b>
    </div>
  );
}
