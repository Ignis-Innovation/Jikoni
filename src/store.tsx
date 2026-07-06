// App-wide state + interaction logic. The AppApi shape is unchanged from the
// prototype — only the implementation changed (PRD Phase 0/1): local useState
// mutation became Supabase queries/RPCs returning data in the same shape.
// Every mutation lands in a Postgres RPC that enforces the document chain,
// budget commitment, approval routing, sanctions gate and writes the audit log.
import React, { createContext, useContext, useEffect, useRef, useState } from "react";
import type { Session } from "@supabase/supabase-js";
import { supabase } from "./lib/supabase";
import { LoginGate } from "./components/login";
import {
  Entity, WeekTask, initialMyWeek, initialPerms, Perms, roleTemplates, budgetLines,
  initialProjectDetails, ProjectDetail, initialEngToProject, initialProjectToEng,
  findEng, users,
} from "./data";

export interface Toast { id: number; title: string; sub?: string }
export interface Req { id: string; item: string; amt: number; code: string; chip: string; chipTxt: string; status: "await" | "md" | "approved" | "po" }
export interface NewPO { id: string; vendor: string; amt: number; delivery: string }
export interface NewInvoice { cust: string; id: string; tot: number; pillCls: string; pillTxt: string }

/* ---------- Inventory (Phase 2 — the one net-new module) ---------- */
export interface StockItem { sku: string; name: string; category: string; unit: string; unitCost: number; reorderLevel: number; onHand: number; autoReq: string | null }
export interface StockMovement { when: string; sku: string; type: string; qty: number; from: string | null; to: string | null; source: string | null; note: string | null }
export interface DispatchRow { id: string; project: string | null; destination: string; lines: { sku: string; name: string; qty: number }[]; state: string }
export interface AssetRow { id: string; name: string; category: string; cost: number; accumDep: number; nbv: number; acquired: string; state: string }
export interface InventoryData { items: StockItem[]; locations: string[]; movements: StockMovement[]; dispatches: DispatchRow[]; assets: AssetRow[] }
export type StockModalMode = "receive" | "issue" | "dispatch" | null;

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

  inventory: InventoryData | null;
  stockModal: StockModalMode;
  openStockModal: (m: Exclude<StockModalMode, null>) => void;
  closeStockModal: () => void;
  receiveStock: (sku: string, location: string, qty: number) => void;
  issueStock: (sku: string, location: string, qty: number, reason: string) => void;
  createDispatch: (project: string, destination: string, sku: string, qty: number) => void;
}

const Ctx = createContext<AppApi>(null!);
export const useApp = () => useContext(Ctx);

let toastSeq = 0;
const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

export function AppProvider({ children }: { children: React.ReactNode }) {
  const [view, setView] = useState("home");
  const [tabs, setTabs] = useState<Record<string, string>>({
    finance: "f-over", procurement: "p-over", inventory: "i-over", hr: "h-over",
    projects: "pr-over", crm: "cr-over", compliance: "c-policies",
  });
  const mainRef = useRef<HTMLElement>(null);

  const [session, setSession] = useState<Session | null>(null);
  const [authReady, setAuthReady] = useState(false);
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

  const [inventory, setInventory] = useState<InventoryData | null>(null);
  const [stockModal, setStockModal] = useState<StockModalMode>(null);

  function toast(title: string, sub?: string) {
    const id = ++toastSeq;
    setToasts((t) => [...t, { id, title, sub }]);
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), 3100);
  }

  /* ---------- auth session (Phase 0: "who is logged in") ---------- */
  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => { setSession(data.session); setAuthReady(true); });
    const { data: sub } = supabase.auth.onAuthStateChange((_e, s) => setSession(s));
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
    setInventory(data.inventory as InventoryData);
    // sync the req modal's live budget preview with the ledger (same object the modal imports)
    for (const [k, v] of Object.entries(data.budgetLines as Record<string, { b: number; u: number }>)) {
      if (budgetLines[k]) { budgetLines[k].b = v.b; budgetLines[k].u = v.u; }
    }
    return true;
  }
  useEffect(() => {
    if (!session) return;
    loadFromDb();
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

  /* ---------- invite (Phase 5): least-privilege template + audit; auth account
     is provisioned by scripts/provision-invites.mjs which emails the link ---------- */
  async function sendInvite(name: string, email: string, role: string) {
    const { error } = await supabase.rpc("invite_user", { p_name: name, p_email: email, p_role_key: role });
    if (error) { toast("Invite failed", error.message); return; }
    setInviteOpen(false);
    await loadFromDb();
    toast("Invite sent to " + name, "Access set from the " + role + " template — they'll set a password and enrol in 2FA");
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
    inventory, stockModal,
    openStockModal: (m) => setStockModal(m), closeStockModal: () => setStockModal(null),
    receiveStock, issueStock, createDispatch,
  };

  if (!authReady) return null;
  return <Ctx.Provider value={api}>{session ? children : <LoginGate />}</Ctx.Provider>;
}

export { roleTemplates };
