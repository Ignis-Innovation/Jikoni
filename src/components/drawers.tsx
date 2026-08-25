// Right-hand record drawers: engagement, vendor, project, access matrix.
import React, { useEffect, useState } from "react";
import { useApp } from "../store";
import {
  engDetails, engStages, vendorDetails, roleMeta,
  accessModules, lvlName, lvlClass, roleTemplates, Perms,
} from "../data";
import { XI, LockI, EyeI, PlusI, ExportI } from "./icons";

function LinkBtn({ label, onClick, primary, icon }: { label: string; onClick: () => void; primary?: boolean; icon?: React.ReactNode }) {
  return (
    <button className={`btn ${primary ? "primary" : ""}`} style={{ padding: "6px 11px", fontSize: 12, margin: "0 6px 6px 0" }} onClick={onClick}>
      {icon}{label}{primary ? "" : " →"}
    </button>
  );
}

function DrawerShell({ open, onClose, width, header, footer, children }: {
  open: boolean; onClose: () => void; width?: number;
  header: React.ReactNode; footer: React.ReactNode; children: React.ReactNode;
}) {
  return (
    <>
      <div className={`drawer-bg ${open ? "show" : ""}`} onClick={onClose} />
      <div className={`drawer ${open ? "show" : ""}`} style={width ? { width } : undefined}>
        <div className="drawer-h">
          {header}
          <button className="drawer-x" onClick={onClose}><XI /></button>
        </div>
        <div className="drawer-b">{children}</div>
        <div className="drawer-f">{footer}</div>
      </div>
    </>
  );
}

/* Horizontal stage ribbon — rungs before/at the current stage read as done. */
function StageRibbon({ stages, current }: { stages: string[]; current: string }) {
  const curIdx = stages.indexOf(current);
  return (
    <div className="eng-ribbon">
      {stages.map((s, i) => {
        const state = curIdx < 0 ? "todo" : i < curIdx ? "done" : i === curIdx ? "now" : "todo";
        return (
          <React.Fragment key={s}>
            <div className={`rib-step ${state}`}>
              <span className="rib-dot" />
              <span className="rib-lbl">{s}</span>
            </div>
            {i < stages.length - 1 && <span className={`rib-line ${i < curIdx ? "done" : ""}`} />}
          </React.Fragment>
        );
      })}
    </div>
  );
}

