import { useState, type ReactNode } from "react";
import { useApp } from "../store";
import { teamColors } from "../data";
import type { WeekTask } from "../data";
import type { PulseStat } from "../data";
import { Pulse, Note } from "../components/ui";
import { buildAttention, orderForRole, type AttentionItem } from "../lib/attention";
import { ExportI, CheckSqI, FlameGlyphI, PlusI, BellI } from "../components/icons";

// relative time, e.g. "3h ago" / "2d ago" — for the recent-activity feed
function timeAgo(iso: string): string {
  const s = Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 1000));
  if (s < 60) return "just now";
  const m = Math.round(s / 60); if (m < 60) return m + "m ago";
  const h = Math.round(m / 60); if (h < 24) return h + "h ago";
  const d = Math.round(h / 24); return d + "d ago";
}

// Map an audit action's domain (the bit before the dot) to a friendly module + the
// view to open on click. Used by the admin "Recent activity" feed.
const ACT_DOMAIN: Record<string, { label: string; view: string }> = {
  engagement: { label: "Partnerships CRM", view: "crm" }, crm: { label: "Partnerships CRM", view: "crm" },
  partner: { label: "Partnerships CRM", view: "crm" }, opportunity: { label: "Partnerships CRM", view: "crm" },
  contract: { label: "Compliance & Governance", view: "compliance" }, risk: { label: "Compliance & Governance", view: "compliance" },
  policy: { label: "Compliance & Governance", view: "compliance" }, company_document: { label: "Compliance & Governance", view: "compliance" },
  compliance: { label: "Compliance & Governance", view: "compliance" },
  proforma: { label: "Finance", view: "finance" }, sales: { label: "Finance", view: "finance" },
  invoice: { label: "Finance", view: "finance" }, payment: { label: "Finance", view: "finance" },
  journal: { label: "Finance", view: "finance" }, coding: { label: "Finance", view: "finance" }, depreciation: { label: "Finance", view: "finance" },
  project: { label: "Projects & Programmes", view: "projects" }, milestone: { label: "Projects & Programmes", view: "projects" },
  hr: { label: "Human Resources", view: "hr" },
  requisition: { label: "Procurement", view: "procurement" }, po: { label: "Procurement", view: "procurement" },
  grn: { label: "Procurement", view: "procurement" }, vendor: { label: "Procurement", view: "procurement" },
  dispatch: { label: "Inventory & Assets", view: "inventory" }, asset: { label: "Inventory & Assets", view: "inventory" },
  stock: { label: "Inventory & Assets", view: "inventory" }, item: { label: "Inventory & Assets", view: "inventory" },
  access: { label: "User Management", view: "users" }, config: { label: "Settings", view: "settings" },
};
// Turn "engagement.created" → "created engagement" (readable, module shown separately).
function prettyAction(action: string): string {
  const verb = action.split(".").slice(1).join(" ").replace(/_/g, " ").trim();
  return verb || action.replace(/_/g, " ");
}

