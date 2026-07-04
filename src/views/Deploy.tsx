import { useApp } from "../store";
import { Pulse } from "../components/ui";
import { Bars } from "../components/charts";
import { DocI } from "../components/icons";

const pulse = [
  { k: "Cookers deployed", tick: "t-blue", v: "1,840", d: "+212 this month", dc: "up" as const },
  { k: "Institutions live", tick: "t-blue", v: "47", d: "across 5 counties", dc: "up" as const },
  { k: "tCO₂e reduced", tick: "t-green", v: "3,120", d: "this quarter", dc: "up" as const },
  { k: "Credits in pipeline", tick: "t-ember", v: "2,640", d: "awaiting verification", dc: "flat" as const },
  { k: "Avg daily usage", tick: "t-blue", v: "4.1h", d: "per cooker", dc: "up" as const },
  { k: "Uptime", tick: "t-blue", v: "96%", d: "fleet", dc: "flat" as const },
];

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
      <Pulse data={pulse} />
      <div className="grid g-2">
        <div className="panel">
          <div className="panel-h"><h3>Assets deployed by county</h3><span className="meta">live · 5 counties</span></div>
          <div className="pad">
            <Bars rows={[
              { l: "Kiambu", n: "520", w: 100, c: "var(--flame)" },
              { l: "Machakos", n: "410", w: 79, c: "var(--flame)" },
              { l: "Makueni", n: "355", w: 68, c: "var(--flame)" },
              { l: "Nakuru", n: "310", w: 60, c: "var(--flame)" },
              { l: "Kajiado", n: "245", w: 47, c: "var(--flame)" },
            ]} />
          </div>
        </div>
        <div className="panel">
          <div className="panel-h"><h3>Carbon chain — this quarter</h3><span className="meta">tonnes CO₂e</span></div>
          <div className="pad">
            <Bars rows={[
              { l: "Deployed", n: "1,840", w: 100, c: "#12A3BE" },
              { l: "Active use", n: "1,766", w: 96, c: "#1597b8" },
              { l: "Fuel displaced", n: "3,440 t", w: 88, c: "#3C8A5E" },
              { l: "CO₂e reduced", n: "3,120 t", w: 82, c: "#3C8A5E" },
              { l: "Verified", n: "480 t", w: 15, c: "var(--ember)" },
            ]} />
          </div>
        </div>
      </div>
    </>
  );
}
