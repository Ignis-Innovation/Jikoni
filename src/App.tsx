import React, { useEffect, useRef, useState } from "react";
import { AppProvider, useApp } from "./store";
import { flagColors, canManageUsers, moduleLevel, gatedViews } from "./data";
import { moduleLabels, subnavs } from "./nav";
import {
  BrandMark, Chev, HomeI, FinanceI, ProcureI, HrI, PortalI, FlameI,
  ProjectsI, RaiseI, CrmI, ComplianceI, UsersI, SettingsI, SearchI, PlusI, BellI, BoxI, LogoutI,
} from "./components/icons";
import { Toasts } from "./components/ui";
import HomeView from "./views/Home";
// Every module view except Home is code-split: the initial bundle only carries the
// shell + Home, and each module's chunk is fetched the first time it's opened.
const DeployView = React.lazy(() => import("./views/Deploy"));
const ReadinessView = React.lazy(() => import("./views/Readiness"));
const RaiseView = React.lazy(() => import("./views/Raise"));
const ProcurementView = React.lazy(() => import("./views/Procurement"));
const InventoryView = React.lazy(() => import("./views/Inventory"));
const ProjectsView = React.lazy(() => import("./views/Projects"));
const CrmView = React.lazy(() => import("./views/Crm"));
const FinanceView = React.lazy(() => import("./views/Finance"));
const HrView = React.lazy(() => import("./views/Hr"));
const StaffPortalView = React.lazy(() => import("./views/StaffPortal"));
const ComplianceView = React.lazy(() => import("./views/Compliance"));
const UsersView = React.lazy(() => import("./views/Users"));
const SettingsView = React.lazy(() => import("./views/Settings"));
import { EngDrawer, VendorDrawer, ProjectDrawer, AccessDrawer, ProformaDrawer } from "./components/drawers";
import { InviteModal, TaskModal, ReqModal, POModal, PoPickerModal, InvoiceModal, ProformaModal, LeaveModal, EngagementModal, EngUpdateModal, PartnerModal, OpportunityModal, RiskModal, PolicyModal, DocumentModal, ContractModal, ProjectModal, FieldActivityModal, VendorModal, GrnModal, CaptureInvoiceModal, ReceiptModal, PoAmendModal, BankChangeModal } from "./components/modals";

const views: Record<string, React.ComponentType> = {
  home: HomeView, deploy: DeployView, readiness: ReadinessView, raise: RaiseView,
  procurement: ProcurementView, inventory: InventoryView, projects: ProjectsView,
  crm: CrmView, finance: FinanceView,
  hr: HrView, staffportal: StaffPortalView, compliance: ComplianceView,
  users: UsersView, settings: SettingsView,
};

function NavItem({ v, icon, label, badge, badgeCls }: { v: string; icon: React.ReactNode; label: string; badge?: string; badgeCls?: string }) {
  const { view, go } = useApp();
  return (
    <div className={`nav-item ${view === v ? "active" : ""}`} onClick={() => go(v)}>
      {icon}
      {label}
      {badge && <span className={`badge ${badgeCls || ""}`}>{badge}</span>}
    </div>
  );
}

function NavModule({ v, icon, badge, badgeCls, collapsed, setCollapsed }: {
  v: string; icon: React.ReactNode; badge?: string; badgeCls?: string;
  collapsed: boolean; setCollapsed: (b: boolean) => void;
}) {
  const { view, tabs, go, goTab } = useApp();
  const active = view === v;
  const expanded = active && !collapsed;
  return (
    <>
      <div
        className={`nav-item has-sub ${active ? "active" : ""} ${expanded ? "expanded" : ""}`}
        onClick={() => {
          if (active && !collapsed) setCollapsed(true);
          else { go(v); setCollapsed(false); }
        }}
      >
        {icon}
        <span className="nl">{moduleLabels[v]}</span>
        {badge && <span className={`badge ${badgeCls || ""}`}>{badge}</span>}
        <Chev />
      </div>
      <div className={`subnav ${expanded ? "open" : ""}`}>
        {subnavs[v].map((s) => (
          <div key={s.t} className={`subnav-item ${tabs[v] === s.t ? "on" : ""}`} onClick={() => goTab(v, s.t)}>
            {s.l}
          </div>
        ))}
      </div>
    </>
  );
}