// One My Week row — click to expand its mini-tasks (checkboxes, add, complete, edit, delete).
function TaskRow({ t, showOwner }: { t: WeekTask; showOwner: boolean }) {
  const { toggleSubtask, addSubtask, setTaskDone, openTaskEdit, deleteTask } = useApp();
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState("");
  const subs = t.subtasks ?? [];
  const done = subs.filter((s) => s.done).length;
  const isDone = t.state === "done";
  const shared = (t.assignees?.length ?? 0) > 1;

  function add() {
    const v = draft.trim();
    if (!v) return;
    addSubtask(t.id, v); setDraft("");
  }
  return (
    <div>
      <div className="task" onClick={() => setOpen((o) => !o)} style={{ cursor: "pointer", opacity: isDone ? 0.72 : 1 }}>
        <span className="id">{t.id}</span>
        <span className="txt">
          <span style={{ textDecoration: isDone ? "line-through" : "none" }}>{t.t}</span>
          {(t.s || t.assignedBy) ? <small>{[t.s, t.assignedBy ? `assigned by ${t.assignedBy}` : ""].filter(Boolean).join(" · ")}</small> : null}
        </span>
        {t.priority === "high" && <span className="pill over" title="High priority" style={{ textTransform: "none" }}>High</span>}
        {t.priority === "low" && <span className="pill week" title="Low priority" style={{ background: "transparent", border: "1px solid var(--line)", color: "var(--ink-soft)", textTransform: "none" }}>Low</span>}
        {subs.length > 0 && <span className="pill week" style={{ background: "transparent", border: "1px solid var(--line)", color: "var(--ink-soft)" }}>{done}/{subs.length}</span>}
        {showOwner && (
          <span className="ownerchip" title={shared ? (t.assignees ?? []).map((a) => a.name).join(", ") : undefined}>
            <span className="oav" style={{ background: teamColors[t.o] || "#999" }}>{t.o[0]}</span>
            {t.o}{shared ? ` +${(t.assignees?.length ?? 1) - 1}` : ""}
          </span>
        )}
        {isDone ? <span className="pill done" style={{ textTransform: "none" }}>Complete</span> : <span className={`pill ${t.p}`}>{t.pl}</span>}
      </div>
      {open && (
        <div style={{ padding: "4px 14px 14px 76px", borderBottom: "1px solid var(--line)" }} onClick={(e) => e.stopPropagation()}>
          {subs.map((s, i) => (
            <label key={i} style={{ display: "flex", alignItems: "center", gap: 9, padding: "4px 0", fontSize: 13, cursor: "pointer" }}>
              <input type="checkbox" checked={s.done} onChange={() => toggleSubtask(t.id, i)} />
              <span style={{ textDecoration: s.done ? "line-through" : "none", color: s.done ? "var(--ink-soft)" : "var(--ink)" }}>{s.text}</span>
            </label>
          ))}
          <div style={{ display: "flex", gap: 8, marginTop: 8, flexWrap: "wrap" }}>
            {!isDone && <input className="field" style={{ flex: 1, minWidth: 160 }} placeholder="Add a mini-task…" value={draft}
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); add(); } }} />}
            {!isDone && <button className="btn" onClick={add}>Add</button>}
            <button className="btn" onClick={() => openTaskEdit(t)}>Edit</button>
            <button className="btn" style={{ color: "var(--red)" }} onClick={() => { if (window.confirm(`Delete task "${t.t}"?`)) deleteTask(t.id); }}>Delete</button>
            {isDone
              ? <button className="btn" onClick={() => setTaskDone(t.id, false)}>Reopen</button>
              : <button className="btn primary" onClick={() => setTaskDone(t.id, true)}>Mark done</button>}
          </div>
        </div>
      )}
    </div>
  );
}

// One row in the "Needs attention" action feed.
function FeedRow({ it, onGo }: { it: AttentionItem; onGo: () => void }) {
  return (
    <div className="task" onClick={onGo} style={{ cursor: "pointer" }}>
      <span className="id" style={{ color: it.codeColor }}>{it.code}</span>
      <span className="txt">{it.title}<small>{it.sub}</small></span>
      <span className={`pill ${it.pill.cls}`}>{it.pill.txt}</span>
    </div>
  );
}

function Quick({ label, onClick }: { label: string; onClick: () => void }) {
  return (
    <button className="btn" style={{ justifyContent: "flex-start", width: "100%" }} onClick={onClick}>{label}</button>
  );
}

