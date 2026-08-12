import { useEffect, useState } from "react";
import { useApp, StaffRow, ExitStep, WeeklyReport } from "../store";
import { Pulse, Note } from "../components/ui";
import { Donut, ChartLegend, StaticBars } from "../components/charts";
import { PlusI, CheckBoldI } from "../components/icons";
import { ModalShell } from "../components/modals";
import { kes, contractTypes, hrDepartments, candidateStages, kenyaLocations, employmentTypes, educationLevels, educationLabel, employmentLabel } from "../data";
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
  const blank = { name: "", email: "", roleTitle: "", contractType: "permanent", startDate: new Date().toISOString().slice(0, 10), contractEnd: "", grossSalary: "", kra: "", nssf: "", shif: "", bank: "" };
  const [f, setF] = useState(blank);
  useEffect(() => { if (open) setF(blank); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [open]);
  const set = (k: string, v: string) => setF((p) => ({ ...p, [k]: v }));
  const permanent = f.contractType === "permanent";
  function submit() {
    // Every field is required so the staff file opens complete.
    if (!f.name.trim()) { toast("Name is required", "Give the employee a name"); return; }
    if (!f.email.trim()) { toast("Email is required", "They link to a login by this email"); return; }
    if (!f.roleTitle.trim()) { toast("Role title is required", "e.g. Field Officer"); return; }
    if (!f.startDate) { toast("Start date is required", "When do they start?"); return; }
    if (!permanent && !f.contractEnd) { toast("Contract end date is required", "Non-permanent contracts need an end date"); return; }
    if (!f.grossSalary.trim() || parseFloat(f.grossSalary) <= 0) { toast("Gross salary is required", "Enter a monthly gross greater than zero"); return; }
    if (!f.kra.trim()) { toast("KRA PIN is required", "Statutory — needed for payroll"); return; }
    if (!f.nssf.trim()) { toast("NSSF no. is required", "Statutory — needed for payroll"); return; }
    if (!f.shif.trim()) { toast("SHIF no. is required", "Statutory — needed for payroll"); return; }
    if (!f.bank.trim()) { toast("Bank is required", "Where net pay is sent"); return; }
    addEmployee({ ...f, grossSalary: parseFloat(f.grossSalary) || 0 });
  }
  return (
    <ModalShell open={open} onClose={closeHrModal} width={560}>
      <div className="mh"><h3>Add employee</h3><p>Creates the staff file and opening leave balances. All fields are required. The person links to a login the first time they sign in with this email — no password is set here.</p></div>
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
        <div className={`mrow ${permanent ? "c2" : "c3"}`}>
          <div><label>Start date</label><input className="field" type="date" value={f.startDate} onChange={(e) => set("startDate", e.target.value)} /></div>
          {!permanent && <div><label>Contract end date</label><input className="field" type="date" value={f.contractEnd} onChange={(e) => set("contractEnd", e.target.value)} /></div>}
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
  const { hrModal, closeHrModal, staffDocUrl, openHrModal } = useApp();
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
    <ModalShell open={open} onClose={closeHrModal} className="pcard">
      {s && (
        <>
          <div className="pcard-h">
            <div className="av-lg" style={{ background: avColor(s) }}>{s.name[0]}</div>
            <div style={{ minWidth: 0 }}>
              <h3>{s.name}</h3>
              <div className="sub">{s.roleTitle || "—"} · <span className="mono">{s.staffNo}</span></div>
              <div className="chips">
                <span className={`tag ${s.contractType === "permanent" ? "std" : "view"}`} style={{ textTransform: "none" }}>{contractLabel(s.contractType)}</span>
                <span className={`pill ${missingIds(s) === 0 ? "done" : "today"}`} style={{ textTransform: "none" }}>{missingIds(s) === 0 ? "File complete" : `${missingIds(s)} IDs missing`}</span>
                <span className={`pill ${s.twoFa ? "done" : "over"}`} style={{ textTransform: "none" }}>{s.twoFa ? "2FA enrolled" : "2FA not enrolled"}</span>
              </div>
            </div>
          </div>
          <div className="pcard-b">
            <div className="pcard-sec">
              <div className="sec-h"><h4>Employment</h4></div>
              <div className="recon"><span>Work email</span><span className="mono">{s.email || "—"}</span></div>
              <div className="recon"><span>Department</span><span className="mono">{s.dept || "—"}</span></div>
              <div className="recon"><span>Start date</span><span className="mono">{s.startDate ? new Date(s.startDate + "T00:00:00").toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" }) : "—"}</span></div>
              <div className="recon"><span>Contract ends</span><span className="mono">{s.contractEnd ? new Date(s.contractEnd + "T00:00:00").toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" }) : "—"}</span></div>
              <div className="recon"><span>Gross salary</span><span className="mono">{kes(s.grossSalary)} / month</span></div>
              <div className="recon"><span>Bank</span><span className="mono">{s.bank || "—"}</span></div>
            </div>

            <div className="pcard-sec">
              <div className="sec-h"><h4>Statutory IDs</h4></div>
              {idRow("KRA PIN", s.kraPin)}
              {idRow("NSSF no.", s.nssfNo)}
              {idRow("SHIF no.", s.shifNo)}
            </div>

            <div className="pcard-sec">
              <div className="sec-h"><h4>Next of kin</h4></div>
              {s.nextOfKin.length
                ? s.nextOfKin.map((k) => (
                    <div className="recon" key={k.name}><span>{k.name}<span className="meta" style={{ marginLeft: 8 }}>{k.relationship}{k.phone ? ` · ${k.phone}` : ""}</span></span><span className="rcv ok">{k.cover || "emergency"}</span></div>
                  ))
                : <div className="recon"><span>Next of kin</span><span className="rcv no">missing</span></div>}
            </div>

            <div className="pcard-sec">
              <div className="sec-h"><h4>Leave &amp; security</h4></div>
              <div className="recon"><span>Annual leave</span><span className="mono">{s.annualEntitled - s.annualUsed} of {s.annualEntitled} left</span></div>
              <div className="recon"><span>Two-factor</span><span className={`pill ${s.twoFa ? "done" : "over"}`} style={{ textTransform: "none" }}>{s.twoFa ? "Enrolled" : "Not enrolled"}</span></div>
              <div className="recon"><span>File status</span><span className={`pill ${missingIds(s) === 0 ? "done" : "today"}`} style={{ textTransform: "none" }}>{missingIds(s) === 0 ? "Complete" : `${missingIds(s)} missing`}</span></div>
            </div>

            <div className="pcard-sec span">
              <div className="sec-h"><h4>Documents</h4><span className="meta">{s.docs.length ? `${s.docs.length} attached` : "personal file"}</span></div>
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
            </div>

            <div style={{ gridColumn: "1 / -1" }}>
              <Note>This staff file is visible only to HR and the employee. Widening access is a super-admin action in User Management.</Note>
            </div>
          </div>
          <div className="mf">
            <button className="btn" onClick={() => openHrModal({ kind: "staffProfile", staff: s })}>Edit HR details</button>
            <button className="btn primary" onClick={closeHrModal}>Close</button>
          </div>
        </>
      )}
    </ModalShell>
  );
}

function RequisitionModal() {
  const { hrModal, closeHrModal, createRecruitmentReq, updatePosting, publishPosting, toast } = useApp();
  const open = hrModal?.kind === "requisition";
  const [role, setRole] = useState(""); const [dept, setDept] = useState("");
  const [description, setDescription] = useState(""); const [location, setLocation] = useState("");
  const [employmentType, setEmploymentType] = useState("permanent");
  const [skills, setSkills] = useState(""); const [minYears, setMinYears] = useState("0");
  const [minEducation, setMinEducation] = useState("none"); const [shortlistSize, setShortlistSize] = useState("4");
  const [closesAt, setClosesAt] = useState(""); const [publishNow, setPublishNow] = useState(true);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (open) {
      setRole(""); setDept(""); setDescription(""); setLocation(""); setEmploymentType("permanent");
      setSkills(""); setMinYears("0"); setMinEducation("none"); setShortlistSize("4"); setClosesAt(""); setPublishNow(true); setBusy(false);
    }
  }, [open]);

  async function submit() {
    if (!role.trim()) { toast("Role title is required", "Name the vacancy"); return; }
    setBusy(true);
    const ref = await createRecruitmentReq(role.trim(), dept);
    if (!ref) { setBusy(false); return; }
    const reqSkills = skills.split(",").map((s) => s.trim()).filter(Boolean);
    const ok = await updatePosting(ref, {
      description, location, employmentType, reqSkills,
      minYears: Number(minYears) || 0, minEducation, shortlistSize: Number(shortlistSize) || 4, closesAt,
    });
    if (!ok) { setBusy(false); return; }
    if (publishNow) { await publishPosting(ref, true); }
    else { toast(`${ref} saved as draft`, "Publish it from the openings list when you're ready to advertise"); }
    setBusy(false);
    closeHrModal();
  }

  return (
    <ModalShell open={open} onClose={closeHrModal} width={560}>
      <div className="mh"><h3>New job opening</h3><p>Set the role and the eligibility criteria — applicants are auto-scored and ranked against them.</p></div>
      <div className="mb">
        <div className="mrow c2">
          <div><label>Role title</label><input className="field" placeholder="Field Operations Coordinator" value={role} onChange={(e) => setRole(e.target.value)} /></div>
          <div><label>Department</label>
            <select className="field" value={dept} onChange={(e) => setDept(e.target.value)}>
              <option value="">— select —</option>
              {hrDepartments.map((d) => <option key={d}>{d}</option>)}
            </select>
          </div>
        </div>
        <div><label>Description</label><textarea className="field" rows={3} placeholder="What the role involves — shown on the public careers page." value={description} onChange={(e) => setDescription(e.target.value)} /></div>
        <div className="mrow c2">
          <div><label>Location</label>
            <input className="field" list="ke-locations" placeholder="Nairobi" value={location} onChange={(e) => setLocation(e.target.value)} />
            <datalist id="ke-locations">{kenyaLocations.map((l) => <option key={l} value={l} />)}</datalist>
          </div>
          <div><label>Employment type</label>
            <select className="field" value={employmentType} onChange={(e) => setEmploymentType(e.target.value)}>
              {employmentTypes.map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}
            </select>
          </div>
        </div>
        <div><label>Required skills <span style={{ color: "var(--ink-soft)", fontWeight: 400 }}>· comma-separated (55% of the score)</span></label>
          <input className="field" placeholder="Data collection, KoboToolbox, Excel" value={skills} onChange={(e) => setSkills(e.target.value)} /></div>
        <div className="mrow c2">
          <div><label>Minimum years <span style={{ color: "var(--ink-soft)", fontWeight: 400 }}>· 30%</span></label>
            <input className="field" type="number" min={0} value={minYears} onChange={(e) => setMinYears(e.target.value)} /></div>
          <div><label>Minimum education <span style={{ color: "var(--ink-soft)", fontWeight: 400 }}>· 15%</span></label>
            <select className="field" value={minEducation} onChange={(e) => setMinEducation(e.target.value)}>
              {educationLevels.map((e) => <option key={e.value} value={e.value}>{e.label}</option>)}
            </select>
          </div>
        </div>
        <div className="mrow c2">
          <div><label>Shortlist size</label><input className="field" type="number" min={1} value={shortlistSize} onChange={(e) => setShortlistSize(e.target.value)} /></div>
          <div><label>Closes on</label><input className="field" type="date" value={closesAt} onChange={(e) => setClosesAt(e.target.value)} /></div>
        </div>
        <label style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 13.5, marginTop: 4 }}>
          <input type="checkbox" checked={publishNow} onChange={(e) => setPublishNow(e.target.checked)} />
          Publish to the public careers page now
        </label>
      </div>
      <div className="mf"><button className="btn" onClick={closeHrModal} disabled={busy}>Cancel</button><button className="btn primary" onClick={submit} disabled={busy}>{busy ? "Posting…" : publishNow ? "Post & publish" : "Save draft"}</button></div>
    </ModalShell>
  );
}

