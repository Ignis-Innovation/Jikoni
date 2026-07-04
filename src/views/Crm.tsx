import { useState } from "react";
import { useApp } from "../store";
import { crmData } from "../data";
import { Pulse, Note } from "../components/ui";
import { Donut, ChartLegend, Bars } from "../components/charts";
import { PlusI } from "../components/icons";
import { Crumb } from "../nav";

const pulse = [
  { k: "Active engagements", tick: "t-blue", v: "29", d: "upstream + down", dc: "up" as const },
  { k: "Critical", tick: "t-ember", v: "8", d: "need action", dc: "flat" as const },
  { k: "Overdue follow-ups", tick: "t-red", v: "4", d: "across owners", dc: "down" as const },
  { k: "Stalled 14d+", tick: "t-ember", v: "5", d: "no recent touch", dc: "flat" as const },
  { k: "Upstream committed", tick: "t-blue", v: "$1.35M", d: "of $3M", dc: "up" as const },
  { k: "Downstream EOIs", tick: "t-blue", v: "38", d: "converting", dc: "up" as const },
];
const mix = [
  { l: "Institutions", v: 63, c: "#12A3BE", d: "63" },
  { l: "Funders", v: 9, c: "#E2632A", d: "9" },
  { l: "Investors", v: 5, c: "#6D28D9", d: "5" },
  { l: "Distributors / EPC", v: 6, c: "#3C8A5E", d: "6" },
  { l: "Gov / TA", v: 7, c: "#A89C8E", d: "7" },
];

