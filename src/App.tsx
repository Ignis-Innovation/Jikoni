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
import DeployView from "./views/Deploy";
import ReadinessView from "./views/Readiness";
import RaiseView from "./views/Raise";
import ProcurementView from "./views/Procurement";
import InventoryView from "./views/Inventory";
import ProjectsView from "./views/Projects";
import CrmView from "./views/Crm";
import FinanceView from "./views/Finance";
import HrView from "./views/Hr";
import StaffPortalView from "./views/StaffPortal";
import ComplianceView from "./views/Compliance";
import UsersView from "./views/Users";
import SettingsView from "./views/Settings";
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
  const { view, me, perms, notifications, signOut, go, setSettingsTab, mobileNavOpen, setMobileNavOpen } = useApp();
  const initial = (me?.name || "?").trim()[0]?.toUpperCase() || "?";
  const openProfile = () => { setSettingsTab("s-profile"); go("settings"); };
  const canUsers = canManageUsers(perms, me?.email);
  // A module appears in the nav only if this user has at least View (level >= 1) on it.
  // Level 0 (None) hides it here and blocks direct access in Shell below.
  const can = (m: string) => moduleLevel(perms, me?.email, m) >= 1;
  const canHr = can("hr");
  // CRM badge counts only unseen CRM notifications — it appears only when there's
  // something new the user hasn't opened yet.
  const crmUnseen = notifications.filter((n) => !n.seen && n.linkView === "crm").length;
  // per-module "collapsed" override so an active module can be folded shut
  const [collapsedFor, setCollapsedFor] = useState<string | null>(null);
  const collapsed = (v: string) => collapsedFor === v;
  const setCollapsed = (v: string) => (b: boolean) => setCollapsedFor(b ? v : null);
  useEffect(() => { setCollapsedFor(null); }, [view]);

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
        <NavItem v="home" icon={<HomeI />} label="Home" />

        {(can("finance") || can("procurement") || can("inventory")) && <div className="nav-group">Finance &amp; Operations</div>}
        {can("finance") && <NavModule v="finance" icon={<FinanceI />} collapsed={collapsed("finance")} setCollapsed={setCollapsed("finance")} />}
        {can("procurement") && <NavModule v="procurement" icon={<ProcureI />} collapsed={collapsed("procurement")} setCollapsed={setCollapsed("procurement")} />}
        {can("inventory") && <NavModule v="inventory" icon={<BoxI />} collapsed={collapsed("inventory")} setCollapsed={setCollapsed("inventory")} />}

        <div className="nav-group">People</div>
        {canHr && <NavModule v="hr" icon={<HrI />} collapsed={collapsed("hr")} setCollapsed={setCollapsed("hr")} />}
        <NavModule v="staffportal" icon={<PortalI />} collapsed={collapsed("staffportal")} setCollapsed={setCollapsed("staffportal")} />

        {(can("deploy") || can("projects")) && <div className="nav-group">Deployment</div>}
        {can("deploy") && <NavItem v="deploy" icon={<FlameI />} label="Deployment & Carbon" />}
        {can("projects") && <NavModule v="projects" icon={<ProjectsI />} collapsed={collapsed("projects")} setCollapsed={setCollapsed("projects")} />}

        {can("crm") && <><div className="nav-group">Growth</div>
        <NavModule v="crm" icon={<CrmI />} badge={crmUnseen ? String(crmUnseen) : undefined} collapsed={collapsed("crm")} setCollapsed={setCollapsed("crm")} /></>}

        {can("compliance") && <><div className="nav-group">Governance</div>
        <NavModule v="compliance" icon={<ComplianceI />} collapsed={collapsed("compliance")} setCollapsed={setCollapsed("compliance")} /></>}

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

// Auto-logout after inactivity. Any interaction resets the timer; a live
// countdown overlay appears for the final WARN_AT seconds before sign-out.
const IDLE_LIMIT = 50; // seconds of no interaction before auto-logout
const WARN_AT = 15;    // show the countdown overlay when this many seconds remain
function IdleLogout() {
  const { signOut } = useApp();
  const signOutRef = useRef(signOut);
  signOutRef.current = signOut;
  const deadline = useRef(Date.now() + IDLE_LIMIT * 1000);
  const firedRef = useRef(false);
  const [remaining, setRemaining] = useState(IDLE_LIMIT);

  useEffect(() => {
    const bump = () => { deadline.current = Date.now() + IDLE_LIMIT * 1000; };
    const evts = ["mousemove", "mousedown", "keydown", "scroll", "touchstart", "wheel"];
    evts.forEach((e) => window.addEventListener(e, bump, { passive: true }));
    const iv = setInterval(() => {
      const left = Math.max(0, Math.ceil((deadline.current - Date.now()) / 1000));
      setRemaining((prev) => (prev === left ? prev : left));
      if (left <= 0 && !firedRef.current) { firedRef.current = true; signOutRef.current(); }
    }, 500);
    return () => { evts.forEach((e) => window.removeEventListener(e, bump)); clearInterval(iv); };
  }, []);

  if (remaining > WARN_AT) return null;
  return (
    <div className="modal-bg show" style={{ zIndex: 190 }}>
      <div className="modal" style={{ width: 380 }}>
        <div className="mh"><h3>Are you still there?</h3><p>You'll be signed out due to inactivity. Move the mouse or press a key to stay.</p></div>
        <div className="mb" style={{ alignItems: "center", gap: 4 }}>
          <div style={{ fontFamily: "var(--display)", fontSize: 52, fontWeight: 700, lineHeight: 1, color: "var(--flame)" }}>{remaining}</div>
          <div className="meta">second{remaining === 1 ? "" : "s"} remaining</div>
        </div>
        <div className="mf" style={{ justifyContent: "center" }}>
          <button className="btn primary" onClick={() => { deadline.current = Date.now() + IDLE_LIMIT * 1000; setRemaining(IDLE_LIMIT); }}>Stay signed in</button>
        </div>
      </div>
    </div>
  );
}

function Shell() {
  const { view, mainRef, me, perms } = useApp();
  // Block direct access (typed URL / stale nav) to any gated module the user has no
  // grant on — the nav already hides these, this is the belt-and-braces backstop.
  const gate = gatedViews[view];
  const blocked = !!gate && moduleLevel(perms, me?.email, gate) < 1;
  const Active = blocked ? NoAccess : views[view];
  return (
    <>
      <Sidebar />
      <main className="main" ref={mainRef}>
        <Topbar />
        <section className="view active" id={view}>
          <Active />
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
      <IdleLogout />
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
