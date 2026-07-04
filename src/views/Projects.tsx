import { useApp } from "../store";
import { Pulse, Note } from "../components/ui";
import { Donut, ChartLegend, Bars, StaticBars } from "../components/charts";
import { PlusI } from "../components/icons";
import { Crumb } from "../nav";

const pulse = [
  { k: "Active projects", tick: "t-blue", v: "5", d: "2 counties + 2 grants", dc: "up" as const },
  { k: "Portfolio budget", tick: "t-blue", v: "KES 9.9M", d: "across projects", dc: "flat" as const },
  { k: "Spent to date", tick: "t-ember", v: "KES 5.6M", d: "57%", dc: "flat" as const },
  { k: "Milestones due", tick: "t-ember", v: "3", d: "this month", dc: "flat" as const },
  { k: "Reports due", tick: "t-red", v: "1", d: "Q2 · 15 Jul", dc: "flat" as const },
  { k: "Drawdowns pending", tick: "t-ember", v: "2", d: "awaiting sign-off", dc: "flat" as const },
];
const alloc = [
  { l: "Makueni VTC", v: 3.2, c: "#12A3BE", d: "3.2M" },
  { l: "5-County data", v: 2.1, c: "#E2632A", d: "2.1M" },
  { l: "Kiambu", v: 1.8, c: "#3C8A5E", d: "1.8M" },
  { l: "Sierra Leone", v: 1.3, c: "#6D28D9", d: "$240k" },
  { l: "EPC pilot", v: 0.3, c: "#A89C8E", d: "$19.8k" },
];

