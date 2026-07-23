import { useEffect, useState } from "react";
import { useApp, StaffRow } from "../store";
import { Pulse, Note } from "../components/ui";
import { Donut, ChartLegend, StaticBars } from "../components/charts";
import { PlusI, CheckBoldI } from "../components/icons";
import { ModalShell } from "../components/modals";
import { kes, contractTypes, hrDepartments, candidateStages, kenyaLocations } from "../data";
import { Crumb } from "../nav";

const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);
const fmtD = (iso: string) => new Date(iso + "T00:00:00").toLocaleDateString("en-GB", { day: "numeric", month: "short" });
const fmtPeriod = (p: string) => { const [y, m] = p.split("-"); return new Date(+y, +m - 1, 1).toLocaleDateString("en-GB", { month: "short", year: "numeric" }); };
const contractLabel = (v: string) => contractTypes.find((c) => c.value === v)?.label ?? v;
const PALETTE = ["#E2632A", "#12A3BE", "#3C8A5E", "#6D28D9", "#0e7d91", "#A16207", "#B91C1C", "#7C2D12"];
const avColor = (s: { color: string | null; name: string }) => s.color || PALETTE[Math.abs([...s.name].reduce((a, c) => a + c.charCodeAt(0), 0)) % PALETTE.length];
const missingIds = (s: StaffRow) => [s.kraPin, s.nssfNo, s.shifNo].filter((x) => !x).length;

function StatChip({ ok, l }: { ok: boolean; l: string }) {
  return (
    <span style={{
      fontFamily: "var(--mono)", fontSize: 9.5, fontWeight: 600, padding: "2px 6px", borderRadius: 5,
      marginRight: 4, whiteSpace: "nowrap",
      background: ok ? "var(--green-soft)" : "var(--ember-soft)", color: ok ? "var(--green)" : "var(--ember)",
    }}>
      {l} {ok ? "✓" : "✗"}
    </span>
  );
}

function Check({ done, children }: { done: boolean; children: React.ReactNode }) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 11, padding: "9px 0", borderBottom: "1px solid var(--hairline)", fontSize: 13.5, color: done ? undefined : "var(--ink-soft)" }}>
      <span style={{
        width: 20, height: 20, borderRadius: "50%", display: "grid", placeItems: "center", flexShrink: 0,
        ...(done ? { background: "var(--green-soft)", color: "var(--green)" } : { background: "#F1EDE5", border: "1px solid var(--hairline-2)" }),
      }}>
        {done && <CheckBoldI />}
      </span>
      {children}
    </div>
  );
}

/* ============================ modals ============================ */
function EmployeeModal() {
  const { hrModal, closeHrModal, addEmployee, toast } = useApp();
  const open = hrModal?.kind === "employee";
  const [f, setF] = useState({ name: "", email: "", roleTitle: "", contractType: "permanent", startDate: new Date().toISOString().slice(0, 10), grossSalary: "", kra: "", nssf: "", shif: "", bank: "" });
  useEffect(() => { if (open) setF({ name: "", email: "", roleTitle: "", contractType: "permanent", startDate: new Date().toISOString().slice(0, 10), grossSalary: "", kra: "", nssf: "", shif: "", bank: "" }); }, [open]);
  const set = (k: string, v: string) => setF((p) => ({ ...p, [k]: v }));
  function submit() {
    if (!f.name.trim()) { toast("Name is required", "Give the employee a name"); return; }
    if (!f.email.trim()) { toast("Email is required", "They link to a login by this email"); return; }
    addEmployee({ ...f, grossSalary: parseFloat(f.grossSalary) || 0 });
  }
  return (
    <ModalShell open={open} onClose={closeHrModal} width={560}>
      <div className="mh"><h3>Add employee</h3><p>Creates the staff file and opening leave balances. The person links to a login the first time they sign in with this email — no password is set here.</p></div>
      <div className="mb">
        <div className="mrow c2">
          <div><label>Full name</label><input className="field" placeholder="Jane Wanjiru" value={f.name} onChange={(e) => set("name", e.target.value)} /></div>
          <div><label>Work email</label><input className="field" placeholder="jane@ignis.africa" value={f.email} onChange={(e) => set("email", e.target.value)} /></div>
        </div>
        <div className="mrow c2">
          <div><label>Role title</label><input className="field" placeholder="Field Officer" value={f.roleTitle} onChange={(e) => set("roleTitle", e.target.value)} /></div>
          <div><label>Contract type</label>
            <select className="field" value={f.contractType} onChange={(e) => set("contractType", e.target.value)}>
              {contractTypes.map((c) => <option key={c.value} value={c.value}>{c.label}</option>)}
            </select>
          </div>
        </div>
        <div className="mrow c2">
          <div><label>Start date</label><input className="field" type="date" value={f.startDate} onChange={(e) => set("startDate", e.target.value)} /></div>
          <div><label>Gross salary (KES / month)</label><input className="field" type="number" min="0" placeholder="0" value={f.grossSalary} onChange={(e) => set("grossSalary", e.target.value)} /></div>
        </div>
        <div className="mrow c3">
          <div><label>KRA PIN</label><input className="field" placeholder="A0…" value={f.kra} onChange={(e) => set("kra", e.target.value)} /></div>
          <div><label>NSSF no.</label><input className="field" placeholder="NSSF-…" value={f.nssf} onChange={(e) => set("nssf", e.target.value)} /></div>
          <div><label>SHIF no.</label><input className="field" placeholder="SHIF-…" value={f.shif} onChange={(e) => set("shif", e.target.value)} /></div>
        </div>
        <div><label>Bank</label><input className="field" placeholder="KCB ****1234" value={f.bank} onChange={(e) => set("bank", e.target.value)} /></div>
      </div>
      <div className="mf"><button className="btn" onClick={closeHrModal}>Cancel</button><button className="btn primary" onClick={submit}>Add employee</button></div>
    </ModalShell>
  );
}

