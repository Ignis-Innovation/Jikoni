import { useState } from "react";
import { useApp } from "../store";
import { crmData } from "../data";
import { Pulse, ViewOnly } from "../components/ui";
import { PlusI } from "../components/icons";
import { Crumb } from "../nav";

export default function CrmView() {
  const { tabs, openEng, crm, openEngForm, openPartnerForm, openOppForm, level } = useApp();
  const tab = tabs.crm;
  const crmLvl = level("crm");
  const canEdit = crmLvl >= 2;
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
          {canEdit && <button className="btn primary" onClick={headerAction.onClick}><PlusI />{headerAction.label}</button>}
        </div>
      </div>
      <Crumb view="crm" />
      <ViewOnly show={crmLvl === 1} />

      {tab === "cr-over" && (
        <div className="crm-panel active">
          <Pulse data={[]} />
          <div className="grid g-2">
            <div className="panel">
              <div className="panel-h"><h3>Engagements by relationship</h3><span className="meta">who's in the book</span></div>
              <div className="pad" style={{ fontSize: 12.5, color: "var(--ink-soft)", padding: "34px 20px", textAlign: "center" }}>No engagements yet — add one from the Engagements tab.</div>
            </div>
            <div className="panel">
              <div className="panel-h"><h3>Upstream funnel</h3><span className="meta">capital pipeline · by stage</span></div>
              <div className="pad" style={{ fontSize: 12.5, color: "var(--ink-soft)", padding: "34px 20px", textAlign: "center" }}>No pipeline data yet.</div>
            </div>
          </div>
          <div className="grid g-2" style={{ marginTop: 18 }}>
            <div className="panel">
              <div className="panel-h"><h3>Needs attention</h3><span className="meta">critical · overdue · stalled</span></div>
              <div className="pad" style={{ fontSize: 12.5, color: "var(--ink-soft)", padding: "34px 20px", textAlign: "center" }}>Nothing needs attention yet.</div>
            </div>
            <div className="panel">
              <div className="panel-h"><h3>Downstream conversion</h3><span className="meta">institutions · by stage</span></div>
              <div className="pad" style={{ fontSize: 12.5, color: "var(--ink-soft)", padding: "34px 20px", textAlign: "center" }}>No conversion data yet.</div>
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
