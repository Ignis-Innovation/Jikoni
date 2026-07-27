// App-wide state + interaction logic. The AppApi shape is unchanged from the
// prototype — only the implementation changed (PRD Phase 0/1): local useState
// mutation became Supabase queries/RPCs returning data in the same shape.
// Every mutation lands in a Postgres RPC that enforces the document chain,
// budget commitment, approval routing, sanctions gate and writes the audit log.
import React, { createContext, useContext, useEffect, useRef, useState } from "react";
import type { Session } from "@supabase/supabase-js";
import { supabase } from "./lib/supabase";
import { LoginGate, SetPassword } from "./components/login";
import {
  Entity, WeekTask, initialMyWeek, initialPerms, Perms, roleTemplates, budgetLines,
  initialProjectDetails, ProjectDetail, initialEngToProject, initialProjectToEng,
  findEng, users, kes,
} from "./data";

export interface Toast { id: number; title: string; sub?: string }
export interface Req { id: string; item: string; amt: number; code: string; chip: string; chipTxt: string; status: "await" | "md" | "approved" | "po" }
export interface NewPO { id: string; vendor: string; amt: number; delivery: string }
export interface NewInvoice { cust: string; id: string; tot: number; pillCls: string; pillTxt: string }

/* ---------- Inventory (Phase 2 — the one net-new module) ---------- */
export interface StockItem { sku: string; name: string; category: string; unit: string; unitCost: number; reorderLevel: number; onHand: number; autoReq: string | null }
export interface StockMovement { when: string; sku: string; type: string; qty: number; from: string | null; to: string | null; source: string | null; note: string | null }
export interface DispatchRow { id: string; project: string | null; destination: string; lines: { sku: string; name: string; qty: number }[]; state: string; receipt?: string | null }
export interface AssetRow { id: string; name: string; category: string; cost: number; accumDep: number; nbv: number; acquired: string; state: string }
export interface InventoryData { items: StockItem[]; locations: string[]; movements: StockMovement[]; dispatches: DispatchRow[]; assets: AssetRow[] }
export type StockModalMode = "receive" | "issue" | "dispatch" | "transfer" | "adjust" | null;
// item form is "new" (create) or an existing row (edit); asset form is a simple open flag
export type ItemModalMode = "new" | StockItem | null;

/* ---------- Staff portal (Phase 2 HR — self-scoped leave) ---------- */
export interface LeaveBalance { kind: string; year: number; entitled: number; used: number; reserved: number }
export interface LeaveApp { id: string; kind: string; from: string; to: string; days: number; state: "pending" | "approved" | "rejected" | "cancelled"; docPath?: string | null }
export interface Payslip { period: string; gross: number; paye: number; nssf: number; shif: number; housing: number; net: number }
export interface StaffDoc { name: string; version: number; uploaded: string; path?: string | null; category?: string; leaveRef?: string | null }
export interface HrSummary { leave: LeaveBalance[]; applications: LeaveApp[]; payslips: Payslip[]; docs: StaffDoc[] }
export interface HrLeaveReq { id: string; who: string; kind: string; from: string; to: string; days: number; reason: string | null; state: string; docPath?: string | null }
export interface HrBalanceRow { who: string; entitled: number; used: number; reserved: number }

/* ---------- HR module read model (staff / payroll / recruitment / field) ---------- */
export interface KinRow { name: string; relationship: string; phone?: string; cover?: string }
export interface StaffRow {
  appUserId: string; name: string; email: string; roleTitle: string | null; color: string | null; twoFa: boolean;
  staffNo: string; contractType: string; startDate: string | null; grossSalary: number; bank: string | null;
  kraPin: string | null; nssfNo: string | null; shifNo: string | null; state: string;
  dept: string | null; contractEnd: string | null; nextOfKin: KinRow[];
  annualEntitled: number; annualUsed: number; docs: StaffDoc[];
}
export interface PayrollItemRow { name: string; gross: number; paye: number; nssf: number; shif: number; housing: number; net: number }
export interface PayrollRun { ref: string; period: string; state: string; totals: { staff: number; gross: number; net: number } | null; items: PayrollItemRow[] }
export interface AiCheck { requirement: string; evidenced: boolean; note: string }
export interface CandidateRow {
  id: string; name: string; email: string | null; stage: string;
  phone: string | null; yearsExp: number; skills: string[]; education: string;
  cvPath: string | null; source: string; eligibility: number;
  aiVerdict: string | null; aiSummary: string | null; aiChecked: AiCheck[]; aiConcerns: string[]; aiScreenedAt: string | null;
}
export interface RecruitmentReq {
  ref: string; roleTitle: string; dept: string | null; state: string; candidates: CandidateRow[];
  description: string | null; location: string | null; employmentType: string;
  reqSkills: string[]; minYears: number; minEducation: string;
  shortlistSize: number; published: boolean; closesAt: string | null;
}
export interface EnumeratorRow { id: string; name: string; county: string | null; idNo: string | null; dailyRate: number; state: string }
export interface FieldAssignmentRow { id: string; enumerator: string; county: string | null; project: string | null; period: string | null; days: number; perDiem: number; contractDoc: string | null; state: string }
export interface AppraisalKpi { k: string; met: boolean; selfMet: boolean }
export interface AppraisalRow { id: string; appUserId: string; who: string; roleTitle: string | null; reviewer: string; cycle: string; stage: string; kpis: AppraisalKpi[]; created: string }
export interface CertificationRow { id: string; appUserId: string | null; holder: string; name: string; issuer: string | null; expiry: string | null; state: string; docPath: string | null }
export interface FeedbackRow { ref: string; author: string | null; category: string | null; body: string; audience: string; state: string; created: string }
export interface ExitStep { area: string; done: boolean; owner: "staff" | "company" }
export interface ExitRow { ref: string; appUserId: string | null; person: string; roleTitle: string | null; reason: string | null; finalDay: string | null; clearance: ExitStep[]; state: string; clearedAt: string | null; accessUntil: string | null }
export interface HrData {
  staff: StaffRow[];
  runs: PayrollRun[];
  recruitment: RecruitmentReq[];
  enumerators: EnumeratorRow[];
  fieldAssignments: FieldAssignmentRow[];
  appraisals: AppraisalRow[];
  certifications: CertificationRow[];
  feedback: FeedbackRow[];
  exits: ExitRow[];
}
export type HrModalMode =
  | { kind: "employee" }
  | { kind: "staffDetail"; staff: StaffRow }
  | { kind: "staffProfile"; staff: StaffRow }
  | { kind: "requisition" }
  | { kind: "candidate"; reqRef: string }
  | { kind: "postingDetail"; ref: string }
  | { kind: "enumerator" }
  | { kind: "assignment" }
  | { kind: "appraisal"; id: string }
  | { kind: "certification" }
  | { kind: "myCert" }
  | { kind: "feedback" }
  | { kind: "exitStart" }
  | { kind: "exitDetail"; ref: string }
  | null;

/* ---------- Partnerships CRM (engagements / partners / opportunities) ---------- */
export interface EngUpdate { ts?: string; d: string; ch: string; who: string; note: string }
export interface EngDoc { name: string; path: string }
export interface CrmEng { id: string; n: string; st: string; o: string; pl: string; plt: string; updates: EngUpdate[]; docs: EngDoc[] }
export interface Partner { id: string; name: string; type: string; country: string; ownerName: string; status: string; statusCls: string }
export interface Opportunity { id: string; name: string; type: string; deadline: string; linkedTo: string; status: string; statusCls: string }
export interface CrmData {
  engUp: CrmEng[]; engDown: CrmEng[];
  partners: Partner[]; opportunities: Opportunity[];
  dropdowns: Record<string, string[]>; teamNames: string[];
  engPartners: Record<string, string[]>;
}

/* ---------- Compliance & Governance (policies / documents / calendar / risk / contracts) ---------- */
export interface PolicyRow { code: string; title: string; version: string; effectiveFrom: string | null; doc: string | null; state: string; statusCls: string; statusTxt: string }
export interface CompanyDocRow { name: string; kind: string | null; doc: string | null; expiry: string; statusCls: string; statusTxt: string }
export interface ObligationRow { obligation: string; authority: string | null; dueRule: string | null; nextDue: string; when: string; state: string; ownerModule: string | null; statusCls: string; statusTxt: string }
export interface RiskRow { ref: string; risk: string; category: string | null; owner: string | null; likelihood: number; impact: number; score: number; mitigation: string | null; state: string; statusCls: string; statusTxt: string }
export interface ContractRow { counterparty: string; kind: string; title: string; detail: string | null; expiry: string; state: string; statusCls: string; statusTxt: string }
export interface ComplianceData {
  policies: PolicyRow[]; companyDocuments: CompanyDocRow[]; obligations: ObligationRow[];
  risks: RiskRow[]; contracts: ContractRow[];
}

interface AppApi {
  view: string;
  tabs: Record<string, string>;
  go: (v: string) => void;
  goTab: (v: string, t: string) => void;
  mainRef: React.RefObject<HTMLElement>;

  entity: Entity;
  cycleEntity: () => void;

  toasts: Toast[];
  toast: (title: string, sub?: string) => void;

  myWeek: WeekTask[];
  taskFilter: "mine" | "team";
  setTaskFilter: (f: "mine" | "team") => void;
  taskOpen: boolean;
  openTask: () => void;
  closeTask: () => void;
  saveTask: (title: string, owner: string, due: string, link: string) => void;

  engId: string | null;
  vendorName: string | null;
  projectName: string | null;
  accessEmail: string | null;
  openEng: (id: string) => void;
  closeEng: () => void;
  openVendor: (n: string) => void;
  closeVendor: () => void;
  openProject: (n: string) => void;
  closeProject: () => void;
  openAccess: (e: string) => void;
  closeAccess: () => void;
  xEng: (id: string) => void;
  xProject: (n: string) => void;
  xTab: (v: string, t: string) => void;
  xView: (v: string) => void;
  openRecord: (id: string) => void;

  perms: Record<string, Perms>;
  saveAccess: (email: string, p: Perms) => void;

  inviteOpen: boolean;
  setInviteOpen: (b: boolean) => void;
  sendInvite: (name: string, email: string, role: string) => void;

  reqOpen: boolean;
  openReq: () => void;
  closeReq: () => void;
  reqs: Req[];
  submitReq: (item: string, amt: number, code: string) => void;
  approvePR: (id: string) => void;
  poFor: Req | null;
  raisePO: (id: string) => void;
  closePO: () => void;
  submitPO: (vendor: string, delivery: string) => void;
  newPOs: NewPO[];

  invOpen: boolean;
  openInvoice: () => void;
  closeInvoice: () => void;
  submitInvoice: (cust: string, desc: string, net: number, dueSel: string) => void;
  newInvoices: NewInvoice[];

