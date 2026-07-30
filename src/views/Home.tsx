import type { ReactNode } from "react";
import { useApp } from "../store";
import { pulseData, teamColors } from "../data";
import { Pulse } from "../components/ui";
import { ExportI, CheckSqI, FlameGlyphI, PlusI } from "../components/icons";

// Panels with no live data source yet render a placeholder until they're wired.
function EmptyPad({ children }: { children: ReactNode }) {
  return <div className="pad" style={{ fontSize: 12.5, color: "var(--ink-soft)", padding: "34px 20px", textAlign: "center" }}>{children}</div>;
}

export default function HomeView() {
  const { entity, toast, myWeek, taskFilter, setTaskFilter, openTask, openRecord } = useApp();
  const mine = taskFilter === "mine";
  const list = mine ? myWeek.filter((t) => t.o === "Wanjiku") : myWeek;

  return (
    <>
      <div className="vhead">
        <div>
          <h1>What's on every burner</h1>
          <p>Live across finance, deployment, partnerships and the raise.</p>
        </div>
        <div className="actions">
          <button className="btn" onClick={() => toast("Snapshot saved", "Exported to the board pack as a live snapshot")}>
            <ExportI />
            Export to board pack
          </button>
        </div>
      </div>

      <Pulse data={pulseData[entity]} />

      <div className="grid g-2">
        <div className="panel">
          <div className="panel-h"><h3>Capital raised</h3><span className="meta">toward $3.0M target</span></div>
          <EmptyPad>No fundraise recorded yet.</EmptyPad>
        </div>
        <div className="panel">
          <div className="panel-h"><h3>Cookstoves deployed</h3><span className="meta">last 6 months · cumulative</span></div>
          <EmptyPad>No deployment data yet.</EmptyPad>
        </div>
      </div>

      <div className="grid g-2" style={{ marginTop: 18 }}>
        <div className="panel">
          <div className="panel-h">
            <h3>
              <span className="glyph ember"><CheckSqI /></span> My Week{" "}
              <span className="meta" style={{ fontWeight: 400, marginLeft: 4 }}>
                {mine ? `assigned to you · ${list.length}` : `whole team · ${list.length}`}
              </span>
            </h3>
            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <div className="seg-ctl mini">
                <button className={mine ? "on" : ""} onClick={() => setTaskFilter("mine")}>Mine</button>
                <button className={!mine ? "on" : ""} onClick={() => setTaskFilter("team")}>Team</button>
              </div>
              <button className="btn" style={{ padding: "7px 11px", fontSize: 12 }} onClick={openTask}>
                <PlusI style={{ width: 14, height: 14 }} />Add task
              </button>
            </div>
          </div>
          <div>
            {list.length ? (
              list.map((t) => (
                <div className="task" key={t.id} onClick={() => openRecord(t.id)}>
                  <span className="id">{t.id}</span>
                  <span className="txt">{t.t}{t.s ? <small>{t.s}</small> : null}</span>
                  {!mine && (
                    <span className="ownerchip">
                      <span className="oav" style={{ background: teamColors[t.o] || "#999" }}>{t.o[0]}</span>
                      {t.o}
                    </span>
                  )}
                  <span className={`pill ${t.p}`}>{t.pl}</span>
                </div>
              ))
            ) : (
              <div className="empty" style={{ padding: "34px 20px" }}>
                <div className="e-t">Nothing assigned yet</div>
                <div style={{ fontSize: 12, marginTop: 4 }}>Use Add task to assign one.</div>
              </div>
            )}
          </div>
        </div>

        <div className="panel">
          <div className="panel-h">
            <h3><span className="glyph blue"><FlameGlyphI /></span> Status Board</h3>
            <span className="meta">where things stand</span>
          </div>
          <div className="empty" style={{ padding: "34px 20px" }}>
            <div className="e-t">Nothing on the board yet</div>
            <div style={{ fontSize: 12, marginTop: 4 }}>Key items across the business will surface here.</div>
          </div>
        </div>
      </div>
    </>
  );
}
