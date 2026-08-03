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
  FieldActivity, AppNotification,
  kes,
} from "./data";

export interface Toast { id: number; title: string; sub?: string }
export interface Req { id: string; item: string; amt: number; code: string; chip: string; chipTxt: string; status: "draft" | "await" | "md" | "approved" | "rejected" | "po"; qty?: number; unit?: string; unitPrice?: number; project?: string | null; justification?: string | null; raisedBy?: string; date?: string }
export interface NewPO { id: string; vendor: string; amt: number; delivery: string }
export interface NewInvoice { cust: string; id: string; tot: number; pillCls: string; pillTxt: string }

/* ---------- Procurement + Finance spine read models (folded in via loadFromDb) ---------- */
export interface Vendor { id: string; name: string; category: string | null; country: string; taxStatus: string; screenStatus: string; rating: string | null; openPos: number; state: string; bank?: string | null }
export interface PORow { id: string; vendor: string; amt: number; delivery: string; state: string; reapproval: boolean; qty: number; unitPrice: number; received: number }
export interface AuditRow { id: number; when: string; actor: string; action: string; recordType: string; recordRef: string | null; detail: Record<string, unknown> }
export interface BankChange { id: string; vendor: string; oldBank: string | null; newBank: string; state: string; callbackNote: string | null; when: string }
export interface Grn { id: string; po: string; vendor: string; coverage: string; pct: number; qtyReceived: number; over: boolean; note: string | null; when: string }
export interface ApInvoice { ref: string; po: string; vendor: string; amount: number; state: string; matchNote: string | null; when: string; invoiceNumber: string | null; invoiceDate: string | null; currency: string; wht: number; capturedByMe: boolean }
export interface PaymentRow { ref: string; invoice: string; amount: number; method: string; journalRef: string | null; when: string }
export interface JournalLine { account: string; debit: number; credit: number }
export interface Journal { ref: string; memo: string; sourceType: string | null; when: string; lines: JournalLine[] }
export interface AccountBal { code: string; name: string; kind: string; debit: number; credit: number; balance: number }

/* ---------- Inventory (Phase 2 — the one net-new module) ---------- */
export interface StockItem { sku: string; name: string; category: string; unit: string; unitCost: number; reorderLevel: number; onHand: number; autoReq: string | null }
export interface StockMovement { when: string; sku: string; type: string; qty: number; from: string | null; to: string | null; source: string | null; note: string | null }
export interface DispatchRow { id: string; project: string | null; destination: string; lines: { sku: string; name: string; qty: number }[]; state: string; receipt?: string | null }
export interface AssetRow { id: string; name: string; category: string; cost: number; accumDep: number; nbv: number; acquired: string; state: string; quantity: number }
export interface AssetAssignment { ref: string; assetRef: string; assetName: string; employee: string; qty: number; assignedAt: string }
export interface InventoryData { items: StockItem[]; locations: string[]; movements: StockMovement[]; dispatches: DispatchRow[]; assets: AssetRow[]; assetAssignments: AssetAssignment[] }
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
export interface Partner { id: string; name: string; type: string; country: string; ownerName: string; status: string; statusCls: string; contactName?: string | null; email?: string | null; phone?: string | null }
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

// the signed-in person (from bootstrap's `me`, keyed off the JWT email)
export interface Me { name: string; email: string; roleTitle: string | null; color?: string | null }
export interface OAuthStatus { google?: { connected: boolean; email?: string | null } | null; claude?: { connected: boolean } | null }

// a real member row from public.app_users (replaces the old hardcoded demo list)
export interface Member {
  name: string;
  email: string;
  roleKey: string;
  roleTitle: string | null;
  twoFa: boolean;
  status: string;   // active | away | off
  state: string;    // active | invited | ...
  color: string | null;
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
  taskMode: "personal" | "assign";
  openTask: (mode?: "personal" | "assign") => void;
  closeTask: () => void;
  createTask: (v: { title: string; due: string; link: string; assigneeEmail?: string; subtasks: string[] }) => void;
  addSubtask: (ref: string, text: string) => void;
  toggleSubtask: (ref: string, idx: number) => void;
  setTaskDone: (ref: string, done: boolean) => void;

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

  me: Me | null;
  signOut: () => void;
  members: Member[];

  inviteOpen: boolean;
  setInviteOpen: (b: boolean) => void;
  sendInvite: (name: string, email: string, role: string) => void;

  reqOpen: boolean;
  openReq: () => void;
  closeReq: () => void;
  reqs: Req[];
  submitReq: (v: { item: string; amt: number; code: string; qty: number; unit: string; unitPrice: number; project: string; justification: string; asDraft: boolean }) => void;
  submitReqFinal: (id: string) => void;
  withdrawReq: (id: string) => void;
  approvePR: (id: string) => void;
  costCentres: { code: string; budget: number; used: number }[];
  createCostCentre: (name: string, budget: number) => void;
  poFor: Req | null;
  raisePO: (id: string) => void;
  closePO: () => void;
  submitPO: (vendor: string, delivery: string, qty?: number, unitPrice?: number) => void;
  poPickerOpen: boolean;
  openPoPicker: () => void;
  closePoPicker: () => void;
  newPOs: NewPO[];

  // Procurement spine read models + mutations
  vendors: Vendor[];
  poRows: PORow[];
  grns: Grn[];
  vendorOpen: boolean;
  openVendorForm: () => void;
  closeVendorForm: () => void;
  createVendor: (v: { name: string; category: string; country: string; kraPin: string; bank: string }) => void;
  screenVendor: (name: string, result: "cleared" | "flagged", detail: string) => void;
  grnFor: PORow | null;
  openGrn: (po: PORow) => void;
  closeGrn: () => void;
  recordGrn: (poRef: string, qtyReceived: number, note: string, overAction: string, photo?: File | null) => void;

  invOpen: boolean;
  openInvoice: () => void;
  closeInvoice: () => void;
  submitInvoice: (cust: string, desc: string, net: number, dueSel: string) => void;
  newInvoices: NewInvoice[];

  // Finance spine read models + mutations
  apInvoices: ApInvoice[];
  payments: PaymentRow[];
  journals: Journal[];
  accounts: AccountBal[];
  invoiceFor: PORow | null;
  openCaptureInvoice: (po: PORow) => void;
  closeCaptureInvoice: () => void;
  captureInvoice: (v: { poRef: string; amount: number; invoiceNumber: string; invoiceDate: string; currency: string; wht: boolean }) => void;
  approveInvoice: (invRef: string) => void;
  payInvoice: (invRef: string, method: string) => void;
  receiptFor: NewInvoice | null;
  openReceipt: (inv: NewInvoice) => void;
  closeReceipt: () => void;
  recordReceipt: (invRef: string, amount: number, method: string) => void;

  // v2 controls: PO amendment, vendor bank-detail change, settings config, audit trail
  poAmendFor: PORow | null;
  openPoAmend: (po: PORow) => void;
  closePoAmend: () => void;
  amendPo: (poRef: string, amount: number, delivery: string, reason: string) => void;
  approvePoAmendment: (poRef: string) => void;
  bankChangeFor: string | null;
  openBankChange: (vendor: string) => void;
  closeBankChange: () => void;
  requestBankChange: (vendor: string, newBank: string) => void;
  approveBankChange: (id: string, callbackNote: string) => void;
  bankChanges: BankChange[];
  appConfig: Record<string, number | boolean | string>;
  setAppConfig: (key: string, value: number | boolean | string) => void;
  audit: AuditRow[];

