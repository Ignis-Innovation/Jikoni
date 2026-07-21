import { useApp } from "../store";
import { Pulse, Note } from "../components/ui";
import { Donut, ChartLegend, Bars, StaticBars } from "../components/charts";
import { Crumb } from "../nav";
import type { ProjectDetail } from "../data";

/* Chart palette — projects are coloured by position so the donut, legend and
   burn bars all agree on a colour per project. */
const COLORS = ["#12A3BE", "#E2632A", "#3C8A5E", "#6D28D9", "#A89C8E", "#C99A2E", "#B5455B", "#2E7D9A"];

// short label for charts: "Makueni VTC rollout" → "Makueni", "5-County …" → "5-County"
const short = (name: string) => name.split(" ")[0];
// spent-vs-budget percentage as a number, from the "59%" string
const pctNum = (p: ProjectDetail) => parseInt(p.pct || "0", 10) || 0;
// parse a money string ("KES 3.2M", "$240k") to a KES-millions number for charts/totals
function amtM(s?: string | null): number {
  if (!s) return 0;
  const usd = /\$/.test(s);
  const num = parseFloat(s.replace(/[^0-9.]/g, "")) || 0;
  const millions = /k/i.test(s) ? num / 1000 : num; // "M" (or bare) is already millions
  return usd ? millions * 130 : millions;           // rough USD→KES so magnitudes compare
}
const fmtM = (n: number) => `KES ${n.toFixed(1)}M`;
// first number in a free-text field string ("214 assessments · …") → 214
const leadNum = (s?: string) => parseInt((s || "").replace(/[^0-9].*$/, ""), 10) || 0;

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
  const { tabs, goTab, openProject, projectDetails } = useApp();
  const tab = tabs.projects;

  // one source of truth: every project the backend returns, keyed by name
  const list = Object.entries(projectDetails).map(([name, d], i) => ({
    name, ...d, c: COLORS[i % COLORS.length], short: short(name),
  }));

  const allMilestones = list.flatMap((p) => p.milestones.map((m) => ({ ...m, project: p.name })));
  const allDrawdowns = list.flatMap((p) => p.drawdowns.map((d) => ({ ...d, project: p.name })));
  const fieldRows = list.filter((p) => p.field && p.field !== "—");

  const budgetTotal = list.reduce((a, p) => a + amtM(p.budget), 0);
  const spentTotal = list.reduce((a, p) => a + amtM(p.spent), 0);
  const remaining = budgetTotal - spentTotal;
  const burnPct = budgetTotal ? Math.round((spentTotal / budgetTotal) * 100) : 0;
  const overBurn = list.filter((p) => pctNum(p) >= 80).length;

  const milestonesDue = allMilestones.filter((m) => m.s === "now");
  const drawdownsPending = allDrawdowns.filter((d) => !/received/i.test(d.s));
  const reportsDue = list.filter((p) => /jul|next|due/i.test(p.reporting || ""));

  const pulse = [
    { k: "Active projects", tick: "t-blue", v: String(list.length), d: `${new Set(list.map((p) => p.funder)).size} funders`, dc: "flat" as const },
    { k: "Portfolio budget", tick: "t-blue", v: fmtM(budgetTotal), d: "across projects", dc: "flat" as const },
    { k: "Spent to date", tick: "t-ember", v: fmtM(spentTotal), d: `${burnPct}%`, dc: "flat" as const },
    { k: "Milestones due", tick: "t-ember", v: String(milestonesDue.length), d: "in progress", dc: "flat" as const },
    { k: "Reports due", tick: reportsDue.length ? "t-red" : "t-blue", v: String(reportsDue.length), d: "funder obligations", dc: "flat" as const },
    { k: "Drawdowns pending", tick: "t-ember", v: String(drawdownsPending.length), d: "awaiting sign-off", dc: "flat" as const },
  ];
  const donutSegs = list.filter((p) => amtM(p.budget) > 0).map((p) => ({ l: p.short, v: amtM(p.budget), c: p.c, d: p.budget || "TBD" }));
  const burnRows = list.map((p) => ({ l: p.short, n: p.pct || "0%", w: pctNum(p), c: pctNum(p) >= 67 ? "var(--ember)" : "var(--flame)" }));

  return (
    <>
      <div className="vhead">
        <div>
          <h1>Projects &amp; Programmes</h1>
          <p>Every funded project and deployment on one code — budget, milestones, deliverables, drawdowns and field activity, tying CRM, Finance and Deployment together.</p>
        </div>
      </div>
      <Crumb view="projects" />

      {tab === "pr-over" && (
        <div className="proj-panel active">
          <Pulse data={pulse} />
          <div className="grid g-2">
            <div className="panel">
              <div className="panel-h"><h3>Portfolio budget by project</h3><span className="meta">allocation</span></div>
              <div className="pad" style={{ display: "flex", alignItems: "center", gap: 24 }}>
                <Donut segs={donutSegs} big={fmtM(budgetTotal)} small="budget" />
                <div style={{ flex: 1 }}><ChartLegend segs={donutSegs} /></div>
              </div>
            </div>
            <div className="panel">
              <div className="panel-h"><h3>Burn by project</h3><span className="meta">spent as % of budget</span></div>
              <div className="pad"><Bars rows={burnRows} /></div>
            </div>
          </div>
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
              <thead><tr><th>Project</th><th>Funder</th><th>Budget</th><th>Spent</th><th>Status</th></tr></thead>
              <tbody>
                {list.map((p) => (
                  <tr key={p.name} style={{ cursor: "pointer" }} onClick={() => openProject(p.name)}>
                    <td><strong>{p.name}</strong></td>
                    <td>{p.funder || "—"}</td>
                    <td className="mono">{p.budget || "TBD"}</td>
                    <td className="mono">{p.spent || "0"}</td>
                    <td><span className={`pill ${statusPill(p.status)}`}>{p.status || "Setup"}</span></td>
                  </tr>
                ))}
                {!list.length && <tr><td colSpan={5}><Note>No projects yet — convert a won CRM engagement to create one.</Note></td></tr>}
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
              <div className="pad"><StaticBars rows={burnRows} /></div>
            </div>
            <div className="panel">
              <div className="panel-h"><h3>Variance &amp; forecast</h3><span className="meta">portfolio</span></div>
              <div className="recon"><span>Total portfolio budget</span><span className="mono">{fmtM(budgetTotal)}</span></div>
              <div className="recon"><span>Committed &amp; spent</span><span className="mono">{fmtM(spentTotal)} · {burnPct}%</span></div>
              <div className="recon"><span>Remaining</span><span className="mono">{fmtM(remaining)}</span></div>
              <div className="recon"><span>Projects over 80% burn</span><span className={`pill ${overBurn ? "today" : "done"}`}>{overBurn}</span></div>
              <Note>Project budgets, cost centres and procurement all post to the same project codes in Finance. USD grants are shown at an indicative KES rate for the portfolio total.</Note>
            </div>
          </div>
        </div>
      )}

      {tab === "pr-milestones" && (
        <div className="proj-panel active">
          <div className="panel">
            <div className="panel-h"><h3>Milestones &amp; deliverables</h3><span className="meta">{allMilestones.length} across {list.length} projects</span></div>
            <table className="tbl">
              <thead><tr><th>Milestone / deliverable</th><th>Project</th><th>Status</th></tr></thead>
              <tbody>
                {allMilestones.map((m, i) => (
                  <tr key={i}>
                    <td>{m.t}</td>
                    <td>{m.project}</td>
                    <td><span className={`pill ${msPill[m.s]?.cls || "week"}`}>{msPill[m.s]?.txt || m.s}</span></td>
                  </tr>
                ))}
                {!allMilestones.length && <tr><td colSpan={3}><Note>No milestones recorded yet.</Note></td></tr>}
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
                  {list.map((p) => {
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
                  {!list.length && <tr><td colSpan={4}><Note>No grants yet.</Note></td></tr>}
                </tbody>
              </table>
            </div>
            <div className="panel">
              <div className="panel-h"><h3>Reporting calendar</h3><span className="meta">funder obligations</span></div>
              {list.filter((p) => p.reporting).map((p) => (
                <div className="task" key={p.name}>
                  <span className="id">{p.short}</span>
                  <span className="txt">{p.reporting}<small>{p.funder}</small></span>
                  <span className={`pill ${/jul|due/i.test(p.reporting) ? "over" : "week"}`}>{/jul|due/i.test(p.reporting) ? "Due" : "Upcoming"}</span>
                </div>
              ))}
              <Note>Drawdowns release on milestone sign-off; each is evidenced by the milestone and its report.</Note>
            </div>
          </div>
        </div>
      )}

      {tab === "pr-field" && (
        <div className="proj-panel active">
          <div className="grid g-2">
            <div className="panel">
              <div className="panel-h"><h3>Field activity by project</h3><span className="meta">visits · installs · assessments</span></div>
              {fieldRows.map((p) => (
                <div className="task" key={p.name} onClick={() => openProject(p.name)} style={{ cursor: "pointer" }}>
                  <span className="id" style={{ color: p.c }}>{p.short}</span>
                  <span className="txt">{p.field}<small>{p.team}</small></span>
                  <span className="pill done">Logged</span>
                </div>
              ))}
              {!fieldRows.length && <Note>No field activity logged yet.</Note>}
            </div>
            <div className="panel">
              <div className="panel-h"><h3>Activity summary</h3><span className="meta">across projects</span></div>
              <div className="recon"><span>Projects with field activity</span><span className="mono">{fieldRows.length}</span></div>
              <div className="recon"><span>Logged activities (approx.)</span><span className="mono">{fieldRows.reduce((a, p) => a + leadNum(p.field), 0)}</span></div>
              <div className="recon"><span>Field teams engaged</span><span className="mono">{new Set(fieldRows.map((p) => p.team)).size}</span></div>
              <Note>Field activity carries the readiness-scoring assessment data and flows to Deployment and project cost allocation.</Note>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