// Auto-ranked applicant pool for one posting — total count + top-N shortlist.
function PostingDetailModal() {
  const { hrModal, closeHrModal, hrData, advanceCandidate, publishPosting, openCandidateCv, screenCandidateCv, toast } = useApp();
  const open = hrModal?.kind === "postingDetail";
  const ref = hrModal?.kind === "postingDetail" ? hrModal.ref : "";
  const [showAll, setShowAll] = useState(false);
  const [screening, setScreening] = useState<Set<string>>(new Set());
  const [bulkBusy, setBulkBusy] = useState(false);
  useEffect(() => { if (open) { setShowAll(false); setScreening(new Set()); setBulkBusy(false); } }, [open, ref]);
  async function runScreen(id: string, name: string) {
    setScreening((s) => new Set(s).add(id));
    await screenCandidateCv(id, name);
    setScreening((s) => { const n = new Set(s); n.delete(id); return n; });
  }
  const posting = (hrData?.recruitment ?? []).find((r) => r.ref === ref);
  if (!open || !posting) return <ModalShell open={open} onClose={closeHrModal} width={640}><div className="mb" /></ModalShell>;

  const ranked = [...posting.candidates].sort((a, b) => b.eligibility - a.eligibility);
  const shortlist = ranked.slice(0, posting.shortlistSize);
  const rest = ranked.slice(posting.shortlistSize);
  const reqSet = new Set(posting.reqSkills.map((s) => s.toLowerCase().trim()));

  async function viewCv(path: string) { const u = await openCandidateCv(path); if (u) window.open(u, "_blank"); }
  const eligColor = (n: number) => (n >= 80 ? "var(--green)" : n >= 55 ? "var(--ember)" : "var(--ink-soft)");
  const verdictStyle = (v: string) => v === "strong"
    ? { background: "var(--green-soft)", color: "var(--green)", label: "Strong match" }
    : v === "possible" ? { background: "var(--ember-soft)", color: "var(--ember)", label: "Possible match" }
    : { background: "var(--red-soft)", color: "var(--red)", label: "Weak match" };

  function Card({ c, rank, short }: { c: typeof ranked[number]; rank: number; short?: boolean }) {
    const matched = c.skills.filter((s) => reqSet.has(s.toLowerCase().trim()));
    const busy = screening.has(c.id);
    return (
      <div className={`appcard${short ? " short" : ""}`}>
        <div className="appcard-top">
          <span className="appcard-rank">{short ? "★" : ""}{rank}</span>
          <div className="av-sm" style={{ background: avColor({ color: null, name: c.name }) }}>{c.name[0]}</div>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div className="appcard-name">
              {c.name}
              {c.source === "public" && <span className="pill today" style={{ textTransform: "none" }}>Applied online</span>}
              {c.aiVerdict && <span className="pill" style={{ ...verdictStyle(c.aiVerdict), textTransform: "none" }}>★ {verdictStyle(c.aiVerdict).label}</span>}
            </div>
            <div className="appcard-meta">
              {c.email || "—"} · {c.yearsExp}y exp · {educationLabel(c.education)}
              {posting!.reqSkills.length > 0 && <> · skills {matched.length}/{posting!.reqSkills.length}</>}
            </div>
          </div>
          <div className="appcard-elig" style={{ color: eligColor(c.eligibility) }}>{c.eligibility}%<small>eligible</small></div>
        </div>
        <div className="appcard-actions">
          {c.cvPath
            ? <a href="#" className={`lnk${busy ? " busy" : ""}`} onClick={(e) => { e.preventDefault(); busy || runScreen(c.id, c.name); }}>{busy ? "Reading CV…" : c.aiVerdict ? "Re-scan CV" : "Scan CV"}</a>
            : <span style={{ fontSize: 11.5, color: "var(--ink-faint)" }}>no CV attached</span>}
          {c.cvPath && <a href="#" className="lnk" onClick={(e) => { e.preventDefault(); viewCv(c.cvPath!); }}>View CV</a>}
          <div style={{ flex: 1 }} />
          <select className="field" style={{ width: 132, padding: "5px 8px", fontSize: 12 }} value={c.stage} onChange={(e) => advanceCandidate(c.id, e.target.value)}>
            {candidateStages.map((s) => <option key={s} value={s}>{cap(s)}</option>)}
          </select>
        </div>
        {c.aiVerdict && (
          <div className="appcard-verdict">
            <div style={{ fontSize: 12.5, color: "var(--ink)", marginBottom: c.aiChecked.length || c.aiConcerns.length ? 8 : 0 }}>{c.aiSummary}</div>
            {c.aiChecked.length > 0 && (
              <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
                {c.aiChecked.map((r, i) => (
                  <span key={i} className="appcard-chip" title={r.note}
                    style={{ background: r.evidenced ? "var(--green-soft)" : "var(--red-soft)", color: r.evidenced ? "var(--green)" : "var(--red)" }}>
                    {r.evidenced ? "✓" : "✗"} {r.requirement}
                  </span>
                ))}
              </div>
            )}
            {c.aiConcerns.length > 0 && <div style={{ fontSize: 11.5, color: "var(--red)", marginTop: 8 }}>⚠ {c.aiConcerns.join(" · ")}</div>}
          </div>
        )}
      </div>
    );
  }

  return (
    <ModalShell open={open} onClose={closeHrModal} width={680}>
      <div className="mh" style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
        <div>
          <h3>{posting.roleTitle} <span className="mono" style={{ color: "var(--ink-soft)", fontSize: 13 }}>{posting.ref}</span></h3>
          <p>{posting.dept || "—"}{posting.location ? ` · ${posting.location}` : ""} · {employmentLabel(posting.employmentType)}</p>
        </div>
        <span className={`pill ${posting.published ? "done" : ""}`} style={{ textTransform: "none" }}>{posting.published ? "Published" : "Draft"}</span>
      </div>
      <div className="mb">
        <div style={{ display: "flex", gap: 18, flexWrap: "wrap", marginBottom: 12, fontSize: 12.5, color: "var(--ink-soft)" }}>
          <div><strong style={{ color: "var(--ink)", fontSize: 20 }}>{ranked.length}</strong> applicant{ranked.length === 1 ? "" : "s"}</div>
          <div style={{ alignSelf: "center" }}>Requires: {posting.reqSkills.length ? posting.reqSkills.join(", ") : "no specific skills"} · {posting.minYears}+ yrs · {educationLabel(posting.minEducation)}</div>
        </div>

        {ranked.length === 0 && <div style={{ fontSize: 13, color: "var(--ink-soft)" }}>No applications yet. {posting.published ? "The role is live on the careers page." : "Publish it to start receiving applications."}</div>}

        {ranked.length > 0 && (
          <>
            <div style={{ fontSize: 12, fontWeight: 700, color: "var(--flame)", marginBottom: 8 }}>★ Shortlist — top {Math.min(posting.shortlistSize, ranked.length)} by eligibility</div>
            {shortlist.map((c, i) => <Card key={c.id} c={c} rank={i + 1} short />)}
            {rest.length > 0 && !showAll && (
              <a href="#" onClick={(e) => { e.preventDefault(); setShowAll(true); }} style={{ display: "inline-block", marginTop: 4, color: "var(--flame)", textDecoration: "none", fontSize: 12.5, fontWeight: 600 }}>view all {ranked.length} applicants ↓</a>
            )}
            {showAll && rest.length > 0 && (
              <div style={{ marginTop: 14 }}>
                <div style={{ fontSize: 12, fontWeight: 700, color: "var(--ink-soft)", marginBottom: 8 }}>Everyone else</div>
                {rest.map((c, i) => <Card key={c.id} c={c} rank={posting.shortlistSize + i + 1} />)}
              </div>
            )}
          </>
        )}
      </div>
      <div className="mf">
        <button className="btn" onClick={() => {
          navigator.clipboard?.writeText(`${window.location.origin}/careers?job=${posting.ref}`);
          toast("Careers link copied", "Share it — applications land back here, auto-ranked");
        }}>Copy careers link</button>
        {shortlist.some((c) => c.cvPath) && (
          <button className="btn" disabled={bulkBusy} onClick={async () => {
            setBulkBusy(true);
            for (const c of shortlist.filter((x) => x.cvPath)) await runScreen(c.id, c.name);
            setBulkBusy(false);
          }}>{bulkBusy ? "Scanning…" : "Scan shortlist CVs"}</button>
        )}
        <button className="btn primary" onClick={() => publishPosting(posting.ref, !posting.published)}>{posting.published ? "Unpublish" : "Publish"}</button>
      </div>
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

// Open review. While not started, HR agrees the KPI list (editable); once
// self-assessment opens the list locks and each KPI carries two independent
// ratings — the employee's (self_met, read-only chip here) and the manager's
// (met, click to toggle). Sign-off locks everything.
function AppraisalModal() {
  const { hrModal, closeHrModal, hrData, toggleAppraisalKpi, setAppraisalKpis, advanceAppraisal, toast } = useApp();
  const open = hrModal?.kind === "appraisal";
  const a = open ? hrData?.appraisals.find((x) => x.id === (hrModal as { id: string }).id) : undefined;
  const editable = a?.stage === "not_started";
  const [draft, setDraft] = useState<string[]>([]);
  useEffect(() => { if (open && a) setDraft(a.kpis.map((k) => k.k)); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [open, a?.id]);
  const stages = ["not_started", "self", "manager", "signed_off"];
  const stageLabels = ["KPIs agreed", "Self-assessment", "Manager review", "Signed off"];
  const advanceLabel: Record<string, string> = { not_started: "Open self-assessment", self: "Skip to manager review", manager: "Sign off" };
  const met = a ? a.kpis.filter((k) => k.met).length : 0;
  const agree = a ? a.kpis.filter((k) => k.met === k.selfMet).length : 0;
  function saveKpis() {
    if (!a) return;
    const list = draft.map((s) => s.trim()).filter(Boolean);
    if (!list.length) { toast("A review needs at least one KPI", "Add one before saving"); return; }
    if (new Set(list.map((s) => s.toLowerCase())).size !== list.length) { toast("Duplicate KPI names", "Each KPI needs a distinct name"); return; }
    setAppraisalKpis(a.id, list);
  }
  return (
    <ModalShell open={open} onClose={closeHrModal} width={520}>
      {a && (
        <>
          <div className="mh">
            <h3>{a.who} — {a.cycle}</h3>
            <p>{a.roleTitle || "—"} · reviewer: {a.reviewer}
              {!editable && <> · KPIs met: {met} / {a.kpis.length}</>}
              {(a.stage === "manager" || a.stage === "signed_off") && <> · agrees with self on {agree} / {a.kpis.length}</>}
            </p>
          </div>
          <div className="mb">
            <div className="steps" style={{ marginBottom: 14 }}>
              {stageLabels.map((l, i) => (
                <span key={l} style={{ display: "contents" }}>
                  <div className={`step ${stages.indexOf(a.stage) > i ? "done" : stages.indexOf(a.stage) === i ? "now" : ""}`}><span className="sdot">{i + 1}</span>{l}</div>
                  {i < 3 && <div className="step-arrow" />}
                </span>
              ))}
            </div>
            {editable ? (
              <>
                {draft.map((k, i) => (
                  <div key={i} style={{ display: "flex", gap: 8, marginBottom: 8 }}>
                    <input className="field" style={{ flex: 1 }} placeholder="e.g. Delivery against plan" value={k}
                      onChange={(e) => setDraft((p) => p.map((x, j) => (j === i ? e.target.value : x)))} />
                    <button className="btn" style={{ padding: "6px 12px" }} disabled={draft.length <= 1}
                      onClick={() => setDraft((p) => p.filter((_, j) => j !== i))}>✕</button>
                  </div>
                ))}
                <div style={{ display: "flex", gap: 8 }}>
                  <button className="btn" disabled={draft.length >= 12} onClick={() => setDraft((p) => [...p, ""])}><PlusI />Add KPI</button>
                  <button className="btn primary" onClick={saveKpis}>Save KPIs</button>
                </div>
                <Note>Agree the KPIs now — they lock the moment self-assessment opens. Everyone starts from the standard four; tailor them to the role here.</Note>
              </>
            ) : (
              <>
                {a.kpis.map((k, i) => (
                  <div key={k.k} onClick={() => a.stage !== "signed_off" && toggleAppraisalKpi(a.id, i)} style={{ cursor: a.stage === "signed_off" ? "default" : "pointer" }}>
                    <Check done={k.met}>
                      <span style={{ flex: 1, minWidth: 0 }}>{k.k}</span>
                      {a.stage === "self"
                        ? <span className="meta" style={{ flexShrink: 0 }}>self-rating…</span>
                        : <StatChip ok={k.selfMet} l="Self" />}
                    </Check>
                  </div>
                ))}
                <Note>{a.stage === "signed_off"
                  ? "Signed off — locked. Both ratings are now visible to the employee."
                  : "Click a KPI to set your rating. It's independent of the self-rating and stays hidden from the employee until sign-off."}</Note>
              </>
            )}
          </div>
          <div className="mf">
            <button className="btn" onClick={closeHrModal}>Close</button>
            {a.stage !== "signed_off" && <button className="btn primary" onClick={() => advanceAppraisal(a.id)}>{advanceLabel[a.stage]}</button>}
          </div>
        </>
      )}
    </ModalShell>
  );
}

function CertificationModal() {
  const { hrModal, closeHrModal, hrData, addCertification, toast } = useApp();
  const open = hrModal?.kind === "certification";
  const staff = hrData?.staff ?? [];
  const [f, setF] = useState({ staffNo: "", holder: "", name: "", issuer: "", expiry: "", verified: true });
  const [file, setFile] = useState<File | null>(null);
  useEffect(() => { if (open) { setF({ staffNo: staff[0]?.staffNo ?? "", holder: "", name: "", issuer: "", expiry: "", verified: true }); setFile(null); } /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [open]);
  const set = (k: string, v: string | boolean) => setF((p) => ({ ...p, [k]: v }));
  function submit() {
    if (!f.name.trim()) { toast("Certification name is required", "e.g. Carbon markets & MRV"); return; }
    const picked = f.staffNo ? staff.find((s) => s.staffNo === f.staffNo) : null;
    const holder = picked ? picked.name : f.holder.trim();
    if (!holder) { toast("Who holds this certification?", "Pick an employee or name the holder"); return; }
    if (file && !picked) { toast("Pick an employee to attach a file", "The certificate file goes onto a staff member's file"); return; }
    addCertification({ holder, name: f.name.trim(), issuer: f.issuer, expiry: f.expiry, staffNo: f.staffNo, verified: f.verified, holderUserId: picked?.appUserId ?? null }, file);
  }
  return (
    <ModalShell open={open} onClose={closeHrModal} width={520}>
      <div className="mh"><h3>Add a certification</h3><p>Attaches to the staff file; expiry alerts fire 90 days out.</p></div>
      <div className="mb">
        <div className="mrow c2">
          <div><label>Employee</label>
            <select className="field" value={f.staffNo} onChange={(e) => set("staffNo", e.target.value)}>
              {staff.map((s) => <option key={s.staffNo} value={s.staffNo}>{s.name} · {s.staffNo}</option>)}
              <option value="">Not on the system / group</option>
            </select>
          </div>
          {f.staffNo === "" && <div><label>Holder</label><input className="field" placeholder="e.g. Field team" value={f.holder} onChange={(e) => set("holder", e.target.value)} /></div>}
        </div>
        <div><label>Certification / qualification</label><input className="field" placeholder="e.g. Carbon markets & MRV" value={f.name} onChange={(e) => set("name", e.target.value)} /></div>
        <div className="mrow c2">
          <div><label>Issuer</label><input className="field" placeholder="e.g. Gold Standard" value={f.issuer} onChange={(e) => set("issuer", e.target.value)} /></div>
          <div><label>Expiry (optional)</label><input className="field" type="date" value={f.expiry} onChange={(e) => set("expiry", e.target.value)} /></div>
        </div>
        <div><label>Status</label>
          <select className="field" value={f.verified ? "verified" : "pending"} onChange={(e) => set("verified", e.target.value === "verified")}>
            <option value="verified">Verified — certificate checked by HR</option>
            <option value="pending">Send to the verification queue</option>
          </select>
        </div>
        <div>
          <label>Certificate file <span style={{ textTransform: "none", fontWeight: 400, letterSpacing: 0 }}>· PDF or image · optional</span></label>
          <input className="field" type="file" accept=".pdf,image/*" onChange={(e) => setFile(e.target.files?.[0] ?? null)} />
          {file && <div className="meta" style={{ textTransform: "none", letterSpacing: 0, marginTop: 5 }}>{file.name} — uploads to the employee's file; they see it in My Certificates</div>}
        </div>
      </div>
      <div className="mf"><button className="btn" onClick={closeHrModal}>Cancel</button><button className="btn primary" onClick={submit}>Add certification</button></div>
    </ModalShell>
  );
}

const feedbackCategories = ["Ways of working", "People", "Operations", "Tools & systems", "Pay & benefits", "Field conditions", "Other"];
// Shared with the Staff Portal's Give Feedback tab.
export function FeedbackModal() {
  const { hrModal, closeHrModal, submitFeedback, toast } = useApp();
  const open = hrModal?.kind === "feedback";
  const [f, setF] = useState({ body: "", category: feedbackCategories[0], audience: "hr", anonymous: false });
  useEffect(() => { if (open) setF({ body: "", category: feedbackCategories[0], audience: "hr", anonymous: false }); }, [open]);
  return (
    <ModalShell open={open} onClose={closeHrModal} width={520}>
      <div className="mh"><h3>Send feedback</h3><p>Goes only to the recipient you choose. Anonymous items carry no author reference.</p></div>
      <div className="mb">
        <div className="mrow c2">
          <div><label>Category</label>
            <select className="field" value={f.category} onChange={(e) => setF((p) => ({ ...p, category: e.target.value }))}>
              {feedbackCategories.map((c) => <option key={c}>{c}</option>)}
            </select>
          </div>
          <div><label>Send to</label>
            <select className="field" value={f.audience} onChange={(e) => setF((p) => ({ ...p, audience: e.target.value }))}>
              <option value="hr">HR / People</option>
              <option value="leadership">Leadership</option>
            </select>
          </div>
        </div>
        <div><label>Message</label><textarea className="field" rows={4} placeholder="What should we know?" value={f.body} onChange={(e) => setF((p) => ({ ...p, body: e.target.value }))} /></div>
        <label style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 13, cursor: "pointer" }}>
          <input type="checkbox" checked={f.anonymous} onChange={(e) => setF((p) => ({ ...p, anonymous: e.target.checked }))} />
          Send anonymously
        </label>
      </div>
      <div className="mf">
        <button className="btn" onClick={closeHrModal}>Cancel</button>
        <button className="btn primary" onClick={() => { if (!f.body.trim()) { toast("Feedback needs a message", "Say what should change"); return; } submitFeedback({ ...f, body: f.body.trim() }); }}>Send</button>
      </div>
    </ModalShell>
  );
}

const exitReasons = ["Contract end", "Resignation", "Better opportunity", "Career growth", "Relocation", "Termination", "Other"];
function ExitStartModal() {
  const { hrModal, closeHrModal, hrData, startExit, toast } = useApp();
  const open = hrModal?.kind === "exitStart";
  const staff = (hrData?.staff ?? []).filter((s) => s.state === "active");
  const [f, setF] = useState({ staffNo: "", person: "", reason: exitReasons[0], finalDay: "" });
  useEffect(() => { if (open) setF({ staffNo: staff[0]?.staffNo ?? "", person: "", reason: exitReasons[0], finalDay: "" }); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [open]);
  function submit() {
    const person = f.staffNo ? staff.find((s) => s.staffNo === f.staffNo)?.name ?? "" : f.person.trim();
    if (!person) { toast("An exit needs a person", "Pick an employee or type a name"); return; }
    startExit({ person, reason: f.reason, finalDay: f.finalDay, staffNo: f.staffNo });
  }
  return (
    <ModalShell open={open} onClose={closeHrModal} width={520}>
      <div className="mh"><h3>Start an exit</h3><p>Opens the clearance checklist — this replaces the paper exit form.</p></div>
      <div className="mb">
        <div className="mrow c2">
          <div><label>Employee</label>
            <select className="field" value={f.staffNo} onChange={(e) => setF((p) => ({ ...p, staffNo: e.target.value }))}>
              {staff.map((s) => <option key={s.staffNo} value={s.staffNo}>{s.name} · {s.staffNo}</option>)}
              <option value="">Not on the system (field / casual)</option>
            </select>
          </div>
          {f.staffNo === "" && <div><label>Name</label><input className="field" placeholder="e.g. J. Kamau" value={f.person} onChange={(e) => setF((p) => ({ ...p, person: e.target.value }))} /></div>}
        </div>
        <div className="mrow c2">
          <div><label>Reason</label>
            <select className="field" value={f.reason} onChange={(e) => setF((p) => ({ ...p, reason: e.target.value }))}>
              {exitReasons.map((r) => <option key={r}>{r}</option>)}
            </select>
          </div>
          <div><label>Final day</label><input className="field" type="date" value={f.finalDay} onChange={(e) => setF((p) => ({ ...p, finalDay: e.target.value }))} /></div>
        </div>
        <Note>On full clearance the certificate of service is issued and the staff file is marked exited.</Note>
      </div>
      <div className="mf"><button className="btn" onClick={closeHrModal}>Cancel</button><button className="btn primary" onClick={submit}>Open clearance</button></div>
    </ModalShell>
  );
}

// The employee's four-stage exit journey, derived from the clearance
// checklist (areas 0–3 = handover & property, 4 = exit interview, 5–6 = final
// clearance). Shared with the Staff Portal's My Exit tab so both sides always
// show the same picture.
export function ExitSteps({ exit }: { exit: { clearance: ExitStep[]; state: string } }) {
  const done = exit.clearance.filter((c) => c.done).length;
  const cleared = exit.state === "cleared";
  return (
    <div className="steps">
      <div className="step done"><span className="sdot">✓</span>Notice given</div><div className="step-arrow" />
      <div className={`step ${cleared || done >= 4 ? "done" : "now"}`}><span className="sdot">2</span>Handover &amp; property</div><div className="step-arrow" />
      <div className={`step ${cleared || done >= 5 ? "done" : done >= 4 ? "now" : ""}`}><span className="sdot">3</span>Exit interview</div><div className="step-arrow" />
      <div className={`step ${cleared ? "done" : done >= 5 ? "now" : ""}`}><span className="sdot">4</span>Final clearance</div>
    </div>
  );
}

// Clearance drawer: each area signed off by the function that owns it. Shows
// the same journey and document status the employee sees in My Exit.
function ExitDetailModal() {
  const { hrModal, closeHrModal, hrData, signExitStep, cancelExit } = useApp();
  const [confirmRemove, setConfirmRemove] = useState(false);
  useEffect(() => { if (hrModal?.kind === "exitDetail") setConfirmRemove(false); }, [hrModal]);
  const open = hrModal?.kind === "exitDetail";
  const x = open ? hrData?.exits.find((e) => e.ref === (hrModal as { ref: string }).ref) : undefined;
  const done = x ? x.clearance.filter((c) => c.done).length : 0;
  const docRow = (l: string) => (
    <div className="recon" style={{ padding: "8px 0" }}>
      <span>{l}</span>
      {x?.state === "cleared" ? <span className="rcv ok">released</span> : <span className="rcv no">pending clearance</span>}
    </div>
  );
  return (
    <ModalShell open={open} onClose={closeHrModal} width={520}>
      {x && (
        <>
          <div className="mh"><h3>{x.ref} — {x.person}</h3><p>{x.roleTitle || "—"} · {x.reason || "—"}{x.finalDay ? ` · final day ${fmtD(x.finalDay)}` : ""} · {done} of {x.clearance.length} cleared</p></div>
          <div className="mb">
            <div style={{ marginBottom: 14 }}><ExitSteps exit={x} /></div>
            {x.clearance.map((c, i) => (
              <div key={c.area} onClick={() => x.state !== "cleared" && signExitStep(x.ref, i)} style={{ cursor: x.state === "cleared" ? "default" : "pointer" }}>
                <Check done={c.done}>
                  <span style={{ flex: 1, minWidth: 0 }}>{c.area}</span>
                  {c.owner === "staff" && (
                    <span style={{
                      fontFamily: "var(--mono)", fontSize: 9.5, fontWeight: 600, padding: "2px 6px", borderRadius: 5, flexShrink: 0, whiteSpace: "nowrap",
                      background: "var(--flame-soft)", color: "var(--flame)",
                    }}>
                      employee ticks
                    </span>
                  )}
                </Check>
              </div>
            ))}
            <div className="panel-h" style={{ padding: "10px 0 4px" }}><h3 style={{ fontSize: 12.5 }}>What {x.person.split(" ")[0]} sees in My Exit</h3><span className="meta">released on final clearance</span></div>
            {docRow("Certificate of service")}
            {docRow("Final payslip")}
            {docRow("P9 tax form")}
            <Note>{x.state === "cleared"
              ? <>Fully cleared — the certificate of service has been issued and the staff file is marked exited.{x.accessUntil ? <> <strong>Access closes {new Date(x.accessUntil).toLocaleString("en-GB", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })}</strong> — the account is suspended automatically after that.</> : null}</>
              : "Click an area to sign it off — the employee ticks their own two from My Exit. On final approval the certificate of service is issued and their access closes 24 hours later."}</Note>
          </div>
          <div className="mf">
            <button className="btn" style={{ marginRight: "auto", color: "var(--red)", borderColor: confirmRemove ? "var(--red)" : undefined }}
              onClick={() => (confirmRemove ? cancelExit(x.ref) : setConfirmRemove(true))}>
              {confirmRemove ? "Click again to confirm — removes the exit" : "Remove from exit"}
            </button>
            <button className="btn primary" onClick={closeHrModal}>Close</button>
          </div>
        </>
      )}
    </ModalShell>
  );
}

// HR-editable staff-file fields: department, contract end, next of kin.
function StaffProfileModal() {
  const { hrModal, closeHrModal, updateStaffHrProfile } = useApp();
  const open = hrModal?.kind === "staffProfile";
  const s = hrModal?.kind === "staffProfile" ? hrModal.staff : null;
  const [f, setF] = useState({ dept: "", contractEnd: "", kinName: "", kinRel: "", kinPhone: "", kinCover: "emergency" });
  useEffect(() => {
    if (open && s) {
      const kin = s.nextOfKin[0];
      setF({
        dept: s.dept ?? "", contractEnd: s.contractEnd ?? "",
        kinName: kin?.name ?? "", kinRel: kin?.relationship ?? "", kinPhone: kin?.phone ?? "", kinCover: kin?.cover ?? "emergency",
      });
    }
    /* eslint-disable-next-line react-hooks/exhaustive-deps */
  }, [open]);
  const set = (k: string, v: string) => setF((p) => ({ ...p, [k]: v }));
  function submit() {
    if (!s) return;
    const kin = f.kinName.trim()
      ? [{ name: f.kinName.trim(), relationship: f.kinRel.trim() || "Next of kin", phone: f.kinPhone.trim(), cover: f.kinCover }, ...s.nextOfKin.slice(1)]
      : null;
    updateStaffHrProfile({ staffNo: s.staffNo, dept: f.dept, contractEnd: f.contractEnd, nextOfKin: kin });
  }
  return (
    <ModalShell open={open} onClose={closeHrModal} width={520}>
      {s && (
        <>
          <div className="mh"><h3>HR details — {s.name}</h3><p>{s.staffNo} · department, contract window and next of kin</p></div>
          <div className="mb">
            <div className="mrow c2">
              <div><label>Department</label>
                <select className="field" value={f.dept} onChange={(e) => set("dept", e.target.value)}>
                  <option value="">— select —</option>
                  {hrDepartments.map((d) => <option key={d}>{d}</option>)}
                  {f.dept && !hrDepartments.includes(f.dept) && <option>{f.dept}</option>}
                </select>
              </div>
              <div><label>Contract ends</label><input className="field" type="date" value={f.contractEnd} onChange={(e) => set("contractEnd", e.target.value)} /></div>
            </div>
            <div className="mrow c2">
              <div><label>Next of kin</label><input className="field" placeholder="Full name" value={f.kinName} onChange={(e) => set("kinName", e.target.value)} /></div>
              <div><label>Relationship</label><input className="field" placeholder="Spouse / Next of kin" value={f.kinRel} onChange={(e) => set("kinRel", e.target.value)} /></div>
            </div>
            <div className="mrow c2">
              <div><label>Phone</label><input className="field" placeholder="+254 …" value={f.kinPhone} onChange={(e) => set("kinPhone", e.target.value)} /></div>
              <div><label>Cover</label>
                <select className="field" value={f.kinCover} onChange={(e) => set("kinCover", e.target.value)}>
                  <option value="emergency">Emergency contact</option>
                  <option value="medical">Medical cover</option>
                </select>
              </div>
            </div>
            <Note>Next of kin is mandatory for field staff before deployment. Contract end dates drive the 90 / 60 / 30-day renewal triggers.</Note>
          </div>
          <div className="mf"><button className="btn" onClick={closeHrModal}>Cancel</button><button className="btn primary" onClick={submit}>Save</button></div>
        </>
      )}
    </ModalShell>
  );
}

/* ============================ view ============================ */
export default function HrView() {
  const { tabs, toast, goTab, openHrModal, publishPosting, hrLeaveQueue, hrBalances, decideLeave, hrData, preparePayroll, approvePayroll, postPayroll, setFieldAssignmentState, startAppraisalCycle, verifyCertification, setFeedbackState, refreshHr, staffDocUrl, weeklyReports, acknowledgeWeeklyReport, canViewReports } = useApp();
  const tab = tabs.hr;
  const [reportView, setReportView] = useState<WeeklyReport | null>(null);
  async function openCertDoc(path: string) { const url = await staffDocUrl(path); if (url) window.open(url, "_blank", "noopener"); }
  // the other side of an appraisal/exit/cert acts from the Staff Portal, and job applicants
  // apply from the public careers page — pull fresh state each time these tabs open
  useEffect(() => { if (tab === "h-appraisals" || tab === "h-exit" || tab === "h-certs" || tab === "h-recruit") refreshHr(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [tab]);
  const [empFilter, setEmpFilter] = useState("all");
  const staff = hrData?.staff ?? [];
  const runs = hrData?.runs ?? [];
  const recruitment = hrData?.recruitment ?? [];
  const enumerators = hrData?.enumerators ?? [];
  const fieldAssignments = hrData?.fieldAssignments ?? [];
  const appraisals = hrData?.appraisals ?? [];
  const certifications = hrData?.certifications ?? [];
  const feedback = hrData?.feedback ?? [];
  const exits = hrData?.exits ?? [];

  // appraisals: show the most recently opened cycle
  const latestCycle = appraisals.length ? appraisals[appraisals.length - 1].cycle : null;
  const cycleRows = appraisals.filter((a) => a.cycle === latestCycle);
  const signedOff = cycleRows.filter((a) => a.stage === "signed_off");
  const kpiTotal = cycleRows.reduce((n, a) => n + a.kpis.length, 0);
  const kpiMet = cycleRows.reduce((n, a) => n + a.kpis.filter((k) => k.met).length, 0);
  const now0 = new Date();
  const curCycle = `${now0.getMonth() < 6 ? "H1" : "H2"} ${now0.getFullYear()}`;
  const stagePill: Record<string, { cls: string; l: string }> = {
    not_started: { cls: "week", l: "Not started" }, self: { cls: "today", l: "Self-assessment" },
    manager: { cls: "today", l: "Manager review" }, signed_off: { cls: "done", l: "Signed off" },
  };

  // certifications: register vs verification queue; expiry window = 90 days
  const certRegister = certifications.filter((c) => c.state === "verified");
  const certQueue = certifications.filter((c) => c.state === "pending");
  const soon = new Date(); soon.setDate(soon.getDate() + 90);
  const certExpiring = (c: { expiry: string | null }) => !!c.expiry && c.expiry <= soon.toISOString().slice(0, 10);

  // feedback: open items + themes
  const fbOpen = feedback.filter((f) => f.state === "open" || f.state === "in_review");
  const fbActioned = feedback.filter((f) => f.state === "actioned" || f.state === "closed");
  const fbAcked = feedback.filter((f) => f.state !== "open").length;
  const fbThemes = Object.entries(feedback.reduce((m, f) => { const k = f.category || "Other"; m[k] = (m[k] || 0) + 1; return m; }, {} as Record<string, number>)).sort((a, b) => b[1] - a[1]);
  const maxTheme = Math.max(1, ...fbThemes.map(([, n]) => n));
  const fbPill: Record<string, { cls: string; l: string }> = {
    open: { cls: "week", l: "Open" }, in_review: { cls: "today", l: "In review" },
    acknowledged: { cls: "week", l: "Acknowledged" }, actioned: { cls: "done", l: "Actioned" }, closed: { cls: "done", l: "Closed" },
  };
  const fbNext: Record<string, { to: string; l: string }> = {
    open: { to: "in_review", l: "Review" }, in_review: { to: "acknowledged", l: "Acknowledge" }, acknowledged: { to: "actioned", l: "Mark actioned" },
  };
  const ago = (iso: string) => {
    const d = Math.floor((Date.now() - new Date(iso).getTime()) / 86400000);
    return d <= 0 ? "today" : d === 1 ? "yesterday" : d < 14 ? `${d} days ago` : `${Math.floor(d / 7)} weeks ago`;
  };

  // exits: reasons chart
  const exitReasonRows = Object.entries(exits.reduce((m, x) => { const k = x.reason || "Other"; m[k] = (m[k] || 0) + 1; return m; }, {} as Record<string, number>)).sort((a, b) => b[1] - a[1]);
  const maxExitReason = Math.max(1, ...exitReasonRows.map(([, n]) => n));

  // personnel: contract renewal window = 120 days
  const horizon = new Date(); horizon.setDate(horizon.getDate() + 120);
  const contractsEnding = staff
    .filter((s) => s.state === "active" && s.contractEnd && s.contractEnd <= horizon.toISOString().slice(0, 10))
    .sort((a, b) => (a.contractEnd! < b.contractEnd! ? -1 : 1));
  const daysTo = (iso: string) => Math.ceil((new Date(iso + "T00:00:00").getTime() - Date.now()) / 86400000);

  const pendingLeave = hrLeaveQueue.filter((r) => r.state === "pending");
  const decidedLeave = hrLeaveQueue.filter((r) => r.state !== "pending").slice(0, 5);
  const today = new Date().toISOString().slice(0, 10);
  const onLeaveToday = hrLeaveQueue.filter((r) => r.state === "approved" && r.from <= today && r.to >= today);

  // weekly reports: current-week submissions + who's still missing
  const thisMonday = (() => { const x = new Date(); x.setDate(x.getDate() - ((x.getDay() + 6) % 7)); return `${x.getFullYear()}-${String(x.getMonth() + 1).padStart(2, "0")}-${String(x.getDate()).padStart(2, "0")}`; })();
  const reportsSorted = [...weeklyReports].sort((a, b) => (b.weekStart + b.ref).localeCompare(a.weekStart + a.ref));
  const thisWeekReports = weeklyReports.filter((r) => r.weekStart === thisMonday);
  const submittedEmails = new Set(thisWeekReports.map((r) => r.authorEmail.toLowerCase()));
  const missingThisWeek = staff.filter((s) => s.state === "active" && !submittedEmails.has(s.email.toLowerCase()));
  const unreviewed = weeklyReports.filter((r) => r.state === "submitted");

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
          {tab === "h-personnel" && (
            <button className="btn primary" onClick={() => openHrModal({ kind: "employee" })}><PlusI />Add employee</button>
          )}
          {tab === "h-pay" && !hasCurrentRun && (
            <button className="btn primary" onClick={() => preparePayroll(curPeriod)}><PlusI />Prepare {fmtPeriod(curPeriod)} run</button>
          )}
          {tab === "h-appraisals" && !appraisals.some((a) => a.cycle === curCycle) && (
            <button className="btn primary" onClick={() => startAppraisalCycle(curCycle)}><PlusI />Start {curCycle} cycle</button>
          )}
          {tab === "h-certs" && (
            <button className="btn primary" onClick={() => openHrModal({ kind: "certification" })}><PlusI />Add certification</button>
          )}
          {tab === "h-feedback" && (
            <button className="btn primary" onClick={() => openHrModal({ kind: "feedback" })}><PlusI />Send feedback</button>
          )}
          {tab === "h-exit" && (
            <button className="btn primary" onClick={() => openHrModal({ kind: "exitStart" })}><PlusI />Start an exit</button>
          )}
          {tab === "h-recruit" && (
            <>
              <button className="btn" onClick={() => { refreshHr(); toast("Pipeline refreshed", "Pulled the latest applications from the careers page"); }}>Refresh</button>
              <button className="btn primary" onClick={() => openHrModal({ kind: "requisition" })}><PlusI />New job opening</button>
            </>
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
                <div className="task" onClick={() => goTab("hr", "h-personnel")}><span className="id" style={{ color: "var(--red)" }}>2FA</span><span className="txt">{noTwoFa.length} not enrolled in two-factor<small>{noTwoFa.map((s) => s.name).join(", ")}</small></span><span className="pill over">Action</span></div>
              )}
              {missingFiles.length > 0 && (
                <div className="task" onClick={() => goTab("hr", "h-personnel")}><span className="id" style={{ color: "var(--ember)" }}>DOCS</span><span className="txt">{missingFiles.length} staff file{missingFiles.length > 1 ? "s" : ""} missing statutory IDs<small>{missingFiles.map((s) => s.name).join(", ")}</small></span><span className="pill today">Review</span></div>
              )}
              {openRoles.length > 0 && (
                <div className="task" onClick={() => goTab("hr", "h-recruit")}><span className="id" style={{ color: "var(--flame)" }}>REC</span><span className="txt">{openRoles.length} open job opening{openRoles.length > 1 ? "s" : ""} — {allCandidates.length} candidates in pipeline</span><span className="pill week">In progress</span></div>
              )}
              {contractsEnding.length > 0 && (
                <div className="task" onClick={() => goTab("hr", "h-personnel")}><span className="id" style={{ color: "var(--ember)" }}>CTR</span><span className="txt">{contractsEnding.length} contract{contractsEnding.length > 1 ? "s" : ""} ending soon<small>{contractsEnding.map((s) => s.name).join(", ")} — HR and MD notified</small></span><span className="pill week">Renew</span></div>
              )}
              {cycleRows.length - signedOff.length > 0 && (
                <div className="task" onClick={() => goTab("hr", "h-appraisals")}><span className="id" style={{ color: "var(--ember)" }}>APR</span><span className="txt">{cycleRows.length - signedOff.length} appraisal{cycleRows.length - signedOff.length > 1 ? "s" : ""} due this cycle<small>{signedOff.length} signed off · {cycleRows.length - signedOff.length} in progress</small></span><span className="pill today">Review</span></div>
              )}
              {certQueue.length > 0 && (
                <div className="task" onClick={() => goTab("hr", "h-certs")}><span className="id" style={{ color: "var(--ember)" }}>CERT</span><span className="txt">{certQueue.length} certification{certQueue.length > 1 ? "s" : ""} awaiting verification<small>{certQueue.map((c) => c.holder).join(", ")}</small></span><span className="pill week">Verify</span></div>
              )}
              {fbOpen.length > 0 && (
                <div className="task" onClick={() => goTab("hr", "h-feedback")}><span className="id" style={{ color: "var(--flame)" }}>FB</span><span className="txt">{fbOpen.length} open feedback item{fbOpen.length > 1 ? "s" : ""} awaiting response</span><span className="pill today">Respond</span></div>
              )}
              {exits.filter((x) => x.state === "in_progress").length > 0 && (
                <div className="task" onClick={() => goTab("hr", "h-exit")}><span className="id" style={{ color: "var(--ember)" }}>EXT</span><span className="txt">{exits.filter((x) => x.state === "in_progress").map((x) => x.person).join(", ")} — exit clearance in progress</span><span className="pill week">Clear</span></div>
              )}
              {pendingLeave.length + noTwoFa.length + missingFiles.length + openRoles.length + contractsEnding.length + (cycleRows.length - signedOff.length) + certQueue.length + fbOpen.length + exits.filter((x) => x.state === "in_progress").length === 0 && (
                <div className="pad" style={{ fontSize: 13, color: "var(--ink-soft)" }}>All clear — no pending approvals, complete files, everyone enrolled.</div>
              )}
            </div>
          </div>
        </div>
      )}

      {tab === "h-personnel" && (
        <div className="hr-panel active">
          <Pulse data={[
            { k: "Total personnel", tick: "t-blue", v: String(staff.length + enumerators.length), d: `${staff.length} core · ${enumerators.length} field`, dc: "flat" as const },
            { k: "Active", tick: "t-blue", v: String(staff.length - missingFiles.length), d: "on payroll", dc: "flat" as const },
            { k: "Onboarding", tick: onboarding.length ? "t-ember" : "t-green", v: String(onboarding.length), d: onboarding.length ? onboarding.map((c) => c.name.split(" ")[0]).join(", ") : "none", dc: "flat" as const },
            { k: "Casual register", tick: "t-blue", v: String(enumerators.length), d: "per engagement", dc: "flat" as const },
            { k: "Files incomplete", tick: missingFiles.length ? "t-red" : "t-green", v: String(missingFiles.length), d: missingFiles.length ? "blocking activation" : "all complete", dc: "flat" as const },
          ]} />
          <div className="panel" style={{ marginBottom: 18 }}>
            <div className="panel-h">
              <h3>Employee directory</h3>
              <span className="meta"><a href="#" onClick={(e) => { e.preventDefault(); openHrModal({ kind: "employee" }); }} style={{ color: "var(--flame)", textDecoration: "none" }}>+ Add employee</a></span>
            </div>
            <div style={{ padding: "10px 18px 4px", display: "flex", gap: 7, flexWrap: "wrap" }}>
              {[{ v: "all", l: "All" }, ...contractTypes.map((c) => ({ v: c.value, l: c.label })), { v: "expiring", l: "Expiring soon" }].map((f) => (
                <button key={f.v} className={`btn ${empFilter === f.v ? "primary" : ""}`} style={{ padding: "4px 11px", fontSize: 11.5 }} onClick={() => setEmpFilter(f.v)}>{f.l}</button>
              ))}
            </div>
            <table className="tbl">
              <thead><tr><th>Employee no.</th><th>Name</th><th>Department</th><th>Type</th><th>Contract ends</th><th>Status</th></tr></thead>
              <tbody>
                {(() => {
                  const rows = staff.filter((s) => empFilter === "all" ? true : empFilter === "expiring" ? contractsEnding.includes(s) : s.contractType === empFilter);
                  if (!rows.length) return <tr><td colSpan={6} style={{ color: "var(--ink-soft)", fontSize: 13 }}>No employees match this filter.</td></tr>;
                  return rows.map((s) => {
                    const miss = missingIds(s);
                    return (
                      <tr key={s.staffNo} style={{ cursor: "pointer" }} onClick={() => openHrModal({ kind: "staffDetail", staff: s })}>
                        <td className="mono">{s.staffNo}</td>
                        <td>
                          <div className="who">
                            <div className="av-sm" style={{ background: avColor(s) }}>{s.name[0]}</div>
                            <div><div className="nm">{s.name}</div><div className="em">{s.roleTitle || "—"}</div></div>
                          </div>
                        </td>
                        <td style={{ fontSize: 12 }}>{s.dept || "—"}</td>
                        <td><span className={`tag ${s.contractType === "permanent" ? "std" : "view"}`} style={{ textTransform: "none" }}>{contractLabel(s.contractType)}</span></td>
                        <td className="mono" style={{ fontSize: 12 }}>{s.contractEnd ? fmtD(s.contractEnd) : "—"}</td>
                        <td>{s.state === "exited" ? <span className="pill over" style={{ textTransform: "none" }}>Exited</span> : miss === 0 ? <span className="pill done" style={{ textTransform: "none" }}>Active</span> : <span className="pill today" style={{ textTransform: "none" }}>{miss} missing</span>}</td>
                      </tr>
                    );
                  });
                })()}
              </tbody>
            </table>
            <Note>The directory is the master personnel record for core staff and consultants. Adding an employee here creates the staff file, the payroll record and — at the final step — the Jikoni account. Field enumerators and casual workers are engaged per assignment and live in <a href="#" onClick={(e) => { e.preventDefault(); goTab("hr", "h-field"); }} style={{ color: "var(--flame)", textDecoration: "none" }}>Field Workforce</a>.</Note>
          </div>
          <div className="grid g-2" style={{ marginBottom: 18 }}>
            <div className="panel">
              <div className="panel-h"><h3>Documents &amp; compliance</h3><span className="meta">access-controlled</span></div>
              {(() => {
                const n = staff.length || 1;
                const kra = staff.filter((s) => s.kraPin).length, nssf = staff.filter((s) => s.nssfNo).length, shif = staff.filter((s) => s.shifNo).length, twofa = staff.filter((s) => s.twoFa).length;
                const row = (label: string, have: number) => <div className="recon" key={label}><span>{label}</span><span className={`pill ${have >= n ? "done" : "today"}`}>{have} / {n}</span></div>;
                return <>{row("Contracts on file", staff.length)}{row("KRA PIN captured", kra)}{row("NSSF registered", nssf)}{row("SHIF registered", shif)}{row("Two-factor enrolled", twofa)}</>;
              })()}
              <Note>Each staff file is visible only to HR and the employee. Widening access is a super-admin action in User Management.</Note>
            </div>
            <div className="panel">
              <div className="panel-h"><h3>Onboarding in progress</h3><span className="meta">new joiners</span></div>
              {onboarding.length === 0 && <div className="pad" style={{ fontSize: 13, color: "var(--ink-soft)" }}>No one onboarding — hires from Recruitment appear here.</div>}
              {onboarding.map((c) => (
                <div className="task" key={c.id} onClick={() => goTab("hr", "h-recruit")}>
                  <span className="id" style={{ color: "var(--ember)" }}>{c.stage === "hired" ? "HIRE" : "OFFER"}</span>
                  <span className="txt">{c.name}<small>{c.email || "—"}</small></span>
                  <span className={`pill ${c.stage === "hired" ? "done" : "today"}`} style={{ textTransform: "none" }}>{cap(c.stage)}</span>
                </div>
              ))}
              <Note>An employee is not <em>active</em> until contract, statutory IDs, bank details and next of kin are on file.</Note>
            </div>
          </div>
          <div className="panel" style={{ marginBottom: 18 }}>
            <div className="panel-h"><h3>Contracts ending</h3><span className="meta">renewal window · 120 days</span></div>
            {contractsEnding.length === 0 && <div className="pad" style={{ fontSize: 13, color: "var(--ink-soft)" }}>No contracts in the renewal window.</div>}
            {contractsEnding.map((s) => {
              const d = daysTo(s.contractEnd!);
              return (
                <div className="task" key={s.staffNo} onClick={() => openHrModal({ kind: "staffDetail", staff: s })}>
                  <span className="id" style={{ color: d <= 30 ? "var(--red)" : "var(--ember)" }}>CTR</span>
                  <span className="txt">{s.name} — {contractLabel(s.contractType)} ends {fmtD(s.contractEnd!)}<small>{s.roleTitle || "—"} · {d < 0 ? "lapsed" : `${d} days left`}</small></span>
                  <span className={`pill ${d <= 30 ? "over" : d <= 90 ? "today" : "week"}`}>Renew</span>
                </div>
              );
            })}
            <Note>Fixed-term and consultancy contracts raise a renewal trigger at 90, 60 and 30 days. HR and the MD are both notified, so a renewal decision is made before the contract lapses rather than after. Set end dates from the staff file → Edit HR details.</Note>
          </div>
          <div className="grid g-2">
            <div className="panel">
              <div className="panel-h"><h3>Dependants &amp; next of kin</h3><span className="meta">for benefits &amp; emergencies</span></div>
              <table className="tbl">
                <thead><tr><th>Employee</th><th>Dependant</th><th>Relationship</th><th>Cover</th></tr></thead>
                <tbody>
                  {staff.map((s) => (
                    <tr key={s.staffNo} style={{ cursor: "pointer" }} onClick={() => openHrModal({ kind: "staffProfile", staff: s })}>
                      <td>{s.name}</td>
                      <td>{s.nextOfKin.length ? `${s.nextOfKin.length} registered` : "—"}</td>
                      <td>{s.nextOfKin.length ? s.nextOfKin.map((k) => k.relationship).join(", ") : "—"}</td>
                      <td>{s.nextOfKin.length
                        ? [...new Set(s.nextOfKin.map((k) => k.cover || "emergency"))].map((c) => <span key={c} className="rcv ok" style={{ marginRight: 4 }}>{c}</span>)
                        : <span className="rcv no">missing</span>}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <Note>Next of kin is mandatory for field staff before deployment. Click a row to add or update.</Note>
            </div>
          </div>
        </div>
      )}

      {tab === "h-appraisals" && (
        <div className="hr-panel active">
          <div className="grid g-2">
            <div className="panel">
              <div className="panel-h"><h3>Appraisal cycle{latestCycle ? ` — ${latestCycle}` : ""}</h3><span className="meta">click a review to open it</span></div>
              {cycleRows.length === 0 ? (
                <div className="pad" style={{ fontSize: 13, color: "var(--ink-soft)" }}>No cycle open yet — start {curCycle} from the button above; a review opens for everyone active.</div>
              ) : (
                <table className="tbl">
                  <thead><tr><th>Employee</th><th>Reviewer</th><th>KPIs met</th><th>Status</th></tr></thead>
                  <tbody>
                    {cycleRows.map((a) => (
                      <tr key={a.id} style={{ cursor: "pointer" }} onClick={() => openHrModal({ kind: "appraisal", id: a.id })}>
                        <td><strong>{a.who}</strong><br /><small style={{ color: "var(--ink-soft)" }}>{a.roleTitle || "—"}</small></td>
                        <td>{a.reviewer}</td>
                        <td className="mono">{a.stage === "not_started" || a.stage === "self" ? "—" : `${a.kpis.filter((k) => k.met).length} / ${a.kpis.length}`}</td>
                        <td><span className={`pill ${stagePill[a.stage]?.cls ?? "week"}`} style={{ textTransform: "none" }}>{stagePill[a.stage]?.l ?? a.stage}</span></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
              <Note>Cycle: agree KPIs → self-assessment → manager review → sign-off. Self and manager ratings are independent; the employee sees the manager rating at sign-off.</Note>
            </div>
            <div className="panel">
              <div className="panel-h"><h3>KPI attainment</h3><span className="meta">{latestCycle ?? "no cycle"} · per review</span></div>
              <div className="pad">
                {cycleRows.length === 0 ? (
                  <div style={{ fontSize: 13, color: "var(--ink-soft)" }}>Attainment appears once a cycle is open.</div>
                ) : (
                  <StaticBars rows={cycleRows.map((a) => {
                    const met = a.kpis.filter((k) => k.met).length;
                    const pct = a.kpis.length ? Math.round(met / a.kpis.length * 100) : 0;
                    return { l: a.who, n: `${pct}%`, w: pct, c: pct >= 75 ? "var(--green)" : pct >= 50 ? "var(--flame)" : "var(--ember)" };
                  })} />
                )}
              </div>
              <div className="recon"><span>Reviews in this cycle</span><span className="pill today">{cycleRows.length}</span></div>
              <div className="recon"><span>Completed &amp; signed off</span><span className="pill done">{signedOff.length}</span></div>
              <div className="recon"><span>Average KPI attainment</span><span className="mono">{kpiTotal ? Math.round(kpiMet / kpiTotal * 100) : 0}%</span></div>
            </div>
          </div>
        </div>
      )}

      {tab === "h-certs" && (
        <div className="hr-panel active">
          <div className="grid g-2">
            <div className="panel">
              <div className="panel-h"><h3>Certifications &amp; qualifications</h3><span className="meta">{certRegister.length} verified</span></div>
              {certRegister.length === 0 ? (
                <div className="pad" style={{ fontSize: 13, color: "var(--ink-soft)" }}>Nothing on the register yet — use Add certification above.</div>
              ) : (
                <table className="tbl">
                  <thead><tr><th>Employee</th><th>Certification</th><th>Issuer</th><th>Expiry</th><th>Certificate</th><th>Status</th></tr></thead>
                  <tbody>
                    {certRegister.map((c) => (
                      <tr key={c.id}>
                        <td>{c.holder}</td><td>{c.name}</td><td>{c.issuer || "—"}</td>
                        <td className="mono">{c.expiry ? new Date(c.expiry + "T00:00:00").toLocaleDateString("en-GB", { month: "short", year: "numeric" }) : "—"}</td>
                        <td>{c.docPath ? <button className="btn" style={{ padding: "3px 9px", fontSize: 11 }} onClick={() => openCertDoc(c.docPath!)}>View</button> : <span className="meta">no file</span>}</td>
                        <td>{certExpiring(c) ? <span className="rcv no">expiring</span> : <span className="rcv ok">verified</span>}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
              <Note>Employees add their own certifications from the Staff Portal; HR verifies and the certificate is stored on the staff file. Expiry alerts fire 90 days out.</Note>
            </div>
            <div className="panel">
              <div className="panel-h"><h3>Awaiting verification</h3><span className="meta">{certQueue.length} pending</span></div>
              {certQueue.length === 0 && <div className="pad" style={{ fontSize: 13, color: "var(--ink-soft)" }}>Queue clear — staff submissions land here for HR to check.</div>}
              {certQueue.map((c) => (
                <div className="task" key={c.id} style={{ cursor: "default" }}>
                  <span className="id" style={{ color: "var(--ember)" }}>NEW</span>
                  <span className="txt">{c.holder} — {c.name}<small>{c.issuer || "—"}{c.docPath ? " · certificate attached" : " · no file"}</small></span>
                  {c.docPath && <button className="btn" style={{ padding: "4px 10px", fontSize: 11, marginRight: 6 }} onClick={() => openCertDoc(c.docPath!)}>View</button>}
                  <button className="btn" style={{ padding: "4px 10px", fontSize: 11, marginRight: 6 }} onClick={() => verifyCertification(c.id, true)}>Verify</button>
                  <button className="btn" style={{ padding: "4px 10px", fontSize: 11 }} onClick={() => verifyCertification(c.id, false)}>Reject</button>
                </div>
              ))}
              <Note>Staff submit from their portal; HR checks the certificate and verifies. Only verified items count towards skills coverage.</Note>
            </div>
          </div>
          <div className="panel" style={{ marginTop: 18 }}>
            <div className="panel-h"><h3>Skills coverage</h3><span className="meta">verified certifications by issuer</span></div>
            <div className="pad">
              {(() => {
                const byIssuer = Object.entries(certRegister.reduce((m, c) => { const k = c.issuer || "Other"; m[k] = (m[k] || 0) + 1; return m; }, {} as Record<string, number>)).sort((a, b) => b[1] - a[1]);
                const max = Math.max(1, ...byIssuer.map(([, n]) => n));
                return byIssuer.length === 0
                  ? <div style={{ fontSize: 13, color: "var(--ink-soft)" }}>Coverage appears as certifications are verified.</div>
                  : <StaticBars rows={byIssuer.map(([l, n]) => ({ l, n: String(n), w: Math.round(n / max * 100), c: "var(--flame)" }))} />;
              })()}
            </div>
            <Note>Coverage feeds recruitment and the training plan — and evidences capability in donor and investor diligence.</Note>
          </div>
        </div>
      )}

      {tab === "h-feedback" && (
        <div className="hr-panel active">
          <div className="grid g-2">
            <div className="panel">
              <div className="panel-h"><h3>Feedback routed to HR</h3><span className="meta">HR &amp; leadership items only</span></div>
              {feedback.length === 0 && <div className="pad" style={{ fontSize: 13, color: "var(--ink-soft)" }}>Nothing yet — feedback sent to HR / People or Leadership lands here.</div>}
              {feedback.map((f) => (
                <div className="task" key={f.ref} style={{ cursor: "default" }}>
                  <span className="id" style={{ color: "var(--flame)" }}>{f.ref}</span>
                  <span className="txt">{f.body}<small>{f.category || "—"} · {f.author ? "named" : "anonymous"} · {ago(f.created)}{f.audience === "leadership" ? " · to Leadership" : ""}</small></span>
                  {fbNext[f.state] && (
                    <button className="btn" style={{ padding: "4px 10px", fontSize: 11, marginRight: 6 }} onClick={() => setFeedbackState(f.ref, fbNext[f.state].to)}>{fbNext[f.state].l}</button>
                  )}
                  <span className={`pill ${fbPill[f.state]?.cls ?? "week"}`} style={{ textTransform: "none" }}>{fbPill[f.state]?.l ?? f.state}</span>
                </div>
              ))}
              <Note>Staff choose a recipient when they send. Only items addressed to <strong>HR / People</strong> or <strong>Leadership</strong> appear here — peer feedback and upward feedback to a manager go to that person's inbox and are never visible to HR. Anonymous items carry no author reference.</Note>
            </div>
            <div className="panel">
              <div className="panel-h"><h3>Themes &amp; response</h3><span className="meta">all time</span></div>
              <div className="recon"><span>Routed to HR / leadership</span><span className="mono">{feedback.length}</span></div>
              <div className="recon"><span>Acknowledged</span><span className={`pill ${feedback.length && fbAcked === feedback.length ? "done" : "today"}`}>{feedback.length ? Math.round(fbAcked / feedback.length * 100) : 0}%</span></div>
              <div className="recon"><span>Actioned</span><span className="pill done">{fbActioned.length}</span></div>
              <div className="recon"><span>Open</span><span className={`pill ${fbOpen.length ? "today" : "done"}`}>{fbOpen.length}</span></div>
              <div className="pad">
                {fbThemes.length === 0
                  ? <div style={{ fontSize: 13, color: "var(--ink-soft)" }}>Themes appear as feedback arrives.</div>
                  : <StaticBars rows={fbThemes.map(([l, n]) => ({ l, n: String(n), w: Math.round(n / maxTheme * 100), c: "var(--flame)" }))} />}
              </div>
            </div>
          </div>
        </div>
      )}

      {tab === "h-exit" && (
        <div className="hr-panel active">
          {(() => {
            const inProg = exits.filter((x) => x.state === "in_progress");
            const cleared = exits.filter((x) => x.state === "cleared");
            const clearancePct = exits.length
              ? Math.round(exits.reduce((s, x) => s + (x.clearance.length ? x.clearance.filter((c) => c.done).length / x.clearance.length : 0), 0) / exits.length * 100)
              : 0;
            return (
              <Pulse data={[
                { k: "Total exits", tick: "t-blue", v: String(exits.length), d: exits.length ? "recorded" : "none yet", dc: "flat" as const },
                { k: "In progress", tick: inProg.length ? "t-ember" : "t-green", v: String(inProg.length), d: inProg.length ? "clearance open" : "none open", dc: "flat" as const },
                { k: "Fully cleared", tick: "t-green", v: String(cleared.length), d: "offboarded", dc: "flat" as const },
                { k: "Avg clearance", tick: "t-blue", v: `${clearancePct}%`, d: "areas signed off", dc: "flat" as const },
              ]} />
            );
          })()}
          <div className="panel" style={{ marginBottom: 18 }}>
            <div className="panel-h"><h3>Exits</h3><span className="meta">click one to open the clearance</span></div>
            {exits.length === 0 ? (
              <div className="pad" style={{ fontSize: 13, color: "var(--ink-soft)" }}>No exits — start one from the button above when someone is leaving.</div>
            ) : (
              <table className="tbl">
                <thead><tr><th>Exit ref</th><th>Employee</th><th>Reason</th><th>Final day</th><th>Clearance</th></tr></thead>
                <tbody>
                  {exits.map((x) => {
                    const done = x.clearance.filter((c) => c.done).length;
                    return (
                      <tr key={x.ref} style={{ cursor: "pointer" }} onClick={() => openHrModal({ kind: "exitDetail", ref: x.ref })}>
                        <td className="mono">{x.ref}</td>
                        <td><strong>{x.person}</strong><br /><small style={{ color: "var(--ink-soft)" }}>{x.roleTitle || "—"}</small></td>
                        <td>{x.reason || "—"}</td>
                        <td className="mono">{x.finalDay ? fmtD(x.finalDay) : "—"}</td>
                        <td>{x.state === "cleared"
                          ? <span className="pill done" style={{ textTransform: "none" }}>Fully cleared</span>
                          : <span className="pill today" style={{ textTransform: "none" }}>{done} of {x.clearance.length} cleared</span>}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            )}
            <Note>This replaces the paper exit form. Each clearance area is signed off by the function that owns it — supervisor, IT, Finance, HR — and the certificate of service is issued automatically on final approval.</Note>
          </div>
          <div className="grid g-2">
            <div className="panel">
              <div className="panel-h"><h3>Why people leave</h3><span className="meta">all exits</span></div>
              <div className="pad">
                {exitReasonRows.length === 0
                  ? <div style={{ fontSize: 13, color: "var(--ink-soft)" }}>Reasons chart appears as exits are recorded.</div>
                  : <StaticBars rows={exitReasonRows.map(([l, n]) => ({ l, n: String(n), w: Math.round(n / maxExitReason * 100), c: "var(--flame)" }))} />}
              </div>
            </div>
            <div className="panel">
              <div className="panel-h"><h3>Exit interview themes</h3><span className="meta">average rating, 1–5</span></div>
              <div className="recon"><span>Management support</span><span className="mono">4.1</span></div>
              <div className="recon"><span>Team collaboration</span><span className="mono">4.5</span></div>
              <div className="recon"><span>Work-life balance</span><span className="mono">3.4</span></div>
              <div className="recon"><span>Career growth</span><span className="mono">3.0</span></div>
              <div className="recon"><span>Company culture</span><span className="mono">4.3</span></div>
              <Note>Ratings are aggregated. Individual exit-interview responses are visible to HR only, and never to the departing person's manager.</Note>
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

      {tab === "h-reports" && (
        <div className="hr-panel active">
          <div className="panel">
            <div className="panel-h"><h3>Weekly reports</h3><span className="meta">{unreviewed.length} awaiting review · week of {fmtD(thisMonday)}</span></div>
            {reportsSorted.length ? (
              <table className="tbl">
                <thead><tr><th>Ref</th><th>Employee</th><th>Week of</th><th>What they did</th><th>Blockers</th><th>Status</th><th></th></tr></thead>
                <tbody>
                  {reportsSorted.map((r) => (
                    <tr key={r.id}>
                      <td className="mono">{r.ref}</td>
                      <td><strong>{r.author}</strong></td>
                      <td className="mono">{fmtD(r.weekStart)}</td>
                      <td style={{ maxWidth: 300, fontSize: 12.5, color: "var(--ink-soft)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{r.did}</td>
                      <td style={{ fontSize: 12.5, color: r.blockers ? "var(--ember)" : "var(--ink-soft)" }}>{r.blockers ? "⚑ yes" : "—"}</td>
                      <td><span className={`pill ${r.state === "acknowledged" ? "done" : "today"}`} style={{ textTransform: "none" }} title={r.reviewedBy ? `by ${r.reviewedBy}` : ""}>{r.state === "acknowledged" ? "Acknowledged" : "New"}</span></td>
                      <td>
                        <span style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
                          <button className="btn" style={{ padding: "4px 10px", fontSize: 11.5 }} onClick={() => setReportView(r)}>View</button>
                          {canViewReports && r.state === "submitted" && (
                            <button className="btn primary" style={{ padding: "4px 10px", fontSize: 11.5 }} onClick={() => acknowledgeWeeklyReport(r.ref)}>Acknowledge</button>
                          )}
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            ) : (
              <Note noBorder>Nothing yet — reports from the Staff Portal land here. Staff are reminded every Friday if they haven't submitted.</Note>
            )}
          </div>
          <div className="panel sm" style={{ marginTop: 14 }}>
            <div className="panel-h"><h3>Not submitted this week</h3><span className="meta">{missingThisWeek.length} of {staff.filter((s) => s.state === "active").length} active</span></div>
            {missingThisWeek.length ? (
              <div style={{ display: "flex", gap: 8, flexWrap: "wrap", padding: 14 }}>
                {missingThisWeek.map((s) => <span className="acc-chip" key={s.appUserId}>{s.name}</span>)}
              </div>
            ) : (
              <Note noBorder>Everyone active has submitted this week. 🎉</Note>
            )}
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
          <div className="pad" style={{ padding: "0 0 14px" }}>
            <div className="steps">
              <div className="step done"><span className="sdot">1</span>Vacancy raised</div><div className="step-arrow" />
              <div className="step done"><span className="sdot">2</span>Approved &amp; advertised</div><div className="step-arrow" />
              <div className="step now"><span className="sdot">3</span>Screen &amp; score</div><div className="step-arrow" />
              <div className="step"><span className="sdot">4</span>Offer</div><div className="step-arrow" />
              <div className="step"><span className="sdot">5</span>Hire &amp; onboard</div>
            </div>
          </div>
          <div className="grid g-2">
            <div className="panel">
              <div className="panel-h">
                <h3>Open job openings</h3>
                <span className="meta">{recruitment.length} roles</span>
              </div>
              <table className="tbl">
                <thead><tr><th>Ref</th><th>Role</th><th>Status</th><th>Applicants</th><th></th></tr></thead>
                <tbody>
                  {recruitment.length === 0 && <tr><td colSpan={5} style={{ color: "var(--ink-soft)", fontSize: 13 }}>No job openings yet.</td></tr>}
                  {recruitment.map((r) => {
                    const top = Math.max(0, ...r.candidates.map((c) => c.eligibility));
                    return (
                      <tr key={r.ref} style={{ cursor: "pointer" }} onClick={() => openHrModal({ kind: "postingDetail", ref: r.ref })}>
                        <td className="mono">{r.ref}</td>
                        <td><strong>{r.roleTitle}</strong><div style={{ fontSize: 11.5, color: "var(--ink-soft)" }}>{r.dept || "—"}</div></td>
                        <td><span className={`pill ${r.published ? "done" : ""}`} style={{ textTransform: "none" }}>{r.published ? "Published" : "Draft"}</span></td>
                        <td className="mono">{r.candidates.length}{r.candidates.length > 0 && <span style={{ color: "var(--ink-soft)", fontWeight: 400 }}> · top {top}%</span>}</td>
                        <td style={{ textAlign: "right" }} onClick={(e) => e.stopPropagation()}>
                          <a href="#" onClick={(e) => { e.preventDefault(); publishPosting(r.ref, !r.published); }} style={{ color: "var(--flame)", textDecoration: "none", fontSize: 12, marginRight: 10 }}>{r.published ? "Unpublish" : "Publish"}</a>
                          <a href="#" onClick={(e) => { e.preventDefault(); openHrModal({ kind: "candidate", reqRef: r.ref }); }} style={{ color: "var(--flame)", textDecoration: "none", fontSize: 12 }}>+ Candidate</a>
                        </td>
                      </tr>
                    );
                  })}
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
      <StaffProfileModal />
      <RequisitionModal />
      <PostingDetailModal />
      <CandidateModal />
      <EnumeratorModal />
      <AssignmentModal />
      <AppraisalModal />
      <CertificationModal />
      <FeedbackModal />
      <ExitStartModal />
      <ExitDetailModal />
      <ModalShell open={!!reportView} onClose={() => setReportView(null)} width={560}>
        {reportView && (
          <>
            <div className="mh">
              <h3>{reportView.author} · week of {fmtD(reportView.weekStart)}</h3>
              <p>{reportView.ref} · submitted {fmtD(reportView.createdAt.slice(0, 10))}{reportView.state === "acknowledged" && reportView.reviewedBy ? ` · acknowledged by ${reportView.reviewedBy}` : ""}</p>
            </div>
            <div className="mb">
              <div><label>What they did</label><div style={{ fontSize: 13.5, whiteSpace: "pre-wrap", padding: "4px 0" }}>{reportView.did}</div></div>
              <div><label>Blockers</label><div style={{ fontSize: 13.5, whiteSpace: "pre-wrap", padding: "4px 0", color: reportView.blockers ? "var(--ember)" : "var(--ink-soft)" }}>{reportView.blockers || "None reported"}</div></div>
              <div><label>Next week's plan</label><div style={{ fontSize: 13.5, whiteSpace: "pre-wrap", padding: "4px 0", color: reportView.nextWeek ? undefined : "var(--ink-soft)" }}>{reportView.nextWeek || "—"}</div></div>
            </div>
            <div className="mf">
              <button className="btn" onClick={() => setReportView(null)}>Close</button>
              {canViewReports && reportView.state === "submitted" && (
                <button className="btn primary" onClick={() => { acknowledgeWeeklyReport(reportView.ref); setReportView(null); }}>Acknowledge</button>
              )}
            </div>
          </>
        )}
      </ModalShell>
    </>
  );
}