  // Settings: profile self-edit, password, deep-link tab, and live integration status
  settingsTab: string;
  setSettingsTab: (t: string) => void;
  updateMyProfile: (v: { name: string; roleTitle: string; color: string }) => void;
  changePassword: (password: string) => Promise<string | null>;
  oauthStatus: OAuthStatus;
  refreshOAuthStatus: () => void;
  connectClaude: (key: string) => Promise<string | null>;
  sendMyDigest: () => void;

  projectDetails: Record<string, ProjectDetail>;
  extraProjects: { name: string; funder: string }[];
  engToProject: Record<string, string>;
  projectToEng: Record<string, string>;
  createProjectFromEng: (id: string) => void;
  projectFormOpen: boolean;
  openProjectForm: () => void;
  closeProjectForm: () => void;
  createProject: (v: { name: string; funder: string; budgetAmount: number; startDate: string; endDate: string; team: string; status: string; location: string }) => void;
  projectEdit: string | null;
  openProjectEdit: (name: string) => void;
  closeProjectEdit: () => void;
  updateProject: (id: string, v: { funder: string; budgetAmount: number; startDate: string; endDate: string; team: string; status: string; location: string }) => void;
  deleteProject: (name: string) => void;
  addMilestone: (projectId: string, title: string, amount: number, startDate: string, endDate: string, status?: string) => void;
  setMilestoneStatus: (milestoneId: string, status: string) => void;
  addDrawdown: (projectId: string, title: string, amount: string, status?: string) => void;
  setDrawdownStatus: (drawdownId: string, status: string) => void;
  logFieldActivity: (projectId: string, kind: string, county: string, note: string) => void;
  fieldActivities: FieldActivity[];
  fieldActivityOpen: boolean;
  openFieldActivity: () => void;
  closeFieldActivity: () => void;
  createFieldActivity: (v: { projectName: string; assignee: string; phone: string; email: string; date: string; note: string }) => void;
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
  addEmployee: (v: { name: string; email: string; roleTitle: string; contractType: string; startDate: string; grossSalary: number; kra: string; nssf: string; shif: string; bank: string; contractEnd: string }) => void;
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
  createEngagement: (name: string, owner: string, pipeline: "up" | "down", dueKey: string, note: string, taggedEmail: string, file?: File | null) => void;
  engUpdateOpen: boolean;
  openEngUpdate: () => void;
  closeEngUpdate: () => void;
  logEngagementNote: (ref: string, v: { channel: string; who: string; note: string; stageTo: string; file?: File | null }) => void;
  setEngagementPartners: (ref: string, partnerIds: string[]) => void;
  engDocUrl: (path: string, downloadName?: string) => string;
  partnerOpen: boolean;
  openPartnerForm: () => void;
  closePartnerForm: () => void;
  createPartner: (v: { name: string; type: string; country: string; owner: string; status: string; contactName: string; email: string; phone: string }) => void;
  oppOpen: boolean;
  openOppForm: () => void;
  closeOppForm: () => void;
  createOpportunity: (name: string, type: string, deadline: string, linkedTo: string, status: string) => void;

  // In-app notifications (topbar bell + CRM badge)
  notifications: AppNotification[];
  markNotificationsSeen: (ids?: string[]) => void;

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
  createStockItem: (v: { name: string; category: string; unit: string; unitCost: number; reorderLevel: number; reorderQty: number; budgetCode: string; supplier: string }) => void;
  updateStockItem: (sku: string, reorderLevel: number, reorderQty: number, unitCost: number) => void;
  assetOpen: boolean;
  openAssetForm: () => void;
  closeAssetForm: () => void;
  registerAsset: (v: { name: string; category: string; quantity: number; acquired: string }) => void;
  assignAsset: (assetRef: string, employee: string, qty: number) => void;
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
  const [taskMode, setTaskMode] = useState<"personal" | "assign">("personal");

  const [engId, setEngId] = useState<string | null>(null);
  const [vendorName, setVendorName] = useState<string | null>(null);
  const [projectName, setProjectName] = useState<string | null>(null);
  const [accessEmail, setAccessEmail] = useState<string | null>(null);

  const [perms, setPerms] = useState(initialPerms);
  const [me, setMe] = useState<Me | null>(null);
  const [members, setMembers] = useState<Member[]>([]);
  const [settingsTab, setSettingsTab] = useState("s-org");
  const [oauthStatus, setOauthStatus] = useState<OAuthStatus>({});
  const [inviteOpen, setInviteOpen] = useState(false);

  const [reqOpen, setReqOpen] = useState(false);
  const [reqs, setReqs] = useState<Req[]>([]);
  const [poFor, setPoFor] = useState<Req | null>(null);
  const [poPickerOpen, setPoPickerOpen] = useState(false);
  const [newPOs, setNewPOs] = useState<NewPO[]>([]);
  const [vendors, setVendors] = useState<Vendor[]>([]);
  const [poRows, setPoRows] = useState<PORow[]>([]);
  const [grns, setGrns] = useState<Grn[]>([]);
  const [vendorOpen, setVendorOpen] = useState(false);
  const [grnFor, setGrnFor] = useState<PORow | null>(null);

  const [invOpen, setInvOpen] = useState(false);
  const [newInvoices, setNewInvoices] = useState<NewInvoice[]>([]);
  const [apInvoices, setApInvoices] = useState<ApInvoice[]>([]);
  const [payments, setPayments] = useState<PaymentRow[]>([]);
  const [journals, setJournals] = useState<Journal[]>([]);
  const [accounts, setAccounts] = useState<AccountBal[]>([]);
  const [invoiceFor, setInvoiceFor] = useState<PORow | null>(null);
  const [receiptFor, setReceiptFor] = useState<NewInvoice | null>(null);
  const [poAmendFor, setPoAmendFor] = useState<PORow | null>(null);
  const [bankChangeFor, setBankChangeFor] = useState<string | null>(null);
  const [bankChanges, setBankChanges] = useState<BankChange[]>([]);
  const [appConfig, setAppConfigState] = useState<Record<string, number | boolean | string>>({});
  const [audit, setAudit] = useState<AuditRow[]>([]);
  const [costCentres, setCostCentres] = useState<{ code: string; budget: number; used: number }[]>([]);