// Read-only staff file — opens when a row on the Staff Files table is clicked.
function StaffDetailModal() {
  const { hrModal, closeHrModal, staffDocUrl } = useApp();
  const open = hrModal?.kind === "staffDetail";
  const s = hrModal?.kind === "staffDetail" ? hrModal.staff : null;
  const idRow = (label: string, val: string | null) => (
    <div className="recon"><span>{label}</span>{val ? <span className="mono">{val}</span> : <span className="rcv no">missing</span>}</div>
  );
  async function openDoc(path: string) {
    const url = await staffDocUrl(path);
    if (url) window.open(url, "_blank", "noopener");
  }
  return (
    <ModalShell open={open} onClose={closeHrModal} width={520}>
      {s && (
        <>
          <div className="mh" style={{ display: "flex", alignItems: "center", gap: 12 }}>
            <div className="av-sm" style={{ background: avColor(s), width: 40, height: 40, fontSize: 16 }}>{s.name[0]}</div>
            <div>
              <h3 style={{ margin: 0 }}>{s.name}</h3>
              <p style={{ margin: 0 }}>{s.roleTitle || "—"} · {s.staffNo} · <span className={`tag ${s.contractType === "permanent" ? "std" : "view"}`} style={{ textTransform: "none" }}>{contractLabel(s.contractType)}</span></p>
            </div>
          </div>
          <div className="mb">
            <div className="panel-h" style={{ padding: "4px 0" }}><h3 style={{ fontSize: 12.5 }}>Employment</h3></div>
            <div className="recon"><span>Work email</span><span className="mono">{s.email || "—"}</span></div>
            <div className="recon"><span>Start date</span><span className="mono">{s.startDate ? new Date(s.startDate + "T00:00:00").toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" }) : "—"}</span></div>
            <div className="recon"><span>Gross salary</span><span className="mono">{kes(s.grossSalary)} / month</span></div>
            <div className="recon"><span>Bank</span><span className="mono">{s.bank || "—"}</span></div>

            <div className="panel-h" style={{ padding: "10px 0 4px" }}><h3 style={{ fontSize: 12.5 }}>Statutory IDs</h3></div>
            {idRow("KRA PIN", s.kraPin)}
            {idRow("NSSF no.", s.nssfNo)}
            {idRow("SHIF no.", s.shifNo)}

            <div className="panel-h" style={{ padding: "10px 0 4px" }}><h3 style={{ fontSize: 12.5 }}>Leave &amp; security</h3></div>
            <div className="recon"><span>Annual leave</span><span className="mono">{s.annualEntitled - s.annualUsed} of {s.annualEntitled} left</span></div>
            <div className="recon"><span>Two-factor</span><span className={`pill ${s.twoFa ? "done" : "over"}`} style={{ textTransform: "none" }}>{s.twoFa ? "Enrolled" : "Not enrolled"}</span></div>
            <div className="recon"><span>File status</span><span className={`pill ${missingIds(s) === 0 ? "done" : "today"}`} style={{ textTransform: "none" }}>{missingIds(s) === 0 ? "Complete" : `${missingIds(s)} missing`}</span></div>

            <div className="panel-h" style={{ padding: "10px 0 4px" }}><h3 style={{ fontSize: 12.5 }}>Documents</h3><span className="meta">{s.docs.length ? `${s.docs.length} attached` : "personal file"}</span></div>
            {s.docs.length
              ? s.docs.map((d) => (
                  <div className="recon" key={d.name + d.version}>
                    <span>{d.name}<span className="meta" style={{ marginLeft: 8 }}>v{d.version}{d.category ? ` · ${d.category}` : ""}{d.leaveRef ? ` · ${d.leaveRef}` : ""}</span></span>
                    {d.path
                      ? <button className="btn" style={{ padding: "4px 10px", fontSize: 11.5 }} onClick={() => openDoc(d.path!)}>View</button>
                      : <span className="rcv ok">on file</span>}
                  </div>
                ))
              : <div className="recon"><span>No documents attached</span><span className="mono">—</span></div>}
            <Note>This staff file is visible only to HR and the employee. Widening access is a super-admin action in User Management.</Note>
          </div>
          <div className="mf"><button className="btn primary" onClick={closeHrModal}>Close</button></div>
        </>
      )}
    </ModalShell>
  );
}

function RequisitionModal() {
  const { hrModal, closeHrModal, createRecruitmentReq, toast } = useApp();
  const open = hrModal?.kind === "requisition";
  const [role, setRole] = useState(""); const [dept, setDept] = useState("");
  useEffect(() => { if (open) { setRole(""); setDept(""); } }, [open]);
  function submit() { if (!role.trim()) { toast("Role title is required", "Name the vacancy"); return; } createRecruitmentReq(role.trim(), dept); }
  return (
    <ModalShell open={open} onClose={closeHrModal} width={480}>
      <div className="mh"><h3>New job opening</h3><p>Post a job opening — add candidates to its pipeline once it's open.</p></div>
      <div className="mb">
        <div><label>Role title</label><input className="field" placeholder="Field Operations Coordinator" value={role} onChange={(e) => setRole(e.target.value)} /></div>
        <div><label>Department</label>
          <select className="field" value={dept} onChange={(e) => setDept(e.target.value)}>
            <option value="">— select —</option>
            {hrDepartments.map((d) => <option key={d}>{d}</option>)}
          </select>
        </div>
      </div>
      <div className="mf"><button className="btn" onClick={closeHrModal}>Cancel</button><button className="btn primary" onClick={submit}>Post job opening</button></div>
    </ModalShell>
  );
}

function CandidateModal() {
  const { hrModal, closeHrModal, addCandidate, toast } = useApp();
  const open = hrModal?.kind === "candidate";
  const reqRef = hrModal?.kind === "candidate" ? hrModal.reqRef : "";
  const [name, setName] = useState(""); const [email, setEmail] = useState(""); const [stage, setStage] = useState("applied");
  useEffect(() => { if (open) { setName(""); setEmail(""); setStage("applied"); } }, [open]);
  function submit() { if (!name.trim()) { toast("Name is required", "Add the candidate's name"); return; } addCandidate(reqRef, name.trim(), email, stage); }
  return (
    <ModalShell open={open} onClose={closeHrModal} width={480}>
      <div className="mh"><h3>Add candidate</h3><p>Adds an applicant to {reqRef}.</p></div>
      <div className="mb">
        <div className="mrow c2">
          <div><label>Name</label><input className="field" placeholder="Applicant name" value={name} onChange={(e) => setName(e.target.value)} /></div>
          <div><label>Email</label><input className="field" placeholder="optional" value={email} onChange={(e) => setEmail(e.target.value)} /></div>
        </div>
        <div><label>Stage</label>
          <select className="field" value={stage} onChange={(e) => setStage(e.target.value)}>
            {candidateStages.map((s) => <option key={s} value={s}>{cap(s)}</option>)}
          </select>
        </div>
      </div>
      <div className="mf"><button className="btn" onClick={closeHrModal}>Cancel</button><button className="btn primary" onClick={submit}>Add candidate</button></div>
    </ModalShell>
  );
}

function EnumeratorModal() {
  const { hrModal, closeHrModal, createEnumerator, toast } = useApp();
  const open = hrModal?.kind === "enumerator";
  const [f, setF] = useState({ name: "", county: "", idNo: "" });
  useEffect(() => { if (open) setF({ name: "", county: "", idNo: "" }); }, [open]);
  const set = (k: string, v: string) => setF((p) => ({ ...p, [k]: v }));
  function submit() { if (!f.name.trim()) { toast("Name is required", "Name the field worker"); return; } createEnumerator({ name: f.name.trim(), county: f.county, idNo: f.idNo }); }
  return (
    <ModalShell open={open} onClose={closeHrModal} width={480}>
      <div className="mh"><h3>Register enumerator</h3><p>Adds a field worker to the roster — assign them per-diem work below.</p></div>
      <div className="mb">
        <div className="mrow c2">
          <div><label>Name</label><input className="field" placeholder="Peter Otieno" value={f.name} onChange={(e) => set("name", e.target.value)} /></div>
          <div><label>County</label>
            <input className="field" placeholder="Makueni" list="ke-counties" value={f.county} onChange={(e) => set("county", e.target.value)} />
            <datalist id="ke-counties">{kenyaLocations.map((l) => <option key={l} value={l} />)}</datalist>
          </div>
        </div>
        <div><label>ID number</label><input className="field" placeholder="ID-…" value={f.idNo} onChange={(e) => set("idNo", e.target.value)} /></div>
      </div>
      <div className="mf"><button className="btn" onClick={closeHrModal}>Cancel</button><button className="btn primary" onClick={submit}>Register</button></div>
    </ModalShell>
  );
}

function AssignmentModal() {
  const { hrModal, closeHrModal, createFieldAssignment, hrData, projectDetails, toast } = useApp();
  const open = hrModal?.kind === "assignment";
  const enums = hrData?.enumerators ?? [];
  const projects = Object.keys(projectDetails);
  const [f, setF] = useState({ enumeratorId: "", project: "", period: new Date().toISOString().slice(0, 7), days: "" });
  useEffect(() => { if (open) setF({ enumeratorId: enums[0]?.id ?? "", project: projects[0] ?? "", period: new Date().toISOString().slice(0, 7), days: "" }); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [open]);
  const set = (k: string, v: string) => setF((p) => ({ ...p, [k]: v }));
  function submit() {
    if (!f.enumeratorId) { toast("Pick an enumerator", "Register one first if the list is empty"); return; }
    createFieldAssignment({ enumeratorId: f.enumeratorId, project: f.project, period: f.period, days: parseFloat(f.days) || 0 });
  }
  return (
    <ModalShell open={open} onClose={closeHrModal} width={520}>
      <div className="mh"><h3>New field assignment</h3><p>Books casual / field work against a project. A contract reference is generated automatically. It starts as planned; approve it to release the assignment.</p></div>
      <div className="mb">
        <div className="mrow c2">
          <div><label>Enumerator</label>
            <select className="field" value={f.enumeratorId} onChange={(e) => set("enumeratorId", e.target.value)}>
              {enums.map((e) => <option key={e.id} value={e.id}>{e.name}{e.county ? ` · ${e.county}` : ""}</option>)}
            </select>
          </div>
          <div><label>Project</label>
            <select className="field" value={f.project} onChange={(e) => set("project", e.target.value)}>
              <option value="">— none —</option>
              {projects.map((p) => <option key={p}>{p}</option>)}
            </select>
          </div>
        </div>
        <div className="mrow c2">
          <div><label>Period</label><input className="field" type="month" value={f.period} onChange={(e) => set("period", e.target.value)} /></div>
          <div><label>Days</label><input className="field" type="number" min="0" placeholder="0" value={f.days} onChange={(e) => set("days", e.target.value)} /></div>
        </div>
      </div>
      <div className="mf"><button className="btn" onClick={closeHrModal}>Cancel</button><button className="btn primary" onClick={submit}>Create assignment</button></div>
    </ModalShell>
  );
}

/* ============================ view ============================ */
export default function HrView() {
  const { tabs, toast, goTab, openHrModal, hrLeaveQueue, hrBalances, decideLeave, hrData, preparePayroll, approvePayroll, postPayroll, setFieldAssignmentState } = useApp();
  const tab = tabs.hr;
  const staff = hrData?.staff ?? [];
  const runs = hrData?.runs ?? [];
  const recruitment = hrData?.recruitment ?? [];
  const enumerators = hrData?.enumerators ?? [];
  const fieldAssignments = hrData?.fieldAssignments ?? [];

  const pendingLeave = hrLeaveQueue.filter((r) => r.state === "pending");
  const decidedLeave = hrLeaveQueue.filter((r) => r.state !== "pending").slice(0, 5);
  const today = new Date().toISOString().slice(0, 10);
  const onLeaveToday = hrLeaveQueue.filter((r) => r.state === "approved" && r.from <= today && r.to >= today);
  const nonPermanent = staff.filter((s) => s.contractType !== "permanent");
  const openRoles = recruitment.filter((r) => r.state !== "filled" && r.state !== "closed");
  const missingFiles = staff.filter((s) => missingIds(s) > 0);
  const noTwoFa = staff.filter((s) => !s.twoFa);

  // contract mix (staff by type + field workers)
  const mixCounts = { permanent: 0, contract: 0, casualField: enumerators.length };
  staff.forEach((s) => {
    if (s.contractType === "permanent") mixCounts.permanent++;
    else if (s.contractType === "casual") mixCounts.casualField++;
    else mixCounts.contract++;
  });
  const contractMix = [
    { l: "Permanent", v: mixCounts.permanent, c: "#12A3BE", d: String(mixCounts.permanent) },
    { l: "Contract", v: mixCounts.contract, c: "#E2632A", d: String(mixCounts.contract) },
    { l: "Casual / field", v: mixCounts.casualField, c: "#A89C8E", d: String(mixCounts.casualField) },
  ].filter((s) => s.v > 0);
  const composition = [
    { l: "Core staff", v: staff.length, c: "#12A3BE", d: String(staff.length) },
    { l: "Field enumerators", v: enumerators.length, c: "#E2632A", d: String(enumerators.length) },
  ].filter((s) => s.v > 0);

  const latest = runs[0];
  const sums = latest?.items.reduce((a, i) => ({ gross: a.gross + i.gross, paye: a.paye + i.paye, nssf: a.nssf + i.nssf, shif: a.shif + i.shif, housing: a.housing + i.housing, net: a.net + i.net }), { gross: 0, paye: 0, nssf: 0, shif: 0, housing: 0, net: 0 });
  const now = new Date();
  const curPeriod = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
  const hasCurrentRun = runs.some((r) => r.period === curPeriod);

  // recruitment pipeline funnel (all candidates by stage)
  const allCandidates = recruitment.flatMap((r) => r.candidates);
  const stageOrder = ["applied", "screened", "interviewed", "offer", "hired"];
  const stageColors = ["var(--flame)", "var(--flame)", "var(--ember)", "var(--ember)", "var(--green)"];
  const stageCounts = stageOrder.map((st) => allCandidates.filter((c) => c.stage === st).length);
  const maxStage = Math.max(1, ...stageCounts);
  const onboarding = allCandidates.filter((c) => c.stage === "offer" || c.stage === "hired");

  // county roster
  const byCounty = enumerators.reduce((m, e) => { const k = e.county || "Unassigned"; m[k] = (m[k] || 0) + 1; return m; }, {} as Record<string, number>);
  const countyRows = Object.entries(byCounty).sort((a, b) => b[1] - a[1]);
  const maxCounty = Math.max(1, ...countyRows.map(([, n]) => n));
  const perDiems = fieldAssignments.filter((a) => a.state === "planned" || a.state === "active");

  const pulse = [
    { k: "Headcount", tick: "t-blue", v: String(staff.length), d: `${staff.length} staff · ${enumerators.length} field`, dc: "flat" as const },
    { k: "On leave today", tick: onLeaveToday.length ? "t-ember" : "t-green", v: String(onLeaveToday.length), d: onLeaveToday.length ? onLeaveToday.map((r) => r.who).join(", ") : "everyone in", dc: "flat" as const },
    { k: "Leave approvals", tick: pendingLeave.length ? "t-ember" : "t-green", v: String(pendingLeave.length), d: pendingLeave.length ? "pending you" : "queue clear", dc: "flat" as const },
    { k: "Non-permanent", tick: "t-blue", v: String(nonPermanent.length), d: "contract / casual", dc: "flat" as const },
    { k: "Open roles", tick: openRoles.length ? "t-ember" : "t-green", v: String(openRoles.length), d: `${allCandidates.length} in pipeline`, dc: "flat" as const },
    { k: "Payroll run", tick: "t-blue", v: latest ? fmtPeriod(latest.period) : "—", d: latest ? cap(latest.state) : "none yet", dc: "flat" as const },
  ];

  return (
    <>
      <div className="vhead">
        <div>
          <h1>Human Resources</h1>
          <p>Staff files, leave, payroll, recruitment and the field workforce — statutory IDs and documents versioned and access-controlled on every record.</p>
        </div>
        <div className="actions">
          {/* The primary action is contextual to the active tab — not a global "Add employee". */}
          {tab === "h-over" && (
            <>
              <button className="btn" onClick={() => toast("Org chart", "Opens the live organogram by department")}>Org chart</button>
              <button className="btn primary" onClick={() => openHrModal({ kind: "employee" })}><PlusI />Add employee</button>
            </>
          )}
          {tab === "h-staff" && (
            <button className="btn primary" onClick={() => openHrModal({ kind: "employee" })}><PlusI />Add employee</button>
          )}
          {tab === "h-pay" && !hasCurrentRun && (
            <button className="btn primary" onClick={() => preparePayroll(curPeriod)}><PlusI />Prepare {fmtPeriod(curPeriod)} run</button>
          )}
          {tab === "h-recruit" && (
            <button className="btn primary" onClick={() => openHrModal({ kind: "requisition" })}><PlusI />New job opening</button>
          )}
          {tab === "h-field" && (
            <>
              <button className="btn" onClick={() => openHrModal({ kind: "enumerator" })}>Add enumerator</button>
              <button className="btn primary" onClick={() => openHrModal({ kind: "assignment" })}><PlusI />New assignment</button>
            </>
          )}
        </div>
      </div>
      <Crumb view="hr" />

      {tab === "h-over" && (
        <div className="hr-panel active">
          <Pulse data={pulse} />
          <div className="grid g-2">
            <div className="panel">
              <div className="panel-h"><h3>Workforce composition</h3><span className="meta">core + field</span></div>
              <div className="pad" style={{ display: "flex", alignItems: "center", gap: 24 }}>
                <Donut segs={composition} big={String(staff.length + enumerators.length)} small="people" />
                <div style={{ flex: 1 }}><ChartLegend segs={composition} /></div>
              </div>
            </div>
            <div className="panel">
              <div className="panel-h"><h3>Contract mix</h3><span className="meta">by engagement type</span></div>
              <div className="pad" style={{ display: "flex", alignItems: "center", gap: 24 }}>
                <Donut segs={contractMix} big={String(staff.length + enumerators.length)} small="people" />
                <div style={{ flex: 1 }}><ChartLegend segs={contractMix} /></div>
              </div>
            </div>
          </div>
          <div className="grid g-2" style={{ marginTop: 18 }}>
            <div className="panel">
              <div className="panel-h"><h3>Headcount by contract type</h3><span className="meta">{staff.length} staff + {enumerators.length} field</span></div>
              <div className="pad">
                <StaticBars rows={[
                  ...contractTypes.map((c) => ({ l: c.label, n: String(staff.filter((s) => s.contractType === c.value).length), w: staff.length ? Math.round(staff.filter((s) => s.contractType === c.value).length / Math.max(1, staff.length) * 100) : 0, c: "var(--flame)" })).filter((r) => +r.n > 0),
                  { l: "Field enumerators", n: String(enumerators.length), w: 100, c: "var(--ember)" },
                ]} />
              </div>
            </div>
            <div className="panel">
              <div className="panel-h"><h3>Needs attention</h3><span className="meta">HR to-dos</span></div>
              {pendingLeave.length > 0 && (
                <div className="task" onClick={() => goTab("hr", "h-leave")}><span className="id" style={{ color: "var(--ember)" }}>LV</span><span className="txt">{pendingLeave.length} leave request{pendingLeave.length > 1 ? "s" : ""} awaiting your decision</span><span className="pill today">Review</span></div>
              )}
              {noTwoFa.length > 0 && (
                <div className="task" onClick={() => goTab("hr", "h-staff")}><span className="id" style={{ color: "var(--red)" }}>2FA</span><span className="txt">{noTwoFa.length} not enrolled in two-factor<small>{noTwoFa.map((s) => s.name).join(", ")}</small></span><span className="pill over">Action</span></div>
              )}
              {missingFiles.length > 0 && (
                <div className="task" onClick={() => goTab("hr", "h-staff")}><span className="id" style={{ color: "var(--ember)" }}>DOCS</span><span className="txt">{missingFiles.length} staff file{missingFiles.length > 1 ? "s" : ""} missing statutory IDs<small>{missingFiles.map((s) => s.name).join(", ")}</small></span><span className="pill today">Review</span></div>
              )}
              {openRoles.length > 0 && (
                <div className="task" onClick={() => goTab("hr", "h-recruit")}><span className="id" style={{ color: "var(--flame)" }}>REC</span><span className="txt">{openRoles.length} open job opening{openRoles.length > 1 ? "s" : ""} — {allCandidates.length} candidates in pipeline</span><span className="pill week">In progress</span></div>
              )}
              {pendingLeave.length + noTwoFa.length + missingFiles.length + openRoles.length === 0 && (
                <div className="pad" style={{ fontSize: 13, color: "var(--ink-soft)" }}>All clear — no pending approvals, complete files, everyone enrolled.</div>
              )}
            </div>
          </div>
        </div>
      )}

      {tab === "h-staff" && (
        <div className="hr-panel active">
          <div className="grid g-2">
            <div className="panel">
              <div className="panel-h">
                <h3>Staff files</h3>
                <span className="meta">{staff.length} staff · use Add employee above</span>
              </div>
              <table className="tbl">
                <thead><tr><th>Employee</th><th>Contract</th><th>Statutory IDs</th><th>Leave bal.</th><th>Files</th></tr></thead>
                <tbody>
                  {staff.map((s) => {
                    const miss = missingIds(s);
                    return (
                      <tr key={s.staffNo} style={{ cursor: "pointer" }} onClick={() => openHrModal({ kind: "staffDetail", staff: s })}>
                        <td>
                          <div className="who">
                            <div className="av-sm" style={{ background: avColor(s) }}>{s.name[0]}</div>
                            <div><div className="nm">{s.name}</div><div className="em">{s.roleTitle || "—"}</div></div>
                          </div>
                        </td>
                        <td><span className={`tag ${s.contractType === "permanent" ? "std" : "view"}`} style={{ textTransform: "none" }}>{contractLabel(s.contractType)}</span></td>
                        <td style={{ whiteSpace: "nowrap" }}><StatChip ok={!!s.nssfNo} l="NSSF" /><StatChip ok={!!s.shifNo} l="SHIF" /><StatChip ok={!!s.kraPin} l="KRA" /></td>
                        <td className="mono" style={{ fontSize: 12 }}>{s.annualEntitled - s.annualUsed} / {s.annualEntitled}</td>
                        <td>{miss === 0 ? <span className="dot-s"><i className="active-i" />Complete</span> : <span className="dot-s"><i className="away-i" />{miss} missing</span>}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            <div className="panel">
              <div className="panel-h"><h3>Documents &amp; compliance</h3><span className="meta">access-controlled</span></div>
              {(() => {
                const n = staff.length || 1;
                const kra = staff.filter((s) => s.kraPin).length, nssf = staff.filter((s) => s.nssfNo).length, shif = staff.filter((s) => s.shifNo).length, twofa = staff.filter((s) => s.twoFa).length;
                const row = (label: string, have: number) => <div className="recon"><span>{label}</span><span className={`pill ${have >= n ? "done" : "today"}`}>{have} / {n}</span></div>;
                return <>{row("Contracts on file", staff.length)}{row("KRA PIN captured", kra)}{row("NSSF registered", nssf)}{row("SHIF registered", shif)}{row("Two-factor enrolled", twofa)}</>;
              })()}
              <Note>Each staff file is visible only to HR and the employee. Widening access is a super-admin action in User Management.</Note>
            </div>
          </div>
        </div>
      )}

      {tab === "h-leave" && (
        <div className="hr-panel active">
          <div className="panel">
            <div className="panel-h"><h3>Leave approvals</h3><span className="meta">{pendingLeave.length} waiting on you</span></div>
            {hrLeaveQueue.length ? (
              <table className="tbl">
                <thead><tr><th>Ref</th><th>Employee</th><th>Type</th><th>Dates</th><th>Days</th><th>Reason</th><th>Decision</th></tr></thead>
                <tbody>
                  {[...pendingLeave, ...decidedLeave].map((r) => (
                    <tr key={r.id}>
                      <td className="mono">{r.id}</td>
                      <td><strong>{r.who}</strong></td>
                      <td>{cap(r.kind)}</td>
                      <td>{fmtD(r.from)} – {fmtD(r.to)}</td>
                      <td className="mono">{r.days}</td>
                      <td>{r.reason || "—"}</td>
                      <td>
                        {r.state === "pending" ? (
                          <span style={{ display: "flex", gap: 8 }}>
                            <button className="btn primary" style={{ padding: "5px 11px", fontSize: 12 }} onClick={() => decideLeave(r.id, true)}>Approve</button>
                            <button className="btn" style={{ padding: "5px 11px", fontSize: 12 }} onClick={() => decideLeave(r.id, false)}>Decline</button>
                          </span>
                        ) : (
                          <span className={`pill ${r.state === "approved" ? "done" : "over"}`} style={{ textTransform: "none" }}>{cap(r.state)}</span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            ) : (
              <Note noBorder>Nothing waiting — new requests from the Staff Portal land here.</Note>
            )}
          </div>
          <div className="grid g-2" style={{ marginTop: 14 }}>
            <div className="panel sm">
              <div className="panel-h"><h3>Leave balances</h3><span className="meta">annual · days</span></div>
              {hrBalances.length
                ? hrBalances.map((b) => (
                    <div className="recon" key={b.who}>
                      <span>{b.who}</span>
                      <span className="mono">{b.entitled - b.used - b.reserved} of {b.entitled} left{b.reserved > 0 ? ` · ${b.reserved} pending` : ""}</span>
                    </div>
                  ))
                : <div className="recon"><span>Balances</span><span className="mono">loading…</span></div>}
            </div>
            <div className="panel sm">
              <div className="panel-h"><h3>Leave types &amp; policy</h3><span className="meta">Kenya · Employment Act</span></div>
              <div style={{ display: "flex", gap: 10, flexWrap: "wrap", padding: "14px" }}>
                <span className="acc-chip">Annual · 21 days</span>
                <span className="acc-chip">Sick · 14 days full, 14 half</span>
                <span className="acc-chip">Maternity · 90 days</span>
                <span className="acc-chip">Paternity · 14 days</span>
                <span className="acc-chip">Compassionate</span>
                <span className="acc-chip">Unpaid</span>
                <span className="acc-chip">Study</span>
              </div>
            </div>
          </div>
        </div>
      )}

      {tab === "h-pay" && (
        <div className="hr-panel active">
          <div className="grid g-2">
            <div className="panel">
              <div className="panel-h"><h3>Payroll — {latest ? fmtPeriod(latest.period) : "no run yet"}</h3><span className="meta">Kenya · {latest ? cap(latest.state) : "—"}</span></div>
              {latest && sums ? (
                <>
                  <div className="pad" style={{ paddingBottom: 6 }}>
                    <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 12 }}>
                      <div>
                        <div style={{ fontFamily: "var(--display)", fontSize: 25, fontWeight: 600, letterSpacing: -0.5 }}>{kes(sums.net)}</div>
                        <div style={{ fontSize: 12, color: "var(--ink-soft)", marginTop: 2 }}>net pay · {latest.totals?.staff ?? latest.items.length} staff · {latest.ref}</div>
                      </div>
                      {latest.state === "prepared" && <button className="btn primary" onClick={() => approvePayroll(latest.ref)}>Approve run</button>}
                      {latest.state === "approved" && <button className="btn primary" onClick={() => postPayroll(latest.ref)}>Post to GL</button>}
                      {latest.state === "posted" && !hasCurrentRun && <button className="btn primary" onClick={() => preparePayroll(curPeriod)}>Prepare {fmtPeriod(curPeriod)}</button>}
                    </div>
                  </div>
                  <div className="row"><div className="rl">Gross pay</div><span className="mono">{kes(sums.gross)}</span></div>
                  <div className="row"><div className="rl">PAYE</div><span className="mono" style={{ color: "var(--red)" }}>− {kes(sums.paye)}</span></div>
                  <div className="row"><div className="rl">NSSF</div><span className="mono" style={{ color: "var(--red)" }}>− {kes(sums.nssf)}</span></div>
                  <div className="row"><div className="rl">SHIF · 2.75%</div><span className="mono" style={{ color: "var(--red)" }}>− {kes(sums.shif)}</span></div>
                  <div className="row"><div className="rl">Housing levy · 1.5%</div><span className="mono" style={{ color: "var(--red)" }}>− {kes(sums.housing)}</span></div>
                  <div className="row"><div className="rl" style={{ fontWeight: 600 }}>Net pay</div><span className="mono" style={{ fontWeight: 600 }}>{kes(sums.net)}</span></div>
                </>
              ) : (
                <div className="pad">
                  <div style={{ fontSize: 13, color: "var(--ink-soft)", marginBottom: 12 }}>No payroll run yet. Prepare {fmtPeriod(curPeriod)} from the {staff.length} active staff files.</div>
                  <button className="btn primary" onClick={() => preparePayroll(curPeriod)}>Prepare {fmtPeriod(curPeriod)} run</button>
                </div>
              )}
            </div>
            <div className="panel">
              <div className="panel-h"><h3>Statutory &amp; remittances</h3><span className="meta">{latest?.state === "posted" ? "posted · from the run" : "on posting"}</span></div>
              {latest?.state === "posted" && sums ? (
                <>
                  <div className="recon"><span>PAYE (KRA)</span><span className="mono">{kes(sums.paye)}</span></div>
                  <div className="recon"><span>NSSF (employee + match)</span><span className="mono">{kes(sums.nssf * 2)}</span></div>
                  <div className="recon"><span>SHIF</span><span className="mono">{kes(sums.shif)}</span></div>
                  <div className="recon"><span>Housing Levy (emp + er)</span><span className="mono">{kes(sums.housing * 2)}</span></div>
                  <div className="recon"><span>Journal</span><span className="pill done">{latest.ref} posted</span></div>
                  <Note>The payroll journal is in the Finance general ledger and the M-Pesa / bank payment file is generated. Payslips are visible in each Staff Portal.</Note>
                </>
              ) : (
                <>
                  <div className="recon"><span>PAYE (KRA)</span><span className="pill today">on posting</span></div>
                  <div className="recon"><span>NSSF</span><span className="pill today">on posting</span></div>
                  <div className="recon"><span>SHIF</span><span className="pill today">on posting</span></div>
                  <div className="recon"><span>Housing Levy · 1.5%</span><span className="pill today">on posting</span></div>
                  <Note>On sign-off, the payroll journal posts straight into the Finance general ledger and generates the M-Pesa / bank payment file.</Note>
                </>
              )}
            </div>
          </div>
          {runs.length > 1 && (
            <div className="panel" style={{ marginTop: 18 }}>
              <div className="panel-h"><h3>Run history</h3><span className="meta">{runs.length} runs</span></div>
              <table className="tbl">
                <thead><tr><th>Ref</th><th>Period</th><th>Staff</th><th>Gross</th><th>Net</th><th>State</th></tr></thead>
                <tbody>
                  {runs.map((r) => (
                    <tr key={r.ref}>
                      <td className="mono">{r.ref}</td><td>{fmtPeriod(r.period)}</td>
                      <td className="mono">{r.totals?.staff ?? r.items.length}</td>
                      <td className="mono">{kes(Number(r.totals?.gross ?? 0))}</td>
                      <td className="mono">{kes(Number(r.totals?.net ?? 0))}</td>
                      <td><span className={`pill ${r.state === "posted" ? "done" : "today"}`} style={{ textTransform: "none" }}>{cap(r.state)}</span></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {tab === "h-recruit" && (
        <div className="hr-panel active">
          <div className="grid g-2">
            <div className="panel">
              <div className="panel-h">
                <h3>Open job openings</h3>
                <span className="meta">{recruitment.length} roles</span>
              </div>
              <table className="tbl">
                <thead><tr><th>Ref</th><th>Role</th><th>Dept</th><th>Candidates</th><th></th></tr></thead>
                <tbody>
                  {recruitment.length === 0 && <tr><td colSpan={5} style={{ color: "var(--ink-soft)", fontSize: 13 }}>No job openings yet.</td></tr>}
                  {recruitment.map((r) => (
                    <tr key={r.ref}>
                      <td className="mono">{r.ref}</td>
                      <td><strong>{r.roleTitle}</strong><div style={{ fontSize: 11 }}><span className={`pill ${r.state === "filled" ? "done" : r.state === "closed" ? "over" : "today"}`} style={{ textTransform: "none" }}>{cap(r.state)}</span></div></td>
                      <td style={{ fontSize: 12 }}>{r.dept || "—"}</td>
                      <td className="mono">{r.candidates.length}</td>
                      <td style={{ textAlign: "right" }}><a href="#" onClick={(e) => { e.preventDefault(); openHrModal({ kind: "candidate", reqRef: r.ref }); }} style={{ color: "var(--flame)", textDecoration: "none", fontSize: 12 }}>+ Candidate</a></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="panel">
              <div className="panel-h"><h3>Applicant pipeline</h3><span className="meta">{allCandidates.length} across all roles</span></div>
              <div className="pad">
                <StaticBars rows={stageOrder.map((st, i) => ({ l: cap(st), n: String(stageCounts[i]), w: Math.round(stageCounts[i] / maxStage * 100), c: stageColors[i] }))} />
              </div>
            </div>
          </div>
          <div className="panel" style={{ marginTop: 18 }}>
            <div className="panel-h"><h3>Onboarding / offers</h3><span className="meta">{onboarding.length} in progress</span></div>
            <div className="pad">
              {onboarding.length === 0 && <div style={{ fontSize: 13, color: "var(--ink-soft)" }}>No candidates at offer stage yet — advance someone in the pipeline.</div>}
              {onboarding.map((c) => (
                <div key={c.id} style={{ display: "flex", alignItems: "center", gap: 11, marginBottom: 10 }}>
                  <div className="av-sm" style={{ background: avColor({ color: null, name: c.name }) }}>{c.name[0]}</div>
                  <div style={{ flex: 1 }}>
                    <div style={{ fontWeight: 600, fontSize: 13.5 }}>{c.name}</div>
                    <div style={{ fontSize: 11.5, color: "var(--ink-soft)" }}>{c.email || "—"}</div>
                  </div>
                  <span className={`pill ${c.stage === "hired" ? "done" : "today"}`} style={{ textTransform: "none" }}>{cap(c.stage)}</span>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {tab === "h-field" && (
        <div className="hr-panel active">
          <div className="grid g-2">
            <div className="panel">
              <div className="panel-h">
                <h3>Enumerator roster by county</h3>
                <span className="meta">{enumerators.length} active · {countyRows.length} counties</span>
              </div>
              <div className="pad">
                {countyRows.length === 0 ? <div style={{ fontSize: 13, color: "var(--ink-soft)" }}>No enumerators yet.</div> :
                  <StaticBars rows={countyRows.map(([county, n]) => ({ l: county, n: String(n), w: Math.round(n / maxCounty * 100), c: "var(--flame)" }))} />}
              </div>
            </div>
            <div className="panel">
              <div className="panel-h">
                <h3>Per-diem &amp; field allowances</h3>
                <span className="meta">{perDiems.length} open</span>
              </div>
              {perDiems.length === 0 && <div className="pad" style={{ fontSize: 13, color: "var(--ink-soft)" }}>Nothing awaiting approval.</div>}
              {perDiems.map((a) => (
                <div className="task" key={a.id} style={{ cursor: "default" }}>
                  <span className="id">{a.state === "planned" ? "NEW" : "ACT"}</span>
                  <span className="txt">{a.enumerator} — {a.project || "unassigned"}<small className="mono">{a.days} days · {kes(a.perDiem)}{a.contractDoc ? ` · ${a.contractDoc}` : ""}</small></span>
                  {a.state === "planned"
                    ? <button className="btn" style={{ marginRight: 8 }} onClick={() => setFieldAssignmentState(a.id, "active")}>Approve</button>
                    : <button className="btn" style={{ marginRight: 8 }} onClick={() => setFieldAssignmentState(a.id, "complete")}>Complete</button>}
                  <span className={`pill ${a.state === "active" ? "done" : "today"}`} style={{ textTransform: "none" }}>{cap(a.state)}</span>
                </div>
              ))}
            </div>
          </div>
          <div className="panel" style={{ marginTop: 18 }}>
            <div className="panel-h"><h3>Field assignments &amp; casual contracts</h3><span className="meta">piece-rate &amp; fixed-term</span></div>
            <table className="tbl">
              <thead><tr><th>Enumerator</th><th>Project</th><th>Period</th><th>Days</th><th>Contract</th><th>State</th></tr></thead>
              <tbody>
                {fieldAssignments.length === 0 && <tr><td colSpan={6} style={{ color: "var(--ink-soft)", fontSize: 13 }}>No assignments yet.</td></tr>}
                {fieldAssignments.map((a) => (
                  <tr key={a.id}>
                    <td><strong>{a.enumerator}</strong></td>
                    <td style={{ fontSize: 12 }}>{a.project || "—"}</td>
                    <td className="mono">{a.period || "—"}</td>
                    <td className="mono">{a.days}</td>
                    <td style={{ fontSize: 12 }}>{a.contractDoc || "—"}</td>
                    <td><span className={`pill ${a.state === "complete" ? "done" : a.state === "cancelled" ? "over" : a.state === "active" ? "week" : "today"}`} style={{ textTransform: "none" }}>{cap(a.state)}</span></td>
                  </tr>
                ))}
              </tbody>
            </table>
            <Note>Field sign-offs (GRNs, installation reports) flow through to Deployment and to project accounting for cost allocation.</Note>
          </div>
        </div>
      )}

      <EmployeeModal />
      <StaffDetailModal />
      <RequisitionModal />
      <CandidateModal />
      <EnumeratorModal />
      <AssignmentModal />
    </>
  );
}
