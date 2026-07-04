// App-wide state + interaction logic, ported from the prototype's script block.
// One provider holds navigation, entity scope, toasts, drawers, modals and the
// mutable demo records (tasks, requisitions, POs, invoices, permissions, projects).
import React, { createContext, useContext, useRef, useState } from "react";
import {
  Entity, WeekTask, initialMyWeek, initialPerms, Perms, roleTemplates,
  initialProjectDetails, ProjectDetail, initialEngToProject, initialProjectToEng,
  findEng, users, reqRouting, reqBudgetState,
} from "./data";

export interface Toast { id: number; title: string; sub?: string }
export interface Req { id: string; item: string; amt: number; code: string; chip: string; chipTxt: string; status: "await" | "md" | "approved" | "po" }
export interface NewPO { id: string; vendor: string; amt: number; delivery: string }
export interface NewInvoice { cust: string; id: string; tot: number; pillCls: string; pillTxt: string }

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
}

const Ctx = createContext<AppApi>(null!);
export const useApp = () => useContext(Ctx);

let toastSeq = 0;
let nextTask = 210;
let nextPR = 208;
let nextPO = 61;
let nextSI = 188;

export function AppProvider({ children }: { children: React.ReactNode }) {
  const [view, setView] = useState("home");
  const [tabs, setTabs] = useState<Record<string, string>>({
    finance: "f-over", procurement: "p-over", hr: "h-over",
    projects: "pr-over", crm: "cr-over", compliance: "c-policies",
  });
  const mainRef = useRef<HTMLElement>(null);

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

  function toast(title: string, sub?: string) {
    const id = ++toastSeq;
    setToasts((t) => [...t, { id, title, sub }]);
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), 3100);
  }

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
  function saveTask(title: string, owner: string, due: string, link: string) {
    const dueMap: Record<string, [string, string]> = { today: ["today", "Today"], week: ["week", "This week"], nweek: ["week", "Next week"] };
    const d = dueMap[due];
    const id = "TSK-" + ++nextTask;
    setMyWeek((w) => [{ id, t: title, s: link, o: owner, p: d[0], pl: d[1] }, ...w]);
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

  function saveAccessFn(email: string, p: Perms) {
    const u = users.find((x) => x.e === email);
    setPerms((prev) => ({ ...prev, [email]: { ...p } }));
    setAccessEmail(null);
    toast("Access updated for " + (u?.n || email), "Recorded in the audit log with your name and time");
  }

  /* ---------- requisition → PO chain ---------- */
  function submitReq(item: string, amt: number, code: string) {
    const b = reqBudgetState(code, amt);
    const r = reqRouting(amt)!;
    const id = "PR-" + ++nextPR;
    const status: Req["status"] = r.st === "Approved" ? "approved" : r.st === "MD review" ? "md" : "await";
    setReqs((prev) => [{ id, item, amt, code, chip: b.chip, chipTxt: b.chipTxt, status }, ...prev]);
    setReqOpen(false);
    toast(id + " raised · " + r.label, r.who.charAt(0).toUpperCase() + r.who.slice(1));
  }
  function approvePR(id: string) {
    setReqs((prev) => prev.map((r) => (r.id === id ? { ...r, status: "approved" } : r)));
    toast(id + " approved", "Ready to raise a purchase order");
  }
  function raisePO(id: string) {
    const r = reqs.find((x) => x.id === id);
    if (r) setPoFor(r);
  }
  function submitPO(vendor: string, delivery: string) {
    if (!poFor) return;
    const id = "PO-" + ++nextPO;
    setNewPOs((prev) => [{ id, vendor, amt: poFor.amt, delivery: delivery.split(" · ")[1] || "—" }, ...prev]);
    setReqs((prev) => prev.map((r) => (r.id === poFor.id ? { ...r, status: "po" } : r)));
    setPoFor(null);
    toast(id + " issued to " + vendor, "Draft PO created — awaiting delivery & goods-received note");
  }

  /* ---------- sales invoice ---------- */
  function submitInvoice(cust: string, _desc: string, net: number, dueSel: string) {
    const tot = Math.round(net * 1.16);
    const id = "SI-0" + ++nextSI;
    const duePill = dueSel === "today" ? ["today", "On receipt"] : dueSel === "week30" ? ["week", "30 days"] : ["week", "14 days"];
    setNewInvoices((prev) => [{ cust, id, tot, pillCls: duePill[0], pillTxt: duePill[1] }, ...prev]);
    setInvOpen(false);
    toast(id + " issued to " + cust, "Filed to eTIMS · total KES " + tot.toLocaleString());
  }

  /* ---------- won deal → project ---------- */
  function createProjectFromEng(id: string) {
    const b = findEng(id);
    if (!b) return;
    const name = b.n.replace(/ \(.*\)/, "") + " — deployment";
    if (!projectDetails[name]) {
      setProjectDetails((prev) => ({
        ...prev,
        [name]: {
          funder: b.n, status: "Setup", budget: "TBD", spent: "KES 0", pct: "0%", timeline: "2026", team: b.o,
          milestones: [
            { t: "Project set up from won deal", s: "done" },
            { t: "Budget & funder agreement", s: "now" },
            { t: "Deployment", s: "todo" },
          ],
          drawdowns: [], reporting: "To be set", field: "—",
          docs: ["Signed agreement (from " + id + ")"],
        },
      }));
      setExtraProjects((prev) => [...prev, { name, funder: b.n }]);
      setEngToProject((prev) => ({ ...prev, [id]: name }));
      setProjectToEng((prev) => ({ ...prev, [name]: id }));
    }
    toast("Project created from " + id, b.n + " is now a project — costs, milestones and drawdowns track here");
    xProject(name);
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
    inviteOpen, setInviteOpen,
    reqOpen, openReq: () => setReqOpen(true), closeReq: () => setReqOpen(false),
    reqs, submitReq, approvePR,
    poFor, raisePO, closePO: () => setPoFor(null), submitPO, newPOs,
    invOpen, openInvoice: () => setInvOpen(true), closeInvoice: () => setInvOpen(false),
    submitInvoice, newInvoices,
    projectDetails, extraProjects, engToProject, projectToEng, createProjectFromEng,
  };

  return <Ctx.Provider value={api}>{children}</Ctx.Provider>;
}

export { roleTemplates };