  projectDetails: Record<string, ProjectDetail>;
  extraProjects: { name: string; funder: string }[];
  engToProject: Record<string, string>;
  projectToEng: Record<string, string>;
  createProjectFromEng: (id: string) => void;
  projectFormOpen: boolean;
  openProjectForm: () => void;
  closeProjectForm: () => void;
  createProject: (v: { name: string; funder: string; budget: string; timeline: string; team: string; status: string }) => void;
  addMilestone: (projectId: string, title: string, status?: string) => void;
  setMilestoneStatus: (milestoneId: string, status: string) => void;
  addDrawdown: (projectId: string, title: string, amount: string, status?: string) => void;
  setDrawdownStatus: (drawdownId: string, status: string) => void;
  logFieldActivity: (projectId: string, kind: string, county: string, note: string) => void;
  setProjectState: (projectId: string, state: string) => void;
  addProjectDocument: (projectId: string, file: File) => void;
  projectDocUrl: (path: string, downloadName?: string) => string;

  hrMe: HrSummary | null;
  leaveOpen: boolean;
  leaveEdit: LeaveApp | null;
  openLeave: () => void;
  openLeaveEdit: (a: LeaveApp) => void;
  closeLeave: () => void;
  applyLeave: (kind: string, from: string, to: string, reason: string, file?: File | null) => void;
  updateLeave: (ref: string, kind: string, from: string, to: string, reason: string) => void;
  deleteLeave: (ref: string) => void;
  addStaffDocument: (file: File, name: string, category: string) => void;
  deleteStaffDocument: (path: string, name: string) => void;
  staffDocUrl: (path: string) => Promise<string | null>;
  hrLeaveQueue: HrLeaveReq[];
  hrBalances: HrBalanceRow[];
  decideLeave: (ref: string, approve: boolean) => void;

  // HR module (staff / payroll / recruitment / field workforce)
  hrData: HrData | null;
  hrModal: HrModalMode;
  openHrModal: (m: HrModalMode) => void;
  closeHrModal: () => void;
  addEmployee: (v: { name: string; email: string; roleTitle: string; contractType: string; startDate: string; grossSalary: number; kra: string; nssf: string; shif: string; bank: string }) => void;
  preparePayroll: (period: string) => void;
  approvePayroll: (ref: string) => void;
  postPayroll: (ref: string) => void;
  createRecruitmentReq: (roleTitle: string, dept: string) => Promise<string | null>;
  addCandidate: (reqRef: string, name: string, email: string, stage: string) => void;
  advanceCandidate: (id: string, stage: string) => void;
  updatePosting: (ref: string, v: { description: string; location: string; employmentType: string; reqSkills: string[]; minYears: number; minEducation: string; shortlistSize: number; closesAt: string }) => Promise<boolean>;
  publishPosting: (ref: string, published: boolean) => void;
  openCandidateCv: (path: string) => Promise<string | null>;
  screenCandidateCv: (id: string, name: string) => Promise<boolean>;
  createEnumerator: (v: { name: string; county: string; idNo: string }) => void;
  createFieldAssignment: (v: { enumeratorId: string; project: string; period: string; days: number }) => void;
  setFieldAssignmentState: (id: string, state: string) => void;
  updateStaffHrProfile: (v: { staffNo: string; dept: string; contractEnd: string; nextOfKin: KinRow[] | null }) => void;
  startAppraisalCycle: (cycle: string) => void;
  toggleAppraisalKpi: (id: string, idx: number) => void;
  setAppraisalKpis: (id: string, kpis: string[]) => void;
  advanceAppraisal: (id: string) => void;
  refreshHr: () => Promise<void>;
  addCertification: (v: { holder: string; name: string; issuer: string; expiry: string; staffNo: string; verified: boolean; holderUserId?: string | null }, file?: File | null) => void;
  verifyCertification: (id: string, ok: boolean) => void;
  submitFeedback: (v: { body: string; category: string; audience: string; anonymous: boolean }) => void;
  setFeedbackState: (ref: string, state: string) => void;
  startExit: (v: { person: string; reason: string; finalDay: string; staffNo: string }) => void;
  signExitStep: (ref: string, idx: number) => void;
  signMyExitStep: (ref: string, idx: number) => void;
  cancelExit: (ref: string) => void;
  // Staff Portal self-service (me-scoped)
  meEmail: string | null;
  selfAssessKpi: (id: string, idx: number) => void;
  submitSelfAssessment: (id: string) => void;
  submitMyCertification: (v: { name: string; issuer: string; expiry: string }, file?: File | null) => void;

  crm: CrmData;
  engFormOpen: boolean;
  openEngForm: () => void;
  closeEngForm: () => void;
  createEngagement: (name: string, owner: string, pipeline: "up" | "down", dueKey: string, note: string, file?: File | null) => void;
  engUpdateOpen: boolean;
  openEngUpdate: () => void;
  closeEngUpdate: () => void;
  logEngagementNote: (ref: string, v: { channel: string; who: string; note: string; stageTo: string; file?: File | null }) => void;
  setEngagementPartners: (ref: string, partnerIds: string[]) => void;
  engDocUrl: (path: string, downloadName?: string) => string;
  partnerOpen: boolean;
  openPartnerForm: () => void;
  closePartnerForm: () => void;
  createPartner: (name: string, type: string, country: string, owner: string, status: string) => void;
  oppOpen: boolean;
  openOppForm: () => void;
  closeOppForm: () => void;
  createOpportunity: (name: string, type: string, deadline: string, linkedTo: string, status: string) => void;

  // Compliance & Governance
  compliance: ComplianceData;
  markObligationFiled: (obligation: string) => void;
  riskOpen: boolean;
  openRiskForm: () => void;
  closeRiskForm: () => void;
  createRisk: (v: { risk: string; category: string; likelihood: number; impact: number; mitigation: string; owner: string }) => void;
  policyOpen: boolean;
  openPolicyForm: () => void;
  closePolicyForm: () => void;
  addPolicy: (v: { code: string; title: string; effectiveFrom: string; file?: File | null }) => void;
  docOpen: boolean;
  openDocForm: () => void;
  closeDocForm: () => void;
  addCompanyDocument: (v: { name: string; kind: string; expiresOn: string; file?: File | null }) => void;
  contractOpen: boolean;
  openContractForm: () => void;
  closeContractForm: () => void;
  addContract: (v: { counterparty: string; kind: string; title: string; detail: string; expiresOn: string }) => void;
  complianceDocUrl: (path: string, downloadName?: string) => string;

  inventory: InventoryData | null;
  stockModal: StockModalMode;
  openStockModal: (m: Exclude<StockModalMode, null>) => void;
  closeStockModal: () => void;
  receiveStock: (sku: string, location: string, qty: number) => void;
  issueStock: (sku: string, location: string, qty: number, reason: string) => void;
  transferStock: (sku: string, from: string, to: string, qty: number) => void;
  adjustStock: (sku: string, location: string, newQty: number, reason: string) => void;
  createDispatch: (project: string, destination: string, sku: string, qty: number) => void;
  setDispatchState: (ref: string, state: "delivered" | "cancelled") => void;
  attachDispatchReceipt: (ref: string, file: File) => void;
  receiptUrl: (path: string) => string;
  itemModal: ItemModalMode;
  openItemModal: (m: Exclude<ItemModalMode, null>) => void;
  closeItemModal: () => void;
  createStockItem: (v: { name: string; category: string; unit: string; unitCost: number; reorderLevel: number; reorderQty: number; budgetCode: string }) => void;
  updateStockItem: (sku: string, reorderLevel: number, reorderQty: number, unitCost: number) => void;
  assetOpen: boolean;
  openAssetForm: () => void;
  closeAssetForm: () => void;
  registerAsset: (v: { name: string; category: string; cost: number; lifeMonths: number; acquired: string; salvage: number }) => void;
  disposeAsset: (ref: string, reason: string) => void;
  runDepreciation: (period: string) => void;
}

const Ctx = createContext<AppApi>(null!);
export const useApp = () => useContext(Ctx);

let toastSeq = 0;
const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