  const [projectDetails, setProjectDetails] = useState(initialProjectDetails);
  const [extraProjects, setExtraProjects] = useState<{ name: string; funder: string }[]>([]);
  const [engToProject, setEngToProject] = useState(initialEngToProject);
  const [projectToEng, setProjectToEng] = useState(initialProjectToEng);
  const [projectFormOpen, setProjectFormOpen] = useState(false);
  const [projectEdit, setProjectEdit] = useState<string | null>(null);  // name of project being edited, or null
  const [fieldActivities, setFieldActivities] = useState<FieldActivity[]>([]);
  const [fieldActivityOpen, setFieldActivityOpen] = useState(false);
  const [notifications, setNotifications] = useState<AppNotification[]>([]);

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
    setMe((data.me as Me) ?? null);   // who's actually signed in — drives the sidebar identity
    setMyWeek(data.tasks as WeekTask[]);
    // Richer task read: subtasks + owner/assigner, so My Week can expand mini-tasks and
    // filter "Mine" by the real signed-in user. Overrides bootstrap's lean tasks payload.
    const { data: taskRows } = await supabase
      .from("tasks")
      .select("ref, title, sub, owner_name, due_pill, due_label, subtasks, owner:app_users!tasks_owner_id_fkey(name, email), assigner:app_users!tasks_assigned_by_id_fkey(name)")
      .eq("state", "open")
      .order("created_at", { ascending: false });
    if (taskRows) setMyWeek((taskRows as any[]).map((r) => {
      const owner = Array.isArray(r.owner) ? r.owner[0] : r.owner;
      const assigner = Array.isArray(r.assigner) ? r.assigner[0] : r.assigner;
      return {
        id: r.ref, t: r.title, s: r.sub, o: r.owner_name, p: r.due_pill, pl: r.due_label,
        subtasks: (r.subtasks ?? []) as { text: string; done: boolean }[],
        ownerEmail: owner?.email, assignedBy: assigner?.name && assigner.name !== r.owner_name ? assigner.name : undefined,
      } as WeekTask;
    }));
    setReqs(data.reqs as Req[]);
    setNewPOs(data.pos as NewPO[]);
    setNewInvoices(data.salesInvoices as NewInvoice[]);
    setPerms({ ...initialPerms, ...(data.perms as Record<string, Perms>) });
    // User Management runs off the live app_users table (no hardcoded roster) — invited
    // people appear as soon as invite_user inserts them, since sendInvite re-runs loadFromDb.
    const { data: memberRows } = await supabase
      .from("app_users")
      .select("name, email, role_key, role_title, two_fa, status, state, color")
      .order("created_at");
    setMembers(((memberRows ?? []) as any[]).map((m) => ({
      name: m.name, email: m.email, roleKey: m.role_key, roleTitle: m.role_title,
      twoFa: !!m.two_fa, status: m.status, state: m.state, color: m.color,
    })));
    // my avatar colour (for the profile editor) + live integration status
    const myColor = ((memberRows ?? []) as any[]).find((m) => m.email === (data.me as Me)?.email)?.color;
    if (myColor) setMe((prev) => (prev ? { ...prev, color: myColor } : prev));
    const { data: oa } = await supabase.rpc("oauth_status");
    if (oa) setOauthStatus(oa as OAuthStatus);
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
    // Asset quantity and employee assignments live on columns/tables bootstrap
    // doesn't return — fold them in by ref (same approach as dispatch receipts).
    const { data: aq } = await supabase.from("assets").select("ref, quantity");
    if (aq) {
      const qtyByRef = new Map((aq as { ref: string; quantity: number }[]).map((r) => [r.ref, r.quantity]));
      inv.assets = inv.assets.map((a) => ({ ...a, quantity: qtyByRef.get(a.id) ?? 1 }));
    }
    const { data: asn } = await supabase
      .from("asset_assignments")
      .select("ref, asset_ref, employee, qty, assigned_at")
      .order("assigned_at", { ascending: false });
    inv.assetAssignments = ((asn ?? []) as { ref: string; asset_ref: string; employee: string; qty: number; assigned_at: string }[])
      .map((r) => ({ ref: r.ref, assetRef: r.asset_ref, assetName: inv.assets.find((a) => a.id === r.asset_ref)?.name ?? r.asset_ref, employee: r.employee, qty: r.qty, assignedAt: r.assigned_at }));
    setInventory(inv);
    // Field-activity assignments live on columns bootstrap doesn't return — fold them in
    // (same approach as asset assignments). Only the new "assignment" rows are shown here.
    const { data: fa } = await supabase
      .from("field_activities")
      .select("id, assignee, phone, email, note, activity_on, projects(name)")
      .eq("kind", "assignment")
      .order("activity_on", { ascending: false });
    setFieldActivities(((fa ?? []) as any[]).map((r) => {
      const rel = r.projects;
      const project: string = Array.isArray(rel) ? rel[0]?.name : rel?.name;
      return { id: r.id, project: project ?? "—", assignee: r.assignee, phone: r.phone, email: r.email, date: r.activity_on, note: r.note };
    }));
    // My in-app notifications (RLS scopes to the signed-in user) — drives bell + CRM badge.
    const { data: nf } = await supabase
      .from("notifications")
      .select("id, kind, title, body, link_view, link_ref, seen, created_at")
      .order("created_at", { ascending: false })
      .limit(50);
    setNotifications(((nf ?? []) as any[]).map((r) => ({
      id: r.id, kind: r.kind, title: r.title, body: r.body,
      linkView: r.link_view, linkRef: r.link_ref, seen: r.seen, createdAt: r.created_at,
    })));
    // Partner contact fields (contact_name/email/phone) aren't in bootstrap — fold them in by id.
    const { data: pc } = await supabase.from("partners").select("id, contact_name, email, phone");
    const contactById = new Map(((pc ?? []) as any[]).map((r) => [r.id as string, r]));
    const withContact = (p: Partner): Partner => {
      const c = contactById.get(p.id);
      return c ? { ...p, contactName: c.contact_name, email: c.email, phone: c.phone } : p;
    };
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
      partners: ((data.partners ?? []) as Partner[]).map(withContact),
      opportunities: (data.opportunities ?? []) as Opportunity[],
      dropdowns: (data.crmDropdowns ?? {}) as Record<string, string[]>,
      teamNames: (data.teamNames ?? []) as string[],
      engPartners: (data.engPartners ?? {}) as Record<string, string[]>,
    });
    // Compliance & Governance — policies, statutory documents, calendar, risk register, contracts
    setCompliance((data.compliance ?? {
      policies: [], companyDocuments: [], obligations: [], risks: [], contracts: [],
    }) as ComplianceData);
    // sync the req modal's live budget preview with the ledger (same object the modal imports).
    // Add new cost centres too (created in Settings → Coding), not just update existing ones.
    const blData = data.budgetLines as Record<string, { b: number; u: number }>;
    for (const [k, v] of Object.entries(blData)) { budgetLines[k] = { b: v.b, u: v.u }; }
    setCostCentres(Object.entries(blData).map(([code, v]) => ({ code, budget: v.b, used: v.u })));
    // ---- Procurement + Finance spine read models (bootstrap doesn't carry these) ----
    const { data: vn } = await supabase
      .from("vendors")
      .select("id, name, category, country, tax_status, screen_status, rating, open_pos, state, bank")
      .order("created_at", { ascending: false });
    setVendors(((vn ?? []) as any[]).map((r) => ({
      id: r.id, name: r.name, category: r.category, country: r.country, taxStatus: r.tax_status,
      screenStatus: r.screen_status, rating: r.rating, openPos: r.open_pos, state: r.state, bank: r.bank,
    })));
    const { data: po } = await supabase
      .from("purchase_orders")
      .select("id, ref, vendor_name, amount, delivery, state, needs_reapproval, qty, unit_price, goods_received_notes(qty_received, state)")
      .order("created_at", { ascending: false });
    setPoRows(((po ?? []) as any[]).map((r) => {
      const recv = ((r.goods_received_notes ?? []) as any[]).filter((g) => g.state === "received").reduce((s, g) => s + Number(g.qty_received || 0), 0);
      return { id: r.ref, vendor: r.vendor_name, amt: Number(r.amount), delivery: r.delivery, state: r.state, reapproval: !!r.needs_reapproval, qty: Number(r.qty ?? 1), unitPrice: Number(r.unit_price ?? r.amount), received: recv };
    }));
    // Richer requisitions read model (draft state + the full form's fields) — overrides bootstrap's reqs.
    const reqStatus: Record<string, Req["status"]> = { draft: "draft", submitted: "await", md_review: "md", approved: "approved", converted: "po", rejected: "rejected" };
    const { data: rqs } = await supabase
      .from("requisitions")
      .select("ref, item, amount, budget_code, budget_chip, budget_chip_txt, state, qty, unit, unit_price, project_code, justification, created_at, app_users(name)")
      .order("created_at", { ascending: false });
    setReqs(((rqs ?? []) as any[]).map((r) => {
      const rel = r.app_users; const who = Array.isArray(rel) ? rel[0]?.name : rel?.name;
      return {
        id: r.ref, item: r.item, amt: Number(r.amount), code: r.budget_code,
        chip: r.budget_chip || "ok", chipTxt: r.budget_chip_txt || "within",
        status: reqStatus[r.state] ?? "await",
        qty: r.qty != null ? Number(r.qty) : undefined, unit: r.unit,
        unitPrice: r.unit_price != null ? Number(r.unit_price) : undefined,
        project: r.project_code, justification: r.justification,
        raisedBy: who ?? "—", date: r.created_at,
      };
    }));
    const { data: gr } = await supabase
      .from("goods_received_notes")
      .select("ref, coverage, pct, qty_received, over_delivery, note, created_at, purchase_orders(ref, vendor_name)")
      .order("created_at", { ascending: false });
    setGrns(((gr ?? []) as any[]).map((r) => {
      const rel = r.purchase_orders; const po = Array.isArray(rel) ? rel[0] : rel;
      return { id: r.ref, po: po?.ref ?? "—", vendor: po?.vendor_name ?? "—", coverage: r.coverage, pct: r.pct, qtyReceived: Number(r.qty_received ?? 0), over: !!r.over_delivery, note: r.note, when: r.created_at };
    }));
    const { data: ap } = await supabase
      .from("invoices_ap")
      .select("ref, amount, state, match_note, created_at, invoice_number, invoice_date, currency, wht_amount, captured_by, purchase_orders(ref, vendor_name)")
      .order("created_at", { ascending: false });
    const myEmail = (data.me as any)?.email ?? null;
    const { data: meRow } = myEmail ? await supabase.from("app_users").select("id").eq("email", myEmail).maybeSingle() : { data: null };
    const myId = (meRow as any)?.id ?? null;
    setApInvoices(((ap ?? []) as any[]).map((r) => {
      const rel = r.purchase_orders; const po = Array.isArray(rel) ? rel[0] : rel;
      return {
        ref: r.ref, po: po?.ref ?? "—", vendor: po?.vendor_name ?? "—", amount: Number(r.amount), state: r.state, matchNote: r.match_note, when: r.created_at,
        invoiceNumber: r.invoice_number, invoiceDate: r.invoice_date, currency: r.currency || "KES", wht: Number(r.wht_amount || 0),
        capturedByMe: myId != null && r.captured_by === myId,
      };
    }));
    const { data: pay } = await supabase
      .from("payments")
      .select("ref, amount, method, journal_ref, created_at, invoices_ap(ref)")
      .order("created_at", { ascending: false });
    setPayments(((pay ?? []) as any[]).map((r) => {
      const rel = r.invoices_ap; const inv = Array.isArray(rel) ? rel[0] : rel;
      return { ref: r.ref, invoice: inv?.ref ?? "—", amount: Number(r.amount), method: r.method, journalRef: r.journal_ref, when: r.created_at };
    }));
    const { data: je } = await supabase
      .from("journal_entries")
      .select("ref, memo, source_type, created_at, journal_lines(account_code, debit, credit)")
      .order("created_at", { ascending: false })
      .limit(40);
    setJournals(((je ?? []) as any[]).map((r) => ({
      ref: r.ref, memo: r.memo, sourceType: r.source_type, when: r.created_at,
      lines: ((r.journal_lines ?? []) as any[]).map((l) => ({ account: l.account_code, debit: Number(l.debit), credit: Number(l.credit) })),
    })));
    const { data: bal } = await supabase.rpc("account_balances");
    setAccounts(((bal ?? []) as any[]).map((r) => ({
      code: r.code, name: r.name, kind: r.kind, debit: Number(r.debit), credit: Number(r.credit), balance: Number(r.balance),
    })));
    // configurable rules (Settings → Approval & Matching Rules) + audit trail + bank-change queue
    const { data: cfg } = await supabase.from("app_config").select("key, value");
    setAppConfigState(Object.fromEntries(((cfg ?? []) as any[]).map((r) => [r.key, r.value])));
    const { data: au } = await supabase
      .from("audit_log")
      .select("id, actor_email, action, record_type, record_ref, detail, created_at")
      .order("created_at", { ascending: false })
      .limit(200);
    setAudit(((au ?? []) as any[]).map((r) => ({
      id: r.id, when: r.created_at, actor: r.actor_email || "system", action: r.action,
      recordType: r.record_type, recordRef: r.record_ref, detail: r.detail || {},
    })));
    const { data: bc } = await supabase
      .from("vendor_bank_changes")
      .select("id, vendor_name, old_bank, new_bank, state, callback_note, created_at")
      .order("created_at", { ascending: false });
    setBankChanges(((bc ?? []) as any[]).map((r) => ({
      id: r.id, vendor: r.vendor_name, oldBank: r.old_bank, newBank: r.new_bank, state: r.state, callbackNote: r.callback_note, when: r.created_at,
    })));
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

  // Returning from the Google OAuth consent screen (api/google-callback → ?connected=…).
  useEffect(() => {
    const p = new URLSearchParams(window.location.search).get("connected");
    if (!p) return;
    if (p === "google") { setView("settings"); setSettingsTab("s-integ"); toast("Google connected", "Gmail & Drive are now linked"); refreshOAuthStatus(); }
    else if (p === "google_error") toast("Google not connected", "The connection was cancelled or failed");
    window.history.replaceState({}, "", window.location.pathname);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Clicking a module header lands on its overview/home tab. Inventory & HR have
  // no visible "Overview" subnav item, so this is what shows their overview.
  const MODULE_HOME: Record<string, string> = {
    finance: "f-over", procurement: "p-over", inventory: "i-over", hr: "h-over",
    staffportal: "sp-me", projects: "pr-over", crm: "cr-over", compliance: "c-policies",
  };
  function go(v: string) {
    if (MODULE_HOME[v]) setTabs((prev) => ({ ...prev, [v]: MODULE_HOME[v] }));
    setView(v);
    mainRef.current?.scrollTo({ top: 0, behavior: "smooth" });
  }
  function goTab(v: string, t: string) {
    // Set the requested tab and switch the view directly — going through go()
    // would clobber the tab back to the module's overview home.
    setTabs((prev) => ({ ...prev, [v]: t }));
    setView(v);
    mainRef.current?.scrollTo({ top: 0, behavior: "smooth" });
  }

  function cycleEntity() {
    const order: Entity[] = ["Kenya", "Uganda", "Consolidated"];
    const next = order[(order.indexOf(entity) + 1) % 3];
    setEntity(next);
    toast("Switched to " + next, next === "Consolidated" ? "Both entities, one set of numbers" : "Records now scoped to " + next);
  }

  /* ---------- tasks ---------- */
  // Replace or update one task in My Week from a returned task_json (drop it if done/absent).
  const upsertTask = (t: WeekTask | null, ref?: string) =>
    setMyWeek((w) => {
      const key = t?.id ?? ref;
      const without = w.filter((x) => x.id !== key);
      return t ? [t, ...without] : without;
    });
  async function createTask(v: { title: string; due: string; link: string; assigneeEmail?: string; subtasks: string[] }) {
    const assignee = v.assigneeEmail && v.assigneeEmail !== me?.email ? v.assigneeEmail : null;
    const { data, error } = await supabase.rpc("create_task", {
      p_title: v.title, p_owner_email: assignee, p_due_key: v.due, p_link: v.link || "",
      p_subtasks: v.subtasks.filter((s) => s.trim()),
    });
    if (error) { toast("Task not saved", error.message); return; }
    const task = data as WeekTask;
    setMyWeek((w) => [task, ...w.filter((x) => x.id !== task.id)]);
    setTaskOpen(false);
    // assigned to someone else → email them too (best-effort; the in-app bell is already written)
    if (assignee) {
      setTaskFilter("team");
      const who = members.find((m) => m.email === assignee);
      try {
        await fetch("/api/notify", {
          method: "POST",
          headers: { "Content-Type": "application/json", Authorization: `Bearer ${session?.access_token ?? ""}` },
          body: JSON.stringify({
            to: assignee,
            subject: `${me?.name ?? "A teammate"} assigned you a task`,
            text: `Hi ${who?.name ?? ""},\n\n${me?.name ?? "A teammate"} assigned you a task: ${v.title}.${v.subtasks.filter((s) => s.trim()).length ? `\n\nSub-tasks:\n- ${v.subtasks.filter((s) => s.trim()).join("\n- ")}` : ""}\n\nOpen Jikoni Tool → Home → My Week to see it.`,
            html: `<p>Hi ${who?.name ?? ""},</p><p><strong>${me?.name ?? "A teammate"}</strong> assigned you a task: <strong>${v.title}</strong>.</p>${v.subtasks.filter((s) => s.trim()).length ? `<p>Sub-tasks:</p><ul>${v.subtasks.filter((s) => s.trim()).map((s) => `<li>${s}</li>`).join("")}</ul>` : ""}<p>Open <strong>Jikoni Tool → Home → My Week</strong> to see it.</p>`,
          }),
        });
      } catch { /* email is best-effort; the in-app notification still lands */ }
      toast("Task assigned to " + task.o, `Now in ${task.o}'s My Week · emailed`);
    } else {
      toast("Task added", "It's in your My Week");
    }
  }
  const applyTaskRpc = async (fn: string, args: Record<string, unknown>, ref: string, doneRemoved = false) => {
    const { data, error } = await supabase.rpc(fn, args);
    if (error) { toast("Couldn't update task", error.message); return; }
    upsertTask(doneRemoved ? null : (data as WeekTask), ref);
  };
  const addSubtask = (ref: string, text: string) => applyTaskRpc("add_task_subtask", { p_ref: ref, p_text: text }, ref);
  const toggleSubtask = (ref: string, idx: number) => applyTaskRpc("toggle_task_subtask", { p_ref: ref, p_idx: idx }, ref);
  const setTaskDone = (ref: string, done: boolean) => applyTaskRpc("set_task_done", { p_ref: ref, p_done: done }, ref, done);

  /* ---------- drawers & cross-links ---------- */
  function closeAllDrawers() {
    setEngId(null); setVendorName(null); setProjectName(null); setAccessEmail(null);
  }
  const xEng = (id: string) => { closeAllDrawers(); openEng(id); };
  const xProject = (n: string) => { closeAllDrawers(); setProjectName(n); };
  const xTab = (v: string, t: string) => { closeAllDrawers(); goTab(v, t); };
  const xView = (v: string) => { closeAllDrawers(); go(v); };

  // Look an engagement up in the live CRM read model (DB-backed) — the drawer,
  // My Week records and won-deal → project flow all resolve engagements here.
  const liveEng = (id: string) => [...crm.engUp, ...crm.engDown].find((e) => e.id === id) || null;

  function openEng(id: string) {
    if (!liveEng(id)) { toast(id, "Engagement detail"); return; }
    setEngId(id);
  }
  function openRecord(id: string) {
    if (liveEng(id)) { openEng(id); return; }
    toast(id, "Opens the item with its history");
  }

  async function saveAccessFn(email: string, p: Perms) {
    const u = members.find((x) => x.email === email);
    const { error } = await supabase.rpc("save_access", { p_email: email, p_perms: p });
    if (error) { toast("Access not saved", error.message); return; }
    setPerms((prev) => ({ ...prev, [email]: { ...p } }));
    setAccessEmail(null);
    toast("Access updated for " + (u?.name || email), "Recorded in the audit log with your name and time");
  }

  /* ---------- requisition → PO chain (budget commit + routing + audit in the DB) ---------- */
  async function submitReq(v: { item: string; amt: number; code: string; qty: number; unit: string; unitPrice: number; project: string; justification: string; asDraft: boolean }) {
    const { data, error } = await supabase.rpc("submit_requisition", {
      p_item: v.item, p_amount: v.amt, p_code: v.code, p_qty: v.qty || 1, p_unit: v.unit || "unit",
      p_unit_price: v.unitPrice || null, p_project: v.project || null,
      p_justification: v.justification || null, p_as_draft: v.asDraft,
    });
    if (error) { toast("Requisition failed", error.message); return; }
    const r = data as Req & { routing: { label: string; who: string } };
    if (!v.asDraft && budgetLines[v.code]) budgetLines[v.code].u += v.amt; // keep the modal preview in step with the commitment
    setReqOpen(false);
    await loadFromDb();
    toast(r.id + (v.asDraft ? " saved as draft" : " raised · " + r.routing.label), v.asDraft ? "Submit it when you're ready" : cap(r.routing.who));
  }
  async function submitReqFinal(id: string) {
    const { data, error } = await supabase.rpc("submit_requisition_final", { p_ref: id });
    if (error) { toast("Couldn't submit", error.message); return; }
    await loadFromDb();
    toast(id + " submitted", data.status === "approved" ? "Auto-approved — ready to raise a PO" : "Routed for approval");
  }
  async function withdrawReq(id: string) {
    const { data, error } = await supabase.rpc("withdraw_requisition", { p_ref: id });
    if (error) { toast("Withdraw failed", error.message); return; }
    await loadFromDb();
    toast(id + (data.status === "discarded" ? " discarded" : " withdrawn"), data.status === "discarded" ? "Draft removed" : "Back to draft — budget released");
  }
  async function createCostCentre(name: string, budget: number) {
    const { data, error } = await supabase.rpc("upsert_cost_centre", { p_name: name, p_budget: budget });
    if (error) { toast("Cost centre not saved", error.message); return; }
    await loadFromDb();
    toast(data.code + " saved", "Available as coding on requisitions and budgets");
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
  async function submitPO(vendor: string, delivery: string, qty?: number, unitPrice?: number) {
    if (!poFor) return;
    const { data, error } = await supabase.rpc("raise_po", {
      p_req_ref: poFor.id, p_vendor_name: vendor, p_delivery: delivery,
      p_qty: qty ?? null, p_unit_price: unitPrice ?? null,
    });
    if (error) { toast("PO blocked", error.message); return; }
    const po = data as NewPO;
    setPoFor(null);
    await loadFromDb();
    toast(po.id + " issued to " + vendor, "Draft PO created — awaiting delivery & goods-received note");
  }
  // Upload a file to the shared 'uploads' bucket and return its public URL/path.
  async function uploadFile(prefix: string, file: File): Promise<string | null> {
    const safe = file.name.replace(/[^\w.\-]+/g, "_");
    const path = `${prefix}/${Date.now()}-${safe}`;
    const up = await supabase.storage.from("uploads").upload(path, file, { upsert: true, contentType: file.type || undefined });
    if (up.error) { toast("Upload failed", up.error.message); return null; }
    return up.data.path;
  }

  /* ---------- vendors (onboard → screen → award-ready) ---------- */
  async function createVendor(v: { name: string; category: string; country: string; kraPin: string; bank: string }) {
    const { data, error } = await supabase.rpc("create_vendor", {
      p_name: v.name, p_category: v.category || null, p_country: v.country || "Kenya",
      p_kra_pin: v.kraPin || null, p_bank: v.bank || null,
    });
    if (error) { toast("Vendor not added", error.message); return; }
    setVendorOpen(false);
    await loadFromDb();
    toast(data.name + " onboarded", "Screen for sanctions before a PO can be awarded");
  }
  async function screenVendor(name: string, result: "cleared" | "flagged", detail: string) {
    const { data, error } = await supabase.rpc("screen_vendor", { p_vendor_name: name, p_result: result, p_detail: detail || null });
    if (error) { toast("Screening failed", error.message); return; }
    await loadFromDb();
    toast(`${name} — ${result}`, result === "cleared" ? "Cleared for award" : "Flagged — cannot be awarded a PO");
  }

  /* ---------- goods received by quantity (SoD: receiver ≠ requester) ---------- */
  async function recordGrn(poRef: string, qtyReceived: number, note: string, overAction: string, photo?: File | null) {
    const photoPath = photo ? await uploadFile(`grn/${poRef}`, photo) : null;
    const { data, error } = await supabase.rpc("submit_grn", {
      p_po_ref: poRef, p_qty_received: qtyReceived, p_note: note || null,
      p_over_action: overAction || null, p_photo_path: photoPath,
    });
    if (error) { toast("GRN blocked", error.message); return; }
    setGrnFor(null);
    await loadFromDb();
    toast(`${data.id} recorded`, `${poRef} — ${data.received} of ${data.ordered} received${data.over ? " · over-delivery flagged" : ""}`);
  }

  /* ---------- payables: capture invoice → match → approve → pay ---------- */
  async function captureInvoice(v: { poRef: string; amount: number; invoiceNumber: string; invoiceDate: string; currency: string; wht: boolean }) {
    const { data, error } = await supabase.rpc("capture_ap_invoice", {
      p_po_ref: v.poRef, p_amount: v.amount, p_invoice_number: v.invoiceNumber || null,
      p_invoice_date: v.invoiceDate || null, p_currency: v.currency || "KES", p_wht: v.wht,
    });
    if (error) { toast("Invoice not captured", error.message); return; }
    setInvoiceFor(null);
    await loadFromDb();
    toast(`${data.id} captured`, data.match === "matched" ? "Three-way match clean — approve for payment" : "Held as an exception — check the match");
  }
  async function approveInvoice(invRef: string) {
    const { error } = await supabase.rpc("approve_ap_invoice", { p_inv_ref: invRef });
    if (error) { toast("Approval blocked", error.message); return; }
    await loadFromDb();
    toast(`${invRef} approved for payment`, "A different person from whoever captured it");
  }
  async function payInvoice(invRef: string, method: string) {
    const { data, error } = await supabase.rpc("pay_invoice", { p_inv_ref: invRef, p_method: method });
    if (error) { toast("Payment blocked", error.message); return; }
    await loadFromDb();
    toast(`${data.id} paid`, `${invRef} settled · net ${Math.round(data.net).toLocaleString()} · journal ${data.journal}`);
  }

  /* ---------- v2: PO amendment (re-approval beyond tolerance) ---------- */
  async function amendPo(poRef: string, amount: number, delivery: string, reason: string) {
    const { data, error } = await supabase.rpc("amend_po", {
      p_po_ref: poRef, p_new_amount: amount, p_new_delivery: delivery || null, p_reason: reason || null,
    });
    if (error) { toast("Amendment failed", error.message); return; }
    setPoAmendFor(null);
    await loadFromDb();
    toast(`${poRef} amended`, data.reapproval ? `+${data.deltaPct}% — routed for re-approval` : "Within tolerance — applied");
  }
  async function approvePoAmendment(poRef: string) {
    const { error } = await supabase.rpc("approve_po_amendment", { p_po_ref: poRef });
    if (error) { toast("Approval failed", error.message); return; }
    await loadFromDb();
    toast(`${poRef} amendment approved`, "Cleared to receive and invoice");
  }

  /* ---------- v2: vendor bank-detail change (callback verification) ---------- */
  async function requestBankChange(vendor: string, newBank: string) {
    const { error } = await supabase.rpc("request_vendor_bank_change", { p_vendor_name: vendor, p_new_bank: newBank });
    if (error) { toast("Change not requested", error.message); return; }
    setBankChangeFor(null);
    await loadFromDb();
    toast("Bank change pending", "Verify by callback before it takes effect — the old details stay in use until then");
  }
  async function approveBankChange(id: string, callbackNote: string) {
    const { error } = await supabase.rpc("approve_vendor_bank_change", { p_change_id: id, p_callback_note: callbackNote });
    if (error) { toast("Verification failed", error.message); return; }
    await loadFromDb();
    toast("Bank details verified", "New account is now on file");
  }

  /* ---------- v2: settings (approval & matching rules) ---------- */
  async function setAppConfig(key: string, value: number | boolean | string) {
    const { error } = await supabase.rpc("set_app_config", { p_key: key, p_value: value });
    if (error) { toast("Setting not saved", error.message); return; }
    setAppConfigState((prev) => ({ ...prev, [key]: value }));
    toast("Setting saved", `${key} = ${value}`);
  }

  /* ---------- settings: my profile, password, integrations, digest ---------- */
  async function updateMyProfile(v: { name: string; roleTitle: string; color: string }) {
    const { data, error } = await supabase.rpc("update_my_profile", { p_name: v.name, p_role_title: v.roleTitle, p_color: v.color });
    if (error) { toast("Profile not saved", error.message); return; }
    setMe(data as Me);
    await loadFromDb();   // refresh the roster so avatars/names update everywhere
    toast("Profile updated", "Your details are saved");
  }
  // Change the signed-in user's password. Returns an error string, or null on success.
  async function changePassword(password: string): Promise<string | null> {
    const { error } = await supabase.auth.updateUser({ password });
    if (error) return error.message;
    toast("Password changed", "Use your new password next time you sign in");
    return null;
  }
  async function refreshOAuthStatus() {
    const { data } = await supabase.rpc("oauth_status");
    if (data) setOauthStatus(data as OAuthStatus);
  }
  // Validate + vault an Anthropic key server-side. Returns an error string, or null on success.
  async function connectClaude(key: string): Promise<string | null> {
    try {
      const res = await fetch("/api/connect-claude", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${session?.access_token ?? ""}` },
        body: JSON.stringify({ key }),
      });
      const j = await res.json();
      if (!res.ok) return j.error || "Couldn't connect Claude";
      await refreshOAuthStatus();
      toast("Claude connected", "AI features can now use your Anthropic key");
      return null;
    } catch (e: any) { return e.message || "Network error"; }
  }
  async function sendMyDigest() {
    try {
      const res = await fetch("/api/digest?me=1", { method: "POST", headers: { Authorization: `Bearer ${session?.access_token ?? ""}` } });
      const j = await res.json();
      if (!res.ok) { toast("Digest not sent", j.error || "Try again"); return; }
      toast("Digest sent", `Check ${me?.email ?? "your inbox"} — sent via Gmail`);
    } catch (e: any) { toast("Digest not sent", e.message || "Network error"); }
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
    await loadFromDb();
    toast(si.id + " issued to " + cust, "Filed to eTIMS · total KES " + si.tot.toLocaleString());
  }
  async function recordReceipt(invRef: string, amount: number, method: string) {
    const { data, error } = await supabase.rpc("record_ar_receipt", { p_inv_ref: invRef, p_amount: amount, p_method: method });
    if (error) { toast("Receipt not recorded", error.message); return; }
    setReceiptFor(null);
    await loadFromDb();
    toast(`${invRef} settled`, `Collection posted · journal ${data.journal}`);
  }

  /* ---------- won deal → project ---------- */
  async function createProjectFromEng(id: string) {
    const b = liveEng(id);
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
  async function createProject(v: { name: string; funder: string; budgetAmount: number; startDate: string; endDate: string; team: string; status: string; location: string }) {
    const { data, error } = await supabase.rpc("create_project", {
      p_name: v.name, p_funder: v.funder || null, p_budget_amount: v.budgetAmount || 0,
      p_start_date: v.startDate || null, p_end_date: v.endDate || null,
      p_team: v.team || null, p_status: v.status || null, p_location: v.location || null,
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
  // Edit a project you created (or any project if you have full projects access).
  async function updateProject(id: string, v: { funder: string; budgetAmount: number; startDate: string; endDate: string; team: string; status: string; location: string }) {
    const { data, error } = await supabase.rpc("update_project", {
      p_id: id, p_funder: v.funder || null, p_budget_amount: v.budgetAmount || 0,
      p_start_date: v.startDate || null, p_end_date: v.endDate || null,
      p_team: v.team || null, p_status: v.status || null, p_location: v.location || null,
    });
    if (error) { toast("Couldn't save changes", error.message); return; }
    const name = data.name as string;
    setProjectDetails((prev) => ({ ...prev, [name]: data.detail as ProjectDetail }));
    setProjectEdit(null);
    toast(name + " updated", "Changes saved");
  }
  // Delete a project you created (or any project if you have full projects access).
  async function deleteProject(name: string) {
    const id = projectDetails[name]?.id;
    if (!id) { toast("Project not found", "Reload and try again"); return; }
    const { error } = await supabase.rpc("delete_project", { p_id: id });
    if (error) { toast("Couldn't delete project", error.message); return; }
    setProjectDetails((prev) => { const next = { ...prev }; delete next[name]; return next; });
    setExtraProjects((prev) => prev.filter((p) => p.name !== name));
    if (projectName === name) setProjectName(null);
    toast(name + " deleted", "The project and its records were removed");
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
  const addMilestone = (projectId: string, title: string, amount: number, startDate: string, endDate: string, status = "todo") =>
    projectRpc("add_project_milestone", {
      p_project_id: projectId, p_title: title, p_amount: amount || 0,
      p_start_date: startDate || null, p_end_date: endDate || null, p_status: status,
    }, "Milestone added", title);
  const setMilestoneStatus = (milestoneId: string, status: string) =>
    projectRpc("set_milestone_status", { p_milestone_id: milestoneId, p_status: status }, "Milestone updated", "Status saved");
  const addDrawdown = (projectId: string, title: string, amount: string, status = "Requested") =>
    projectRpc("add_project_drawdown", { p_project_id: projectId, p_title: title, p_amount_txt: amount, p_status: status }, "Drawdown added", `${title} · ${amount}`);
  const setDrawdownStatus = (drawdownId: string, status: string) =>
    projectRpc("set_drawdown_status", { p_drawdown_id: drawdownId, p_status: status }, "Drawdown updated", status);
  const logFieldActivity = (projectId: string, kind: string, county: string, note: string) =>
    projectRpc("log_field_activity", { p_project_id: projectId, p_kind: kind, p_county: county || null, p_note: note || null }, "Field activity logged", "Recorded against the project");
  // Assign someone (free-text name/phone/email) to check a site — a project must be picked by name.
  async function createFieldActivity(v: { projectName: string; assignee: string; phone: string; email: string; date: string; note: string }) {
    const projectId = projectDetails[v.projectName]?.id;
    if (!projectId) { toast("Pick a project", "Choose which project this field activity is for"); return; }
    const { data, error } = await supabase.rpc("create_field_activity", {
      p_project_id: projectId, p_assignee: v.assignee, p_phone: v.phone || null,
      p_email: v.email || null, p_activity_on: v.date || null, p_note: v.note || null,
    });
    if (error) { toast("Field activity not saved", error.message); return; }
    setFieldActivityOpen(false);
    // Email the assignee that they've been assigned (in-app bell already written by the RPC for
    // staff). Best-effort — a mail failure never blocks the save. Mirrors createEngagement's notify.
    if (v.email) {
      const proj = data?.project ?? v.projectName;
      const where = data?.location ? ` in ${data.location}` : "";
      const by = data?.by ?? me?.name ?? "A teammate";
      const when = v.date ? new Date(v.date).toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric" }) : "";
      const taskLine = v.note ? `\n\nTask: ${v.note}` : "";
      try {
        await fetch("/api/notify", {
          method: "POST",
          headers: { "Content-Type": "application/json", Authorization: `Bearer ${session?.access_token ?? ""}` },
          body: JSON.stringify({
            to: v.email,
            subject: `You've been assigned a field task — ${proj}`,
            text: `Hi ${v.assignee},\n\n${by} has assigned you a field task on ${proj}${where}${when ? ` (${when})` : ""}.${taskLine}\n\nOpen Jikoni Tool → Projects & Programmes → Field activity to see the details.`,
            html: `<p>Hi ${v.assignee},</p><p><strong>${by}</strong> has assigned you a field task on <strong>${proj}</strong>${where}${when ? ` (${when})` : ""}.</p>${v.note ? `<p><strong>Task:</strong> ${v.note}</p>` : ""}<p>Open <strong>Jikoni Tool → Projects &amp; Programmes → Field activity</strong> to see the details.</p>`,
          }),
        });
      } catch { /* email is best-effort; the in-app notification still lands for staff */ }
    }
    await loadFromDb();
    toast("Field activity assigned", `${v.assignee} · ${v.projectName}${v.email ? " · emailed" : ""}`);
  }
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
  async function addEmployee(v: { name: string; email: string; roleTitle: string; contractType: string; startDate: string; grossSalary: number; kra: string; nssf: string; shif: string; bank: string; contractEnd: string }) {
    const { data, error } = await supabase.rpc("add_employee", {
      p_name: v.name, p_email: v.email, p_role_title: v.roleTitle || null, p_contract_type: v.contractType,
      p_start_date: v.startDate || null, p_gross_salary: v.grossSalary, p_kra: v.kra || null,
      p_nssf: v.nssf || null, p_shif: v.shif || null, p_bank: v.bank || null,
      p_contract_end: v.contractType !== "permanent" ? (v.contractEnd || null) : null,
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
  async function createEngagement(name: string, owner: string, pipeline: "up" | "down", dueKey: string, note: string, taggedEmail: string, file?: File | null) {
    // stage isn't collected on the form — the RPC starts new engagements at the top of the
    // funnel; the note ("where we are on the discussion") seeds the engagement's update log.
    // A tagged teammate gets an in-app notification (RPC) + an email (below).
    const { data, error } = await supabase.rpc("create_engagement", {
      p_name: name, p_stage: null, p_owner_name: owner, p_pipeline: pipeline,
      p_next_action: note.trim() || null, p_due_key: dueKey, p_tagged_email: taggedEmail || null,
    });
    if (error) { toast("Engagement not created", error.message); return; }
    if (file) await uploadEngagementDoc(data.id, file, owner);
    setEngFormOpen(false);
    // Email the tagged teammate (the in-app notification was already written by the RPC).
    if (data.taggedEmail) {
      const tagged = members.find((m) => m.email === data.taggedEmail);
      try {
        await fetch("/api/notify", {
          method: "POST",
          headers: { "Content-Type": "application/json", Authorization: `Bearer ${session?.access_token ?? ""}` },
          body: JSON.stringify({
            to: data.taggedEmail,
            subject: `You were tagged on ${data.id}`,
            text: `Hi ${tagged?.name ?? ""},\n\n${me?.name ?? "A teammate"} tagged you on engagement ${data.id} — ${name}.\n\nOpen Jikoni Tool → Partnerships CRM to take a look.`,
            html: `<p>Hi ${tagged?.name ?? ""},</p><p><strong>${me?.name ?? "A teammate"}</strong> tagged you on engagement <strong>${data.id}</strong> — ${name}.</p><p>Open <strong>Jikoni Tool → Partnerships CRM</strong> to take a look.</p>`,
          }),
        });
      } catch { /* email is best-effort; the in-app notification still lands */ }
    }
    await loadFromDb();
    toast(`${data.id} created`, `${name} · ${owner}${data.taggedEmail ? " · teammate tagged" : ""}${file ? " · document attached" : ""}`);
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
  async function createPartner(v: { name: string; type: string; country: string; owner: string; status: string; contactName: string; email: string; phone: string }) {
    const { error } = await supabase.rpc("create_partner", {
      p_name: v.name, p_type: v.type, p_country: v.country, p_owner_name: v.owner, p_status: v.status,
      p_contact_name: v.contactName || null, p_email: v.email || null, p_phone: v.phone || null,
    });
    if (error) { toast("Partner not added", error.message); return; }
    setPartnerOpen(false);
    await loadFromDb();
    toast(v.name + " added to the registry", `${v.type} · ${v.country} · ${v.owner}`);
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

  /* ---------- in-app notifications ---------- */
  // Flip seen locally for snappy UI, then persist (pass ids to mark specific ones, none = all).
  async function markNotificationsSeen(ids?: string[]) {
    if (!notifications.some((n) => !n.seen && (!ids || ids.includes(n.id)))) return;
    setNotifications((prev) => prev.map((n) => (!ids || ids.includes(n.id)) ? { ...n, seen: true } : n));
    await supabase.rpc("mark_notifications_seen", { p_ids: ids ?? null });
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
  async function createStockItem(v: { name: string; category: string; unit: string; unitCost: number; reorderLevel: number; reorderQty: number; budgetCode: string; supplier: string }) {
    // SKU is auto-generated server-side (the form no longer asks for one); the
    // budget code is auto-assigned by the caller (the form no longer asks either)
    const { data, error } = await supabase.rpc("create_stock_item", {
      p_name: v.name, p_category: v.category || null, p_unit: v.unit || "unit",
      p_unit_cost: v.unitCost, p_reorder_level: v.reorderLevel, p_reorder_qty: v.reorderQty,
      p_budget_code: v.budgetCode || null, p_supplier: v.supplier || null,
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
  async function registerAsset(v: { name: string; category: string; quantity: number; acquired: string }) {
    const { data, error } = await supabase.rpc("register_asset", {
      p_name: v.name, p_category: v.category || null, p_quantity: v.quantity, p_acquired: v.acquired,
    });
    if (error) { toast("Asset not registered", error.message); return; }
    setAssetOpen(false);
    await loadFromDb();
    toast(data.id + " registered", `${v.name} — ${v.quantity} on the register`);
  }
  async function assignAsset(assetRef: string, employee: string, qty: number) {
    const { data, error } = await supabase.rpc("assign_asset", { p_asset_ref: assetRef, p_employee: employee, p_qty: qty });
    if (error) { toast("Couldn't assign asset", error.message); return; }
    await loadFromDb();
    toast(`${data.asset} assigned`, `${data.qty} to ${data.employee}`);
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
    taskOpen, taskMode, openTask: (mode: "personal" | "assign" = "personal") => { setTaskMode(mode); setTaskOpen(true); },
    closeTask: () => setTaskOpen(false), createTask, addSubtask, toggleSubtask, setTaskDone,
    engId, vendorName, projectName, accessEmail,
    openEng, closeEng: () => setEngId(null),
    openVendor: (n) => setVendorName(n), closeVendor: () => setVendorName(null),
    openProject: (n) => setProjectName(n), closeProject: () => setProjectName(null),
    openAccess: (e) => setAccessEmail(e), closeAccess: () => setAccessEmail(null),
    xEng, xProject, xTab, xView, openRecord,
    perms, saveAccess: saveAccessFn,
    me,
    signOut: async () => { await supabase.auth.signOut(); setMe(null); setMembers([]); },
    members,
    inviteOpen, setInviteOpen, sendInvite,
    reqOpen, openReq: () => setReqOpen(true), closeReq: () => setReqOpen(false),
    reqs, submitReq, submitReqFinal, withdrawReq, approvePR,
    costCentres, createCostCentre,
    poFor, raisePO, closePO: () => setPoFor(null), submitPO, newPOs,
    poPickerOpen, openPoPicker: () => setPoPickerOpen(true), closePoPicker: () => setPoPickerOpen(false),
    vendors, poRows, grns,
    vendorOpen, openVendorForm: () => setVendorOpen(true), closeVendorForm: () => setVendorOpen(false), createVendor, screenVendor,
    grnFor, openGrn: (po: PORow) => setGrnFor(po), closeGrn: () => setGrnFor(null), recordGrn,
    invOpen, openInvoice: () => setInvOpen(true), closeInvoice: () => setInvOpen(false),
    submitInvoice, newInvoices,
    apInvoices, payments, journals, accounts,
    invoiceFor, openCaptureInvoice: (po: PORow) => setInvoiceFor(po), closeCaptureInvoice: () => setInvoiceFor(null), captureInvoice, approveInvoice, payInvoice,
    receiptFor, openReceipt: (inv: NewInvoice) => setReceiptFor(inv), closeReceipt: () => setReceiptFor(null), recordReceipt,
    poAmendFor, openPoAmend: (po: PORow) => setPoAmendFor(po), closePoAmend: () => setPoAmendFor(null), amendPo, approvePoAmendment,
    bankChangeFor, openBankChange: (v: string) => setBankChangeFor(v), closeBankChange: () => setBankChangeFor(null), requestBankChange, approveBankChange, bankChanges,
    appConfig, setAppConfig, audit,
    settingsTab, setSettingsTab, updateMyProfile, changePassword,
    oauthStatus, refreshOAuthStatus, connectClaude, sendMyDigest,
    projectDetails, extraProjects, engToProject, projectToEng, createProjectFromEng,
    projectFormOpen, openProjectForm: () => setProjectFormOpen(true), closeProjectForm: () => setProjectFormOpen(false), createProject,
    projectEdit, openProjectEdit: (name: string) => setProjectEdit(name), closeProjectEdit: () => setProjectEdit(null), updateProject, deleteProject,
    addMilestone, setMilestoneStatus, addDrawdown, setDrawdownStatus, logFieldActivity, setProjectState,
    fieldActivities,
    fieldActivityOpen, openFieldActivity: () => setFieldActivityOpen(true), closeFieldActivity: () => setFieldActivityOpen(false), createFieldActivity,
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
    notifications, markNotificationsSeen,
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
    registerAsset, assignAsset, disposeAsset, runDepreciation,
  };

  if (!authReady) return null;
  // an invitee with a session but a pending password sees the set-password screen first
  if (session && needPassword) return <SetPassword onDone={() => setNeedPassword(false)} />;
  return <Ctx.Provider value={api}>{session ? children : <LoginGate />}</Ctx.Provider>;
}

export { roleTemplates };
