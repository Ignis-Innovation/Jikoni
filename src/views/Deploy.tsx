import { useApp } from "../store";
import { Pulse } from "../components/ui";
import { DocI } from "../components/icons";

export default function DeployView() {
  const { toast } = useApp();
  return (
    <>
      <div className="vhead">
        <div>
          <h1>Deployment &amp; Carbon</h1>
          <p>Every cooker in the field, the institutions served, and the emissions chain that backs the carbon credits.</p>
        </div>
        <div className="actions">
          <button className="btn primary" onClick={() => toast("MRV export", "Deployment → usage → fuel displaced → credits, ready for verifier")}>
            <DocI />MRV pack
          </button>
        </div>
      </div>
      <Pulse data={[]} />
      <div className="grid g-2">
        <div className="panel">
          <div className="panel-h"><h3>Assets deployed by county</h3><span className="meta">by county</span></div>
          <div className="pad" style={{ fontSize: 12.5, color: "var(--ink-soft)", padding: "34px 20px", textAlign: "center" }}>No deployments recorded yet.</div>
        </div>
        <div className="panel">
          <div className="panel-h"><h3>Carbon chain</h3><span className="meta">tonnes CO₂e</span></div>
          <div className="pad" style={{ fontSize: 12.5, color: "var(--ink-soft)", padding: "34px 20px", textAlign: "center" }}>No carbon data yet.</div>
        </div>
      </div>
    </>
  );
}
