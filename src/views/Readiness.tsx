import { Pulse } from "../components/ui";

export default function ReadinessView() {
  return (
    <>
      <div className="vhead">
        <div>
          <h1>Institution Readiness</h1>
          <p>Field assessment scoring, rolled up by county and tier. The pipeline from identification to deployment.</p>
        </div>
      </div>
      <Pulse data={[]} />
      <div className="grid g-2">
        <div className="panel">
          <div className="panel-h"><h3>Readiness score by county</h3><span className="meta">avg of 100 · 5 dimensions</span></div>
          <div className="pad" style={{ fontSize: 12.5, color: "var(--ink-soft)", padding: "34px 20px", textAlign: "center" }}>No assessments recorded yet.</div>
        </div>
        <div className="panel">
          <div className="panel-h"><h3>Pipeline by tier</h3><span className="meta">institutions assessed</span></div>
          <div className="pad" style={{ fontSize: 12.5, color: "var(--ink-soft)", padding: "34px 20px", textAlign: "center" }}>No pipeline data yet.</div>
        </div>
      </div>
    </>
  );
}
