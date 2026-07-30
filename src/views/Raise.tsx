import { useApp } from "../store";
import { funders } from "../data";

export default function RaiseView() {
  const { go } = useApp();

  return (
    <>
      <div className="vhead">
        <div>
          <h1>Fundraise &amp; Diligence</h1>
          <p>Where the $3M raise stands, funder by funder. The live answer when an investor opens the hood.</p>
        </div>
        <div className="actions">
          <button className="btn" onClick={() => go("users")}>Open data room</button>
        </div>
      </div>
      <div className="panel" style={{ marginBottom: 18 }}>
        <div className="panel-h"><h3>Progress to target</h3><span className="meta">USD · committed vs target</span></div>
        <div className="pad" style={{ fontSize: 12.5, color: "var(--ink-soft)", padding: "30px 20px", textAlign: "center" }}>
          No commitments recorded yet — the raise progress will show here.
        </div>
      </div>
      <div className="panel">
        <div className="panel-h"><h3>Funder pipeline</h3><span className="meta">by stage</span></div>
        <table className="tbl">
          <thead><tr><th>Funder</th><th>Type</th><th>Stage</th><th>Indicative</th></tr></thead>
          <tbody>
            {funders.length === 0 ? (
              <tr><td colSpan={4} style={{ textAlign: "center", color: "var(--ink-soft)", padding: "18px 0" }}>No funders in the pipeline yet.</td></tr>
            ) : funders.map((f) => (
              <tr key={f.n}>
                <td><strong>{f.n}</strong></td>
                <td>{f.ty}</td>
                <td><span className={`pill ${f.stc === "blue" ? "week" : f.stc === "ember" ? "today" : "over"}`} style={{ textTransform: "none" }}>{f.st}</span></td>
                <td className="mono">{f.amt}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}
