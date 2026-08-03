import { useState, type ReactNode } from "react";
import { useApp } from "../store";
import { pulseData, teamColors } from "../data";
import type { WeekTask } from "../data";
import { Pulse } from "../components/ui";
import { ExportI, CheckSqI, FlameGlyphI, PlusI } from "../components/icons";

// Panels with no live data source yet render a placeholder until they're wired.
function EmptyPad({ children }: { children: ReactNode }) {
  return <div className="pad" style={{ fontSize: 12.5, color: "var(--ink-soft)", padding: "34px 20px", textAlign: "center" }}>{children}</div>;
}

// One My Week row — click to expand its mini-tasks (checkboxes, add, mark done).
function TaskRow({ t, showOwner }: { t: WeekTask; showOwner: boolean }) {
  const { toggleSubtask, addSubtask, setTaskDone } = useApp();
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState("");
  const subs = t.subtasks ?? [];
  const done = subs.filter((s) => s.done).length;

  function add() {
    const v = draft.trim();
    if (!v) return;
    addSubtask(t.id, v); setDraft("");
  }
  return (
    <div>
      <div className="task" onClick={() => setOpen((o) => !o)} style={{ cursor: "pointer" }}>
        <span className="id">{t.id}</span>
        <span className="txt">
          {t.t}
          {(t.s || t.assignedBy) ? <small>{[t.s, t.assignedBy ? `assigned by ${t.assignedBy}` : ""].filter(Boolean).join(" · ")}</small> : null}
        </span>
        {subs.length > 0 && <span className="pill week" style={{ background: "transparent", border: "1px solid var(--line)", color: "var(--ink-soft)" }}>{done}/{subs.length}</span>}
        {showOwner && (
          <span className="ownerchip">
            <span className="oav" style={{ background: teamColors[t.o] || "#999" }}>{t.o[0]}</span>
            {t.o}
          </span>
        )}
        <span className={`pill ${t.p}`}>{t.pl}</span>
      </div>
      {open && (
        <div style={{ padding: "4px 14px 14px 76px", borderBottom: "1px solid var(--line)" }} onClick={(e) => e.stopPropagation()}>
          {subs.map((s, i) => (
            <label key={i} style={{ display: "flex", alignItems: "center", gap: 9, padding: "4px 0", fontSize: 13, cursor: "pointer" }}>
              <input type="checkbox" checked={s.done} onChange={() => toggleSubtask(t.id, i)} />
              <span style={{ textDecoration: s.done ? "line-through" : "none", color: s.done ? "var(--ink-soft)" : "var(--ink)" }}>{s.text}</span>
            </label>
          ))}
          <div style={{ display: "flex", gap: 8, marginTop: 8 }}>
            <input className="field" style={{ flex: 1 }} placeholder="Add a mini-task…" value={draft}
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); add(); } }} />
            <button className="btn" onClick={add}>Add</button>
            <button className="btn primary" onClick={() => setTaskDone(t.id, true)}>Mark done</button>
          </div>
        </div>
      )}
    </div>
  );
}

export default function HomeView() {
  const { entity, toast, myWeek, taskFilter, setTaskFilter, openTask, me } = useApp();
  const mine = taskFilter === "mine";
  const list = mine ? myWeek.filter((t) => t.ownerEmail === me?.email) : myWeek;

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
              <button className="btn" style={{ padding: "7px 11px", fontSize: 12 }} onClick={() => openTask("personal")}>
                <PlusI style={{ width: 14, height: 14 }} />Add task
              </button>
              <button className="btn primary" style={{ padding: "7px 11px", fontSize: 12 }} onClick={() => openTask("assign")}>
                <PlusI style={{ width: 14, height: 14 }} />Assign task
              </button>
            </div>
          </div>
          <div>
            {list.length ? (
              list.map((t) => <TaskRow key={t.id} t={t} showOwner={!mine} />)
            ) : (
              <div className="empty" style={{ padding: "34px 20px" }}>
                <div className="e-t">Nothing here yet</div>
                <div style={{ fontSize: 12, marginTop: 4 }}>Use <strong>Add task</strong> for your own, or <strong>Assign task</strong> to give one to a teammate.</div>
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
