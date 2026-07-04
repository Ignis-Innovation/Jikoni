// Right-hand record drawers: engagement, vendor, project, access matrix.
import React, { useEffect, useState } from "react";
import { useApp } from "../store";
import {
  findEng, engDetails, vendorDetails, users, roleMeta, superAdmins,
  accessModules, lvlName, lvlClass, roleTemplates, Perms,
} from "../data";
import { XI, LockI, EyeI, PlusI } from "./icons";

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

/* ================= ENGAGEMENT ================= */
export function EngDrawer() {
  const { engId, closeEng, toast, engToProject, xProject, xView, xTab, createProjectFromEng, openTask } = useApp();
  const b = engId ? findEng(engId) : null;
  const det = (engId && engDetails[engId]) || {};
  const up = b?.pipeline === "up";

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
        <>
          <button className="btn" onClick={() => toast("Log update", "Add a diary entry to this engagement")}>Log update</button>
          <button className="btn primary" onClick={() => toast("Stage advanced", "Moved to the next pipeline stage")}>Advance stage</button>
        </>
      }
    >
      {b && (
        <>
          <div className="eng-chips">
            <span className={`pill ${b.pl}`}>{b.plt || b.st}</span>
            {det.priority && <span className="acc-chip">{det.priority} priority</span>}
            <span className="acc-chip">{up ? "Upstream · capital" : "Downstream · deployment"}</span>
            {det.value && <span className="acc-chip full">{det.value}</span>}
          </div>
          <div className="eng-next">
            <div className="l">Next action · {det.due || b.plt || "—"}</div>
            {det.next || b.st}
          </div>
          <div className="eng-sec">Updates log</div>
          <div>
            {(det.updates || [{ d: "—", ch: "—", who: b.o, note: "No updates logged yet." }]).map((u, i) => (
              <div className="upd" key={i}>
                <div className="um">{u.d} · {u.ch} · {u.who}</div>
                <div className="un">{u.note}</div>
              </div>
            ))}
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
          <div className="eng-sec">Documents</div>
          <div>
            {det.docs?.length ? (
              det.docs.map((d, i) => (
                <div className="recon" style={{ paddingLeft: 0, paddingRight: 0 }} key={i}>
                  <span>{d}</span>
                  <button className="btn" style={{ padding: "4px 10px", fontSize: 11.5 }} onClick={() => toast(d, "Opens the document")}>Open</button>
                </div>
              ))
            ) : (
              <div style={{ fontSize: 12.5, color: "var(--ink-soft)", padding: "4px 0" }}>No documents attached.</div>
            )}
          </div>
          <div className="eng-sec">Linked records</div>
          <div style={{ display: "flex", flexWrap: "wrap" }}>
            {engToProject[b.id] ? (
              <LinkBtn label="Open linked project" onClick={() => xProject(engToProject[b.id])} />
            ) : !up ? (
              <LinkBtn
                primary
                icon={<PlusI style={{ width: 13, height: 13, verticalAlign: -2 }} />}
                label=" Create project"
                onClick={() => createProjectFromEng(b.id)}
              />
            ) : null}
            {up && <LinkBtn label="View in Fundraise" onClick={() => xView("raise")} />}
            <LinkBtn label="Partner registry" onClick={() => xTab("crm", "cr-partners")} />
          </div>
        </>
      )}
    </DrawerShell>
  );
}

/* ================= VENDOR ================= */
export function VendorDrawer() {
  const { vendorName, closeVendor, toast, xTab } = useApp();
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
          <button className="btn" onClick={() => toast("Raise PO", "Create a purchase order for this vendor")}>Raise PO</button>
          <button className="btn primary" onClick={() => toast("Upload document", "Attach a document to this vendor record")}>Upload document</button>
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
export function ProjectDrawer() {
  const { projectName, closeProject, toast, projectDetails, projectToEng, xEng, xTab } = useApp();
  const p = projectName ? projectDetails[projectName] : null;
  const ms: Record<string, [string, string]> = { done: ["done", "Complete"], now: ["today", "In progress"], todo: ["week", "Upcoming"] };

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
          <button className="btn" onClick={() => toast("Log activity", "Record a site visit or deliverable")}>Log activity</button>
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
          <div className="eng-sec">Overview</div>
          <div>
            <div className="recon" style={{ padding: "8px 0" }}><span>Funder</span><span className="mono">{p.funder}</span></div>
            <div className="recon" style={{ padding: "8px 0" }}><span>Timeline</span><span className="mono">{p.timeline}</span></div>
            <div className="recon" style={{ padding: "8px 0" }}><span>Reporting</span><span className="mono">{p.reporting}</span></div>
            <div className="recon" style={{ padding: "8px 0" }}><span>Field activity</span><span className="mono">{p.field}</span></div>
          </div>
          <div className="eng-sec">Milestones</div>
          <div>
            {p.milestones.map((m, i) => (
              <div className="recon" style={{ padding: "8px 0" }} key={i}>
                <span>{m.t}</span>
                <span className={`pill ${ms[m.s][0]}`}>{ms[m.s][1]}</span>
              </div>
            ))}
          </div>
          <div className="eng-sec">Drawdowns</div>
          <div>
            {p.drawdowns.map((d, i) => (
              <div className="recon" style={{ padding: "8px 0" }} key={i}>
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
            {p.docs.map((d, i) => (
              <div className="recon" style={{ padding: "8px 0" }} key={i}>
                <span>{d}</span>
                <button className="btn" style={{ padding: "4px 10px", fontSize: 11.5 }} onClick={() => toast(d, "Opens the document")}>Open</button>
              </div>
            ))}
          </div>
          <div className="eng-sec">Linked records</div>
          <div style={{ display: "flex", flexWrap: "wrap" }}>
            {projectToEng[projectName] && <LinkBtn label="Originating engagement" onClick={() => xEng(projectToEng[projectName])} />}
            <LinkBtn label="Budget in Finance" onClick={() => xTab("finance", "f-budget")} />
            <LinkBtn label="Procurement" onClick={() => xTab("procurement", "p-po")} />
            <LinkBtn label="Field activity" onClick={() => xTab("projects", "pr-field")} />
          </div>
        </>
      )}
    </DrawerShell>
  );
}

/* ================= ACCESS ================= */
export function AccessDrawer() {
  const { accessEmail, closeAccess, perms, saveAccess, toast } = useApp();
  const u = accessEmail ? users.find((x) => x.e === accessEmail) : null;
  const [draft, setDraft] = useState<Perms>({});

  useEffect(() => {
    if (!accessEmail || !u) return;
    const base = { ...(perms[accessEmail] || roleTemplates[u.role] || {}) };
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
          <div className="av-sm" style={{ width: 38, height: 38, fontSize: 15, background: u?.c }}>{u ? u.n[0] : "—"}</div>
          <div>
            <h3>{u ? u.n : "—"}</h3>
            <div className="sub">
              {u ? u.rt + " · " + roleMeta[u.role][1] + (superAdmins.includes(u.e) ? " · super admin" : "") : "—"}
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
                ? `${u.n} will see ${visible.length} module${visible.length > 1 ? "s" : ""} in the sidebar. Everything else stays hidden.`
                : `${u.n} will see no modules. Grant at least one above.`}
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