export default function CrmView() {
  const { tabs, toast, openEng } = useApp();
  const tab = tabs.crm;
  const [pipeline, setPipeline] = useState<"up" | "down">("up");
  const d = crmData[pipeline];

  return (
    <>
      <div className="vhead">
        <div>
          <h1>Partnerships CRM</h1>
          <p>One engagement engine, two views — upstream capital and downstream deployment in the same query.</p>
        </div>
        <div className="actions">
          <button className="btn primary" onClick={() => toast("New engagement", "Create a partner engagement with owner, stage and next action")}><PlusI />New engagement</button>
        </div>
      </div>
      <Crumb view="crm" />

      {tab === "cr-over" && (
        <div className="crm-panel active">
          <Pulse data={pulse} />
          <div className="grid g-2">
            <div className="panel">
              <div className="panel-h"><h3>Engagements by relationship</h3><span className="meta">who's in the book</span></div>
              <div className="pad" style={{ display: "flex", alignItems: "center", gap: 24 }}>
                <Donut segs={mix} big="90" small="partners" />
                <div style={{ flex: 1 }}><ChartLegend segs={mix} /></div>
              </div>
            </div>
            <div className="panel">
              <div className="panel-h"><h3>Upstream funnel</h3><span className="meta">capital pipeline · by stage</span></div>
              <div className="pad">
                <Bars rows={[
                  { l: "Discovery", n: "9", w: 100, c: "var(--flame)" },
                  { l: "Materials", n: "6", w: 66, c: "var(--flame)" },
                  { l: "Negotiation", n: "4", w: 44, c: "var(--ember)" },
                  { l: "Term sheet", n: "2", w: 22, c: "var(--ember)" },
                  { l: "Close", n: "1", w: 11, c: "var(--green)" },
                ]} />
              </div>
            </div>
          </div>
          <div className="grid g-2" style={{ marginTop: 18 }}>
            <div className="panel">
              <div className="panel-h"><h3>Needs attention</h3><span className="meta">critical · overdue · stalled</span></div>
              <div className="task" style={{ cursor: "pointer" }} onClick={() => openEng("ENG-002")}>
                <span className="id" style={{ color: "var(--red)" }}>ENG-002</span>
                <span className="txt">IEA — DSA + dataset overdue<small>Wilson</small></span>
                <span className="pill over">Overdue</span>
              </div>
              <div className="task" style={{ cursor: "pointer" }} onClick={() => openEng("ENG-026")}>
                <span className="id" style={{ color: "var(--red)" }}>ENG-026</span>
                <span className="txt">SEforALL — Ethiopia brief overdue<small>Wilson</small></span>
                <span className="pill over">Overdue</span>
              </div>
              <div className="task" style={{ cursor: "pointer" }} onClick={() => openEng("DST-018")}>
                <span className="id" style={{ color: "var(--ember)" }}>DST-018</span>
                <span className="txt">Kiambu cluster — site visit slipping<small>Elizabeth</small></span>
                <span className="pill today">Stalled 16d</span>
              </div>
              <div className="task" style={{ cursor: "pointer" }} onClick={() => openEng("ENG-019")}>
                <span className="id" style={{ color: "var(--ember)" }}>ENG-019</span>
                <span className="txt">Cygnum — no touch in 14 days<small>Wilson</small></span>
                <span className="pill today">Stalled</span>
              </div>
            </div>
            <div className="panel">
              <div className="panel-h"><h3>Downstream conversion</h3><span className="meta">institutions · by stage</span></div>
              <div className="pad">
                <Bars rows={[
                  { l: "Identification", n: "61", w: 100, c: "var(--flame)" },
                  { l: "EOI", n: "38", w: 62, c: "var(--flame)" },
                  { l: "Site visit", n: "19", w: 31, c: "var(--ember)" },
                  { l: "Contracting", n: "11", w: 18, c: "var(--ember)" },
                  { l: "Deployed", n: "7", w: 11, c: "var(--green)" },
                ]} />
              </div>
            </div>
          </div>
        </div>
      )}

      {tab === "cr-eng" && (
        <div className="crm-panel active">
          <div className="panel" style={{ marginBottom: 18 }}>
            <div className="panel-h">
              <h3>{d.title}</h3>
              <div className="seg-ctl">
                <button className={pipeline === "up" ? "on" : ""} onClick={() => setPipeline("up")}>Upstream · Wilson</button>
                <button className={pipeline === "down" ? "on" : ""} onClick={() => setPipeline("down")}>Downstream · Elizabeth</button>
              </div>
            </div>
            <div style={{ padding: "4px 18px 10px", fontSize: 11.5, color: "var(--ink-soft)" }}>{d.meta}</div>
            <table className="tbl">
              <thead><tr><th>ID</th><th>Partner</th><th>Stage</th><th>Owner</th><th>Next action</th></tr></thead>
              <tbody>
                {d.rows.map((r) => (
                  <tr key={r.id} style={{ cursor: "pointer" }} onClick={() => openEng(r.id)}>
                    <td className="mono" style={{ color: "var(--flame)", fontWeight: 600 }}>{r.id}</td>
                    <td><strong>{r.n}</strong></td>
                    <td>{r.st}</td>
                    <td>{r.o}</td>
                    <td><span className={`pill ${r.pl}`}>{r.plt}</span></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="panel">
            <div className="panel-h"><h3>Recent updates log</h3><span className="meta">diary of interactions</span></div>
            <div className="task" style={{ cursor: "pointer" }} onClick={() => openEng("ENG-012")}><span className="id">ENG-012</span><span className="txt">Charm Impact — term sheet received, reviewing terms<small>Call · Wilson · today</small></span><span className="pill done">Logged</span></div>
            <div className="task" style={{ cursor: "pointer" }} onClick={() => openEng("DST-004")}><span className="id">DST-004</span><span className="txt">Makueni VTCs — 22 of 63 registered on platform<small>Email · Elizabeth · yesterday</small></span><span className="pill done">Logged</span></div>
            <div className="task" style={{ cursor: "pointer" }} onClick={() => openEng("ENG-008")}><span className="id">ENG-008</span><span className="txt">EAIF — concessional terms discussion, follow-up next wk<small>Meeting · Wilson · 2 days ago</small></span><span className="pill done">Logged</span></div>
            <div className="task" style={{ cursor: "pointer" }} onClick={() => openEng("DST-011")}><span className="id">DST-011</span><span className="txt">Catholic Diocese Machakos — EOI signed<small>Field · Elizabeth · 3 days ago</small></span><span className="pill done">Logged</span></div>
          </div>
        </div>
      )}

      {tab === "cr-partners" && (
        <div className="crm-panel active">
          <div className="panel">
            <div className="panel-h">
              <h3>Partner registry</h3>
              <span className="meta">
                <a href="#" onClick={(e) => { e.preventDefault(); toast("New partner", "Add an organisation to the registry"); }} style={{ color: "var(--flame)", textDecoration: "none" }}>+ Add partner</a>
              </span>
            </div>
            <table className="tbl">
              <thead><tr><th>Organisation</th><th>Type</th><th>Country</th><th>Owner</th><th>Status</th></tr></thead>
              <tbody>
                <tr><td>Charm Impact</td><td>Blended funder</td><td>UK / KE</td><td>Wilson</td><td><span className="pill week">Term sheet</span></td></tr>
                <tr><td>EAIF</td><td>Concessional debt</td><td>UK</td><td>Wilson</td><td><span className="pill today">Negotiation</span></td></tr>
                <tr><td>KIICO</td><td>Equity investor</td><td>KE</td><td>Wilson</td><td><span className="pill today">Materials</span></td></tr>
                <tr><td>Signum Capital</td><td>Equity investor</td><td>SG</td><td>Wilson</td><td><span className="pill over">Holding</span></td></tr>
                <tr><td>UNDP / WAIIS</td><td>Programme / TA</td><td>KE</td><td>Wilson</td><td><span className="pill week">Discovery</span></td></tr>
                <tr><td>Stanbic Bank</td><td>Lender (Uganda)</td><td>UG</td><td>Wilson</td><td><span className="pill done">Ready to fund</span></td></tr>
                <tr><td>Makueni County VTCs</td><td>Institution</td><td>KE</td><td>Elizabeth</td><td><span className="pill today">Contracting</span></td></tr>
                <tr><td>Catholic Diocese — Machakos</td><td>Institution</td><td>KE</td><td>Elizabeth</td><td><span className="pill week">EOI</span></td></tr>
                <tr><td>BURN Manufacturing</td><td>Manufacturer</td><td>KE</td><td>Elizabeth</td><td><span className="pill done">Active</span></td></tr>
                <tr><td>CLASP</td><td>TA / convener</td><td>Global</td><td>Elizabeth</td><td><span className="pill week">Site visit</span></td></tr>
              </tbody>
            </table>
          </div>
        </div>
      )}

      {tab === "cr-inst" && (
        <div className="crm-panel active">
          <div className="grid g-2">
            <div className="panel">
              <div className="panel-h"><h3>Institution pipeline</h3><span className="meta">downstream · tier &amp; EOI stage</span></div>
              <table className="tbl">
                <thead><tr><th>Institution</th><th>County</th><th>Tier</th><th>Stage</th></tr></thead>
                <tbody>
                  <tr><td>Makueni County VTCs</td><td>Makueni</td><td><span className="tag std">A</span></td><td><span className="pill today">Contracting</span></td></tr>
                  <tr><td>Catholic Diocese</td><td>Machakos</td><td><span className="tag std">B</span></td><td><span className="pill week">EOI</span></td></tr>
                  <tr><td>Kiambu cluster</td><td>Kiambu</td><td><span className="tag std">A</span></td><td><span className="pill week">Site visit</span></td></tr>
                  <tr><td>Nakuru institutions</td><td>Nakuru</td><td><span className="tag view">C</span></td><td><span className="pill week">Identification</span></td></tr>
                </tbody>
              </table>
            </div>
            <div className="panel">
              <div className="panel-h"><h3>Pipeline by stage</h3><span className="meta">institutions</span></div>
              <div className="pad">
                <Bars rows={[
                  { l: "Identification", n: "61", w: 100, c: "var(--flame)" },
                  { l: "EOI", n: "38", w: 63, c: "var(--flame)" },
                  { l: "Site visit", n: "19", w: 31, c: "var(--ember)" },
                  { l: "Contracting", n: "11", w: 18, c: "var(--ember)" },
                  { l: "Deployed", n: "7", w: 12, c: "var(--green)" },
                ]} />
              </div>
              <Note>This pipeline draws on the institution readiness scoring. Open item: whether it lives here or in CleanCookIQ, or syncs between the two.</Note>
            </div>
          </div>
        </div>
      )}

      {tab === "cr-opps" && (
        <div className="crm-panel active">
          <div className="panel">
            <div className="panel-h"><h3>Opportunity map</h3><span className="meta">RFPs · funding calls · windows</span></div>
            <table className="tbl">
              <thead><tr><th>Opportunity</th><th>Type</th><th>Deadline</th><th>Linked to</th><th>Status</th></tr></thead>
              <tbody>
                <tr><td>Africa Clean Cooking Summit</td><td>Convening</td><td className="mono">9–10 Jul</td><td>Multiple</td><td><span className="pill done">On track</span></td></tr>
                <tr><td>Accelerate Africa cohort</td><td>Accelerator</td><td className="mono">Rolling</td><td>Concept note</td><td><span className="pill today">Applying</span></td></tr>
                <tr><td>FCDO Uganda window</td><td>Grant / TA</td><td className="mono">Q3</td><td>ENG (FCDO)</td><td><span className="pill week">Discovery</span></td></tr>
                <tr><td>Carbon finance window</td><td>Climate finance</td><td className="mono">Q4</td><td>MRV readiness</td><td><span className="pill week">Watching</span></td></tr>
                <tr><td>County institutional RFP</td><td>Tender</td><td className="mono">Aug</td><td>Downstream</td><td><span className="pill week">Preparing</span></td></tr>
              </tbody>
            </table>
          </div>
        </div>
      )}

      {tab === "cr-analytics" && (
        <div className="crm-panel active">
          <div className="panel" style={{ marginBottom: 18 }}>
            <div className="panel-h"><h3>Upstream capital vs $3M target</h3><span className="meta">committed · USD</span></div>
            <div className="raise">
              <div className="top"><div className="big">$1.35M</div><div className="of">committed of $3.0M target</div></div>
              <div className="meter">
                <div className="seg" style={{ background: "var(--flame)", width: "18%" }}>Equity</div>
                <div className="seg" style={{ background: "var(--ember)", width: "27%" }}>Concessional</div>
              </div>
              <div className="legend">
                <span><i style={{ background: "var(--flame)" }} /> Equity · $0.55M</span>
                <span><i style={{ background: "var(--ember)" }} /> Concessional · $0.80M</span>
                <span><i style={{ background: "#F1EDE5" }} /> Remaining · $1.65M</span>
              </div>
            </div>
          </div>
          <div className="grid g-2">
            <div className="panel">
              <div className="panel-h"><h3>Activity by owner</h3><span className="meta">engagements owned</span></div>
              <div className="pad">
                <Bars rows={[
                  { l: "Wilson", n: "14", w: 100, c: "var(--flame)" },
                  { l: "Elizabeth", n: "11", w: 79, c: "var(--flame)" },
                  { l: "Dennis", n: "4", w: 29, c: "var(--flame)" },
                ]} />
              </div>
            </div>
            <div className="panel">
              <div className="panel-h"><h3>Conversion</h3><span className="meta">last quarter</span></div>
              <div className="recon"><span>Upstream discovery → term sheet</span><span className="mono">22%</span></div>
              <div className="recon"><span>Downstream EOI → contracting</span><span className="mono">29%</span></div>
              <div className="recon"><span>Avg days in stage</span><span className="mono">31</span></div>
              <div className="recon"><span>Stalled (no touch 14d+)</span><span className="pill today">5</span></div>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
