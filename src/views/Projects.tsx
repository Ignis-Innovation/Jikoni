import { useApp } from "../store";
import { Pulse, Note } from "../components/ui";
import { Bars, StaticBars, GroupedBars } from "../components/charts";
import { Crumb } from "../nav";
import { PlusI } from "../components/icons";
import type { ProjectDetail } from "../data";

/* Chart palette — projects are coloured by position so the donut, legend and
   burn bars all agree on a colour per project. */
const COLORS = ["#12A3BE", "#E2632A", "#3C8A5E", "#6D28D9", "#A89C8E", "#C99A2E", "#B5455B", "#2E7D9A"];

// short label for charts: "Makueni VTC rollout" → "Makueni", "5-County …" → "5-County"
const short = (name: string) => name.split(" ")[0];
// money now lives on the project as numeric KES (budgetAmount / spentAmount)
const budgetOf = (p: ProjectDetail) => p.budgetAmount ?? 0;
const spentOf = (p: ProjectDetail) => p.spentAmount ?? 0;
const burnOf = (p: ProjectDetail) => { const b = budgetOf(p); return b > 0 ? Math.round((spentOf(p) / b) * 100) : 0; };
// format KES: millions get an "M" suffix, smaller amounts show in full
const fmtKes = (n: number) => n >= 1e6 ? `KES ${(n / 1e6).toFixed(1)}M` : `KES ${Math.round(n).toLocaleString()}`;

const statusPill = (status: string) => {
  const s = (status || "").toLowerCase();
  if (s.includes("track") || s.includes("complete")) return "done";
  if (s.includes("due") || s.includes("pending") || s.includes("request")) return "today";
  return "week";
};
const msPill: Record<string, { cls: string; txt: string }> = {
  done: { cls: "done", txt: "Complete" },
  now: { cls: "today", txt: "In progress" },
  todo: { cls: "week", txt: "Upcoming" },
};
const ddPill = (s: string) =>
  /received/i.test(s) ? "done" : /request|pending|due/i.test(s) ? "today" : "week";

