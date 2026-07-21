import React, { useEffect, useState } from "react";
import { AppProvider, useApp } from "./store";
import { flagColors } from "./data";
import { moduleLabels, subnavs } from "./nav";
import {
  BrandMark, ChevDown, Chev, HomeI, FinanceI, ProcureI, HrI, PortalI, FlameI,
  ProjectsI, RaiseI, CrmI, ComplianceI, UsersI, SettingsI, SearchI, PlusI, BellI, BoxI,
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
import { EngDrawer, VendorDrawer, ProjectDrawer, AccessDrawer } from "./components/drawers";
import { InviteModal, TaskModal, ReqModal, POModal, InvoiceModal, LeaveModal, EngagementModal, PartnerModal, OpportunityModal } from "./components/modals";

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
  const { view, entity, cycleEntity } = useApp();
  // per-module "collapsed" override so an active module can be folded shut
  const [collapsedFor, setCollapsedFor] = useState<string | null>(null);
  const collapsed = (v: string) => collapsedFor === v;
  const setCollapsed = (v: string) => (b: boolean) => setCollapsedFor(b ? v : null);
  useEffect(() => { setCollapsedFor(null); }, [view]);

  return (
    <aside className="sidebar">
      <div className="brand">
        <div className="mark"><BrandMark /></div>
        <div>
          <div className="name">Jikoni</div>
          <div className="sub">CleanCookIQ · Ignis</div>
        </div>
      </div>

      <div className="entity" onClick={cycleEntity}>
        <div className="lbl">Entity / Country</div>
        <div className="val">
          <span className="flag">
            {flagColors[entity].map((c, i) => <span key={i} style={{ flex: 1, background: c }} />)}
          </span>
          <span>{entity}</span>
          <ChevDown width={13} height={13} />
        </div>
      </div>

      <nav className="nav">
        <div className="nav-group">Overview</div>
        <NavItem v="home" icon={<HomeI />} label="Home" />

        <div className="nav-group">Finance &amp; Operations</div>
        <NavModule v="finance" icon={<FinanceI />} collapsed={collapsed("finance")} setCollapsed={setCollapsed("finance")} />
        <NavModule v="procurement" icon={<ProcureI />} collapsed={collapsed("procurement")} setCollapsed={setCollapsed("procurement")} />
        <NavModule v="inventory" icon={<BoxI />} collapsed={collapsed("inventory")} setCollapsed={setCollapsed("inventory")} />

        <div className="nav-group">People</div>
        <NavModule v="hr" icon={<HrI />} badge="3" badgeCls="blue" collapsed={collapsed("hr")} setCollapsed={setCollapsed("hr")} />
        <NavItem v="staffportal" icon={<PortalI />} label="Staff Portal" />

        <div className="nav-group">Deployment</div>
        <NavItem v="deploy" icon={<FlameI />} label="Deployment & Carbon" />
        <NavModule v="projects" icon={<ProjectsI />} collapsed={collapsed("projects")} setCollapsed={setCollapsed("projects")} />

        <div className="nav-group">Growth</div>
        <NavItem v="raise" icon={<RaiseI />} label="Fundraise & Diligence" />
        <NavModule v="crm" icon={<CrmI />} badge="8" collapsed={collapsed("crm")} setCollapsed={setCollapsed("crm")} />

        <div className="nav-group">Governance</div>
        <NavModule v="compliance" icon={<ComplianceI />} collapsed={collapsed("compliance")} setCollapsed={setCollapsed("compliance")} />

        <div className="nav-group">Administration</div>
        <NavItem v="users" icon={<UsersI />} label="User Management" />
        <NavItem v="settings" icon={<SettingsI />} label="Settings" />
      </nav>

      <div className="me">
        <div className="av">W</div>
        <div className="info">
          <div className="n">Wanjiku</div>
          <div className="r">Chief of Staff</div>
        </div>
      </div>
    </aside>
  );
}

function Topbar() {
  const { toast, openTask } = useApp();
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
      <div className="greeting">
        <div className="g">{greet}, Wanjiku</div>
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
      <div className="iconbtn" onClick={openTask} title="Add task" style={{ fontWeight: 600 }}>
        <PlusI width={18} height={18} />
      </div>
      <div className="iconbtn" onClick={() => toast("Notifications", "3 items need your attention")}>
        <span className="ping" />
        <BellI width={18} height={18} />
      </div>
    </div>
  );
}

function Shell() {
  const { view, mainRef } = useApp();
  const Active = views[view];
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
      <InviteModal />
      <TaskModal />
      <ReqModal />
      <POModal />
      <InvoiceModal />
      <LeaveModal />
      <EngagementModal />
      <PartnerModal />
      <OpportunityModal />
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