export default function ProjectsView() {
  const { tabs, toast, goTab, openProject, extraProjects } = useApp();
  const tab = tabs.projects;

  return (
    <>
      <div className="vhead">
        <div>
          <h1>Projects &amp; Programmes</h1>
          <p>Every funded project and deployment on one code — budget, milestones, deliverables, drawdowns and field activity, tying CRM, Finance and Deployment together.</p>
        </div>
        <div className="actions">
          <button className="btn primary" onClick={() => toast("New project", "Create a project with funder, budget and milestones")}><PlusI />New project</button>
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
                <Donut segs={alloc} big="9.9M" small="budget" />
                <div style={{ flex: 1 }}><ChartLegend segs={alloc} /></div>
              </div>
            </div>
            <div className="panel">
              <div className="panel-h"><h3>Burn by project</h3><span className="meta">spent as % of budget</span></div>
              <div className="pad">
                <Bars rows={[
                  { l: "Makueni", n: "59%", w: 59, c: "var(--flame)" },
                  { l: "Kiambu", n: "61%", w: 61, c: "var(--flame)" },
                  { l: "5-County", n: "67%", w: 67, c: "var(--ember)" },
                  { l: "Sierra Leone", n: "25%", w: 25, c: "var(--flame)" },
                  { l: "EPC pilot", n: "30%", w: 30, c: "var(--flame)" },
                ]} />
              </div>
            </div>
          </div>
          <div className="panel" style={{ marginTop: 18 }}>
            <div className="panel-h"><h3>Needs attention</h3><span className="meta">across the portfolio</span></div>
            <div className="task" onClick={() => goTab("projects", "pr-milestones")}>
              <span className="id" style={{ color: "var(--ember)" }}>MS</span>
              <span className="txt">Makueni — Phase 2 milestone due 15 Jul<small>platform registration</small></span>
              <span className="pill today">Due soon</span>
            </div>
            <div className="task" onClick={() => goTab("projects", "pr-grants")}>
              <span className="id" style={{ color: "var(--ember)" }}>DD</span>
              <span className="txt">Sierra Leone — drawdown request pending<small>PICREF tranche 2</small></span>
              <span className="pill today">Pending</span>
            </div>
            <div className="task" onClick={() => goTab("projects", "pr-grants")}>
              <span className="id" style={{ color: "var(--red)" }}>RPT</span>
              <span className="txt">Q2 narrative report — due to funders<small>Makueni · CCIQ</small></span>
              <span className="pill over">15 Jul</span>
            </div>
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
                <tr style={{ cursor: "pointer" }} onClick={() => openProject("Makueni VTC rollout")}><td><strong>Makueni VTC rollout</strong></td><td>County + grant</td><td className="mono">3.2M</td><td className="mono">1.9M</td><td><span className="pill done">On track</span></td></tr>
                <tr style={{ cursor: "pointer" }} onClick={() => openProject("Sierra Leone (PICREF)")}><td><strong>Sierra Leone (PICREF)</strong></td><td>PICREF grant</td><td className="mono">$240k</td><td className="mono">$61k</td><td><span className="pill today">Drawdown due</span></td></tr>
                <tr style={{ cursor: "pointer" }} onClick={() => openProject("Kiambu cluster")}><td><strong>Kiambu cluster</strong></td><td>Blended</td><td className="mono">1.8M</td><td className="mono">1.1M</td><td><span className="pill done">On track</span></td></tr>
                <tr style={{ cursor: "pointer" }} onClick={() => openProject("5-County data collection")}><td><strong>5-County data collection</strong></td><td>CCIQ / grant</td><td className="mono">2.1M</td><td className="mono">1.4M</td><td><span className="pill week">Active</span></td></tr>
                <tr style={{ cursor: "pointer" }} onClick={() => openProject("EPC 5-site pilot")}><td><strong>EPC 5-site pilot</strong></td><td>Grant</td><td className="mono">$19.8k</td><td className="mono">$6k</td><td><span className="pill week">Active</span></td></tr>
                {extraProjects.map((p) => (
                  <tr key={p.name} style={{ cursor: "pointer" }} onClick={() => openProject(p.name)}>
                    <td><strong>{p.name}</strong></td><td>{p.funder}</td><td className="mono">TBD</td><td className="mono">0</td><td><span className="pill week">Setup</span></td>
                  </tr>
                ))}
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
              <div className="pad">
                <StaticBars rows={[
                  { l: "Makueni", n: "59%", w: 59, c: "var(--flame)" },
                  { l: "Kiambu", n: "61%", w: 61, c: "var(--flame)" },
                  { l: "5-County", n: "67%", w: 67, c: "var(--ember)" },
                  { l: "Sierra Leone", n: "25%", w: 25, c: "var(--flame)" },
                  { l: "EPC pilot", n: "30%", w: 30, c: "var(--flame)" },
                ]} />
              </div>
            </div>
            <div className="panel">
              <div className="panel-h"><h3>Variance &amp; forecast</h3><span className="meta">portfolio</span></div>
              <div className="recon"><span>Total portfolio budget</span><span className="mono">KES 9.9M</span></div>
              <div className="recon"><span>Committed &amp; spent</span><span className="mono">KES 5.6M</span></div>
              <div className="recon"><span>Remaining</span><span className="mono">KES 4.3M</span></div>
              <div className="recon"><span>Projects over 80% burn</span><span className="pill today">0</span></div>
              <Note>Project budgets, cost centres and procurement all post to the same project codes in Finance.</Note>
            </div>
          </div>
        </div>
      )}

      {tab === "pr-milestones" && (
        <div className="proj-panel active">
          <div className="panel">
            <div className="panel-h"><h3>Milestones &amp; deliverables</h3><span className="meta">by due date</span></div>
            <table className="tbl">
              <thead><tr><th>Milestone / deliverable</th><th>Project</th><th>Due</th><th>Status</th></tr></thead>
              <tbody>
                <tr><td>Platform registration — 63 institutions</td><td>Makueni</td><td className="mono">15 Jul</td><td><span className="pill today">In progress</span></td></tr>
                <tr><td>Q2 narrative + M&amp;E report</td><td>Makueni · CCIQ</td><td className="mono">15 Jul</td><td><span className="pill over">Due</span></td></tr>
                <tr><td>Baseline data — 5 counties</td><td>5-County</td><td className="mono">31 Jul</td><td><span className="pill week">On track</span></td></tr>
                <tr><td>Site selection sign-off</td><td>Sierra Leone</td><td className="mono">Aug</td><td><span className="pill week">Upcoming</span></td></tr>
                <tr><td>Phase 1 — 22 institutions onboarded</td><td>Makueni</td><td className="mono">Jun</td><td><span className="pill done">Complete</span></td></tr>
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
                  <tr><td>Makueni County + grant</td><td className="mono">KES 3.2M</td><td className="mono">1.2M</td><td><span className="pill today">Milestone 2</span></td></tr>
                  <tr><td>PICREF (Sierra Leone)</td><td className="mono">$240k</td><td className="mono">$61k</td><td><span className="pill today">Requested</span></td></tr>
                  <tr><td>CCIQ data-collection grant</td><td className="mono">KES 2.1M</td><td className="mono">1.4M</td><td><span className="pill week">On schedule</span></td></tr>
                  <tr><td>EPC pilot grant</td><td className="mono">$19.8k</td><td className="mono">$6k</td><td><span className="pill week">Tranche 2</span></td></tr>
                </tbody>
              </table>
            </div>
            <div className="panel">
              <div className="panel-h"><h3>Reporting calendar</h3><span className="meta">funder obligations</span></div>
              <div className="task"><span className="id">15 Jul</span><span className="txt">Q2 narrative + financial — Makueni &amp; CCIQ</span><span className="pill over">Due</span></div>
              <div className="task"><span className="id">Aug</span><span className="txt">PICREF inception report — Sierra Leone</span><span className="pill week">Upcoming</span></div>
              <div className="task"><span className="id">Sep</span><span className="txt">Mid-term review — 5-County</span><span className="pill week">Upcoming</span></div>
              <Note>Drawdowns release on milestone sign-off; each is evidenced by the milestone and its report.</Note>
            </div>
          </div>
        </div>
      )}

      {tab === "pr-field" && (
        <div className="proj-panel active">
          <div className="grid g-2">
            <div className="panel">
              <div className="panel-h"><h3>Recent field activity</h3><span className="meta">visits · installs · assessments</span></div>
              <div className="task"><span className="id">FLD-091</span><span className="txt">Makueni — installation batch, 12 units<small>photo evidence · Elizabeth</small></span><span className="pill done">Logged</span></div>
              <div className="task"><span className="id">FLD-090</span><span className="txt">Kiambu — site visit + readiness assessment<small>enumerator team</small></span><span className="pill done">Logged</span></div>
              <div className="task"><span className="id">FLD-089</span><span className="txt">Nakuru — baseline data collection<small>5-county exercise</small></span><span className="pill done">Logged</span></div>
              <div className="task"><span className="id">FLD-088</span><span className="txt">Makueni — onboarding workshop<small>county VTCs</small></span><span className="pill done">Logged</span></div>
            </div>
            <div className="panel">
              <div className="panel-h"><h3>Activity summary</h3><span className="meta">this quarter</span></div>
              <div className="recon"><span>Site visits logged</span><span className="mono">214</span></div>
              <div className="recon"><span>Installations confirmed</span><span className="mono">48</span></div>
              <div className="recon"><span>Readiness assessments</span><span className="mono">214</span></div>
              <div className="recon"><span>Photos captured</span><span className="mono">1,120</span></div>
              <Note>Field activity carries the readiness-scoring assessment data and flows to Deployment and project cost allocation.</Note>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
