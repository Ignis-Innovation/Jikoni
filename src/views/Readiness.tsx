import { Pulse } from "../components/ui";
import { Bars } from "../components/charts";

const pulse = [
  { k: "Institutions assessed", tick: "t-blue", v: "214", d: "+38 this month", dc: "up" as const },
  { k: "Avg readiness", tick: "t-blue", v: "62", d: "of 100", dc: "up" as const },
  { k: "Tier A — ready", tick: "t-green", v: "41", d: "deploy now", dc: "up" as const },
  { k: "In EOI stage", tick: "t-ember", v: "73", d: "converting", dc: "flat" as const },
  { k: "Site visits due", tick: "t-ember", v: "19", d: "this week", dc: "flat" as const },
  { k: "Enumerators active", tick: "t-blue", v: "12", d: "5 counties", dc: "flat" as const },
];

export default function ReadinessView() {
  return (
    <>
      <div className="vhead">
        <div>
          <h1>Institution Readiness</h1>
          <p>Field assessment scoring, rolled up by county and tier. The pipeline from identification to deployment.</p>
        </div>
      </div>
      <Pulse data={pulse} />
      <div className="grid g-2">
        <div className="panel">
          <div className="panel-h"><h3>Readiness score by county</h3><span className="meta">avg of 100 · 5 dimensions</span></div>
          <div className="pad">
            <Bars rows={[
              { l: "Kiambu", n: "71", w: 71, c: "var(--flame)" },
              { l: "Nakuru", n: "66", w: 66, c: "var(--flame)" },
              { l: "Machakos", n: "61", w: 61, c: "var(--flame)" },
              { l: "Makueni", n: "58", w: 58, c: "var(--ember)" },
              { l: "Kajiado", n: "52", w: 52, c: "var(--ember)" },
            ]} />
          </div>
        </div>
        <div className="panel">
          <div className="panel-h"><h3>Pipeline by tier</h3><span className="meta">institutions assessed</span></div>
          <div className="pad">
            <Bars rows={[
              { l: "Tier A", n: "41", w: 38, c: "#3C8A5E" },
              { l: "Tier B", n: "68", w: 64, c: "#12A3BE" },
              { l: "Tier C", n: "62", w: 58, c: "var(--ember)" },
              { l: "Tier D", n: "43", w: 40, c: "#A89C8E" },
            ]} />
          </div>
        </div>
      </div>
    </>
  );
}
