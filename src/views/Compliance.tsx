import { useApp } from "../store";
import { Crumb } from "../nav";

export default function ComplianceView() {
  const { tabs, toast } = useApp();
  const tab = tabs.compliance;

  return (
    <>
      <div className="vhead">
        <div>
          <h1>Compliance &amp; Governance</h1>
          <p>The single home for policies and manuals, the company's statutory documents, the compliance calendar and the risk register.</p>
        </div>
      </div>
      <Crumb view="compliance" />

      {tab === "c-policies" && (
        <div className="comp-panel active">
          <div className="panel">
            <div className="panel-h">
              <h3>Policies &amp; manuals</h3>
              <span className="meta">
                <a href="#" onClick={(e) => { e.preventDefault(); toast("Upload", "Add a document or a new version"); }} style={{ color: "var(--flame)", textDecoration: "none" }}>+ Upload / new version</a>
              </span>
            </div>
            <table className="tbl">
              <thead><tr><th>Document</th><th>Reference</th><th>Version</th><th>Owner</th><th>Status</th></tr></thead>
              <tbody>
                <tr><td>Procurement Manual</td><td className="mono">IGN-PROC-001</td><td className="mono">v2.0</td><td>Joan</td><td><span className="pill done">Current</span></td></tr>
                <tr><td>Employee Handbook</td><td className="mono">IGN-HR-001</td><td className="mono">v1.3</td><td>HR</td><td><span className="pill done">Current</span></td></tr>
                <tr><td>Finance &amp; Accounting Policy</td><td className="mono">IGN-FIN-001</td><td className="mono">v1.1</td><td>Dennis</td><td><span className="pill done">Current</span></td></tr>
                <tr><td>Code of Conduct</td><td className="mono">IGN-GOV-002</td><td className="mono">v1.0</td><td>MD</td><td><span className="pill done">Current</span></td></tr>
                <tr><td>Safeguarding / Child Protection</td><td className="mono">IGN-GOV-004</td><td className="mono">v1.0</td><td>MD</td><td><span className="pill today">Review due</span></td></tr>
                <tr><td>Data Protection Policy</td><td className="mono">IGN-GOV-005</td><td className="mono">v1.0</td><td>Brian</td><td><span className="pill done">Current</span></td></tr>
                <tr><td>Anti-Corruption &amp; Sanctions</td><td className="mono">IGN-PROC-002</td><td className="mono">v1.2</td><td>Joan</td><td><span className="pill done">Current</span></td></tr>
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
              <thead><tr><th>Document</th><th>Reference</th><th>Expiry</th><th>Status</th></tr></thead>
              <tbody>
                <tr><td>Certificate of Incorporation</td><td className="mono">PVT-XXXXXXX</td><td className="mono">—</td><td><span className="rcv ok">on file</span></td></tr>
                <tr><td>KRA PIN Certificate</td><td className="mono">P05XXXXXXX</td><td className="mono">—</td><td><span className="rcv ok">on file</span></td></tr>
                <tr><td>Tax Compliance Certificate</td><td className="mono">KRA-TCC</td><td className="mono">14 Feb 2027</td><td><span className="pill done">Valid</span></td></tr>
                <tr><td>CR12 (shareholding)</td><td className="mono">BRS</td><td className="mono">—</td><td><span className="rcv ok">on file</span></td></tr>
                <tr><td>Single Business Permit</td><td className="mono">NCC-2026</td><td className="mono">31 Dec 2026</td><td><span className="pill today">Renew Q4</span></td></tr>
                <tr><td>NSSF / SHIF registration</td><td className="mono">Employer no.</td><td className="mono">—</td><td><span className="rcv ok">on file</span></td></tr>
                <tr><td>Annual Returns (Registrar)</td><td className="mono">BRS</td><td className="mono">Sep 2026</td><td><span className="pill week">Upcoming</span></td></tr>
              </tbody>
            </table>
          </div>
        </div>
      )}

      {tab === "c-cal" && (
        <div className="comp-panel active">
          <div className="panel">
            <div className="panel-h"><h3>Compliance calendar</h3><span className="meta">statutory obligations</span></div>
            <div className="task"><span className="id">9 Jul</span><span className="txt">PAYE, NSSF, SHIF &amp; Housing Levy remittance<small>June payroll</small></span><span className="pill today">Due soon</span></div>
            <div className="task"><span className="id">20 Jul</span><span className="txt">VAT return &amp; payment (KRA)<small>via eTIMS</small></span><span className="pill week">This month</span></div>
            <div className="task"><span className="id">Sep</span><span className="txt">Annual Returns — Registrar of Companies</span><span className="pill week">Upcoming</span></div>
            <div className="task"><span className="id">Q4</span><span className="txt">Single Business Permit renewal</span><span className="pill week">Upcoming</span></div>
            <div className="task"><span className="id">Feb</span><span className="txt">Tax Compliance Certificate renewal</span><span className="pill done">Valid to 2027</span></div>
          </div>
        </div>
      )}

      {tab === "c-risk" && (
        <div className="comp-panel active">
          <div className="panel">
            <div className="panel-h">
              <h3>Risk register</h3>
              <span className="meta">
                <a href="#" onClick={(e) => { e.preventDefault(); toast("New risk", "Log a risk with owner and mitigation"); }} style={{ color: "var(--flame)", textDecoration: "none" }}>+ Add risk</a>
              </span>
            </div>
            <table className="tbl">
              <thead><tr><th>Risk</th><th>Owner</th><th>Severity</th><th>Mitigation</th></tr></thead>
              <tbody>
                <tr><td>Single-funder dependency (Wave 1)</td><td>Wilson</td><td><span className="pill over">High</span></td><td style={{ fontSize: 12 }}>Diversify pipeline — 7 funders live</td></tr>
                <tr><td>FX exposure (USD / KES)</td><td>Dennis</td><td><span className="pill today">Medium</span></td><td style={{ fontSize: 12 }}>Monthly revaluation; USD grant a/c</td></tr>
                <tr><td>Field data quality</td><td>Elizabeth</td><td><span className="pill today">Medium</span></td><td style={{ fontSize: 12 }}>Enumerator rubric + supervisor QA</td></tr>
                <tr><td>Key-person dependency</td><td>Dennis</td><td><span className="pill today">Medium</span></td><td style={{ fontSize: 12 }}>Documented SOPs; cross-training</td></tr>
                <tr><td>Carbon registry ambiguity</td><td>Wanjiku</td><td><span className="pill today">Medium</span></td><td style={{ fontSize: 12 }}>MRV lineage; verifier engagement</td></tr>
              </tbody>
            </table>
          </div>
        </div>
      )}
    </>
  );
}
