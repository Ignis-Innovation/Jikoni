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
    { t: "f-over", l: "Overview" },
    { t: "f-gl", l: "General Ledger" },
    { t: "f-ap", l: "Payables" },
    { t: "f-ar", l: "Receivables" },
    { t: "f-bank", l: "Bank & Cash" },
    { t: "f-petty", l: "Petty Cash" },
    { t: "f-budget", l: "Budgets & Costing" },
    { t: "f-report", l: "Reporting & Compliance" },
  ],
  inventory: [
    { t: "i-over", l: "Overview" },
    { t: "i-items", l: "Stock Items" },
    { t: "i-move", l: "Movements" },
    { t: "i-dsp", l: "Dispatches" },
    { t: "i-assets", l: "Asset Register" },
  ],
  procurement: [
    { t: "p-over", l: "Overview" },
    { t: "p-vendors", l: "Vendors" },
    { t: "p-req", l: "Requisitions" },
    { t: "p-po", l: "Purchase Orders" },
    { t: "p-grn", l: "Goods Received" },
    { t: "p-rfq", l: "Sourcing / RFQ" },
    { t: "p-contracts", l: "Contracts" },
  ],
  hr: [
    { t: "h-over", l: "Overview" },
    { t: "h-personnel", l: "Personnel Management" },
    { t: "h-leave", l: "Leave" },
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
    { t: "sp-leave", l: "My Leave" },
    { t: "sp-perf", l: "My Performance" },
    { t: "sp-files", l: "My Files" },
    { t: "sp-fb", l: "Give Feedback" },
    { t: "sp-exit", l: "My Exit" },
  ],
  projects: [
    { t: "pr-over", l: "Overview" },
    { t: "pr-projects", l: "Projects" },
    { t: "pr-budget", l: "Budgets" },
    { t: "pr-milestones", l: "Milestones" },
    { t: "pr-grants", l: "Grants & Drawdowns" },
    { t: "pr-field", l: "Field Activity" },
  ],
  crm: [
    { t: "cr-over", l: "Overview" },
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
  const label = subnavs[view]?.find((s) => s.t === tab)?.l || "";
  return (
    <div className="crumb">
      {moduleLabels[view]} <CrumbChev /> <b>{label}</b>
    </div>
  );
}
