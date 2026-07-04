import { useEffect, useState } from "react";
import { useApp } from "../store";
import { funders } from "../data";

export default function RaiseView() {
  const { toast, go } = useApp();
  const [animated, setAnimated] = useState(false);
  useEffect(() => {
    const t = setTimeout(() => setAnimated(true), 80);
    return () => clearTimeout(t);
  }, []);

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
        <div className="raise">
          <div className="top">
            <div className="big">$1.35M</div>
            <div className="of">committed of $3.0M target</div>
          </div>
          <div className="meter">
            <div className="seg" style={{ background: "var(--flame)", width: animated ? "18%" : 0 }}>Equity</div>
            <div className="seg" style={{ background: "var(--ember)", width: animated ? "27%" : 0 }}>Concessional</div>
          </div>
          <div className="legend">
            <span><i style={{ background: "var(--flame)" }} /> Equity committed · $0.55M</span>
            <span><i style={{ background: "var(--ember)" }} /> Concessional committed · $0.80M</span>
            <span><i style={{ background: "#F1EDE5" }} /> Remaining · $1.65M</span>
          </div>
        </div>
      </div>
      <div className="panel">
        <div className="panel-h"><h3>Funder pipeline</h3><span className="meta">by stage</span></div>
        <table className="tbl">
          <thead><tr><th>Funder</th><th>Type</th><th>Stage</th><th>Indicative</th></tr></thead>
          <tbody>
            {funders.map((f) => (
              <tr key={f.n} onClick={() => toast(f.n, "Opens the engagement, materials and next action")} style={{ cursor: "pointer" }}>
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