export default function ProjectsView() {
  const { tabs, goTab, openProject, projectDetails, openProjectForm, openProjectEdit, deleteProject, setMilestoneStatus, fieldActivities, openFieldActivity } = useApp();
  const tab = tabs.projects;

  // one source of truth: every project the backend returns, keyed by name
  const list = Object.entries(projectDetails).map(([name, d], i) => ({
    name, ...d, c: COLORS[i % COLORS.length], short: short(name),
  }));

  const allMilestones = list.flatMap((p) => p.milestones.map((m) => ({ ...m, project: p.name })));
  const allDrawdowns = list.flatMap((p) => p.drawdowns.map((d) => ({ ...d, project: p.name })));
  // Aggregate tabs (Budgets / Grants / burn charts) only show projects that
  // actually carry that data — a bare new project lives in the registry until
  // it has a budget, a funder/drawdown or a reporting date.
  const budgeted = list.filter((p) => budgetOf(p) > 0);
  const grantRows = list.filter((p) => (p.funder && p.funder !== "—") || p.drawdowns.length > 0);
  const reportingRows = list.filter((p) => p.reporting && !/to be set/i.test(p.reporting));

  const budgetTotal = list.reduce((a, p) => a + budgetOf(p), 0);
  const spentTotal = list.reduce((a, p) => a + spentOf(p), 0);
  const remaining = budgetTotal - spentTotal;
  const burnPct = budgetTotal ? Math.round((spentTotal / budgetTotal) * 100) : 0;
  const overBurn = list.filter((p) => burnOf(p) >= 80).length;
  const milestonesDone = allMilestones.filter((m) => m.s === "done").length;

  const milestonesDue = allMilestones.filter((m) => m.s === "now");
  const drawdownsPending = allDrawdowns.filter((d) => !/received/i.test(d.s));
  const reportsDue = list.filter((p) => /jul|next|due/i.test(p.reporting || ""));

  const pulse = [
    { k: "Active projects", tick: "t-blue", v: String(list.length), d: `${new Set(grantRows.map((p) => p.funder)).size} funders`, dc: "flat" as const },
    { k: "Portfolio budget", tick: "t-blue", v: fmtKes(budgetTotal), d: "across projects", dc: "flat" as const },
    { k: "Spent to date", tick: "t-ember", v: fmtKes(spentTotal), d: `${burnPct}%`, dc: "flat" as const },
    { k: "Milestones done", tick: "t-green", v: String(milestonesDone), d: `of ${allMilestones.length}`, dc: "flat" as const },
    { k: "Reports due", tick: reportsDue.length ? "t-red" : "t-blue", v: String(reportsDue.length), d: "funder obligations", dc: "flat" as const },
    { k: "Field activities", tick: "t-blue", v: String(fieldActivities.length), d: "assigned", dc: "flat" as const },
  ];
  // budget-vs-spent per project: the bar fills to burn %, labelled "spent / budget"
  const burnRows = budgeted.map((p) => ({ l: p.short, n: `${fmtKes(spentOf(p))} / ${fmtKes(budgetOf(p))}`, w: burnOf(p), c: burnOf(p) >= 67 ? "var(--ember)" : "var(--flame)" }));
  // grouped bar graph: budget vs spent (absolute KES) for each budgeted project
  const budgetGroups = budgeted.map((p) => ({ l: p.short, a: budgetOf(p), b: spentOf(p) }));
  // compact money for the graph's bar labels: "12.0M" / "850k" / "0"
  const fmtShort = (n: number) => n >= 1e6 ? `${(n / 1e6).toFixed(1)}M` : n >= 1e3 ? `${Math.round(n / 1e3)}k` : String(Math.round(n));

  return (
    <>
      <div className="vhead">
        <div>
          <h1>Projects &amp; Programmes</h1>
          <p>Every funded project and deployment on one code — budget, milestones, deliverables, drawdowns and field activity, tying CRM, Finance and Deployment together.</p>
        </div>
        <div className="actions">
          {tab === "pr-projects" && <button className="btn primary" onClick={openProjectForm}><PlusI />New project</button>}
          {tab === "pr-field" && <button className="btn primary" onClick={openFieldActivity}><PlusI />Add field activity</button>}
        </div>
      </div>
      <Crumb view="projects" />

      {tab === "pr-over" && (
        <div className="proj-panel active">
          <Pulse data={pulse} />
          <div className="panel">
            <div className="panel-h"><h3>Portfolio budget by project</h3><span className="meta">budget, spend & burn across the portfolio</span></div>
            <div className="pad">
              <div style={{ display: "flex", flexWrap: "wrap", gap: 12, marginBottom: burnRows.length ? 20 : 0 }}>
                {[
                  { k: "Portfolio budget", v: fmtKes(budgetTotal), c: "var(--ink)" },
                  { k: "Spent to date", v: fmtKes(spentTotal), c: "var(--ember)" },
                  { k: "Remaining", v: fmtKes(remaining), c: "var(--flame)" },
                  { k: "Burn", v: `${burnPct}%`, c: burnPct >= 80 ? "var(--red)" : "var(--ink)" },
                ].map((s) => (
                  <div key={s.k} style={{ flex: "1 1 140px", padding: "12px 14px", border: "1px solid var(--line)", borderRadius: 10, background: "var(--paper)" }}>
                    <div style={{ fontSize: 10.5, textTransform: "uppercase", letterSpacing: 0.6, color: "var(--ink-soft)" }}>{s.k}</div>
                    <div className="mono" style={{ fontSize: 20, fontWeight: 600, color: s.c, marginTop: 4 }}>{s.v}</div>
                  </div>
                ))}
              </div>
              {burnRows.length
                ? <Bars rows={burnRows} />
                : <Note>No budgeted projects yet — add a budget on a project to see its burn here.</Note>}
            </div>
          </div>
          {budgetGroups.length > 0 && (
            <div className="panel" style={{ marginTop: 18 }}>
              <div className="panel-h"><h3>Budget vs spent by project</h3><span className="meta">KES per project</span></div>
              <div className="pad">
                <GroupedBars groups={budgetGroups} fmt={fmtShort} />
                <div style={{ display: "flex", gap: 20, justifyContent: "center", marginTop: 6, fontSize: 12.5 }}>
                  <span style={{ display: "flex", alignItems: "center", gap: 7 }}><span style={{ width: 11, height: 11, borderRadius: 3, background: "var(--flame)" }} />Budget</span>
                  <span style={{ display: "flex", alignItems: "center", gap: 7 }}><span style={{ width: 11, height: 11, borderRadius: 3, background: "var(--ember)" }} />Spent</span>
                </div>
              </div>
            </div>
          )}
          <div className="panel" style={{ marginTop: 18 }}>
            <div className="panel-h"><h3>Needs attention</h3><span className="meta">across the portfolio</span></div>
            {milestonesDue.slice(0, 2).map((m) => (
              <div className="task" key={"ms" + m.project + m.t} onClick={() => goTab("projects", "pr-milestones")}>
                <span className="id" style={{ color: "var(--ember)" }}>MS</span>
                <span className="txt">{m.project} — {m.t}<small>milestone in progress</small></span>
                <span className="pill today">Due soon</span>
              </div>
            ))}
            {drawdownsPending.slice(0, 2).map((d) => (
              <div className="task" key={"dd" + d.project + d.t} onClick={() => goTab("projects", "pr-grants")}>
                <span className="id" style={{ color: "var(--ember)" }}>DD</span>
                <span className="txt">{d.project} — {d.t} drawdown<small>{d.v} · {d.s}</small></span>
                <span className="pill today">{d.s}</span>
              </div>
            ))}
            {reportsDue.slice(0, 2).map((p) => (
              <div className="task" key={"rp" + p.name} onClick={() => goTab("projects", "pr-grants")}>
                <span className="id" style={{ color: "var(--red)" }}>RPT</span>
                <span className="txt">{p.name} — reporting due<small>{p.reporting}</small></span>
                <span className="pill over">Report</span>
              </div>
            ))}
            {!milestonesDue.length && !drawdownsPending.length && !reportsDue.length && (
              <Note>Nothing outstanding across the portfolio right now.</Note>
            )}
          </div>
        </div>
      )}

      {tab === "pr-projects" && (
        <div className="proj-panel active">
          <div className="panel">
            <div className="panel-h"><h3>Project registry</h3><span className="meta">click a project for the full record</span></div>
            <table className="tbl">
              <thead><tr><th>Project</th><th>Funder</th><th>Location</th><th>Budget</th><th>Spent</th><th>Status</th><th></th></tr></thead>
              <tbody>
                {list.map((p) => (
                  <tr key={p.name} style={{ cursor: "pointer" }} onClick={() => openProject(p.name)}>
                    <td><strong>{p.name}</strong></td>
                    <td>{p.funder || "—"}</td>
                    <td>{p.location || "—"}</td>
                    <td className="mono">{p.budget || "TBD"}</td>
                    <td className="mono">{p.spent || "0"}</td>
                    <td><span className={`pill ${statusPill(p.status)}`}>{p.status || "Setup"}</span></td>
                    <td onClick={(e) => e.stopPropagation()} style={{ whiteSpace: "nowrap", textAlign: "right" }}>
                      {p.createdByMe && (
                        <>
                          <button className="btn" style={{ padding: "5px 10px", fontSize: 12 }} onClick={() => openProjectEdit(p.name)}>Edit</button>{" "}
                          <button className="btn" style={{ padding: "5px 10px", fontSize: 12, color: "var(--red)" }}
                            onClick={() => { if (confirm(`Delete "${p.name}"? This removes its milestones, drawdowns and field activity. This can't be undone.`)) deleteProject(p.name); }}>Delete</button>
                        </>
                      )}
                    </td>
                  </tr>
                ))}
                {!list.length && <tr><td colSpan={7}><Note>No projects yet — click <strong>+ New project</strong>, or convert a won CRM engagement to create one.</Note></td></tr>}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {tab === "pr-budget" && (
        <div className="proj-panel active">
          <div className="grid g-2">
            <div className="panel">
              <div className="panel-h"><h3>Budget vs actual</h3><span className="meta">spent as % of budget</span></div>
              <div className="pad">{burnRows.length ? <StaticBars rows={burnRows} /> : <Note>No budgeted projects yet.</Note>}</div>
            </div>
            <div className="panel">
              <div className="panel-h"><h3>Variance &amp; forecast</h3><span className="meta">portfolio</span></div>
              <div className="recon"><span>Total portfolio budget</span><span className="mono">{fmtKes(budgetTotal)}</span></div>
              <div className="recon"><span>Recognised spend</span><span className="mono">{fmtKes(spentTotal)} · {burnPct}%</span></div>
              <div className="recon"><span>Remaining</span><span className="mono">{fmtKes(remaining)}</span></div>
              <div className="recon"><span>Projects over 80% burn</span><span className={`pill ${overBurn ? "today" : "done"}`}>{overBurn}</span></div>
              <Note>Spend is recognised as milestones are completed — each completed milestone draws down its amount. Project budgets and cost centres post to the same project codes in Finance.</Note>
            </div>
          </div>
        </div>
      )}

      {tab === "pr-milestones" && (
        <div className="proj-panel active">
          <div className="panel">
            <div className="panel-h"><h3>Milestones &amp; deliverables</h3><span className="meta">{allMilestones.length} across {list.length} projects</span></div>
            <table className="tbl">
              <thead><tr><th>Milestone / deliverable</th><th>Project</th><th>Status</th><th style={{ textAlign: "right" }}>Action</th></tr></thead>
              <tbody>
                {allMilestones.map((m, i) => (
                  <tr key={m.id ?? i}>
                    <td style={{ textDecoration: m.s === "done" ? "line-through" : "none", color: m.s === "done" ? "var(--ink-soft)" : "inherit" }}>{m.t}</td>
                    <td>{m.project}</td>
                    <td><span className={`pill ${msPill[m.s]?.cls || "week"}`}>{msPill[m.s]?.txt || m.s}</span></td>
                    <td style={{ textAlign: "right" }}>
                      {m.id && (m.s === "done"
                        ? <button className="btn" style={{ padding: "4px 10px", fontSize: 11.5 }} onClick={() => setMilestoneStatus(m.id!, "todo")}>Reopen</button>
                        : <button className="btn primary" style={{ padding: "4px 10px", fontSize: 11.5 }} onClick={() => setMilestoneStatus(m.id!, "done")}>Mark complete</button>)}
                    </td>
                  </tr>
                ))}
                {!allMilestones.length && <tr><td colSpan={4}><Note>No milestones recorded yet.</Note></td></tr>}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {tab === "pr-grants" && (
        <div className="proj-panel active">
          <div className="grid g-2">
            <div className="panel">
              <div className="panel-h"><h3>Grant register</h3><span className="meta">agreements &amp; drawdowns</span></div>
              <table className="tbl">
                <thead><tr><th>Grant / funder</th><th>Amount</th><th>Drawn</th><th>Next drawdown</th></tr></thead>
                <tbody>
                  {grantRows.map((p) => {
                    const next = p.drawdowns.find((d) => !/received/i.test(d.s));
                    return (
                      <tr key={p.name}>
                        <td>{p.funder || p.name}</td>
                        <td className="mono">{p.budget || "TBD"}</td>
                        <td className="mono">{p.spent || "0"}</td>
                        <td>{next ? <span className={`pill ${ddPill(next.s)}`}>{next.s}</span> : <span className="pill done">Fully drawn</span>}</td>
                      </tr>
                    );
                  })}
                  {!grantRows.length && <tr><td colSpan={4}><Note>No grants yet.</Note></td></tr>}
                </tbody>
              </table>
            </div>
            <div className="panel">
              <div className="panel-h"><h3>Reporting calendar</h3><span className="meta">funder obligations</span></div>
              {reportingRows.map((p) => (
                <div className="task" key={p.name}>
                  <span className="id">{p.short}</span>
                  <span className="txt">{p.reporting}<small>{p.funder}</small></span>
                  <span className={`pill ${/jul|due/i.test(p.reporting) ? "over" : "week"}`}>{/jul|due/i.test(p.reporting) ? "Due" : "Upcoming"}</span>
                </div>
              ))}
              {!reportingRows.length && <Note>No reporting obligations set yet.</Note>}
              <Note>Drawdowns release on milestone sign-off; each is evidenced by the milestone and its report.</Note>
            </div>
          </div>
        </div>
      )}

      {tab === "pr-field" && (
        <div className="proj-panel active">
          <div className="panel">
            <div className="panel-h"><h3>Field activity</h3><span className="meta">people assigned to check sites</span></div>
            <table className="tbl">
              <thead><tr><th>Project</th><th>Assignee</th><th>Contact</th><th>Date</th><th>Task</th></tr></thead>
              <tbody>
                {fieldActivities.map((a) => (
                  <tr key={a.id} style={{ cursor: "pointer" }} onClick={() => openProject(a.project)}>
                    <td><strong>{a.project}</strong></td>
                    <td>{a.assignee}</td>
                    <td className="mono" style={{ fontSize: 12 }}>{[a.phone, a.email].filter(Boolean).join(" · ") || "—"}</td>
                    <td className="mono">{a.date}</td>
                    <td>{a.note || "—"}</td>
                  </tr>
                ))}
                {!fieldActivities.length && <tr><td colSpan={5}><Note>No field activity yet — click <strong>+ Add field activity</strong> to assign someone to check a site.</Note></td></tr>}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </>
  );
}
