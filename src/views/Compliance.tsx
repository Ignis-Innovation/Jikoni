import { useApp } from "../store";
import { Crumb } from "../nav";
import { PlusI } from "../components/icons";

export default function ComplianceView() {
  const {
    tabs, compliance, complianceDocUrl, markObligationFiled,
    openPolicyForm, openDocForm, openRiskForm, openContractForm, me, perms,
  } = useApp();
  const tab = tabs.compliance;
  const { policies, companyDocuments, obligations, risks, contracts } = compliance;

  // Editing Compliance & Governance needs an edit+ grant (level >= 2). Without it
  // the view is read-only — the add/upload actions and "Mark filed" are hidden.
  const canEdit = (perms[me?.email ?? ""]?.compliance ?? 0) >= 2;

  // one primary action per tab, shown top-right of the view header (same pattern as CRM)
  const headerAction =
    tab === "c-policies" ? { label: "Upload / new version", onClick: openPolicyForm } :
    tab === "c-docs" ? { label: "Add / upload document", onClick: openDocForm } :
    tab === "c-risk" ? { label: "Add risk", onClick: openRiskForm } :
    tab === "c-contracts" ? { label: "Add contract", onClick: openContractForm } :
    null;

  return (
    <>
      <div className="vhead">
        <div>
          <h1>Compliance &amp; Governance</h1>
          <p>The single home for policies and manuals, the company's statutory documents, the compliance calendar, the risk register and the contracts registry.</p>
        </div>
        {headerAction && canEdit && (
          <div className="actions">
            <button className="btn primary" onClick={headerAction.onClick}><PlusI />{headerAction.label}</button>
          </div>
        )}
      </div>
      <Crumb view="compliance" />

      {tab === "c-policies" && (
        <div className="comp-panel active">
          <div className="panel">
            <div className="panel-h"><h3>Policies &amp; manuals</h3><span className="meta">versioned · access-controlled</span></div>
            <table className="tbl">
              <thead><tr><th>Document</th><th>Reference</th><th>Version</th><th>Effective</th><th>Status</th></tr></thead>
              <tbody>
                {policies.length === 0 && <tr><td colSpan={5} className="meta">No policies yet.</td></tr>}
                {policies.map((p) => (
                  <tr key={p.code}>
                    <td>{p.doc ? <a href={complianceDocUrl(p.doc)} target="_blank" rel="noreferrer" style={{ color: "var(--flame)", textDecoration: "none" }}>{p.title}</a> : p.title}</td>
                    <td className="mono">{p.code}</td>
                    <td className="mono">{p.version}</td>
                    <td className="mono">{p.effectiveFrom ?? "—"}</td>
                    <td><span className={`pill ${p.statusCls}`}>{p.statusTxt}</span></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {tab === "c-docs" && (
        <div className="comp-panel active">
          <div className="panel">
            <div className="panel-h"><h3>Company &amp; statutory documents</h3><span className="meta">access-controlled · versioned</span></div>
            <table className="tbl">
              <thead><tr><th>Document</th><th>Kind</th><th>Expiry</th><th>Status</th></tr></thead>
              <tbody>
                {companyDocuments.length === 0 && <tr><td colSpan={4} className="meta">No documents yet.</td></tr>}
                {companyDocuments.map((d) => (
                  <tr key={d.name}>
                    <td>{d.doc ? <a href={complianceDocUrl(d.doc)} target="_blank" rel="noreferrer" style={{ color: "var(--flame)", textDecoration: "none" }}>{d.name}</a> : d.name}</td>
                    <td className="meta" style={{ textTransform: "capitalize" }}>{d.kind ?? "—"}</td>
                    <td className="mono">{d.expiry}</td>
                    <td><span className={`pill ${d.statusCls}`}>{d.statusTxt}</span></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {tab === "c-cal" && (
        <div className="comp-panel active">
          <div className="panel">
            <div className="panel-h"><h3>Compliance calendar</h3><span className="meta">statutory obligations</span></div>
            {obligations.length === 0 && <div className="meta" style={{ padding: 12 }}>No obligations tracked.</div>}
            {obligations.map((o) => (
              <div className="task" key={o.obligation}>
                <span className="id">{o.when}</span>
                <span className="txt">{o.obligation}<small>{[o.authority, o.dueRule].filter(Boolean).join(" · ")}</small></span>
                <span className={`pill ${o.statusCls}`}>{o.statusTxt}</span>
                {canEdit && <button className="btn sm" style={{ marginLeft: 10 }} onClick={() => markObligationFiled(o.obligation)}>Mark filed</button>}
              </div>
            ))}
          </div>
        </div>
      )}

      {tab === "c-risk" && (
        <div className="comp-panel active">
          <div className="panel">
            <div className="panel-h"><h3>Risk register</h3><span className="meta">owner · severity · mitigation</span></div>
            <table className="tbl">
              <thead><tr><th>Ref</th><th>Risk</th><th>Owner</th><th>Severity</th><th>Mitigation</th></tr></thead>
              <tbody>
                {risks.length === 0 && <tr><td colSpan={5} className="meta">No risks logged.</td></tr>}
                {risks.map((r) => (
                  <tr key={r.ref}>
                    <td className="mono">{r.ref}</td>
                    <td>{r.risk}</td>
                    <td>{r.owner ?? "—"}</td>
                    <td><span className={`pill ${r.statusCls}`}>{r.statusTxt}</span> <span className="meta">L{r.likelihood}×I{r.impact}</span></td>
                    <td style={{ fontSize: 12 }}>{r.mitigation ?? "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {tab === "c-contracts" && (
        <div className="comp-panel active">
          <div className="panel">
            <div className="panel-h"><h3>Contracts registry</h3><span className="meta">Procurement &amp; CRM read the same records</span></div>
            <table className="tbl">
              <thead><tr><th>Counterparty</th><th>Type</th><th>Contract</th><th>Expiry</th><th>Status</th></tr></thead>
              <tbody>
                {contracts.length === 0 && <tr><td colSpan={5} className="meta">No contracts registered.</td></tr>}
                {contracts.map((c) => (
                  <tr key={c.counterparty + c.title}>
                    <td>{c.counterparty}</td>
                    <td className="meta" style={{ textTransform: "capitalize" }}>{c.kind}</td>
                    <td>{c.doc ? <a href={complianceDocUrl(c.doc)} target="_blank" rel="noreferrer" style={{ color: "var(--flame)", textDecoration: "none" }}>{c.title}</a> : c.title}{c.detail ? <><br /><span className="meta" style={{ textTransform: "none", letterSpacing: 0 }}>{c.detail}</span></> : null}</td>
                    <td className="mono">{c.expiry}</td>
                    <td><span className={`pill ${c.statusCls}`}>{c.statusTxt}</span></td>
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
