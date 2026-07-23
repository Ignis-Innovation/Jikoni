import { useState } from "react";
import { useApp } from "../store";
import { crmData } from "../data";
import { Pulse } from "../components/ui";
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
  const { tabs, openEng, crm, openEngForm, openPartnerForm, openOppForm } = useApp();
  const tab = tabs.crm;
  const [pipeline, setPipeline] = useState<"up" | "down">("up");
  const d = crmData[pipeline];
  const engRows = pipeline === "up" ? crm.engUp : crm.engDown;

  // Recent updates log — flatten every engagement's DB updates, newest first, tagged
  // with the engagement id so the diary stays consistent with each record's own log.
  const recentUpdates = [...crm.engUp, ...crm.engDown]
    .flatMap((e) => (e.updates ?? []).map((u) => ({ ...u, engId: e.id, engName: e.n })))
    .sort((a, b) => (b.ts ?? "").localeCompare(a.ts ?? ""))
    .slice(0, 6);

  // the primary action follows the active sub-tab so it never says "New engagement" on the Partners tab
  const headerAction =
    tab === "cr-partners" ? { label: "Add partner", onClick: openPartnerForm } :
    tab === "cr-opps" ? { label: "New opportunity", onClick: openOppForm } :
    { label: "New engagement", onClick: openEngForm };

  return (
    <>
      <div className="vhead">
        <div>
          <h1>Partnerships CRM</h1>
          <p>One engagement engine, two views — upstream capital and downstream deployment in the same query.</p>
        </div>
        <div className="actions">
          <button className="btn primary" onClick={headerAction.onClick}><PlusI />{headerAction.label}</button>
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
                {engRows.length === 0 && (
                  <tr><td colSpan={5} style={{ textAlign: "center", color: "var(--ink-soft)", padding: "18px 0" }}>No {pipeline === "up" ? "upstream" : "downstream"} engagements yet — use “New engagement” above.</td></tr>
                )}
                {engRows.map((r) => (
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
            {recentUpdates.length === 0 ? (
              <div className="pad" style={{ fontSize: 13, color: "var(--ink-soft)" }}>No updates logged yet — open an engagement and hit Update.</div>
            ) : recentUpdates.map((u, i) => (
              <div className="task" key={u.engId + i} style={{ cursor: "pointer" }} onClick={() => openEng(u.engId)}>
                <span className="id">{u.engId}</span>
                <span className="txt">{u.engName} — {u.note}<small>{u.ch} · {u.who} · {u.d}</small></span>
                <span className="pill done">Logged</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {tab === "cr-partners" && (
        <div className="crm-panel active">
          <div className="panel">
            <div className="panel-h">
              <h3>Partner registry</h3>
              <span className="meta">funders · investors · institutions · distributors</span>
            </div>
            <table className="tbl">
              <thead><tr><th>Organisation</th><th>Type</th><th>Country</th><th>Owner</th><th>Status</th></tr></thead>
              <tbody>
                {crm.partners.length === 0 ? (
                  <tr><td colSpan={5} style={{ textAlign: "center", color: "var(--ink-soft)", padding: "18px 0" }}>No partners yet — use “Add partner” above.</td></tr>
                ) : crm.partners.map((p) => (
                  <tr key={p.id}>
                    <td><strong>{p.name}</strong></td>
                    <td>{p.type}</td>
                    <td>{p.country}</td>
                    <td>{p.ownerName}</td>
                    <td><span className={`pill ${p.statusCls}`}>{p.status}</span></td>
                  </tr>
                ))}
              </tbody>
            </table>
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
                {crm.opportunities.length === 0 ? (
                  <tr><td colSpan={5} style={{ textAlign: "center", color: "var(--ink-soft)", padding: "18px 0" }}>No opportunities yet — use “New opportunity” above.</td></tr>
                ) : crm.opportunities.map((o) => (
                  <tr key={o.id}>
                    <td><strong>{o.name}</strong></td>
                    <td>{o.type}</td>
                    <td className="mono">{o.deadline}</td>
                    <td>{o.linkedTo}</td>
                    <td><span className={`pill ${o.statusCls}`}>{o.status}</span></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

    </>
  );
}