function Sidebar() {
  const { view, me, perms, notifications, markNotificationsSeen, signOut, go, setSettingsTab, mobileNavOpen, setMobileNavOpen } = useApp();
  const initial = (me?.name || "?").trim()[0]?.toUpperCase() || "?";
  const openProfile = () => { setSettingsTab("s-profile"); go("settings"); };
  const canUsers = canManageUsers(perms, me?.email);
  // A module appears in the nav only if this user has at least View (level >= 1) on it.
  // Level 0 (None) hides it here and blocks direct access in Shell below.
  const can = (m: string) => moduleLevel(perms, me?.email, m) >= 1;
  const canHr = can("hr");
  // Per-module badge = unseen notifications routed to that module (link_view === module id;
  // the Home item carries 'home', where task assignments land). Shows the approver/assignee
  // there's something new to check, and clears when they open the module (below).
  const badge = (lv: string) => { const n = notifications.filter((x) => !x.seen && x.linkView === lv).length; return n ? String(n) : undefined; };
  // per-module "collapsed" override so an active module can be folded shut
  const [collapsedFor, setCollapsedFor] = useState<string | null>(null);
  const collapsed = (v: string) => collapsedFor === v;
  const setCollapsed = (v: string) => (b: boolean) => setCollapsedFor(b ? v : null);
  useEffect(() => { setCollapsedFor(null); }, [view]);
  // Opening a module counts as "checked" — clear that module's unseen notifications so the
  // nav badge (and the matching bell items) drop. The pending item itself stays in its tab.
  useEffect(() => {
    const ids = notifications.filter((n) => !n.seen && n.linkView === view).map((n) => n.id);
    if (ids.length) markNotificationsSeen(ids);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [view]);

  return (
    <>
      {mobileNavOpen && <div className="nav-backdrop" onClick={() => setMobileNavOpen(false)} />}
      <aside className={`sidebar ${mobileNavOpen ? "open" : ""}`}>
      <div className="brand">
        <div className="mark"><BrandMark /></div>
        <div>
          <div className="name">Jikoni Tool</div>
          <div className="sub">Operations Suite</div>
        </div>
      </div>

      <div className="entity" style={{ cursor: "default" }}>
        <div className="lbl">Entity / Country</div>
        <div className="val">
          <span className="flag">
            {flagColors.Kenya.map((c, i) => <span key={i} style={{ flex: 1, background: c }} />)}
          </span>
          <span>Kenya</span>
        </div>
      </div>

      <nav className="nav">
        <div className="nav-group">Overview</div>
        <NavItem v="home" icon={<HomeI />} label="Home" badge={badge("home")} />

        {(can("finance") || can("procurement") || can("inventory")) && <div className="nav-group">Finance &amp; Operations</div>}
        {can("finance") && <NavModule v="finance" icon={<FinanceI />} badge={badge("finance")} collapsed={collapsed("finance")} setCollapsed={setCollapsed("finance")} />}
        {can("procurement") && <NavModule v="procurement" icon={<ProcureI />} badge={badge("procurement")} collapsed={collapsed("procurement")} setCollapsed={setCollapsed("procurement")} />}
        {can("inventory") && <NavModule v="inventory" icon={<BoxI />} badge={badge("inventory")} collapsed={collapsed("inventory")} setCollapsed={setCollapsed("inventory")} />}

        <div className="nav-group">People</div>
        {canHr && <NavModule v="hr" icon={<HrI />} badge={badge("hr")} collapsed={collapsed("hr")} setCollapsed={setCollapsed("hr")} />}
        <NavModule v="staffportal" icon={<PortalI />} badge={badge("staffportal")} collapsed={collapsed("staffportal")} setCollapsed={setCollapsed("staffportal")} />

        {(can("deploy") || can("projects")) && <div className="nav-group">Deployment</div>}
        {can("deploy") && <NavItem v="deploy" icon={<FlameI />} label="Deployment & Carbon" />}
        {can("projects") && <NavModule v="projects" icon={<ProjectsI />} badge={badge("projects")} collapsed={collapsed("projects")} setCollapsed={setCollapsed("projects")} />}

        {can("crm") && <><div className="nav-group">Growth</div>
        <NavModule v="crm" icon={<CrmI />} badge={badge("crm")} collapsed={collapsed("crm")} setCollapsed={setCollapsed("crm")} /></>}

        {can("compliance") && <><div className="nav-group">Governance</div>
        <NavModule v="compliance" icon={<ComplianceI />} badge={badge("compliance")} collapsed={collapsed("compliance")} setCollapsed={setCollapsed("compliance")} /></>}

        <div className="nav-group">Administration</div>
        {canUsers && <NavItem v="users" icon={<UsersI />} label="User Management" />}
        <NavItem v="settings" icon={<SettingsI />} label="Settings" />
      </nav>

      <div className="me">
        <div className="av" style={{ background: me?.color || undefined, cursor: "pointer" }} onClick={openProfile} title="Edit profile">{initial}</div>
        <div className="info" onClick={openProfile} style={{ cursor: "pointer" }} title="Edit profile">
          <div className="n">{me?.name || "…"}</div>
          <div className="r">{me?.roleTitle || "Member"}</div>
        </div>
        <button className="logout" title="Log out" aria-label="Log out" onClick={() => signOut()}>
          <LogoutI />
        </button>
      </div>
    </aside>
    </>
  );
}

function Topbar() {
  const { toast, openTask, me, setMobileNavOpen } = useApp();
  const firstName = (me?.name || "").trim().split(/\s+/)[0] || "there";
  const [now, setNow] = useState(new Date());
  useEffect(() => {
    const iv = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(iv);
  }, []);
  const h = now.getHours();
  const greet = h < 12 ? "Good morning" : h < 17 ? "Good afternoon" : "Good evening";
  const dateline =
    now.toLocaleDateString("en-GB", { weekday: "long", day: "numeric", month: "long" }) +
    " · " +
    now.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit", second: "2-digit" });

  return (
    <div className="topbar">
      <button className="iconbtn hamburger" onClick={() => setMobileNavOpen(true)} title="Menu" aria-label="Open menu">
        <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round"><path d="M4 6h16M4 12h16M4 18h16" /></svg>
      </button>
      <div className="greeting">
        <div className="g">{greet}, {firstName}</div>
        <div className="d">{dateline}</div>
      </div>
      <div className="live"><span className="dot" /> Live</div>
      <div className="search">
        <SearchI />
        <input
          placeholder="Search Jikoni…"
          onKeyDown={(e) => { if (e.key === "Enter") toast("Search", "Global search across every module"); }}
        />
      </div>
      <div className="iconbtn" onClick={() => openTask("personal")} title="Add task" style={{ fontWeight: 600 }}>
        <PlusI width={18} height={18} />
      </div>
      <NotifBell />
    </div>
  );
}

function NotifBell() {
  const { notifications, markNotificationsSeen, goTab, go } = useApp();
  const [open, setOpen] = useState(false);
  const unseen = notifications.filter((n) => !n.seen);
  function openNotif(n: { id: string; kind: string; linkView: string | null }) {
    markNotificationsSeen([n.id]);
    if (n.linkView === "crm") goTab("crm", "cr-eng");
    else if (n.linkView === "procurement") goTab("procurement", "p-req");
    else if (n.kind === "petty_cash_request") goTab("finance", "f-petty");   // approver → petty queue
    else if (n.linkView === "finance") goTab("finance", "f-ap");
    else if (n.linkView === "staffportal") go("staffportal");                 // requester → their portal
    setOpen(false);
  }
  return (
    <div style={{ position: "relative" }}>
      <div className="iconbtn" onClick={() => setOpen((o) => !o)} title="Notifications">
        {unseen.length > 0 && <span className="ping" />}
        <BellI width={18} height={18} />
      </div>
      {open && (
        <>
          <div style={{ position: "fixed", inset: 0, zIndex: 40 }} onClick={() => setOpen(false)} />
          <div style={{ position: "absolute", right: 0, top: "calc(100% + 8px)", width: 328, maxHeight: 420, overflowY: "auto", background: "#fff", border: "1px solid var(--line)", borderRadius: 12, boxShadow: "0 12px 32px rgba(0,0,0,.14)", zIndex: 41 }}>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "12px 14px", borderBottom: "1px solid var(--line)" }}>
              <strong style={{ fontSize: 13 }}>Notifications</strong>
              {unseen.length > 0 && <button className="btn" style={{ padding: "3px 8px", fontSize: 11 }} onClick={() => markNotificationsSeen()}>Mark all read</button>}
            </div>
            {notifications.length === 0 && <div style={{ padding: 16, color: "var(--ink-soft)", fontSize: 13 }}>Nothing yet — you're all caught up.</div>}
            {notifications.map((n) => (
              <div key={n.id} onClick={() => openNotif(n)} style={{ padding: "10px 14px", borderBottom: "1px solid var(--line)", cursor: "pointer", background: n.seen ? "#fff" : "#FCFAF6" }}>
                <div style={{ fontSize: 12.5, fontWeight: n.seen ? 400 : 600 }}>{n.title}</div>
                {n.body && <div style={{ fontSize: 11.5, color: "var(--ink-soft)", marginTop: 2 }}>{n.body}</div>}
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  );
}

function NoAccess() {
  return (
    <div className="vhead">
      <div>
        <h1>Restricted</h1>
        <p>You don't have access to this area. Ask an administrator (MD, HR or Head of IT) if you need it.</p>
      </div>
    </div>
  );
}

// Shown when the active view isn't a known module — the app is state-driven, so
// an unknown `view` key would otherwise render nothing. Calm, on-brand empty state.
function NotFound() {
  const { go } = useApp();
  return (
    <div className="notfound">
      <div className="notfound-code">404</div>
      <h1 className="notfound-title">Page not found</h1>
      <p className="notfound-sub">
        This workspace area doesn't exist or has moved. Let's get you back to somewhere useful.
      </p>
      <button className="btn primary" onClick={() => go("home")}>Back to Home</button>
    </div>
  );
}

function Shell() {
  const { view, mainRef, me, perms } = useApp();
  // Block direct access (typed URL / stale nav) to any gated module the user has no
  // grant on — the nav already hides these, this is the belt-and-braces backstop.
  const gate = gatedViews[view];
  const blocked = !!gate && moduleLevel(perms, me?.email, gate) < 1;
  const Active = blocked ? NoAccess : (views[view] ?? NotFound);
  return (
    <>
      <Sidebar />
      <main className="main" ref={mainRef}>
        <Topbar />
        <section className="view active" id={view}>
          <React.Suspense fallback={<div style={{ padding: 40, color: "var(--ink-faint)", fontSize: 14 }}>Loading…</div>}>
            <Active />
          </React.Suspense>
        </section>
      </main>
      <EngDrawer />
      <VendorDrawer />
      <ProjectDrawer />
      <AccessDrawer />
      <ProformaDrawer />
      <InviteModal />
      <TaskModal />
      <ReqModal />
      <POModal />
      <InvoiceModal />
      <ProformaModal />
      <LeaveModal />
      <EngagementModal />
      <EngUpdateModal />
      <PartnerModal />
      <OpportunityModal />
      <RiskModal />
      <PolicyModal />
      <DocumentModal />
      <ContractModal />
      <ProjectModal />
      <FieldActivityModal />
      <VendorModal />
      <PoPickerModal />
      <GrnModal />
      <CaptureInvoiceModal />
      <ReceiptModal />
      <PoAmendModal />
      <BankChangeModal />
      <Toasts />
    </>
  );
}

export default function App() {
  return (
    <AppProvider>
      <Shell />
    </AppProvider>
  );
}