/* ================= ENGAGEMENT ================= */
export function EngDrawer() {
  const {
    engId, closeEng, toast, engToProject, xProject, createProjectFromEng, openTask,
    crm, openEngUpdate, setEngagementPartners, engDocUrl, level,
  } = useApp();
  const canEdit = level("crm") >= 2;
  // Engagement comes straight from the live CRM read model (DB) — the header,
  // stage ribbon, updates log and links all read from it.
  const up = engId ? crm.engUp.some((e) => e.id === engId) : false;
  const live = engId ? [...crm.engUp, ...crm.engDown].find((e) => e.id === engId) : null;
  const b = live
    ? { id: live.id, n: live.n, st: live.st, o: live.o, pl: live.pl, plt: live.plt, pipeline: (up ? "up" : "down") as "up" | "down" }
    : null;
  const det = (engId && engDetails[engId]) || {};
  const stage = live?.st || b?.st || "";
  const updates = live?.updates ?? det.updates ?? [];
  const ladder = engStages[up ? "up" : "down"];

  // partner links — currently linked + inline multi-select editor
  const linkedIds = (engId && crm.engPartners[engId]) || [];
  const [editLinks, setEditLinks] = useState(false);
  const [checked, setChecked] = useState<Record<string, boolean>>({});
  useEffect(() => { setEditLinks(false); }, [engId]);
  function openLinkEditor() {
    const seed: Record<string, boolean> = {};
    linkedIds.forEach((id) => { seed[id] = true; });
    setChecked(seed);
    setEditLinks(true);
  }
  function saveLinks() {
    if (!engId) return;
    setEngagementPartners(engId, Object.keys(checked).filter((id) => checked[id]));
    setEditLinks(false);
  }
  const linkedPartners = crm.partners.filter((p) => linkedIds.includes(p.id));

  return (
    <DrawerShell
      open={!!b}
      onClose={closeEng}
      width={520}
      header={
        <div className="dt">
          <div className="av-sm" style={{ width: 38, height: 38, fontSize: 15, background: up ? "#12A3BE" : "#E2632A" }}>{b ? b.n[0] : "—"}</div>
          <div>
            <h3>{b ? b.n : "—"}</h3>
            <div className="sub">{b ? `${b.id} · ${det.type || (up ? "Upstream" : "Downstream")} · ${b.o}` : "—"}</div>
          </div>
        </div>
      }
      footer={
        canEdit ? <button className="btn primary" style={{ width: "100%" }} onClick={openEngUpdate}>Update</button> : undefined
      }
    >
      {b && (
        <>
          <div className="eng-chips">
            <span className={`pill ${b.pl}`}>{b.plt || stage}</span>
            {det.priority && <span className="acc-chip">{det.priority} priority</span>}
            <span className="acc-chip">{up ? "Upstream · capital" : "Downstream · deployment"}</span>
            {det.value && <span className="acc-chip full">{det.value}</span>}
          </div>

          <div className="eng-sec">Progress</div>
          <StageRibbon stages={ladder} current={stage} />

          <div className="eng-next">
            <div className="l">Next action · {det.due || b.plt || "—"}</div>
            {det.next || stage}
          </div>

          <div className="eng-sec">
            Updates log{" "}
            <a href="#" onClick={(e) => { e.preventDefault(); openEngUpdate(); }} style={{ color: "var(--flame)", textDecoration: "none", fontWeight: 600, textTransform: "none", letterSpacing: 0, marginLeft: 6 }}>+ update</a>
          </div>
          <div>
            {updates.length ? (
              updates.map((u, i) => (
                <div className="upd" key={i}>
                  <div className="um">{u.d} · {u.ch} · {u.who}</div>
                  <div className="un">{u.note}</div>
                </div>
              ))
            ) : (
              <div style={{ fontSize: 12.5, color: "var(--ink-soft)", padding: "4px 0" }}>No updates logged yet — hit Update to start the diary.</div>
            )}
          </div>

          <div className="eng-sec">
            Action items{" "}
            <a href="#" onClick={(e) => { e.preventDefault(); openTask(); }} style={{ color: "var(--flame)", textDecoration: "none", fontWeight: 600, textTransform: "none", letterSpacing: 0, marginLeft: 6 }}>+ add</a>
          </div>
          <div>
            {det.tasks?.length ? (
              det.tasks.map((t, i) => (
                <div className="task" style={{ paddingLeft: 0, paddingRight: 0 }} key={i}>
                  <span className="txt">{t.t}<small>{t.owner}</small></span>
                  <span className={`pill ${t.pill}`}>{t.due}</span>
                </div>
              ))
            ) : (
              <div style={{ fontSize: 12.5, color: "var(--ink-soft)", padding: "4px 0" }}>No open action items.</div>
            )}
          </div>

          {(live?.docs?.length ?? 0) > 0 && (
            <>
              <div className="eng-sec">Documents</div>
              <div>
                {live!.docs.map((d, i) => (
                  <div className="recon" style={{ paddingLeft: 0, paddingRight: 0 }} key={i}>
                    <span>{d.name}</span>
                    <span style={{ display: "flex", gap: 6 }}>
                      <button className="btn" style={{ padding: "4px 10px", fontSize: 11.5 }} onClick={() => window.open(engDocUrl(d.path), "_blank", "noopener")}>Open</button>
                      <a className="btn" style={{ padding: "4px 10px", fontSize: 11.5 }} href={engDocUrl(d.path, d.name)}>Download</a>
                    </span>
                  </div>
                ))}
              </div>
            </>
          )}

          <div className="eng-sec">
            Linked partners{" "}
            {canEdit && <a href="#" onClick={(e) => { e.preventDefault(); editLinks ? setEditLinks(false) : openLinkEditor(); }} style={{ color: "var(--flame)", textDecoration: "none", fontWeight: 600, textTransform: "none", letterSpacing: 0, marginLeft: 6 }}>{editLinks ? "close" : linkedPartners.length ? "edit" : "+ link"}</a>}
          </div>
          {editLinks ? (
            <div>
              <div style={{ maxHeight: 220, overflowY: "auto", border: "1px solid var(--hairline)", borderRadius: 8, padding: "4px 0", marginBottom: 10 }}>
                {crm.partners.length === 0 && <div style={{ fontSize: 12.5, color: "var(--ink-soft)", padding: "8px 12px" }}>No partners in the registry yet.</div>}
                {crm.partners.map((p) => (
                  <label key={p.id} style={{ display: "flex", alignItems: "center", gap: 10, padding: "7px 12px", fontSize: 13, cursor: "pointer" }}>
                    <input type="checkbox" checked={!!checked[p.id]} onChange={(e) => setChecked((c) => ({ ...c, [p.id]: e.target.checked }))} />
                    <span style={{ flex: 1 }}>{p.name}<small style={{ display: "block", color: "var(--ink-soft)", fontSize: 11 }}>{p.type} · {p.country}</small></span>
                  </label>
                ))}
              </div>
              <div style={{ display: "flex", gap: 8 }}>
                <button className="btn primary" style={{ padding: "6px 14px", fontSize: 12 }} onClick={saveLinks}>Save links</button>
                <button className="btn" style={{ padding: "6px 14px", fontSize: 12 }} onClick={() => setEditLinks(false)}>Cancel</button>
              </div>
            </div>
          ) : linkedPartners.length ? (
            <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
              {linkedPartners.map((p) => <span className="acc-chip" key={p.id}>{p.name}</span>)}
            </div>
          ) : (
            <div style={{ fontSize: 12.5, color: "var(--ink-soft)", padding: "4px 0" }}>No partners linked — use “+ link” to attach one or more.</div>
          )}

          {(engToProject[b.id] || !up) && (
            <>
              <div className="eng-sec">Project</div>
              <div style={{ display: "flex", flexWrap: "wrap" }}>
                {engToProject[b.id] ? (
                  <LinkBtn label="Open linked project" onClick={() => xProject(engToProject[b.id])} />
                ) : (
                  <LinkBtn
                    primary
                    icon={<PlusI style={{ width: 13, height: 13, verticalAlign: -2 }} />}
                    label=" Create project"
                    onClick={() => createProjectFromEng(b.id)}
                  />
                )}
              </div>
            </>
          )}
        </>
      )}
    </DrawerShell>
  );
}