export default function HomeView() {
  const {
    toast, myWeek, taskFilter, setTaskFilter, openTask, me,
    projectDetails, apInvoices, perms, go, goTab,
    hrMode, setHrMode, isHrToggleUser, audit, members,
  } = useApp();
  const mine = taskFilter === "mine";
  const list = mine
    ? myWeek.filter((t) => t.ownerEmail === me?.email || (t.assignees ?? []).some((a) => a.email === me?.email))
    : myWeek;

  // Build the action feed from live data, ordered by the signed-in user's role.
  const attention = buildAttention({ projectDetails, apInvoices, myWeek, meEmail: me?.email });
  const order = orderForRole(perms[me?.email ?? ""]);
  const rank = (c: AttentionItem["cat"]) => { const i = order.indexOf(c); return i < 0 ? 99 : i; };
  const feed = [...attention].sort((a, b) => rank(a.cat) - rank(b.cat));
  const feedTop = feed.slice(0, 8);

  const goItem = (it: AttentionItem) => (it.tab ? goTab(it.view, it.tab) : go(it.view));

  // Real dashboard KPIs, replacing the empty placeholder pulse.
  const count = (c: AttentionItem["cat"]) => attention.filter((a) => a.cat === c).length;
  const overdueTasks = attention.filter((a) => a.cat === "task" && a.pill.txt === "Overdue").length;
  const pulse: PulseStat[] = [
    { k: "Pending approvals", tick: count("approval") ? "t-ember" : "t-blue", v: String(count("approval")), d: "waiting on the team", dc: "flat" },
    { k: "Reports due", tick: count("report") ? "t-red" : "t-blue", v: String(count("report")), d: "funder obligations", dc: "flat" },
    { k: "My tasks due", tick: overdueTasks ? "t-red" : "t-blue", v: String(count("task")), d: overdueTasks ? `${overdueTasks} overdue` : "due soon", dc: "flat" },
    { k: "Milestones", tick: count("milestone") ? "t-ember" : "t-blue", v: String(count("milestone")), d: "in progress / behind", dc: "flat" },
    { k: "Budget alerts", tick: count("budget") ? "t-red" : "t-blue", v: String(count("budget")), d: "lines over 80%", dc: "flat" },
    { k: "Needs attention", tick: attention.length ? "t-ember" : "t-green", v: String(attention.length), d: "items in total", dc: "flat" },
  ];

  // Recent activity is an oversight feed for the people who watch the business: only a
  // Super Admin (users:3) or Sub Admin sees it. It's sourced from the audit log (every
  // module edit — CRM, Compliance, Finance, …) with petty cash excluded, since those are
  // private to whoever raised them and show only in that person's Staff Portal.
  const isSuper = (perms[me?.email ?? ""]?.users ?? 0) >= 3;
  const canSeeActivity = isSuper || isHrToggleUser;
  const actorName = (email: string) => members.find((m) => m.email === email)?.name ?? (email ? email.split("@")[0] : "System");
  const activity = canSeeActivity
    ? audit.filter((a) => a.action && !a.action.startsWith("petty_cash")).slice(0, 8)
    : [];

  return (
    <>
      <div className="vhead">
        <div>
          <h1>What's on every burner</h1>
          <p>Everything that needs your attention right now — approvals, reports, deadlines, milestones and your tasks across the business, newest first.</p>
        </div>
        <div className="actions">
          {isHrToggleUser && (
            <button
              className={`btn ${hrMode ? "primary" : ""}`}
              onClick={() => { const next = !hrMode; setHrMode(next); toast(next ? "Switched to HR" : "Switched to Employee", next ? "Human Resources, Compliance editing and inviting members are unlocked" : "You're back to a view-only employee view"); }}
              title={hrMode ? "You're in HR mode — click to return to the employee view" : "Unlock HR, Compliance editing and member invites"}
            >
              {hrMode ? "Switch to Employee" : "Switch to HR"}
            </button>
          )}
          <button className="btn" onClick={() => toast("Snapshot saved", "Exported to the board pack as a live snapshot")}>
            <ExportI />
            Export to board pack
          </button>
        </div>
      </div>

      <Pulse data={pulse} />

      <div className="grid g-2">
        <div className="panel">
          <div className="panel-h">
            <h3><span className="glyph ember"><FlameGlyphI /></span> Needs attention</h3>
            <span className="meta">{attention.length ? `${attention.length} items · your priorities first` : "across the business"}</span>
          </div>
          <div>
            {feedTop.length ? (
              feedTop.map((it) => <FeedRow key={it.key} it={it} onGo={() => goItem(it)} />)
            ) : (
              <div className="empty" style={{ padding: "34px 20px" }}>
                <div className="e-t">You're all clear</div>
                <div style={{ fontSize: 12, marginTop: 4 }}>No approvals, reports, overdue milestones or due tasks right now.</div>
              </div>
            )}
            {feed.length > feedTop.length && (
              <Note>+ {feed.length - feedTop.length} more — open the relevant module to see them all.</Note>
            )}
          </div>
        </div>

        <div className="panel">
          <div className="panel-h">
            <h3>
              <span className="glyph ember"><CheckSqI /></span> My Week{" "}
              <span className="meta" style={{ fontWeight: 400, marginLeft: 4 }}>
                {mine ? `assigned to you · ${list.length}` : `whole team · ${list.length}`}
              </span>
            </h3>
            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <div className="seg-ctl mini">
                <button className={mine ? "on" : ""} onClick={() => setTaskFilter("mine")}>Mine</button>
                <button className={!mine ? "on" : ""} onClick={() => setTaskFilter("team")}>Team</button>
              </div>
              <button className="btn" style={{ padding: "7px 11px", fontSize: 12 }} onClick={() => openTask("personal")}>
                <PlusI style={{ width: 14, height: 14 }} />Add task
              </button>
              <button className="btn primary" style={{ padding: "7px 11px", fontSize: 12 }} onClick={() => openTask("assign")}>
                <PlusI style={{ width: 14, height: 14 }} />Assign task
              </button>
            </div>
          </div>
          <div>
            {list.length ? (
              list.map((t) => <TaskRow key={t.id} t={t} showOwner={!mine} />)
            ) : (
              <div className="empty" style={{ padding: "34px 20px" }}>
                <div className="e-t">Nothing here yet</div>
                <div style={{ fontSize: 12, marginTop: 4 }}>Use <strong>Add task</strong> for your own, or <strong>Assign task</strong> to give one to a teammate.</div>
              </div>
            )}
          </div>
        </div>
      </div>

      <div className={canSeeActivity ? "grid g-2" : ""} style={{ marginTop: 18 }}>
        {canSeeActivity && (
        <div className="panel">
          <div className="panel-h">
            <h3><span className="glyph blue"><BellI /></span> Recent activity</h3>
            <span className="meta">across the business</span>
          </div>
          <div>
            {activity.length ? activity.map((a) => {
              const dom = ACT_DOMAIN[(a.action.split(".")[0] || "")];
              return (
                <div className="task" key={a.id} style={{ cursor: dom ? "pointer" : "default" }}
                  onClick={() => { if (dom) go(dom.view); }}>
                  <span className="txt" style={{ paddingLeft: 4 }}>
                    {actorName(a.actor)} <span style={{ color: "var(--ink-soft)", fontWeight: 400 }}>{prettyAction(a.action)}</span>
                    <small>{dom?.label ?? "Activity"}{a.recordRef ? ` · ${a.recordRef}` : ""}</small>
                  </span>
                  <span className="meta" style={{ whiteSpace: "nowrap" }}>{timeAgo(a.when)}</span>
                </div>
              );
            }) : (
              <div className="empty" style={{ padding: "34px 20px" }}>
                <div className="e-t">Nothing recent</div>
                <div style={{ fontSize: 12, marginTop: 4 }}>Edits across CRM, Compliance, Finance and other modules will surface here.</div>
              </div>
            )}
          </div>
        </div>
        )}

        <div className="panel">
          <div className="panel-h"><h3>Quick links</h3><span className="meta">jump straight in</span></div>
          <div className="pad" style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            <Quick label="Add a task" onClick={() => openTask("personal")} />
            <Quick label="Approvals waiting in Finance" onClick={() => goTab("finance", "f-ap")} />
            <Quick label="Projects & Programmes overview" onClick={() => go("projects")} />
            <Quick label="Partnerships CRM" onClick={() => go("crm")} />
            <Quick label="Reporting & board pack" onClick={() => goTab("finance", "f-report")} />
          </div>
        </div>
      </div>
    </>
  );
}