export function AppProvider({ children }: { children: React.ReactNode }) {
  const [view, setView] = useState("home");
  const [tabs, setTabs] = useState<Record<string, string>>({
    finance: "f-over", procurement: "p-over", inventory: "i-over", hr: "h-over",
    staffportal: "sp-me", projects: "pr-over", crm: "cr-over", compliance: "c-policies",
  });
  const mainRef = useRef<HTMLElement>(null);

  const [session, setSession] = useState<Session | null>(null);
  const [authReady, setAuthReady] = useState(false);
  const [needPassword, setNeedPassword] = useState(false);
  const [entity, setEntity] = useState<Entity>("Kenya");
  const [toasts, setToasts] = useState<Toast[]>([]);

  const [myWeek, setMyWeek] = useState<WeekTask[]>(initialMyWeek);
  const [taskFilter, setTaskFilter] = useState<"mine" | "team">("mine");
  const [taskOpen, setTaskOpen] = useState(false);

  const [engId, setEngId] = useState<string | null>(null);
  const [vendorName, setVendorName] = useState<string | null>(null);
  const [projectName, setProjectName] = useState<string | null>(null);
  const [accessEmail, setAccessEmail] = useState<string | null>(null);

  const [perms, setPerms] = useState(initialPerms);
  const [inviteOpen, setInviteOpen] = useState(false);

  const [reqOpen, setReqOpen] = useState(false);
  const [reqs, setReqs] = useState<Req[]>([]);
  const [poFor, setPoFor] = useState<Req | null>(null);
  const [newPOs, setNewPOs] = useState<NewPO[]>([]);

  const [invOpen, setInvOpen] = useState(false);
  const [newInvoices, setNewInvoices] = useState<NewInvoice[]>([]);

  const [projectDetails, setProjectDetails] = useState(initialProjectDetails);
  const [extraProjects, setExtraProjects] = useState<{ name: string; funder: string }[]>([]);
  const [engToProject, setEngToProject] = useState(initialEngToProject);
  const [projectToEng, setProjectToEng] = useState(initialProjectToEng);
  const [projectFormOpen, setProjectFormOpen] = useState(false);

  const [inventory, setInventory] = useState<InventoryData | null>(null);
  const [stockModal, setStockModal] = useState<StockModalMode>(null);
  const [itemModal, setItemModal] = useState<ItemModalMode>(null);
  const [assetOpen, setAssetOpen] = useState(false);

  const [hrMe, setHrMe] = useState<HrSummary | null>(null);
  const [leaveOpen, setLeaveOpen] = useState(false);
  const [leaveEdit, setLeaveEdit] = useState<LeaveApp | null>(null);
  const [hrLeaveQueue, setHrLeaveQueue] = useState<HrLeaveReq[]>([]);
  const [hrBalances, setHrBalances] = useState<HrBalanceRow[]>([]);
  const [hrData, setHrData] = useState<HrData | null>(null);
  const [hrModal, setHrModal] = useState<HrModalMode>(null);

  const [crm, setCrm] = useState<CrmData>({
    engUp: [], engDown: [], partners: [], opportunities: [], dropdowns: {}, teamNames: [], engPartners: {},
  });
  const [engFormOpen, setEngFormOpen] = useState(false);
  const [engUpdateOpen, setEngUpdateOpen] = useState(false);
  const [partnerOpen, setPartnerOpen] = useState(false);
  const [oppOpen, setOppOpen] = useState(false);

  const [compliance, setCompliance] = useState<ComplianceData>({
    policies: [], companyDocuments: [], obligations: [], risks: [], contracts: [],
  });
  const [riskOpen, setRiskOpen] = useState(false);
  const [policyOpen, setPolicyOpen] = useState(false);
  const [docOpen, setDocOpen] = useState(false);
  const [contractOpen, setContractOpen] = useState(false);

  function toast(title: string, sub?: string) {
    const id = ++toastSeq;
    setToasts((t) => [...t, { id, title, sub }]);
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), 4500);
  }

  /* ---------- auth session (Phase 0: "who is logged in") ---------- */
  useEffect(() => {
    // invitees (and password resets) land here via an emailed link whose URL hash
    // carries type=invite|recovery — that's our cue to show the set-password screen.
    if (/type=(invite|recovery)/.test(window.location.hash)) setNeedPassword(true);
    supabase.auth.getSession().then(({ data }) => { setSession(data.session); setAuthReady(true); });
    const { data: sub } = supabase.auth.onAuthStateChange((e, s) => {
      setSession(s);
      if (e === "PASSWORD_RECOVERY") setNeedPassword(true);
    });
    return () => sub.subscription.unsubscribe();
  }, []);

  /* ---------- bootstrap: one round-trip, everything in view shapes ---------- */
  async function loadFromDb(): Promise<boolean> {
    const { data, error } = await supabase.rpc("bootstrap");
    if (error) { toast("Couldn't load records", error.message); return false; }
    setMyWeek(data.tasks as WeekTask[]);
    setReqs(data.reqs as Req[]);
    setNewPOs(data.pos as NewPO[]);
    setNewInvoices(data.salesInvoices as NewInvoice[]);
    setPerms({ ...initialPerms, ...(data.perms as Record<string, Perms>) });
    setProjectDetails(data.projects as Record<string, ProjectDetail>);
    setExtraProjects(data.extraProjects as { name: string; funder: string }[]);
    setEngToProject(data.engToProject as Record<string, string>);
    setProjectToEng(data.projectToEng as Record<string, string>);
    // Dispatch receipts live on a column bootstrap doesn't return — fold them in by ref.
    const inv = data.inventory as InventoryData;
    const { data: rc } = await supabase.from("dispatches").select("ref, receipt_path");
    if (rc) {
      const byRef = new Map((rc as { ref: string; receipt_path: string | null }[]).map((r) => [r.ref, r.receipt_path]));
      inv.dispatches = inv.dispatches.map((d) => ({ ...d, receipt: byRef.get(d.id) ?? null }));
    }
    setInventory(inv);
    // Engagement documents live in a side table — fold them into each engagement by ref
    // (same approach as dispatch receipts above), so bootstrap() stays untouched.
    const { data: docRows } = await supabase
      .from("engagement_documents")
      .select("name, path, engagements(ref)")
      .order("created_at");
    const docsByRef = new Map<string, EngDoc[]>();
    ((docRows ?? []) as any[]).forEach((r) => {
      // the joined relationship comes back as an object (to-one) or array depending on typing
      const rel = r.engagements;
      const ref: string | undefined = Array.isArray(rel) ? rel[0]?.ref : rel?.ref;
      if (!ref) return;
      const arr = docsByRef.get(ref) ?? [];
      arr.push({ name: r.name as string, path: r.path as string });
      docsByRef.set(ref, arr);
    });
    const withDocs = (e: CrmEng): CrmEng => ({ ...e, docs: docsByRef.get(e.id) ?? [] });
    // Partnerships CRM — engagements (two pipelines), partners, opportunities + editable dropdowns/owners
    setCrm({
      engUp: ((data.engagements?.up ?? []) as CrmEng[]).map(withDocs),
      engDown: ((data.engagements?.down ?? []) as CrmEng[]).map(withDocs),
      partners: (data.partners ?? []) as Partner[],
      opportunities: (data.opportunities ?? []) as Opportunity[],
      dropdowns: (data.crmDropdowns ?? {}) as Record<string, string[]>,
      teamNames: (data.teamNames ?? []) as string[],
      engPartners: (data.engPartners ?? {}) as Record<string, string[]>,
    });
    // Compliance & Governance — policies, statutory documents, calendar, risk register, contracts
    setCompliance((data.compliance ?? {
      policies: [], companyDocuments: [], obligations: [], risks: [], contracts: [],
    }) as ComplianceData);
    // sync the req modal's live budget preview with the ledger (same object the modal imports)
    for (const [k, v] of Object.entries(data.budgetLines as Record<string, { b: number; u: number }>)) {
      if (budgetLines[k]) { budgetLines[k].b = v.b; budgetLines[k].u = v.u; }
    }
    return true;
  }
  // self-scoped HR record (leave balances + my applications) — my_hr_summary()
  async function loadHr() {
    const { data, error } = await supabase.rpc("my_hr_summary");
    if (error) { toast("Couldn't load your HR record", error.message); return; }
    setHrMe({
      leave: (data.leave ?? []) as LeaveBalance[], applications: (data.applications ?? []) as LeaveApp[],
      payslips: (data.payslips ?? []) as Payslip[], docs: (data.docs ?? []) as StaffDoc[],
    });
  }

  // everyone's leave applications, for the HR approvals queue (RLS: read for authenticated)
  async function loadLeaveQueue() {
    const { data, error } = await supabase
      .from("leave_applications")
      .select("ref, kind, from_date, to_date, days, reason, state, doc_path, applicant:app_users!leave_applications_app_user_id_fkey(name)")
      .order("created_at", { ascending: false })
      .limit(30);
    if (error) { toast("Couldn't load leave queue", error.message); return; }
    setHrLeaveQueue((data as any[]).map((r) => ({
      id: r.ref, who: r.applicant?.name ?? "—", kind: r.kind, from: r.from_date, to: r.to_date,
      days: Number(r.days), reason: r.reason, state: r.state, docPath: r.doc_path ?? null,
    })));
    const { data: bals, error: balErr } = await supabase
      .from("leave_balances")
      .select("entitled, used, reserved, app_users(name)")
      .eq("kind", "annual")
      .eq("year", new Date().getFullYear());
    if (balErr) { toast("Couldn't load balances", balErr.message); return; }
    setHrBalances((bals as any[])
      .map((b) => ({ who: b.app_users?.name ?? "—", entitled: Number(b.entitled), used: Number(b.used), reserved: Number(b.reserved) }))
      .sort((a, b) => a.who.localeCompare(b.who)));
  }

  // module-wide HR read model — direct table queries (same pattern as loadLeaveQueue)
  async function loadHrModule() {
    const year = new Date().getFullYear();
    const [sf, lb, pr, rc, en, fa, ap, ct, fb, ex] = await Promise.all([
      supabase.from("staff_files").select("app_user_id, staff_no, kra_pin, nssf_no, shif_no, contract_type, start_date, gross_salary, bank, docs, state, dept, contract_end, next_of_kin, app_users!staff_files_app_user_id_fkey(name, email, role_title, color, two_fa)"),
      supabase.from("leave_balances").select("app_user_id, entitled, used").eq("kind", "annual").eq("year", year),
      supabase.from("payroll_runs").select("ref, period, state, totals, payroll_items(gross, paye, nssf, shif, housing, net, app_users(name))").order("period", { ascending: false }),
      supabase.from("recruitment_reqs").select("ref, role_title, dept, state, description, location, employment_type, req_skills, min_years, min_education, shortlist_size, published, closes_at, candidates(id, name, email, stage, phone, years_exp, skills, education, cv_path, source, eligibility, ai_verdict, ai_summary, ai_checked, ai_concerns, ai_screened_at)").order("created_at"),
      supabase.from("enumerators").select("id, name, county, id_no, daily_rate, state").order("name"),
      supabase.from("field_assignments").select("id, project_name, period, days, per_diem, contract_doc, state, enumerators(name, county)").order("created_at", { ascending: false }),
      supabase.from("appraisals").select("id, app_user_id, cycle, stage, kpis, created_at, subject:app_users!appraisals_app_user_id_fkey(name, role_title), reviewer:app_users!appraisals_reviewer_id_fkey(name)").order("created_at"),
      supabase.from("certifications").select("id, app_user_id, holder, name, issuer, expiry, state, doc_path").order("created_at"),
      supabase.from("staff_feedback").select("ref, category, body, audience, state, created_at, author:app_users!staff_feedback_author_id_fkey(name)").order("created_at", { ascending: false }),
      supabase.from("staff_exits").select("ref, app_user_id, person, role_title, reason, final_day, clearance, state, cleared_at, access_until").order("ref", { ascending: false }),
    ]);
    const err = sf.error || lb.error || pr.error || rc.error || en.error || fa.error || ap.error || ct.error || fb.error || ex.error;
    if (err) { toast("Couldn't load HR records", err.message); return; }
    const balByUser = new Map((lb.data as any[]).map((b) => [b.app_user_id, b]));
    setHrData({
      staff: (sf.data as any[]).map((s) => {
        const b = balByUser.get(s.app_user_id);
        return {
          appUserId: s.app_user_id, name: s.app_users?.name ?? "—", email: s.app_users?.email ?? "",
          roleTitle: s.app_users?.role_title ?? null, color: s.app_users?.color ?? null, twoFa: !!s.app_users?.two_fa,
          staffNo: s.staff_no, contractType: s.contract_type, startDate: s.start_date, grossSalary: Number(s.gross_salary),
          bank: s.bank, kraPin: s.kra_pin, nssfNo: s.nssf_no, shifNo: s.shif_no, state: s.state,
          dept: s.dept, contractEnd: s.contract_end, nextOfKin: (s.next_of_kin ?? []) as KinRow[],
          annualEntitled: b ? Number(b.entitled) : 0, annualUsed: b ? Number(b.used) : 0,
          docs: (s.docs ?? []) as StaffDoc[],
        };
      }).sort((a, b) => a.name.localeCompare(b.name)),
      runs: (pr.data as any[]).map((r) => ({
        ref: r.ref, period: r.period, state: r.state, totals: r.totals,
        items: (r.payroll_items ?? []).map((i: any) => ({
          name: i.app_users?.name ?? "—", gross: Number(i.gross), paye: Number(i.paye), nssf: Number(i.nssf),
          shif: Number(i.shif), housing: Number(i.housing), net: Number(i.net),
        })),
      })),
      recruitment: (rc.data as any[]).map((r) => ({
        ref: r.ref, roleTitle: r.role_title, dept: r.dept, state: r.state,
        description: r.description ?? null, location: r.location ?? null, employmentType: r.employment_type ?? "permanent",
        reqSkills: (r.req_skills ?? []) as string[], minYears: Number(r.min_years ?? 0), minEducation: r.min_education ?? "none",
        shortlistSize: Number(r.shortlist_size ?? 4), published: !!r.published, closesAt: r.closes_at ?? null,
        candidates: (r.candidates ?? []).map((c: any) => ({
          id: c.id, name: c.name, email: c.email, stage: c.stage,
          phone: c.phone ?? null, yearsExp: Number(c.years_exp ?? 0), skills: (c.skills ?? []) as string[],
          education: c.education ?? "none", cvPath: c.cv_path ?? null, source: c.source ?? "hr", eligibility: Number(c.eligibility ?? 0),
          aiVerdict: c.ai_verdict ?? null, aiSummary: c.ai_summary ?? null, aiChecked: (c.ai_checked ?? []) as AiCheck[],
          aiConcerns: (c.ai_concerns ?? []) as string[], aiScreenedAt: c.ai_screened_at ?? null,
        })),
      })),
      enumerators: (en.data as any[]).map((e) => ({ id: e.id, name: e.name, county: e.county, idNo: e.id_no, dailyRate: Number(e.daily_rate), state: e.state })),
      fieldAssignments: (fa.data as any[]).map((a) => ({
        id: a.id, enumerator: a.enumerators?.name ?? "—", county: a.enumerators?.county ?? null, project: a.project_name,
        period: a.period, days: Number(a.days), perDiem: Number(a.per_diem), contractDoc: a.contract_doc, state: a.state,
      })),
      appraisals: (ap.data as any[]).map((a) => ({
        id: a.id, appUserId: a.app_user_id, who: a.subject?.name ?? "—", roleTitle: a.subject?.role_title ?? null, reviewer: a.reviewer?.name ?? "—",
        cycle: a.cycle, stage: a.stage, kpis: ((a.kpis ?? []) as any[]).map((k) => ({ k: k.k, met: !!k.met, selfMet: !!k.self_met })), created: a.created_at,
      })),
      certifications: (ct.data as any[]).map((c) => ({ id: c.id, appUserId: c.app_user_id, holder: c.holder, name: c.name, issuer: c.issuer, expiry: c.expiry, state: c.state, docPath: c.doc_path ?? null })),
      feedback: (fb.data as any[]).map((f) => ({
        ref: f.ref, author: f.author?.name ?? null, category: f.category, body: f.body,
        audience: f.audience, state: f.state, created: f.created_at,
      })),
      exits: (ex.data as any[]).map((x) => ({
        ref: x.ref, appUserId: x.app_user_id, person: x.person, roleTitle: x.role_title, reason: x.reason, finalDay: x.final_day,
        clearance: ((x.clearance ?? []) as any[]).map((c) => ({ area: c.area, done: !!c.done, owner: c.owner === "staff" ? "staff" : "company" })),
        state: x.state, clearedAt: x.cleared_at, accessUntil: x.access_until,
      })),
    });
  }

  useEffect(() => {
    if (!session) return;
    (async () => {
      // sweep due suspensions, then gate: an exited account is signed out
      // before any module data loads (their exit's 24h grace has passed)
      const { data: acc } = await supabase.rpc("my_access_state");
      if (acc?.state === "exited") {
        toast("This account is closed", "Your exit was finalised — contact HR if you think this is wrong");
        setTimeout(() => supabase.auth.signOut(), 1200);
        return;
      }
      loadFromDb();
      loadHr();
      loadLeaveQueue();
      loadHrModule();
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session]);

  function go(v: string) {
    setView(v);
    mainRef.current?.scrollTo({ top: 0, behavior: "smooth" });
  }
  function goTab(v: string, t: string) {
    setTabs((prev) => ({ ...prev, [v]: t }));
    go(v);
  }

  function cycleEntity() {
    const order: Entity[] = ["Kenya", "Uganda", "Consolidated"];
    const next = order[(order.indexOf(entity) + 1) % 3];
    setEntity(next);
    toast("Switched to " + next, next === "Consolidated" ? "Both entities, one set of numbers" : "Records now scoped to " + next);
  }

  /* ---------- tasks ---------- */
  async function saveTask(title: string, owner: string, due: string, link: string) {
    const { data, error } = await supabase.rpc("save_task", {
      p_title: title, p_owner: owner, p_due_key: due, p_link: link,
    });
    if (error) { toast("Task not saved", error.message); return; }
    setMyWeek((w) => [data as WeekTask, ...w]);
    setTaskOpen(false);
    if (owner !== "Wanjiku") setTaskFilter("team");
    toast("Task assigned to " + owner, owner === "Wanjiku" ? "Added to your My Week" : `Now in ${owner}'s My Week — switched to Team view so you can see it`);
  }

  /* ---------- drawers & cross-links ---------- */
  function closeAllDrawers() {
    setEngId(null); setVendorName(null); setProjectName(null); setAccessEmail(null);
  }
  const xEng = (id: string) => { closeAllDrawers(); openEng(id); };
  const xProject = (n: string) => { closeAllDrawers(); setProjectName(n); };
  const xTab = (v: string, t: string) => { closeAllDrawers(); goTab(v, t); };
  const xView = (v: string) => { closeAllDrawers(); go(v); };

  function openEng(id: string) {
    if (!findEng(id)) { toast(id, "Engagement detail"); return; }
    setEngId(id);
  }
  function openRecord(id: string) {
    if (findEng(id)) { openEng(id); return; }
    toast(id, "Opens the item with its history");
  }

  async function saveAccessFn(email: string, p: Perms) {
    const u = users.find((x) => x.e === email);
    const { error } = await supabase.rpc("save_access", { p_email: email, p_perms: p });
    if (error) { toast("Access not saved", error.message); return; }
    setPerms((prev) => ({ ...prev, [email]: { ...p } }));
    setAccessEmail(null);
    toast("Access updated for " + (u?.n || email), "Recorded in the audit log with your name and time");
  }

  /* ---------- requisition → PO chain (budget commit + routing + audit in the DB) ---------- */
  async function submitReq(item: string, amt: number, code: string) {
    const { data, error } = await supabase.rpc("submit_requisition", {
      p_item: item, p_amount: amt, p_code: code,
    });
    if (error) { toast("Requisition failed", error.message); return; }
    const r = data as Req & { routing: { label: string; who: string } };
    setReqs((prev) => [{ id: r.id, item: r.item, amt: r.amt, code: r.code, chip: r.chip, chipTxt: r.chipTxt, status: r.status }, ...prev]);
    if (budgetLines[code]) budgetLines[code].u += amt; // keep the modal preview in step with the commitment
    setReqOpen(false);
    toast(r.id + " raised · " + r.routing.label, cap(r.routing.who));
  }
  async function approvePR(id: string) {
    const { error } = await supabase.rpc("approve_requisition", { p_ref: id });
    if (error) { toast("Approval failed", error.message); return; }
    setReqs((prev) => prev.map((r) => (r.id === id ? { ...r, status: "approved" } : r)));
    toast(id + " approved", "Ready to raise a purchase order");
  }
  function raisePO(id: string) {
    const r = reqs.find((x) => x.id === id);
    if (r) setPoFor(r);
  }
  async function submitPO(vendor: string, delivery: string) {
    if (!poFor) return;
    const { data, error } = await supabase.rpc("raise_po", {
      p_req_ref: poFor.id, p_vendor_name: vendor, p_delivery: delivery,
    });
    if (error) { toast("PO blocked", error.message); return; }
    const po = data as NewPO;
    setNewPOs((prev) => [po, ...prev]);
    setReqs((prev) => prev.map((r) => (r.id === poFor.id ? { ...r, status: "po" } : r)));
    setPoFor(null);
    toast(po.id + " issued to " + vendor, "Draft PO created — awaiting delivery & goods-received note");
  }

  /* ---------- sales invoice (VAT + GL + eTIMS intent in the DB) ---------- */
  async function submitInvoice(cust: string, desc: string, net: number, dueSel: string) {
    const { data, error } = await supabase.rpc("submit_sales_invoice", {
      p_customer: cust, p_description: desc, p_net: net, p_due_key: dueSel,
    });
    if (error) { toast("Invoice failed", error.message); return; }
    const si = data as NewInvoice;
    setNewInvoices((prev) => [si, ...prev]);
    setInvOpen(false);
    toast(si.id + " issued to " + cust, "Filed to eTIMS · total KES " + si.tot.toLocaleString());
  }

  /* ---------- won deal → project ---------- */
  async function createProjectFromEng(id: string) {
    const b = findEng(id);
    if (!b) return;
    const { data, error } = await supabase.rpc("create_project_from_eng", { p_eng_ref: id });
    if (error) { toast("Project not created", error.message); return; }
    const name = data.name as string;
    const detail = data.detail as ProjectDetail;
    setProjectDetails((prev) => (prev[name] ? prev : { ...prev, [name]: detail }));
    if (data.created) {
      setExtraProjects((prev) => [...prev, { name, funder: b.n }]);
      setEngToProject((prev) => ({ ...prev, [id]: name }));
      setProjectToEng((prev) => ({ ...prev, [name]: id }));
    }
    toast("Project created from " + id, b.n + " is now a project — costs, milestones and drawdowns track here");
    xProject(name);
  }

  /* ---------- standalone new project (not from a CRM engagement) ---------- */
  async function createProject(v: { name: string; funder: string; budget: string; timeline: string; team: string; status: string }) {
    const { data, error } = await supabase.rpc("create_project", {
      p_name: v.name, p_funder: v.funder || null, p_budget_txt: v.budget || null,
      p_timeline: v.timeline || null, p_team: v.team || null, p_status: v.status || null,
    });
    if (error) { toast("Project not created", error.message); return; }
    const name = data.name as string;
    const detail = data.detail as ProjectDetail;
    setProjectDetails((prev) => ({ ...prev, [name]: detail }));
    setExtraProjects((prev) => (prev.some((p) => p.name === name) ? prev : [...prev, { name, funder: v.funder || "—" }]));
    setProjectFormOpen(false);
    toast(name + " created", "New project — budget, milestones and drawdowns track here");
    xProject(name);
  }

  /* ---------- project drawer mutations: RPC → upsert one project's detail → toast ---------- */
  // each RPC returns { name, detail }; we replace just that project so the drawer + all tabs re-render
  async function projectRpc(fn: string, args: Record<string, unknown>, okTitle: string, okSub: string) {
    const { data, error } = await supabase.rpc(fn, args);
    if (error) { toast("Couldn't save", error.message); return; }
    const name = data.name as string;
    setProjectDetails((prev) => ({ ...prev, [name]: data.detail as ProjectDetail }));
    toast(okTitle, okSub);
  }
  const addMilestone = (projectId: string, title: string, status = "todo") =>
    projectRpc("add_project_milestone", { p_project_id: projectId, p_title: title, p_status: status }, "Milestone added", title);
  const setMilestoneStatus = (milestoneId: string, status: string) =>
    projectRpc("set_milestone_status", { p_milestone_id: milestoneId, p_status: status }, "Milestone updated", "Status saved");
  const addDrawdown = (projectId: string, title: string, amount: string, status = "Requested") =>
    projectRpc("add_project_drawdown", { p_project_id: projectId, p_title: title, p_amount_txt: amount, p_status: status }, "Drawdown added", `${title} · ${amount}`);
  const setDrawdownStatus = (drawdownId: string, status: string) =>
    projectRpc("set_drawdown_status", { p_drawdown_id: drawdownId, p_status: status }, "Drawdown updated", status);
  const logFieldActivity = (projectId: string, kind: string, county: string, note: string) =>
    projectRpc("log_field_activity", { p_project_id: projectId, p_kind: kind, p_county: county || null, p_note: note || null }, "Field activity logged", "Recorded against the project");
  const setProjectState = (projectId: string, state: string) =>
    projectRpc("set_project_state", { p_project_id: projectId, p_new_state: state }, "Project status updated", state);

  // Upload a document to the project-docs bucket and record it against the project.
  async function addProjectDocument(projectId: string, file: File) {
    const safe = file.name.replace(/[^\w.\-]+/g, "_");
    const path = `${projectId}/${Date.now()}-${safe}`;
    const up = await supabase.storage.from("project-docs").upload(path, file, { upsert: true, contentType: file.type || undefined });
    if (up.error) { toast("Upload failed", up.error.message); return; }
    const { data, error } = await supabase.rpc("add_project_document", {
      p_project_id: projectId, p_name: file.name, p_path: up.data.path,
    });
    if (error) { toast("Couldn't save document", error.message); return; }
    setProjectDetails((prev) => ({ ...prev, [data.name as string]: data.detail as ProjectDetail }));
    toast("Document added", `${file.name} — attached to the project`);
  }
  // Public URL for a stored project document; pass a name to force a download.
  function projectDocUrl(path: string, downloadName?: string) {
    return supabase.storage.from("project-docs").getPublicUrl(path, downloadName ? { download: downloadName } : undefined).data.publicUrl;
  }

  /* ---------- invite (Phase 5): record the invite + least-privilege template + audit,
     then fire the /api/invite serverless function to email a set-password link. The
     email step only runs where the function is deployed (Vercel) or under `vercel dev`;
     with plain `vite`, the invite is still recorded and scripts/provision-invites.mjs
     can email the link. ---------- */
  async function sendInvite(name: string, email: string, role: string) {
    const { error } = await supabase.rpc("invite_user", { p_name: name, p_email: email, p_role_key: role });
    if (error) { toast("Invite failed", error.message); return; }
    setInviteOpen(false);
    await loadFromDb();
    try {
      const res = await fetch("/api/invite", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${session?.access_token ?? ""}` },
        body: JSON.stringify({ name, email, role }),
      });
      if (res.ok) {
        toast("Invite emailed to " + name, "They'll get a link to set their password and sign in");
      } else {
        const j = await res.json().catch(() => ({}));
        toast("Invite recorded for " + name, j.error ? "Email not sent: " + j.error : "Run provision-invites to email the link");
      }
    } catch {
      toast("Invite recorded for " + name, "Access set from the " + role + " template — email sends once deployed");
    }
  }

  /* ---------- leave (Phase 2 HR): apply_leave holds the days as reserved,
     writes the audit log and routes to HR for approval ---------- */
  async function applyLeave(kind: string, from: string, to: string, reason: string, file?: File | null) {
    const { data, error } = await supabase.rpc("apply_leave", {
      p_kind: kind, p_from: from, p_to: to, p_reason: reason.trim() || null,
    });
    if (error) { toast("Request not submitted", error.message); return; }
    setLeaveOpen(false);
    // optional supporting document (e.g. a sick note) — lands in the personal file, tagged to this request
    if (file) await uploadStaffDoc(file, "leave", `${kind} note`, data.id);
    await Promise.all([loadHr(), loadLeaveQueue()]);
    toast(`${data.id} submitted · ${data.days} ${data.days === 1 ? "day" : "days"} ${kind}`,
      file ? "Days held, supporting document attached — routed to HR" : "Days held against your balance — routed to HR for approval");
  }

  // edit / withdraw your own pending request — the reserved-days hold moves or is released
  async function updateLeave(ref: string, kind: string, from: string, to: string, reason: string) {
    const { data, error } = await supabase.rpc("update_leave", {
      p_ref: ref, p_kind: kind, p_from: from, p_to: to, p_reason: reason.trim() || null,
    });
    if (error) { toast("Couldn't update request", error.message); return; }
    setLeaveOpen(false); setLeaveEdit(null);
    await Promise.all([loadHr(), loadLeaveQueue()]);
    toast(`${ref} updated · now ${data.days} ${data.days === 1 ? "day" : "days"} ${kind}`, "Still pending — HR sees the new dates");
  }
  async function deleteLeave(ref: string) {
    const { error } = await supabase.rpc("delete_leave", { p_ref: ref });
    if (error) { toast("Couldn't delete request", error.message); return; }
    await Promise.all([loadHr(), loadLeaveQueue()]);
    toast(ref + " deleted", "The held days are back in your balance");
  }

  // HR decision — decide_leave moves reserved days to used (approve) or releases them (reject)
  async function decideLeave(ref: string, approve: boolean) {
    const { error } = await supabase.rpc("decide_leave", { p_ref: ref, p_approve: approve, p_note: null });
    if (error) { toast(approve ? "Approval failed" : "Rejection failed", error.message); return; }
    await Promise.all([loadLeaveQueue(), loadHr()]);
    toast(`${ref} ${approve ? "approved" : "rejected"}`,
      approve ? "Days deducted from the balance — the employee can see it in their portal" : "Days released back to the balance");
  }

  /* ---------- HR module mutations: RPC → toast → reload the module read model ---------- */
  async function addEmployee(v: { name: string; email: string; roleTitle: string; contractType: string; startDate: string; grossSalary: number; kra: string; nssf: string; shif: string; bank: string }) {
    const { data, error } = await supabase.rpc("add_employee", {
      p_name: v.name, p_email: v.email, p_role_title: v.roleTitle || null, p_contract_type: v.contractType,
      p_start_date: v.startDate || null, p_gross_salary: v.grossSalary, p_kra: v.kra || null,
      p_nssf: v.nssf || null, p_shif: v.shif || null, p_bank: v.bank || null,
    });
    if (error) { toast("Employee not added", error.message); return; }
    setHrModal(null);
    await loadHrModule();
    toast(`${v.name} added — ${data.staffNo}`, "Staff file created; they link to a login when they first sign in by email");
  }
  async function preparePayroll(period: string) {
    const { data, error } = await supabase.rpc("prepare_payroll", { p_period: period });
    if (error) { toast("Payroll not prepared", error.message); return; }
    await loadHrModule();
    toast(`Payroll ${period} prepared — ${data.id}`, `${data.staff} staff · gross ${kes(Number(data.gross))} · route to a second approver`);
  }
  async function approvePayroll(ref: string) {
    const { error } = await supabase.rpc("approve_payroll", { p_ref: ref });
    if (error) { toast("Approval failed", error.message); return; }
    await loadHrModule();
    toast(`${ref} approved`, "Ready to post — the journal hits Finance and generates the payment file");
  }
  async function postPayroll(ref: string) {
    const { data, error } = await supabase.rpc("post_payroll", { p_ref: ref });
    if (error) { toast("Posting failed", error.message); return; }
    await loadHrModule();
    toast(`${ref} posted — ${data.journal}`, "Payroll journal in the GL; payment file generated; payslips visible in the Staff Portal");
  }
  // Opens a requisition and returns its ref so the caller can attach posting
  // criteria (update_posting) and optionally publish, all in one flow.
  async function createRecruitmentReq(roleTitle: string, dept: string): Promise<string | null> {
    const { data, error } = await supabase.rpc("create_recruitment_req", { p_role_title: roleTitle, p_dept: dept || null });
    if (error) { toast("Requisition not created", error.message); return null; }
    await loadHrModule();
    return (data as any)?.id ?? null;
  }
  async function addCandidate(reqRef: string, name: string, email: string, stage: string) {
    const { error } = await supabase.rpc("add_candidate", { p_req_ref: reqRef, p_name: name, p_email: email || null, p_stage: stage });
    if (error) { toast("Candidate not added", error.message); return; }
    setHrModal(null);
    await loadHrModule();
    toast(`${name} added to ${reqRef}`, `In the pipeline at "${stage}"`);
  }
  async function advanceCandidate(id: string, stage: string) {
    const { error } = await supabase.rpc("advance_candidate", { p_candidate_id: id, p_stage: stage });
    if (error) { toast("Couldn't move candidate", error.message); return; }
    await loadHrModule();
    toast("Candidate moved", `Now at "${stage}"`);
  }
  async function updatePosting(ref: string, v: {
    description: string; location: string; employmentType: string; reqSkills: string[];
    minYears: number; minEducation: string; shortlistSize: number; closesAt: string;
  }) {
    const { error } = await supabase.rpc("update_posting", {
      p_ref: ref, p_description: v.description || null, p_location: v.location || null,
      p_employment_type: v.employmentType, p_req_skills: v.reqSkills, p_min_years: v.minYears,
      p_min_education: v.minEducation, p_shortlist_size: v.shortlistSize, p_closes_at: v.closesAt || null,
    });
    if (error) { toast("Posting not saved", error.message); return false; }
    await loadHrModule();
    return true;
  }
  async function publishPosting(ref: string, published: boolean) {
    const { error } = await supabase.rpc("publish_posting", { p_ref: ref, p_published: published });
    if (error) { toast("Couldn't update posting", error.message); return; }
    await loadHrModule();
    toast(published ? `${ref} published to careers` : `${ref} unpublished`,
      published ? "Live on the public careers page — applications open" : "Removed from the public careers page");
  }
  // CV scan — reads the actual CV text and checks it against the job criteria.
  // Runs server-side (/api/screen-cv, no external AI key needed); returns true on success.
  async function screenCandidateCv(id: string, name: string): Promise<boolean> {
    try {
      const res = await fetch("/api/screen-cv", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${session?.access_token ?? ""}` },
        body: JSON.stringify({ candidateId: id }),
      });
      const j = await res.json().catch(() => ({}));
      if (!res.ok) { toast("Couldn't scan CV", j.error || `Error ${res.status}`); return false; }
      await loadHrModule();
      const v = j.verdict as string;
      toast(`${name}: ${v === "strong" ? "Strong match" : v === "possible" ? "Possible match" : "Weak match"}`, j.summary || "CV scan complete");
      return true;
    } catch (e: any) {
      toast("Couldn't scan CV", e.message || "Network error");
      return false;
    }
  }
  // Signed URL for a candidate's uploaded CV (HR read via storage RLS).
  async function openCandidateCv(path: string) {
    const { data, error } = await supabase.storage.from("job-applications").createSignedUrl(path, 120);
    if (error) { toast("Couldn't open CV", error.message); return null; }
    return data.signedUrl;
  }
  async function createEnumerator(v: { name: string; county: string; idNo: string }) {
    const { error } = await supabase.rpc("create_enumerator", { p_name: v.name, p_county: v.county || null, p_id_no: v.idNo || null });
    if (error) { toast("Enumerator not added", error.message); return; }
    setHrModal(null);
    await loadHrModule();
    toast(`${v.name} registered`, v.county ? `Field roster · ${v.county}` : "Added to the field roster");
  }
  async function createFieldAssignment(v: { enumeratorId: string; project: string; period: string; days: number }) {
    const { data, error } = await supabase.rpc("create_field_assignment", {
      p_enumerator_id: v.enumeratorId, p_project: v.project || null, p_period: v.period || null,
      p_days: v.days,
    });
    if (error) { toast("Assignment not created", error.message); return; }
    setHrModal(null);
    await loadHrModule();
    toast("Field assignment created", `${(data as any)?.contractDoc ?? "Contract"} — awaiting approval`);
  }
  async function setFieldAssignmentState(id: string, state: string) {
    const { error } = await supabase.rpc("set_field_assignment_state", { p_id: id, p_state: state });
    if (error) { toast("Couldn't update assignment", error.message); return; }
    await loadHrModule();
    toast(`Assignment ${state}`, state === "active" ? "Per-diem approved — flows to project accounting" : `Marked ${state}`);
  }

  /* ---------- HR personnel suite: appraisals / certifications / feedback / exits ---------- */
  async function updateStaffHrProfile(v: { staffNo: string; dept: string; contractEnd: string; nextOfKin: KinRow[] | null }) {
    const { error } = await supabase.rpc("update_staff_hr_profile", {
      p_staff_no: v.staffNo, p_dept: v.dept || null, p_contract_end: v.contractEnd || null,
      p_next_of_kin: v.nextOfKin,
    });
    if (error) { toast("Profile not updated", error.message); return; }
    setHrModal(null);
    await loadHrModule();
    toast(`${v.staffNo} updated`, "HR details saved on the staff file");
  }
  async function startAppraisalCycle(cycle: string) {
    const { data, error } = await supabase.rpc("start_appraisal_cycle", { p_cycle: cycle });
    if (error) { toast("Cycle not started", error.message); return; }
    await loadHrModule();
    toast(`${cycle} cycle opened`, `${data.opened} review${data.opened === 1 ? "" : "s"} created — self-assessment → manager review → sign-off`);
  }
  async function toggleAppraisalKpi(id: string, idx: number) {
    const { error } = await supabase.rpc("toggle_appraisal_kpi", { p_id: id, p_idx: idx });
    if (error) { toast("KPI not updated", error.message); return; }
    await loadHrModule();
  }
  async function setAppraisalKpis(id: string, kpis: string[]) {
    const { error } = await supabase.rpc("set_appraisal_kpis", { p_id: id, p_kpis: kpis.map((k) => ({ k })) });
    if (error) { toast("KPIs not saved", error.message); return; }
    await loadHrModule();
    toast("KPIs agreed", "They lock the moment self-assessment opens");
  }
  async function advanceAppraisal(id: string) {
    const { data, error } = await supabase.rpc("advance_appraisal", { p_id: id });
    if (error) { toast("Couldn't advance review", error.message); return; }
    await loadHrModule();
    const msg: Record<string, string> = {
      self: "Self-assessment open — the employee scores their own KPIs first",
      manager: "With the manager for review",
      signed_off: "Signed off — the employee now sees both ratings; the review is locked",
    };
    toast(`Review ${data.stage === "signed_off" ? "signed off" : "advanced"}`, msg[data.stage as string] ?? "");
  }
  // Upload a certificate file into the holder's own staff-documents prefix.
  // Staff write their own prefix; HR (level ≥ 2) may write any prefix (0031 policy).
  async function uploadCertFile(file: File, holderUserId: string): Promise<string | null> {
    const safe = file.name.replace(/[^\w.\-]+/g, "_");
    const path = `${holderUserId}/certifications/${Date.now()}-${safe}`;
    const up = await supabase.storage.from("staff-documents").upload(path, file, { upsert: true, contentType: file.type || undefined });
    if (up.error) { toast("Certificate upload failed", up.error.message); return null; }
    return up.data.path;
  }
  async function addCertification(v: { holder: string; name: string; issuer: string; expiry: string; staffNo: string; verified: boolean; holderUserId?: string | null }, file?: File | null) {
    let docPath: string | null = null;
    if (file && v.holderUserId) { docPath = await uploadCertFile(file, v.holderUserId); if (docPath === null) return; }
    const { error } = await supabase.rpc("add_certification", {
      p_holder: v.holder, p_name: v.name, p_issuer: v.issuer || null, p_expiry: v.expiry || null,
      p_staff_no: v.staffNo || null, p_verified: v.verified, p_doc_path: docPath,
    });
    if (error) { toast("Certification not added", error.message); return; }
    setHrModal(null);
    await loadHrModule();
    toast(`${v.name} added`, v.verified ? `On ${v.holder}'s file — expiry alerts fire 90 days out` : "In the verification queue for HR to check");
  }
  async function verifyCertification(id: string, ok: boolean) {
    const { error } = await supabase.rpc("verify_certification", { p_id: id, p_ok: ok });
    if (error) { toast("Verification failed", error.message); return; }
    await loadHrModule();
    toast(ok ? "Certification verified" : "Certification rejected", ok ? "Stored on the staff file — counts towards skills coverage" : "Removed from the register");
  }
  async function submitFeedback(v: { body: string; category: string; audience: string; anonymous: boolean }) {
    const { data, error } = await supabase.rpc("submit_feedback", {
      p_body: v.body, p_category: v.category || null, p_audience: v.audience, p_anonymous: v.anonymous,
    });
    if (error) { toast("Feedback not sent", error.message); return; }
    setHrModal(null);
    await loadHrModule();
    toast(`${data.id} sent to ${v.audience === "hr" ? "HR / People" : "Leadership"}`, v.anonymous ? "Sent anonymously — no author reference is stored" : "Sent with your name");
  }
  async function setFeedbackState(ref: string, state: string) {
    const { error } = await supabase.rpc("set_feedback_state", { p_ref: ref, p_state: state });
    if (error) { toast("Couldn't update feedback", error.message); return; }
    await loadHrModule();
    const msg: Record<string, string> = {
      in_review: "In review with HR", acknowledged: "Acknowledged — the sender can see it landed",
      actioned: "Actioned and closed out", closed: "Closed",
    };
    toast(`${ref} ${state.replace("_", " ")}`, msg[state] ?? "");
  }
  async function startExit(v: { person: string; reason: string; finalDay: string; staffNo: string }) {
    const { data, error } = await supabase.rpc("start_exit", {
      p_person: v.person, p_reason: v.reason || null, p_final_day: v.finalDay || null, p_staff_no: v.staffNo || null,
    });
    if (error) { toast("Exit not started", error.message); return; }
    await loadHrModule();
    setHrModal({ kind: "exitDetail", ref: data.id });
    toast(`${data.id} opened for ${v.person}`, "Work through the clearance — each area is signed off by the function that owns it");
  }
  async function signExitStep(ref: string, idx: number) {
    const { data, error } = await supabase.rpc("sign_exit_step", { p_ref: ref, p_idx: idx });
    if (error) { toast("Couldn't sign off", error.message); return; }
    await loadHrModule();
    if (data.state === "cleared") toast(`${ref} fully cleared`, "Certificate of service issued; their access closes automatically in 24 hours");
  }
  async function cancelExit(ref: string) {
    const { data, error } = await supabase.rpc("cancel_exit", { p_ref: ref });
    if (error) { toast("Couldn't remove the exit", error.message); return; }
    setHrModal(null);
    await loadHrModule();
    toast(`${ref} removed`, data.reinstated
      ? `${data.person} is reinstated and can log in again — re-grant module access in User Management`
      : `${data.person} is back to active — nothing else was changed`);
  }
  async function signMyExitStep(ref: string, idx: number) {
    const { data, error } = await supabase.rpc("sign_my_exit_step", { p_ref: ref, p_idx: idx });
    if (error) { toast("Couldn't tick that off", error.message); return; }
    await loadHrModule();
    if (data.state === "cleared") toast("Exit fully cleared", "Your documents are released below — your access closes in 24 hours");
  }

  /* ---------- Staff Portal self-service: me-scoped RPCs (no HR access needed) ---------- */
  async function selfAssessKpi(id: string, idx: number) {
    const { error } = await supabase.rpc("self_assess_kpi", { p_id: id, p_idx: idx });
    if (error) { toast("KPI not updated", error.message); return; }
    await loadHrModule();
  }
  async function submitSelfAssessment(id: string) {
    const { error } = await supabase.rpc("submit_self_assessment", { p_id: id });
    if (error) { toast("Not submitted", error.message); return; }
    await loadHrModule();
    toast("Self-assessment submitted", "Your review is with your manager — their rating is independent of yours");
  }
  async function submitMyCertification(v: { name: string; issuer: string; expiry: string }, file?: File | null) {
    let docPath: string | null = null;
    if (file) {
      const authId = session?.user?.id;
      const { data: me } = authId ? await supabase.from("app_users").select("id").eq("auth_id", authId).single() : { data: null };
      if (!me) { toast("No staff record", "Your login isn't linked to a staff file"); return; }
      docPath = await uploadCertFile(file, me.id);
      if (docPath === null) return;
    }
    const { error } = await supabase.rpc("submit_my_certification", {
      p_name: v.name, p_issuer: v.issuer || null, p_expiry: v.expiry || null, p_doc_path: docPath,
    });
    if (error) { toast("Certification not submitted", error.message); return; }
    setHrModal(null);
    await loadHrModule();
    toast(`${v.name} submitted`, file ? "Certificate uploaded — with HR for verification" : "With HR for verification — it joins your file once checked");
  }

  /* ---------- Partnerships CRM: create-forms insert via SECURITY DEFINER RPCs
     (audit-logged, access-gated), then reload so the tables re-render live ---------- */
  // Upload a document to Storage and record it against an engagement. Returns true on success.
  async function uploadEngagementDoc(ref: string, file: File, who?: string) {
    const safe = file.name.replace(/[^\w.\-]+/g, "_");
    const path = `${ref}/${Date.now()}-${safe}`;
    const up = await supabase.storage.from("engagement-docs").upload(path, file, { upsert: true, contentType: file.type || undefined });
    if (up.error) { toast("Upload failed", up.error.message); return false; }
    const { error } = await supabase.rpc("add_engagement_document", {
      p_eng_ref: ref, p_name: file.name, p_path: up.data.path, p_who: who ?? null,
    });
    if (error) { toast("Couldn't save document", error.message); return false; }
    return true;
  }
  // Public URL for a stored engagement document; pass a name to force a download.
  function engDocUrl(path: string, downloadName?: string) {
    return supabase.storage.from("engagement-docs").getPublicUrl(path, downloadName ? { download: downloadName } : undefined).data.publicUrl;
  }
  async function createEngagement(name: string, owner: string, pipeline: "up" | "down", dueKey: string, note: string, file?: File | null) {
    // stage isn't collected on the form — the RPC starts new engagements at the top of the
    // funnel; the note ("where we are on the discussion") seeds the engagement's update log
    const { data, error } = await supabase.rpc("create_engagement", {
      p_name: name, p_stage: null, p_owner_name: owner, p_pipeline: pipeline,
      p_next_action: note.trim() || null, p_due_key: dueKey,
    });
    if (error) { toast("Engagement not created", error.message); return; }
    if (file) await uploadEngagementDoc(data.id, file, owner);
    setEngFormOpen(false);
    await loadFromDb();
    toast(`${data.id} created`, `${name} · ${owner}${note.trim() ? " · note logged" : ""}${file ? " · document attached" : ""}`);
  }
  async function logEngagementNote(ref: string, v: { channel: string; who: string; note: string; stageTo: string; file?: File | null }) {
    const { data, error } = await supabase.rpc("log_engagement_note", {
      p_eng_ref: ref, p_channel: v.channel || null, p_who: v.who || null,
      p_note: v.note, p_stage_to: v.stageTo || null,
    });
    if (error) { toast("Update not saved", error.message); return; }
    if (v.file) await uploadEngagementDoc(ref, v.file, v.who);
    setEngUpdateOpen(false);
    await loadFromDb();
    toast(`${ref} updated`, `Now at ${(data as any)?.stage ?? "—"}${v.file ? " · document attached" : ""}`);
  }
  async function setEngagementPartners(ref: string, partnerIds: string[]) {
    const { error } = await supabase.rpc("set_engagement_partners", { p_eng_ref: ref, p_partner_ids: partnerIds });
    if (error) { toast("Partners not linked", error.message); return; }
    await loadFromDb();
    toast(`${ref} — partners linked`, partnerIds.length ? `${partnerIds.length} linked` : "All links cleared");
  }
  async function createPartner(name: string, type: string, country: string, owner: string, status: string) {
    const { error } = await supabase.rpc("create_partner", {
      p_name: name, p_type: type, p_country: country, p_owner_name: owner, p_status: status,
    });
    if (error) { toast("Partner not added", error.message); return; }
    setPartnerOpen(false);
    await loadFromDb();
    toast(name + " added to the registry", `${type} · ${country} · ${owner}`);
  }
  async function createOpportunity(name: string, type: string, deadline: string, linkedTo: string, status: string) {
    const { error } = await supabase.rpc("create_opportunity", {
      p_name: name, p_type: type, p_deadline: deadline, p_linked_to: linkedTo, p_status: status,
    });
    if (error) { toast("Opportunity not created", error.message); return; }
    setOppOpen(false);
    await loadFromDb();
    toast(name + " added to the map", `${type} · ${status}`);
  }

  /* ---------- Compliance & Governance: create-forms hit SECURITY DEFINER RPCs
     (access-gated, audit-logged), then reload so the tables re-render live ---------- */
  // Upload a document to the compliance-docs bucket; returns the stored path or null.
  async function uploadComplianceDoc(prefix: string, file: File): Promise<string | null> {
    const safe = file.name.replace(/[^\w.\-]+/g, "_");
    const path = `${prefix}/${Date.now()}-${safe}`;
    const up = await supabase.storage.from("compliance-docs").upload(path, file, { upsert: true, contentType: file.type || undefined });
    if (up.error) { toast("Upload failed", up.error.message); return null; }
    return up.data.path;
  }
  function complianceDocUrl(path: string, downloadName?: string) {
    return supabase.storage.from("compliance-docs").getPublicUrl(path, downloadName ? { download: downloadName } : undefined).data.publicUrl;
  }
  async function markObligationFiled(obligation: string) {
    const { data, error } = await supabase.rpc("mark_obligation_filed", { p_obligation: obligation });
    if (error) { toast("Couldn't mark filed", error.message); return; }
    await loadFromDb();
    toast(`${obligation} filed`, `Next due ${(data as any)?.nextDue ?? "—"}`);
  }
  async function createRisk(v: { risk: string; category: string; likelihood: number; impact: number; mitigation: string; owner: string }) {
    const { data, error } = await supabase.rpc("create_risk", {
      p_risk: v.risk, p_category: v.category || null, p_likelihood: v.likelihood,
      p_impact: v.impact, p_mitigation: v.mitigation || null, p_owner: v.owner || null,
    });
    if (error) { toast("Risk not logged", error.message); return; }
    setRiskOpen(false);
    await loadFromDb();
    toast(`${(data as any)?.ref ?? "Risk"} logged`, `${v.risk} · severity ${v.likelihood * v.impact}`);
  }
  async function addPolicy(v: { code: string; title: string; effectiveFrom: string; file?: File | null }) {
    const path = v.file ? await uploadComplianceDoc(v.code, v.file) : null;
    if (v.file && !path) return; // upload failed — toast already fired
    const { data, error } = await supabase.rpc("add_policy", {
      p_code: v.code, p_title: v.title, p_effective_from: v.effectiveFrom || null, p_doc: path,
    });
    if (error) { toast("Policy not saved", error.message); return; }
    setPolicyOpen(false);
    await loadFromDb();
    toast(`${v.code} ${(data as any)?.version ?? ""} saved`, `${v.title}${v.file ? " · document attached" : ""}`);
  }
  async function addCompanyDocument(v: { name: string; kind: string; expiresOn: string; file?: File | null }) {
    const path = v.file ? await uploadComplianceDoc("company", v.file) : null;
    if (v.file && !path) return;
    const { error } = await supabase.rpc("add_company_document", {
      p_name: v.name, p_kind: v.kind || null, p_expires_on: v.expiresOn || null, p_doc: path,
    });
    if (error) { toast("Document not saved", error.message); return; }
    setDocOpen(false);
    await loadFromDb();
    toast(`${v.name} saved`, v.expiresOn ? `Expiry ${v.expiresOn}${v.file ? " · attached" : ""}` : (v.file ? "Document attached" : "On file"));
  }
  async function addContract(v: { counterparty: string; kind: string; title: string; detail: string; expiresOn: string }) {
    const { error } = await supabase.rpc("add_contract", {
      p_counterparty: v.counterparty, p_kind: v.kind, p_title: v.title,
      p_detail: v.detail || null, p_expires_on: v.expiresOn || null,
    });
    if (error) { toast("Contract not saved", error.message); return; }
    setContractOpen(false);
    await loadFromDb();
    toast(`${v.title} registered`, `${v.counterparty} · ${v.kind}`);
  }

  /* ---------- inventory (Phase 2): mutations hit the ledger, then reload ---------- */
  async function receiveStock(sku: string, location: string, qty: number) {
    const { data, error } = await supabase.rpc("receive_stock", {
      p_sku: sku, p_location: location, p_qty: qty, p_unit_cost: null, p_grn_ref: null,
    });
    if (error) { toast("Receipt failed", error.message); return; }
    setStockModal(null);
    await loadFromDb();
    toast(`${qty} × ${sku} received into ${location}`, "On hand now " + data.onHand + " — movement posted to the ledger");
  }
  async function issueStock(sku: string, location: string, qty: number, reason: string) {
    const { data, error } = await supabase.rpc("issue_stock", {
      p_sku: sku, p_location: location, p_qty: qty, p_reason: reason || null,
    });
    if (error) { toast("Issue failed", error.message); return; }
    setStockModal(null);
    await loadFromDb();
    toast(`${qty} × ${sku} issued from ${location}`,
      data.autoRequisition
        ? `Below reorder level — ${data.autoRequisition} auto-raised into Procurement`
        : "On hand now " + data.onHand);
  }
  async function createDispatch(project: string, destination: string, sku: string, qty: number) {
    const { data, error } = await supabase.rpc("create_dispatch", {
      p_project: project || null, p_destination: destination,
      p_lines: [{ sku, qty }], p_note: null,
    });
    if (error) { toast("Dispatch failed", error.message); return; }
    setStockModal(null);
    await loadFromDb();
    toast(data.id + " dispatched to " + destination, project ? "Linked to " + project + " — stock issued from the central store" : "Stock issued from the central store");
  }
  async function transferStock(sku: string, from: string, to: string, qty: number) {
    const { error } = await supabase.rpc("transfer_stock", { p_sku: sku, p_from: from, p_to: to, p_qty: qty });
    if (error) { toast("Transfer failed", error.message); return; }
    setStockModal(null);
    await loadFromDb();
    toast(`${qty} × ${sku} transferred`, `${from} → ${to} — two movements posted to the ledger`);
  }
  async function adjustStock(sku: string, location: string, newQty: number, reason: string) {
    const { data, error } = await supabase.rpc("adjust_stock", { p_sku: sku, p_location: location, p_new_qty: newQty, p_reason: reason || null });
    if (error) { toast("Adjustment failed", error.message); return; }
    setStockModal(null);
    await loadFromDb();
    toast(`${sku} adjusted to ${newQty} in ${location}`, data.delta === 0 ? "No change" : `${data.delta > 0 ? "+" : ""}${data.delta} correction posted to the ledger`);
  }
  async function setDispatchState(ref: string, state: "delivered" | "cancelled") {
    const { error } = await supabase.rpc("set_dispatch_state", { p_ref: ref, p_state: state });
    if (error) { toast("Couldn't update dispatch", error.message); return; }
    await loadFromDb();
    toast(`${ref} ${state}`, state === "delivered" ? "Marked received at the destination" : "Dispatch cancelled");
  }
  // Upload a proof-of-delivery receipt for a dispatch → Storage, then record the path.
  async function attachDispatchReceipt(ref: string, file: File) {
    const safe = file.name.replace(/[^\w.\-]+/g, "_");
    const path = `${ref}/${Date.now()}-${safe}`;
    const up = await supabase.storage.from("dispatch-receipts").upload(path, file, { upsert: true, contentType: file.type || undefined });
    if (up.error) { toast("Upload failed", up.error.message); return; }
    const { error } = await supabase.rpc("attach_dispatch_receipt", { p_ref: ref, p_path: path });
    if (error) { toast("Couldn't save receipt", error.message); return; }
    await loadFromDb();
    toast(`Receipt saved for ${ref}`, "Proof of delivery attached to the dispatch");
  }
  // Public URL for a stored receipt path (bucket is public-read).
  function receiptUrl(path: string) {
    return supabase.storage.from("dispatch-receipts").getPublicUrl(path).data.publicUrl;
  }

  /* ---------- staff documents (Phase 2c): private bucket, owner + HR read ---------- */
  // Upload a file to the caller's own staff file. Returns true on success.
  async function uploadStaffDoc(file: File, category: string, name?: string, leaveRef?: string) {
    // path prefix must be the caller's app_user id (enforced by storage RLS)
    const authId = session?.user?.id;
    if (!authId) { toast("Not signed in", "Sign in again to upload"); return false; }
    const { data: me, error: meErr } = await supabase.from("app_users").select("id").eq("auth_id", authId).single();
    if (meErr || !me) { toast("No staff record", "Your login isn't linked to a staff file"); return false; }
    const safe = file.name.replace(/[^\w.\-]+/g, "_");
    const path = `${me.id}/${category}/${Date.now()}-${safe}`;
    const up = await supabase.storage.from("staff-documents").upload(path, file, { upsert: true, contentType: file.type || undefined });
    if (up.error) { toast("Upload failed", up.error.message); return false; }
    const { error } = await supabase.rpc("add_staff_document", {
      p_name: name?.trim() || file.name, p_path: up.data.path, p_category: category, p_leave_ref: leaveRef ?? null,
    });
    if (error) { toast("Couldn't save document", error.message); return false; }
    return true;
  }
  // Add a document to my own personal file (from the Staff Portal).
  async function addStaffDocument(file: File, name: string, category: string) {
    if (await uploadStaffDoc(file, category, name)) {
      await loadHr();
      toast("Document added to your file", `${name.trim() || file.name} — visible to you and HR`);
    }
  }
  // Remove a document from my own personal file (metadata + the storage object).
  async function deleteStaffDocument(path: string, name: string) {
    const { error } = await supabase.rpc("delete_staff_document", { p_path: path });
    if (error) { toast("Couldn't delete document", error.message); return; }
    // best-effort: drop the underlying object too (owner-scoped storage policy)
    await supabase.storage.from("staff-documents").remove([path]);
    await loadHr();
    toast("Document removed", `${name || "The file"} was deleted from your file`);
  }
  // Signed URL for a private staff document (owner or HR only, via storage RLS).
  async function staffDocUrl(path: string) {
    const { data, error } = await supabase.storage.from("staff-documents").createSignedUrl(path, 120);
    if (error) { toast("Couldn't open document", error.message); return null; }
    return data.signedUrl;
  }

  /* ---------- stock item registry (create / edit) ---------- */
  async function createStockItem(v: { name: string; category: string; unit: string; unitCost: number; reorderLevel: number; reorderQty: number; budgetCode: string }) {
    // SKU is auto-generated server-side (the form no longer asks for one)
    const { data, error } = await supabase.rpc("create_stock_item", {
      p_name: v.name, p_category: v.category || null, p_unit: v.unit || "unit",
      p_unit_cost: v.unitCost, p_reorder_level: v.reorderLevel, p_reorder_qty: v.reorderQty,
      p_budget_code: v.budgetCode || null,
    });
    if (error) { toast("Item not created", error.message); return; }
    setItemModal(null);
    await loadFromDb();
    toast(`${v.name} added to the registry`, `${data.sku} — receive stock to open its balance`);
  }
  async function updateStockItem(sku: string, reorderLevel: number, reorderQty: number, unitCost: number) {
    const { error } = await supabase.rpc("update_stock_item", {
      p_sku: sku, p_reorder_level: reorderLevel, p_reorder_qty: reorderQty, p_unit_cost: unitCost,
    });
    if (error) { toast("Item not updated", error.message); return; }
    setItemModal(null);
    await loadFromDb();
    toast(sku + " updated", "Reorder policy and cost saved");
  }

  /* ---------- assets (register / dispose / depreciate) ---------- */
  async function registerAsset(v: { name: string; category: string; cost: number; lifeMonths: number; acquired: string; salvage: number }) {
    const { data, error } = await supabase.rpc("register_asset", {
      p_name: v.name, p_category: v.category || null, p_cost: v.cost,
      p_life_months: v.lifeMonths, p_acquired: v.acquired, p_salvage: v.salvage || 0,
    });
    if (error) { toast("Asset not registered", error.message); return; }
    setAssetOpen(false);
    await loadFromDb();
    toast(data.id + " registered", `${v.name} — straight-line over ${v.lifeMonths} months`);
  }
  async function disposeAsset(ref: string, reason: string) {
    const { error } = await supabase.rpc("dispose_asset", { p_ref: ref, p_reason: reason || null });
    if (error) { toast("Couldn't dispose asset", error.message); return; }
    await loadFromDb();
    toast(ref + " disposed", "Removed from the active register");
  }
  async function runDepreciation(period: string) {
    const { data, error } = await supabase.rpc("run_depreciation", { p_period: period });
    if (error) { toast("Depreciation run failed", error.message); return; }
    await loadFromDb();
    toast(`Depreciation posted for ${period}`,
      data.assets ? `${data.assets} asset${data.assets === 1 ? "" : "s"} · KES ${Number(data.total).toLocaleString()} to the GL` : "Nothing to post — already run or fully depreciated");
  }

  const api: AppApi = {
    view, tabs, go, goTab, mainRef,
    entity, cycleEntity,
    toasts, toast,
    myWeek, taskFilter, setTaskFilter,
    taskOpen, openTask: () => setTaskOpen(true), closeTask: () => setTaskOpen(false), saveTask,
    engId, vendorName, projectName, accessEmail,
    openEng, closeEng: () => setEngId(null),
    openVendor: (n) => setVendorName(n), closeVendor: () => setVendorName(null),
    openProject: (n) => setProjectName(n), closeProject: () => setProjectName(null),
    openAccess: (e) => setAccessEmail(e), closeAccess: () => setAccessEmail(null),
    xEng, xProject, xTab, xView, openRecord,
    perms, saveAccess: saveAccessFn,
    inviteOpen, setInviteOpen, sendInvite,
    reqOpen, openReq: () => setReqOpen(true), closeReq: () => setReqOpen(false),
    reqs, submitReq, approvePR,
    poFor, raisePO, closePO: () => setPoFor(null), submitPO, newPOs,
    invOpen, openInvoice: () => setInvOpen(true), closeInvoice: () => setInvOpen(false),
    submitInvoice, newInvoices,
    projectDetails, extraProjects, engToProject, projectToEng, createProjectFromEng,
    projectFormOpen, openProjectForm: () => setProjectFormOpen(true), closeProjectForm: () => setProjectFormOpen(false), createProject,
    addMilestone, setMilestoneStatus, addDrawdown, setDrawdownStatus, logFieldActivity, setProjectState,
    addProjectDocument, projectDocUrl,
    hrMe, leaveOpen, leaveEdit,
    openLeave: () => { setLeaveEdit(null); setLeaveOpen(true); },
    openLeaveEdit: (a) => { setLeaveEdit(a); setLeaveOpen(true); },
    closeLeave: () => { setLeaveOpen(false); setLeaveEdit(null); },
    applyLeave, updateLeave, deleteLeave, addStaffDocument, deleteStaffDocument, staffDocUrl,
    hrLeaveQueue, hrBalances, decideLeave,
    hrData, hrModal, openHrModal: (m: HrModalMode) => setHrModal(m), closeHrModal: () => setHrModal(null),
    addEmployee, preparePayroll, approvePayroll, postPayroll,
    createRecruitmentReq, addCandidate, advanceCandidate, updatePosting, publishPosting, openCandidateCv, screenCandidateCv, createEnumerator, createFieldAssignment, setFieldAssignmentState,
    updateStaffHrProfile, startAppraisalCycle, toggleAppraisalKpi, setAppraisalKpis, advanceAppraisal, refreshHr: loadHrModule,
    addCertification, verifyCertification, submitFeedback, setFeedbackState, startExit, signExitStep, signMyExitStep, cancelExit,
    meEmail: session?.user?.email ?? null, selfAssessKpi, submitSelfAssessment, submitMyCertification,
    crm,
    engFormOpen, openEngForm: () => setEngFormOpen(true), closeEngForm: () => setEngFormOpen(false), createEngagement,
    engUpdateOpen, openEngUpdate: () => setEngUpdateOpen(true), closeEngUpdate: () => setEngUpdateOpen(false),
    logEngagementNote, setEngagementPartners, engDocUrl,
    partnerOpen, openPartnerForm: () => setPartnerOpen(true), closePartnerForm: () => setPartnerOpen(false), createPartner,
    oppOpen, openOppForm: () => setOppOpen(true), closeOppForm: () => setOppOpen(false), createOpportunity,
    compliance, markObligationFiled,
    riskOpen, openRiskForm: () => setRiskOpen(true), closeRiskForm: () => setRiskOpen(false), createRisk,
    policyOpen, openPolicyForm: () => setPolicyOpen(true), closePolicyForm: () => setPolicyOpen(false), addPolicy,
    docOpen, openDocForm: () => setDocOpen(true), closeDocForm: () => setDocOpen(false), addCompanyDocument,
    contractOpen, openContractForm: () => setContractOpen(true), closeContractForm: () => setContractOpen(false), addContract,
    complianceDocUrl,
    inventory, stockModal,
    openStockModal: (m) => setStockModal(m), closeStockModal: () => setStockModal(null),
    receiveStock, issueStock, transferStock, adjustStock, createDispatch, setDispatchState, attachDispatchReceipt, receiptUrl,
    itemModal, openItemModal: (m) => setItemModal(m), closeItemModal: () => setItemModal(null),
    createStockItem, updateStockItem,
    assetOpen, openAssetForm: () => setAssetOpen(true), closeAssetForm: () => setAssetOpen(false),
    registerAsset, disposeAsset, runDepreciation,
  };

  if (!authReady) return null;
  // an invitee with a session but a pending password sees the set-password screen first
  if (session && needPassword) return <SetPassword onDone={() => setNeedPassword(false)} />;
  return <Ctx.Provider value={api}>{session ? children : <LoginGate />}</Ctx.Provider>;
}

export { roleTemplates };