/* ================= VENDOR ================= */
export function VendorDrawer() {
  const { vendorName, closeVendor, toast, xTab, level } = useApp();
  const canEdit = level("procurement") >= 2;
  const v = vendorName ? vendorDetails[vendorName] : null;

  return (
    <DrawerShell
      open={!!v}
      onClose={closeVendor}
      width={520}
      header={
        <div className="dt">
          <div className="av-sm" style={{ width: 38, height: 38, fontSize: 15, background: "#12A3BE" }}>{vendorName ? vendorName[0] : "—"}</div>
          <div>
            <h3>{vendorName || "—"}</h3>
            <div className="sub">{v ? v.cat + " · " + v.country + (v.rating && v.rating !== "—" ? " · ★ " + v.rating : "") : "—"}</div>
          </div>
        </div>
      }
      footer={
        <>
          {canEdit && <button className="btn" onClick={() => toast("Raise PO", "Create a purchase order for this vendor")}>Raise PO</button>}
          {canEdit && <button className="btn primary" onClick={() => toast("Upload document", "Attach a document to this vendor record")}>Upload document</button>}
        </>
      }
    >
      {v && (
        <>
          <div className="eng-chips">
            <span className={`acc-chip ${v.tax === "Compliant" ? "full" : ""}`}>{v.tax}</span>
            <span className={`acc-chip ${v.screen === "Cleared" ? "full" : ""}`}>{v.screen === "Cleared" ? "Screened ✓" : v.screen}</span>
            {v.openPOs > 0 && <span className="acc-chip">{v.openPOs} open PO{v.openPOs > 1 ? "s" : ""}</span>}
          </div>
          <div className="eng-sec">Relationship</div>
          <div>
            <div className="recon" style={{ padding: "8px 0" }}><span>Vendor since</span><span className="mono">{v.since}</span></div>
            <div className="recon" style={{ padding: "8px 0" }}><span>Total spend to date</span><span className="mono">{v.spend}</span></div>
            <div className="recon" style={{ padding: "8px 0" }}><span>Payment account</span><span className="mono">{v.bank}</span></div>
          </div>
          <div className="eng-sec">History</div>
          <div>
            {v.timeline.map((t, i) => (
              <div className="upd" key={i}>
                <div className="um">{t.d} · {t.ev}</div>
                <div className="un">{t.note}</div>
              </div>
            ))}
          </div>
          <div className="eng-sec">Contracts</div>
          <div>
            {v.contracts.length ? (
              v.contracts.map((c, i) => (
                <div className="recon" style={{ padding: "9px 0" }} key={i}>
                  <span>
                    {c.name}
                    <br />
                    <small style={{ color: "var(--ink-soft)", fontFamily: "var(--mono)" }}>{c.type} · exp {c.expiry}</small>
                  </span>
                  <span className={`pill ${c.status === "Active" ? "done" : "today"}`}>{c.status}</span>
                </div>
              ))
            ) : (
              <div style={{ fontSize: 12.5, color: "var(--ink-soft)", padding: "4px 0" }}>No contracts on file.</div>
            )}
          </div>
          <div className="eng-sec">Documents shared</div>
          <div>
            {v.docs.map((d, i) => (
              <div className="recon" style={{ padding: "8px 0" }} key={i}>
                <span>{d}</span>
                <button className="btn" style={{ padding: "4px 10px", fontSize: 11.5 }} onClick={() => toast(d, "Opens the shared document")}>Open</button>
              </div>
            ))}
          </div>
          <div className="eng-sec">Linked records</div>
          <div style={{ display: "flex", flexWrap: "wrap" }}>
            <LinkBtn label="Purchase orders" onClick={() => xTab("procurement", "p-po")} />
            <LinkBtn label="Contract registry" onClick={() => xTab("compliance", "c-docs")} />
          </div>
        </>
      )}
    </DrawerShell>
  );
}

/* ================= PROJECT ================= */
const MS_OPTS: [string, string][] = [["done", "Complete"], ["now", "In progress"], ["todo", "Upcoming"]];
const STATE_NEXT: Record<string, { to: string; label: string }> = {
  setup: { to: "active", label: "Activate project" },
  active: { to: "reporting", label: "Move to reporting" },
  reporting: { to: "closed", label: "Close project" },
};
const ACT_KINDS: [string, string][] = [["site_visit", "Site visit"], ["install", "Installation"], ["readiness_assessment", "Readiness assessment"]];
const smallField = { padding: "4px 8px", fontSize: 11.5, width: "auto" } as const;

export function ProjectDrawer() {
  const {
    projectName, closeProject, toast, projectDetails,
    addMilestone, setMilestoneStatus, logFieldActivity, setProjectState,
    addProjectDocument, projectDocUrl, level,
  } = useApp();
  const canEdit = level("projects") >= 2;
  const p = projectName ? projectDetails[projectName] : null;
  const ms: Record<string, [string, string]> = { done: ["done", "Complete"], now: ["today", "In progress"], todo: ["week", "Upcoming"] };

  const [msTitle, setMsTitle] = useState("");
  const [msAmt, setMsAmt] = useState("");
  const [msStart, setMsStart] = useState("");
  const [msEnd, setMsEnd] = useState("");
  const [showAct, setShowAct] = useState(false);
  const [actKind, setActKind] = useState("site_visit");
  const [actCounty, setActCounty] = useState("");
  const [actNote, setActNote] = useState("");
  useEffect(() => {
    setMsTitle(""); setMsAmt(""); setMsStart(""); setMsEnd("");
    setShowAct(false); setActKind("site_visit"); setActCounty(""); setActNote("");
  }, [projectName]);

  const kes0 = (n: number) => "KES " + Math.round(n).toLocaleString();
  const budgetAmount = p?.budgetAmount ?? 0;
  const usedTotal = (p?.milestones ?? []).reduce((s, m) => s + (m.amount ?? 0), 0);
  const remaining = budgetAmount - usedTotal;
  const newAmt = parseFloat(msAmt) || 0;
  const overBudget = newAmt > remaining + 0.001;

  const next = p?.state ? STATE_NEXT[p.state] : undefined;
  const submitActivity = () => {
    if (!p?.id) return;
    logFieldActivity(p.id, actKind, actCounty, actNote);
    setActNote(""); setActCounty(""); setShowAct(false);
  };

  return (
    <DrawerShell
      open={!!p}
      onClose={closeProject}
      width={520}
      header={
        <div className="dt">
          <div className="av-sm" style={{ width: 38, height: 38, fontSize: 15, background: "#3C8A5E" }}>P</div>
          <div>
            <h3>{projectName || "—"}</h3>
            <div className="sub">{p ? `${p.funder} · ${p.timeline} · ${p.team}` : "—"}</div>
          </div>
        </div>
      }
      footer={
        <>
          {canEdit && <button className="btn" onClick={() => setShowAct((s) => !s)}>Log activity</button>}
          <button className="btn primary" onClick={() => toast("Generate report", "Draft the funder report from live data")}>Generate report</button>
        </>
      }
    >
      {p && projectName && (
        <>
          <div className="eng-chips">
            <span className={`pill ${p.status === "On track" || p.status === "Active" ? "done" : "today"}`}>{p.status}</span>
            <span className="acc-chip">Budget {p.budget}</span>
            <span className="acc-chip full">Spent {p.spent} · {p.pct}</span>
          </div>
          {p.id && next && canEdit && (
            <button className="btn" style={{ padding: "5px 11px", fontSize: 12, marginTop: 4 }}
              onClick={() => setProjectState(p.id!, next.to)}>{next.label} →</button>
          )}
          <div className="eng-sec">Overview</div>
          <div>
            <div className="recon" style={{ padding: "8px 0" }}><span>Funder</span><span className="mono">{p.funder}</span></div>
            <div className="recon" style={{ padding: "8px 0" }}><span>Timeline</span><span className="mono">{p.timeline}</span></div>
            <div className="recon" style={{ padding: "8px 0" }}><span>Reporting</span><span className="mono">{p.reporting}</span></div>
            <div className="recon" style={{ padding: "8px 0" }}><span>Field activity</span><span className="mono">{p.field}</span></div>
          </div>
          {showAct && p.id && (
            <div style={{ background: "#FCFAF6", borderRadius: 10, padding: 12, marginTop: 8 }}>
              <div className="eng-sec" style={{ marginTop: 0 }}>Log field activity</div>
              <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
                <select className="field" style={smallField} value={actKind} onChange={(e) => setActKind(e.target.value)}>
                  {ACT_KINDS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
                </select>
                <input className="field" style={{ ...smallField, flex: 1 }} placeholder="County (optional)" value={actCounty} onChange={(e) => setActCounty(e.target.value)} />
              </div>
              <input className="field" style={{ width: "100%", marginTop: 8 }} placeholder="Note (optional)" value={actNote} onChange={(e) => setActNote(e.target.value)} />
              <div style={{ display: "flex", justifyContent: "flex-end", gap: 8, marginTop: 8 }}>
                <button className="btn" style={{ padding: "4px 10px", fontSize: 11.5 }} onClick={() => setShowAct(false)}>Cancel</button>
                <button className="btn primary" style={{ padding: "4px 10px", fontSize: 11.5 }} onClick={submitActivity}>Log activity</button>
              </div>
            </div>
          )}
          <div className="eng-sec">Milestones</div>
          <div>
            {p.milestones.map((m, i) => (
              <div className="recon" style={{ padding: "8px 0", gap: 8 }} key={m.id ?? i}>
                {m.id && (
                  <input type="checkbox" checked={m.s === "done"}
                    onChange={(e) => setMilestoneStatus(m.id!, e.target.checked ? "done" : "todo")}
                    style={{ cursor: "pointer", width: 16, height: 16, accentColor: "var(--flame)", flexShrink: 0 }}
                    title={m.s === "done" ? "Mark not complete" : "Mark complete"} />
                )}
                <span style={{ flex: 1, textDecoration: m.s === "done" ? "line-through" : "none", color: m.s === "done" ? "var(--ink-soft)" : "inherit" }}>
                  {m.t}
                  <br />
                  <small style={{ color: "var(--ink-soft)", fontFamily: "var(--mono)" }}>
                    {kes0(m.amount ?? 0)}{m.start ? ` · ${m.start}${m.end ? ` → ${m.end}` : ""}` : ""}
                  </small>
                </span>
                {m.id && canEdit
                  ? <select className="field" style={smallField} value={m.s} onChange={(e) => setMilestoneStatus(m.id!, e.target.value)}>
                      {MS_OPTS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
                    </select>
                  : <span className={`pill ${ms[m.s][0]}`}>{ms[m.s][1]}</span>}
              </div>
            ))}
            {p.id && canEdit && (
              <div style={{ marginTop: 6 }}>
                <div className="recon" style={{ padding: "6px 0", fontSize: 11.5, color: overBudget ? "var(--flame)" : "var(--ink-soft)" }}>
                  <span>Milestones {kes0(usedTotal)} of {kes0(budgetAmount)}</span>
                  <span className="mono">{kes0(Math.max(remaining, 0))} left</span>
                </div>
                <div style={{ display: "flex", gap: 8 }}>
                  <input className="field" style={{ flex: 2, padding: "5px 9px", fontSize: 12 }} placeholder="New milestone…" value={msTitle} onChange={(e) => setMsTitle(e.target.value)} />
                  <input className="field" style={{ flex: 1, padding: "5px 9px", fontSize: 12 }} type="number" min="0" placeholder="Amount" value={msAmt} onChange={(e) => setMsAmt(e.target.value)} />
                </div>
                <div style={{ display: "flex", gap: 8, marginTop: 8, alignItems: "center" }}>
                  <input className="field" style={{ flex: 1, padding: "5px 9px", fontSize: 12 }} type="date" title="Start date" value={msStart} onChange={(e) => setMsStart(e.target.value)} />
                  <input className="field" style={{ flex: 1, padding: "5px 9px", fontSize: 12 }} type="date" title="End date" value={msEnd} onChange={(e) => setMsEnd(e.target.value)} />
                  <button className="btn" style={{ padding: "5px 10px", fontSize: 11.5 }} disabled={!msTitle.trim() || newAmt <= 0 || overBudget}
                    onClick={() => { addMilestone(p.id!, msTitle.trim(), newAmt, msStart, msEnd); setMsTitle(""); setMsAmt(""); setMsStart(""); setMsEnd(""); }}><PlusI />Add</button>
                </div>
                {overBudget && <div style={{ fontSize: 11, color: "var(--flame)", marginTop: 5 }}>That would push milestones past the budget — only {kes0(Math.max(remaining, 0))} left.</div>}
              </div>
            )}
          </div>
          <div className="eng-sec">Drawdowns <span style={{ textTransform: "none", fontWeight: 400, letterSpacing: 0, color: "var(--ink-soft)", fontSize: 11 }}>· recognised when a milestone is completed</span></div>
          <div>
            {p.drawdowns.length === 0 && <div style={{ color: "var(--ink-soft)", fontSize: 12, padding: "6px 0" }}>None yet — complete a milestone to draw down its amount.</div>}
            {p.drawdowns.map((d, i) => (
              <div className="recon" style={{ padding: "8px 0" }} key={d.id ?? i}>
                <span>
                  {d.t}
                  <br />
                  <small style={{ color: "var(--ink-soft)", fontFamily: "var(--mono)" }}>{d.v}</small>
                </span>
                <span className={`pill ${d.s === "Received" ? "done" : "today"}`}>{d.s}</span>
              </div>
            ))}
          </div>
          <div className="eng-sec">Documents</div>
          <div>
            {p.docs.map((d, i) => {
              const file = typeof d === "object" ? d : null;   // uploaded files carry a path
              const label = typeof d === "string" ? d : d.name;
              const iconBtn = { padding: "4px 8px", fontSize: 11.5, display: "inline-flex", alignItems: "center", gap: 5, textDecoration: "none" } as const;
              return (
                <div className="recon" style={{ padding: "8px 0", gap: 8 }} key={i}>
                  <span style={{ flex: 1 }}>{label}</span>
                  {file ? (
                    <span style={{ display: "flex", gap: 6 }}>
                      <a className="btn" style={iconBtn} href={projectDocUrl(file.path)} target="_blank" rel="noreferrer" title="View"><EyeI /> View</a>
                      <a className="btn" style={iconBtn} href={projectDocUrl(file.path, file.name)} title="Download"><ExportI /> Download</a>
                    </span>
                  ) : (
                    <button className="btn" style={{ padding: "4px 10px", fontSize: 11.5 }} onClick={() => toast(String(d), "Opens the document")}>Open</button>
                  )}
                </div>
              );
            })}
            {!p.docs.length && <div style={{ fontSize: 12.5, color: "var(--ink-soft)", padding: "4px 0" }}>No documents yet.</div>}
            {p.id && canEdit && (
              <label className="btn" style={{ padding: "5px 10px", fontSize: 11.5, marginTop: 6, display: "inline-flex", alignItems: "center", gap: 5, cursor: "pointer" }}>
                <PlusI />Upload document
                <input type="file" style={{ display: "none" }}
                  onChange={(e) => { const f = e.target.files?.[0]; if (f && p.id) addProjectDocument(p.id, f); e.target.value = ""; }} />
              </label>
            )}
          </div>
        </>
      )}
    </DrawerShell>
  );
}

/* ================= PROFORMA RECORD ================= */
export function ProformaDrawer() {
  const { pfRecRef, closeProformaRec, proformas, acceptProforma, declineProforma, level } = useApp();
  const canEdit = level("finance") >= 2;
  const p = pfRecRef ? proformas.find((x) => x.ref === pfRecRef) : null;
  const [showDecline, setShowDecline] = useState(false);
  const [reason, setReason] = useState("");
  useEffect(() => { setShowDecline(false); setReason(""); }, [pfRecRef]);

  const kesFmt = (n: number) => "KES " + Math.round(n).toLocaleString();
  const subtotal = p?.subtotal ?? 0;
  const vat = Math.round(subtotal * 0.16);
  const daysLeft = p?.validRaw ? Math.round((new Date(p.validRaw).getTime() - Date.now()) / 864e5) : null;
  const issuedLive = p?.state === "issued";
  const lapsed = issuedLive && daysLeft != null && daysLeft < 0;

  const rules =
    p?.state === "accepted"
      ? `Accepted and converted to tax invoice ${p.invoiceRef ?? ""}. That invoice is now the revenue and the receivable — it was reported to eTIMS and is being aged and chased until the receipt lands. Acceptance is not cash; the money is real only at the receipt.`
      : p?.state === "declined"
      ? "Declined by the customer. Nothing posted to the ledger — a proforma is never revenue. The reason is kept so the pattern of why quotes are lost is visible."
      : p?.state === "expired" || lapsed
      ? "The validity period lapsed with no response. Nothing posted. It can be re-issued as a fresh proforma if the customer comes back."
      : "While issued, this is an offer only. Nothing has posted to the ledger and no VAT is due. Accepting it converts it to a tax invoice, reports that invoice to eTIMS, and creates a receivable that is then chased to collection. If the customer declines, record why — that feeds the conversion rate. If neither happens by the valid-to date, it expires on its own.";

  return (
    <DrawerShell
      open={!!p}
      onClose={closeProformaRec}
      width={540}
      header={
        <div className="dt">
          <div className="av-sm" style={{ width: 38, height: 38, fontSize: 15, background: "#12A3BE" }}>{p?.customer?.[0] ?? "—"}</div>
          <div>
            <h3>{p?.customer || "—"}</h3>
            <div className="sub">{p ? `${p.ref} · raised by ${p.owner || "—"}` : "—"}</div>
          </div>
        </div>
      }
      footer={
        p && issuedLive && canEdit ? (
          <>
            <button className="btn" onClick={() => setShowDecline((s) => !s)}>Record decline</button>
            <button className="btn primary" onClick={() => acceptProforma(p.ref)}>Accept → tax invoice</button>
          </>
        ) : (
          <div style={{ fontSize: 12.5, color: "var(--ink-soft)", alignSelf: "center" }}>
            {p?.state === "accepted" ? `Converted to ${p.invoiceRef ?? "tax invoice"}` : p ? (lapsed ? "Lapsed" : p.statusTxt) : "—"}
          </div>
        )
      }
    >
      {p && (
        <>
          <div style={{ display: "flex", gap: 7, flexWrap: "wrap", alignItems: "center", marginBottom: 6 }}>
            <span className={`pill ${lapsed ? "week" : p.statusCls}`}>{lapsed ? "Lapsed" : p.statusTxt}</span>
            <span className="pill done">{kesFmt(subtotal)}</span>
          </div>

          <div className="panel" style={{ marginBottom: 14 }}>
            <div className="panel-h"><h3>Proforma</h3><span className="meta">the offer</span></div>
            <div className="recon"><span>Proforma no.</span><span className="mono">{p.ref}</span></div>
            <div className="recon"><span>Customer</span><span>{p.customer}</span></div>
            <div className="recon"><span>Raised by</span><span>{p.owner || "—"}</span></div>
            <div className="recon"><span>Issued</span><span className="mono">{p.issued}</span></div>
            {p.terms && <div className="recon"><span>Payment terms</span><span>{p.terms}</span></div>}
            {p.lead && <div className="recon"><span>Lead time</span><span>{p.lead}</span></div>}
            {p.notes && <div className="recon"><span>Notes</span><span style={{ textAlign: "right", maxWidth: 300 }}>{p.notes}</span></div>}
            <div className="recon"><span>Currency</span><span>{p.currency}</span></div>
          </div>

          <div className="panel" style={{ marginBottom: 14 }}>
            <div className="panel-h"><h3>Status &amp; validity</h3><span className="meta">where it stands</span></div>
            <div className="recon"><span>Status</span><span className={`pill ${lapsed ? "week" : p.statusCls}`}>{lapsed ? "Lapsed" : p.statusTxt}</span></div>
            <div className="recon"><span>Valid to</span><span className="mono">{p.validTo}{issuedLive && daysLeft != null && daysLeft >= 0 ? ` · ${daysLeft}d left` : ""}</span></div>
            {p.state === "accepted" && <div className="recon"><span>Tax invoice</span><span className="mono" style={{ color: "var(--green)" }}>{p.invoiceRef} · issued</span></div>}
            {p.state === "declined" && <div className="recon"><span>Decline reason</span><span style={{ color: "var(--red)", textAlign: "right", maxWidth: 300 }}>{p.declineReason || "—"}</span></div>}
          </div>

          <div className="panel" style={{ marginBottom: 14 }}>
            <div className="panel-h"><h3>Line items</h3><span className="meta">what is being quoted</span></div>
            <table className="tbl">
              <thead><tr><th>Item</th><th>Qty</th><th>Unit price</th><th style={{ textAlign: "right" }}>Line total</th></tr></thead>
              <tbody>
                {p.lines.map((l, i) => (
                  <tr key={i}>
                    <td>{l.d}</td>
                    <td className="mono">{l.q}</td>
                    <td className="mono">{kesFmt(l.p)}</td>
                    <td className="mono" style={{ textAlign: "right" }}>{kesFmt(l.q * l.p)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            <div style={{ borderTop: "1px solid var(--hairline)" }}>
              <div className="recon"><span>Subtotal</span><span className="mono">{kesFmt(subtotal)}</span></div>
              <div className="recon"><span>VAT (16%) <span style={{ color: "var(--ink-soft)", fontSize: 11 }}>— applies only on the tax invoice</span></span><span className="mono">{kesFmt(vat)}</span></div>
              <div className="recon" style={{ fontWeight: 600 }}><span>Total if accepted</span><span className="mono">{kesFmt(subtotal + vat)}</span></div>
            </div>
          </div>

          {showDecline && issuedLive && canEdit && (
            <div className="panel" style={{ marginBottom: 14 }}>
              <div className="panel-h"><h3>Record decline</h3><span className="meta">kept for conversion analysis</span></div>
              <div className="pad">
                <input className="field" placeholder="Why was it declined? e.g. Chose a lower-cost LPG option" value={reason} onChange={(e) => setReason(e.target.value)} />
                <div style={{ display: "flex", gap: 8, marginTop: 10 }}>
                  <button className="btn" onClick={() => { setShowDecline(false); setReason(""); }}>Cancel</button>
                  <button className="btn primary" onClick={() => declineProforma(p.ref, reason)}>Confirm decline</button>
                </div>
              </div>
            </div>
          )}

          <div className="panel">
            <div className="panel-h"><h3>What happens on a decision</h3><span className="meta">the rules</span></div>
            <div style={{ padding: "15px 18px", fontSize: 12.5, color: "var(--ink-soft)", lineHeight: 1.65 }}>{rules}</div>
          </div>
        </>
      )}
    </DrawerShell>
  );
}

/* ================= ACCESS ================= */
export function AccessDrawer() {
  const { accessEmail, closeAccess, perms, saveAccess, toast, members, setReportTrack } = useApp();
  const u = accessEmail ? members.find((x) => x.email === accessEmail) : null;
  const [draft, setDraft] = useState<Perms>({});

  useEffect(() => {
    if (!accessEmail || !u) return;
    const base = { ...(perms[accessEmail] || roleTemplates[u.roleKey] || {}) };
    accessModules.forEach((m) => { if (base[m.k] == null) base[m.k] = 0; });
    setDraft(base);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [accessEmail]);

  const labels = ["None", "View", "Edit", "Full"];
  const cls = ["none", "view", "edit", "full"];
  const visible = accessModules.filter((m) => (draft[m.k] || 0) >= 1);

  function applyTemplate(role: string) {
    if (!role) return;
    const t = { ...roleTemplates[role] };
    accessModules.forEach((m) => { if (t[m.k] == null) t[m.k] = 0; });
    setDraft(t);
    toast("Applied the " + roleMeta[role][1] + " template", "Adjust any module before saving");
  }

  return (
    <DrawerShell
      open={!!u}
      onClose={closeAccess}
      header={
        <div className="dt">
          <div className="av-sm" style={{ width: 38, height: 38, fontSize: 15, background: u?.color ?? undefined }}>{u ? u.name[0] : "—"}</div>
          <div>
            <h3>{u ? u.name : "—"}</h3>
            <div className="sub">
              {u ? (u.roleTitle ?? roleMeta[u.roleKey]?.[1] ?? "Member") + " · " + (roleMeta[u.roleKey]?.[1] ?? u.roleKey) + (perms[u.email]?.users === 3 ? " · super admin" : "") : "—"}
            </div>
          </div>
        </div>
      }
      footer={
        <>
          <button className="btn" onClick={closeAccess}>Cancel</button>
          <button className="btn primary" onClick={() => accessEmail && saveAccess(accessEmail, draft)}>Save access</button>
        </>
      }
    >
      {u && (
        <>
          <div className="sa-banner">
            <LockI />
            <div>
              Grant access module by module. <strong>View</strong> can read, <strong>Edit</strong> can change records,{" "}
              <strong>Full</strong> can also approve and configure. Anything left on <strong>None</strong> stays hidden from this person.
            </div>
          </div>
          <div className="tmpl">
            <label>Start from</label>
            <select className="field" defaultValue="" onChange={(e) => applyTemplate(e.target.value)} style={{ minWidth: "auto", flex: 1 }}>
              <option value="">Role template…</option>
              <option value="admin">Admin — full access</option>
              <option value="fin">Finance</option>
              <option value="std">Standard</option>
              <option value="view">View only</option>
            </select>
          </div>
          <div className="tmpl">
            <label>Weekly report</label>
            <select className="field" value={u.reportTrack ?? ""} onChange={(e) => accessEmail && setReportTrack(accessEmail, e.target.value)} style={{ minWidth: "auto", flex: 1 }}>
              <option value="">Free-text (no track)</option>
              <option value="pipeline">Pipeline — revenue, deals, stalled, win, ask</option>
              <option value="technology">Technology — shipped, blocked, uptime, commitments, ask</option>
              <option value="leadership">Leadership — five CEO numbers</option>
            </select>
          </div>
          <div>
            {accessModules.map((m) => {
              const lv = draft[m.k] || 0;
              return (
                <div className="pm-row" key={m.k}>
                  <div className="pm-l">{m.l}</div>
                  <div className="seg-ctl mini">
                    {[0, 1, 2, 3].map((i) => (
                      <button
                        key={i}
                        className={`lv-${cls[i]} ${lv === i ? "on" : ""}`}
                        onClick={() => setDraft((d) => ({ ...d, [m.k]: i }))}
                      >
                        {labels[i]}
                      </button>
                    ))}
                  </div>
                </div>
              );
            })}
          </div>
          <div className="preview">
            <h4><EyeI /> What they'll see</h4>
            <div className="pv-sub">
              {visible.length
                ? `${u.name} will see ${visible.length} module${visible.length > 1 ? "s" : ""} in the sidebar. Everything else stays hidden.`
                : `${u.name} will see no modules. Grant at least one above.`}
            </div>
            <div>
              {visible.map((m) => {
                const lv = draft[m.k];
                return (
                  <div className="pv-item" key={m.k}>
                    <span>{m.l}</span>
                    <span className={`lvtag ${lvlClass[lv]}`}>{lvlName[lv]}</span>
                  </div>
                );
              })}
            </div>
          </div>
        </>
      )}
    </DrawerShell>
  );
}
