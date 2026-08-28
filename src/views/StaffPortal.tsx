import { useEffect, useRef, useState } from "react";
import { useApp } from "../store";
import { Note } from "../components/ui";
import { PlusI, CheckBoldI } from "../components/icons";
import { ModalShell } from "../components/modals";
import { kes, contractTypes, REPORT_TRACKS, type ReportTrack, type WeekTask } from "../data";
import { Crumb } from "../nav";
import { FeedbackModal, ExitSteps } from "./Hr";

const docCategories = [
  { value: "id", label: "ID / KRA / statutory" },
  { value: "contract", label: "Contract / letter" },
  { value: "certificate", label: "Certificate" },
  { value: "other", label: "Other" },
];
const fileFilters = [
  { v: "all", l: "All" },
  { v: "id", l: "Statutory / ID" },
  { v: "certificate", l: "Certifications" },
  { v: "contract", l: "Contract" },
  { v: "other", l: "Other" },
];

const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);
// Monday of a given week, formatted YYYY-MM-DD (matches Postgres date_trunc('week'))
function mondayOf(d = new Date()) {
  const x = new Date(d);
  x.setDate(x.getDate() - ((x.getDay() + 6) % 7));
  return `${x.getFullYear()}-${String(x.getMonth() + 1).padStart(2, "0")}-${String(x.getDate()).padStart(2, "0")}`;
}
const fmtD = (iso: string) => new Date(iso + "T00:00:00").toLocaleDateString("en-GB", { day: "numeric", month: "short" });

// ----- weekly-report auto-fill from tasks -----
// Tasks owned by, or shared with, the signed-in user.
const myTasks = (tasks: WeekTask[], email: string) =>
  email ? tasks.filter((t) => t.ownerEmail === email || (t.assignees ?? []).some((a) => a.email === email)) : [];
// One bullet per task (title only), with its subtasks nested beneath — for a
// report textarea, editable after fill.
const taskBullets = (tasks: WeekTask[]) =>
  tasks
    .map((t) => [`• ${t.t}`, ...(t.subtasks ?? []).map((s) => `    – ${s.text}`)].join("\n"))
    .join("\n");
const fmtDT = (ts: string) => new Date(ts).toLocaleString("en-GB", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });
const fmtPeriod = (p: string) => { const [y, m] = p.split("-"); return new Date(+y, +m - 1, 1).toLocaleDateString("en-GB", { month: "long", year: "numeric" }); };
const statePill: Record<string, { cls: string; txt: string }> = {
  pending: { cls: "today", txt: "Awaiting HR" },
  approved: { cls: "done", txt: "Approved" },
  rejected: { cls: "over", txt: "Rejected" },
  cancelled: { cls: "done", txt: "Cancelled" },
};
const fbPill: Record<string, { cls: string; l: string }> = {
  open: { cls: "week", l: "Delivered" }, in_review: { cls: "today", l: "In review" },
  acknowledged: { cls: "today", l: "Acknowledged" }, actioned: { cls: "done", l: "Actioned" }, closed: { cls: "done", l: "Closed" },
};

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

// Submit a certification from the portal — lands in HR's verification queue.
function MyCertModal() {
  const { hrModal, closeHrModal, submitMyCertification, toast } = useApp();
  const open = hrModal?.kind === "myCert";
  const [f, setF] = useState({ name: "", issuer: "", expiry: "" });
  const [file, setFile] = useState<File | null>(null);
  useEffect(() => { if (open) { setF({ name: "", issuer: "", expiry: "" }); setFile(null); } }, [open]);
  return (
    <ModalShell open={open} onClose={closeHrModal} width={480}>
      <div className="mh"><h3>Add a certification</h3><p>Upload the certificate — it goes to HR for verification, then attaches to your file</p></div>
      <div className="mb">
        <div><label>Certification / qualification</label><input className="field" placeholder="e.g. Prince2 Practitioner" value={f.name} onChange={(e) => setF((p) => ({ ...p, name: e.target.value }))} /></div>
        <div className="mrow c2">
          <div><label>Issuer</label><input className="field" placeholder="e.g. Axelos" value={f.issuer} onChange={(e) => setF((p) => ({ ...p, issuer: e.target.value }))} /></div>
          <div><label>Expiry (optional)</label><input className="field" type="date" value={f.expiry} onChange={(e) => setF((p) => ({ ...p, expiry: e.target.value }))} /></div>
        </div>
        <div>
          <label>Certificate file <span style={{ textTransform: "none", fontWeight: 400, letterSpacing: 0 }}>· PDF or image · optional</span></label>
          <input className="field" type="file" accept=".pdf,image/*" onChange={(e) => setFile(e.target.files?.[0] ?? null)} />
          {file && <div className="meta" style={{ textTransform: "none", letterSpacing: 0, marginTop: 5 }}>{file.name} — uploads to your file for HR to verify</div>}
        </div>
        <Note>HR checks the certificate and verifies. Only verified items count towards skills coverage.</Note>
      </div>
      <div className="mf">
        <button className="btn" onClick={closeHrModal}>Cancel</button>
        <button className="btn primary" onClick={() => { if (!f.name.trim()) { toast("Certification name is required", "e.g. Prince2 Practitioner"); return; } submitMyCertification({ ...f, name: f.name.trim() }, file); }}>Submit</button>
      </div>
    </ModalShell>
  );
}

// Raise or edit a petty-cash request from the portal — routes to Finance/HR.
function PettyCashModal() {
  const { pettyOpen, pettyEdit, closePetty, submitPettyRequest, updatePettyRequest, toast } = useApp();
  const [item, setItem] = useState("");
  const [amount, setAmount] = useState("");
  const [needBy, setNeedBy] = useState("");
  const [reason, setReason] = useState("");
  useEffect(() => {
    if (pettyOpen) {
      setItem(pettyEdit?.item ?? "");
      setAmount(pettyEdit ? String(pettyEdit.amount) : "");
      setNeedBy(pettyEdit?.needBy ?? "");
      setReason(pettyEdit?.reason ?? "");
    }
  }, [pettyOpen, pettyEdit]);

  function save() {
    const amt = Number(amount);
    if (!item.trim()) { toast("What is it for?", "Add the item you're requesting money for"); return; }
    if (!amt || amt <= 0) { toast("Enter an amount", "How much do you need? (KES)"); return; }
    const v = { item: item.trim(), amount: amt, needBy, reason };
    if (pettyEdit) updatePettyRequest(pettyEdit.id, v);
    else submitPettyRequest(v);
  }

  return (
    <ModalShell open={pettyOpen} onClose={closePetty} width={480}>
      <div className="mh">
        <h3>{pettyEdit ? `Edit request ${pettyEdit.id}` : "Request petty cash"}</h3>
        <p>{pettyEdit ? "You can change it until it's decided — it stays pending." : "Say what it's for, how much, when you need it and why. It routes to Finance / HR for approval."}</p>
      </div>
      <div className="mb">
        <div><label>Item</label><input className="field" placeholder="e.g. Fuel for the Makueni site visit" value={item} onChange={(e) => setItem(e.target.value)} /></div>
        <div style={{ display: "flex", gap: 12 }}>
          <div style={{ flex: 1 }}><label>Amount (KES)</label><input className="field" type="number" min="0" placeholder="e.g. 3500" value={amount} onChange={(e) => setAmount(e.target.value)} /></div>
          <div style={{ flex: 1 }}><label>Needed by <span style={{ textTransform: "none", fontWeight: 400, letterSpacing: 0 }}>· optional</span></label><input className="field" type="date" style={{ width: "100%" }} value={needBy} onChange={(e) => setNeedBy(e.target.value)} /></div>
        </div>
        <div><label>Reason <span style={{ textTransform: "none", fontWeight: 400, letterSpacing: 0 }}>· optional</span></label><textarea className="field" rows={3} placeholder="What's it for and why now?" value={reason} onChange={(e) => setReason(e.target.value)} /></div>
        <Note>Approved requests show as <strong>Approved</strong> here; if it's turned down you'll see <strong>Rejected</strong> with any note.</Note>
      </div>
      <div className="mf">
        <button className="btn" onClick={closePetty}>Cancel</button>
        <button className="btn primary" onClick={save}>{pettyEdit ? "Save changes" : "Submit request"}</button>
      </div>
    </ModalShell>
  );
}

// Submit or edit this week's report — routes to HR's Weekly Reports queue.
// The five prompts follow the user's admin-assigned report track; users with no
// track get the classic free-text form.
function WeeklyReportModal() {
  const { reportOpen, reportEdit, closeReport, submitWeeklyReport, uploadFile, uploadedFileUrl, toast, me, myWeek } = useApp();
  const track = (me?.reportTrack && me.reportTrack in REPORT_TRACKS ? me.reportTrack : null) as ReportTrack | null;
  const questions = track ? REPORT_TRACKS[track].questions : [];
  const [did, setDid] = useState("");
  const [blockers, setBlockers] = useState("");
  const [nextWeek, setNextWeek] = useState("");
  const [answers, setAnswers] = useState<string[]>([]);
  const [file, setFile] = useState<File | null>(null);
  const [existing, setExisting] = useState<string | null>(null); // attachment already on the report
  const [saving, setSaving] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  // A fresh report auto-fills from the user's tasks: what they finished this week,
  // and what's still open (a starting point for next week). Editing an existing
  // report keeps the saved text instead. Auto-fill for the structured form only
  // seeds the technology track, whose prompts are task-shaped; the pipeline and
  // leadership prompts aren't, so they're left blank.
  const mine = myTasks(myWeek, me?.email ?? "");
  // instant-based comparison so late-evening completions aren't dropped by the UTC/local offset
  const mondayStart = new Date(mondayOf() + "T00:00:00").getTime();
  const completedThisWeek = mine.filter((t) => t.state === "done" && t.updatedAt != null && new Date(t.updatedAt).getTime() >= mondayStart);
  const stillOpen = mine.filter((t) => t.state !== "done");
  const doneText = taskBullets(completedThisWeek);
  const openText = taskBullets(stillOpen);
  const autoFilled = !reportEdit && (completedThisWeek.length > 0 || stillOpen.length > 0);

  useEffect(() => {
    if (reportOpen) {
      const fresh = !reportEdit;
      setDid(reportEdit?.did ?? (fresh ? doneText : ""));
      setBlockers(reportEdit?.blockers ?? "");
      setNextWeek(reportEdit?.nextWeek ?? (fresh ? openText : ""));
      // prefill structured answers when editing; seed shipped/commitments for a fresh technology report
      setAnswers(questions.map((q, i) => {
        const saved = reportEdit?.answers?.find((x) => x.q === q)?.a;
        if (saved != null) return saved;
        if (fresh && track === "technology") { if (i === 0) return doneText; if (i === 3) return openText; }
        return "";
      }));
      setFile(null);
      setExisting(reportEdit?.attachmentPath ?? null);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [reportOpen, reportEdit]);

  async function save() {
    if (track) {
      if (!answers.some((a) => a.trim())) { toast("Fill in your report", "Add at least one line before submitting"); return; }
    } else if (!did.trim()) { toast("What did you do?", "Tell HR what you worked on this week"); return; }
    setSaving(true);
    // new pick uploads; otherwise keep the existing attachment (or null if it was cleared)
    let attachment: string | null = existing;
    if (file) attachment = await uploadFile("weekly-reports", file);
    if (track) {
      await submitWeeklyReport({ track, answers: questions.map((q, i) => ({ q, a: answers[i]?.trim() ?? "" })), attachment });
    } else {
      await submitWeeklyReport({ did: did.trim(), blockers, nextWeek, attachment });
    }
    setSaving(false);
  }

  return (
    <ModalShell open={reportOpen} onClose={closeReport} width={520}>
      <div className="mh">
        <h3>{reportEdit ? "Edit this week's report" : "Submit weekly report"}</h3>
        <p>{track ? `${REPORT_TRACKS[track].blurb} It goes to HR. Due Friday 11:50pm.` : "A quick note on your week — what you did, anything blocking you, and what's next. It goes to HR. Due Friday 11:50pm."}</p>
      </div>
      <div className="mb">
        {autoFilled && (
          <div style={{ fontSize: 12, color: "var(--ink-soft)", background: "#fff", border: "1px solid var(--hairline)", borderRadius: 9, padding: "10px 12px" }}>
            Pre-filled from your tasks — {completedThisWeek.length} done this week{stillOpen.length ? `, ${stillOpen.length} still open` : ""}. Edit anything before submitting.
          </div>
        )}
        {track ? (
          questions.map((q, i) => (
            <div key={i}><label>{q}</label><textarea className="field" rows={2} placeholder="One or two lines" value={answers[i] ?? ""} onChange={(e) => setAnswers((a) => a.map((x, j) => (j === i ? e.target.value : x)))} /></div>
          ))
        ) : (
          <>
            <div><label>What I did this week</label><textarea className="field" rows={4} placeholder="Key things you worked on and finished…" value={did} onChange={(e) => setDid(e.target.value)} /></div>
            <div><label>Blockers <span style={{ textTransform: "none", fontWeight: 400, letterSpacing: 0 }}>· optional</span></label><textarea className="field" rows={3} placeholder="Anything slowing you down or that you need help with" value={blockers} onChange={(e) => setBlockers(e.target.value)} /></div>
            <div><label>Next week's plan <span style={{ textTransform: "none", fontWeight: 400, letterSpacing: 0 }}>· optional</span></label><textarea className="field" rows={3} placeholder="What you'll focus on next week" value={nextWeek} onChange={(e) => setNextWeek(e.target.value)} /></div>
          </>
        )}
        <div>
          <label>Attachment <span style={{ textTransform: "none", fontWeight: 400, letterSpacing: 0 }}>· optional</span></label>
          <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
            <button className="btn" style={{ padding: "6px 12px", fontSize: 12 }} onClick={() => fileRef.current?.click()}>Choose file</button>
            {file ? (
              <span style={{ fontSize: 12.5 }}>{file.name} <a href="#" onClick={(e) => { e.preventDefault(); setFile(null); }} style={{ color: "var(--red)", textDecoration: "none" }}>· remove</a></span>
            ) : existing ? (
              <span style={{ fontSize: 12.5 }}><a href="#" onClick={(e) => { e.preventDefault(); window.open(uploadedFileUrl(existing), "_blank", "noopener"); }} style={{ color: "var(--flame)", textDecoration: "none" }}>current file</a> <a href="#" onClick={(e) => { e.preventDefault(); setExisting(null); }} style={{ color: "var(--red)", textDecoration: "none" }}>· remove</a></span>
            ) : (
              <span className="meta">any file or image</span>
            )}
          </div>
          <input ref={fileRef} type="file" style={{ display: "none" }} onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ""; if (f) setFile(f); }} />
        </div>
        <Note>You can resubmit anytime this week — it replaces the earlier version, attachment included. HR sees the latest.</Note>
      </div>
      <div className="mf">
        <button className="btn" onClick={closeReport}>Cancel</button>
        <button className="btn primary" onClick={save} disabled={saving}>{saving ? "Saving…" : reportEdit ? "Save report" : "Submit report"}</button>
      </div>
    </ModalShell>
  );
}

export default function StaffPortalView() {
  const { tabs, goTab, toast, openLeave, openLeaveEdit, deleteLeave, hrMe, addStaffDocument, deleteStaffDocument, staffDocUrl, hrData, meEmail, myWeek, openHrModal, selfAssessKpi, submitSelfAssessment, signMyExitStep, refreshHr,
    pettyRequests, openPetty, openPettyEdit, deletePettyRequest, attachPettyInvoice, removePettyInvoice, uploadedFileUrl,
    weeklyReports, openReport, openReportEdit } = useApp();
  const tab = tabs.staffportal;
  // HR may have opened a cycle, signed off a review or cleared an exit area
  // since last look — pull fresh state each time one of these tabs opens
  useEffect(() => { if (tab === "sp-perf" || tab === "sp-exit" || tab === "sp-files") refreshHr(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [tab]);
  const fileRef = useRef<HTMLInputElement>(null);
  const [docCat, setDocCat] = useState("other");
  const [fileFilter, setFileFilter] = useState("all");
  const [busy, setBusy] = useState(false);

  async function openDoc(path: string) {
    const url = await staffDocUrl(path);
    if (url) window.open(url, "_blank", "noopener");
  }
  async function onPick(e: React.ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0];
    e.target.value = "";
    if (!f) return;
    setBusy(true);
    await addStaffDocument(f, f.name, docCat);
    setBusy(false);
  }
  // attach an invoice/receipt to one of my approved petty-cash requests
  const invoiceRef = useRef<HTMLInputElement>(null);
  const [invoiceTarget, setInvoiceTarget] = useState<string | null>(null);
  const pickInvoice = (ref: string) => { setInvoiceTarget(ref); invoiceRef.current?.click(); };
  function onInvoicePick(e: React.ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0]; e.target.value = "";
    if (f && invoiceTarget) attachPettyInvoice(invoiceTarget, f);
    setInvoiceTarget(null);
  }

  const balances = hrMe?.leave ?? [];
  const apps = hrMe?.applications ?? [];
  const payslips = hrMe?.payslips ?? [];
  const docs = hrMe?.docs ?? [];
  const annual = balances.find((b) => b.kind === "annual");
  const annualLeft = annual ? annual.entitled - annual.used - annual.reserved : null;
  const latestSlip = payslips[0];
  const pendingApps = apps.filter((a) => a.state === "pending");
  // my own petty-cash requests (the queue lives in Finance → Petty Cash)
  const myPetty = pettyRequests.filter((r) => r.requesterEmail.toLowerCase() === (meEmail ?? "").toLowerCase());
  const pendingPetty = myPetty.filter((r) => r.state === "pending");
  // my weekly reports (HR sees the queue in HR → Weekly Reports)
  const thisMonday = mondayOf();
  const myReports = weeklyReports.filter((r) => r.authorEmail.toLowerCase() === (meEmail ?? "").toLowerCase());
  const thisWeekReport = myReports.find((r) => r.weekStart === thisMonday) ?? null;

  // me, from the module read model (matched by login email)
  const me = (hrData?.staff ?? []).find((s) => s.email.toLowerCase() === (meEmail ?? "").toLowerCase());
  const myAppraisals = (hrData?.appraisals ?? []).filter((a) => a.appUserId === me?.appUserId);
  const myAppraisal = myAppraisals[myAppraisals.length - 1];
  const prevAppraisals = myAppraisals.slice(0, -1).reverse();
  const selfOpen = !!myAppraisal && (myAppraisal.stage === "not_started" || myAppraisal.stage === "self");
  const selfRated = myAppraisal ? myAppraisal.kpis.filter((k) => k.selfMet).length : 0;
  function submitSelf() {
    if (!myAppraisal) return;
    if (!selfRated) { toast("Rate your KPIs first", "Tick at least one KPI you met before sending the review to your manager"); return; }
    submitSelfAssessment(myAppraisal.id);
  }
  const myCerts = (hrData?.certifications ?? []).filter((c) => c.appUserId === me?.appUserId);
  const mySentFb = (hrData?.feedback ?? []).filter((f) => !!me && f.author === me.name);
  const myExit = (hrData?.exits ?? []).filter((x) => x.appUserId === me?.appUserId).sort((a, b) => (a.state === "in_progress" ? -1 : 1) - (b.state === "in_progress" ? -1 : 1))[0];
  const exitDone = myExit ? myExit.clearance.filter((c) => c.done).length : 0;

  const stageMeta: Record<string, string> = {
    not_started: "self-assessment open", self: "self-assessment open",
    manager: "with your manager", signed_off: "signed off",
  };

  const filteredDocs = docs.filter((d) => fileFilter === "all" || (d.category ?? "other") === fileFilter);
  const catLabel = (c?: string) => docCategories.find((x) => x.value === (c ?? "other"))?.label ?? cap(c ?? "other");
  const routeNote: Record<string, string> = {
    id: "unblocks payroll & statutory filings",
    contract: "joins your employment record",
    certificate: "goes to HR for verification",
    other: "stored on your file",
  };

  return (
    <>
      <div className="vhead">
        <div>
          <h1>Staff Portal</h1>
          <p>Your own view of yourself — pay, leave, performance, certifications and documents. Nobody else sees this page.</p>
        </div>
        <div className="actions">
          {tab === "sp-reports" && !thisWeekReport && <button className="btn primary" onClick={openReport}><PlusI />Submit weekly report</button>}
          {tab === "sp-reports" && thisWeekReport && <button className="btn" onClick={() => openReportEdit(thisWeekReport)}>Edit this week's report</button>}
          {tab === "sp-leave" && <button className="btn primary" onClick={openLeave}><PlusI />Apply for leave</button>}
          {tab === "sp-petty" && <button className="btn primary" onClick={openPetty}><PlusI />Request petty cash</button>}
          {tab === "sp-perf" && selfOpen && <button className="btn primary" style={selfRated ? undefined : { opacity: 0.55 }} onClick={submitSelf}>Submit self-assessment</button>}
          {tab === "sp-files" && <button className="btn primary" onClick={() => openHrModal({ kind: "myCert" })}><PlusI />Add certification</button>}
          {tab === "sp-fb" && <button className="btn primary" onClick={() => openHrModal({ kind: "feedback" })}><PlusI />New feedback</button>}
        </div>
      </div>
      <Crumb view="staffportal" />

      {tab === "sp-me" && (
        <div className="hr-panel active">
          <div className="grid g-2">
            <div className="panel">
              <div className="panel-h"><h3>This month</h3><span className="meta">{me ? `${me.name} · ${me.roleTitle || "—"}` : "…"}</span></div>
              <div className="recon"><span>Next payday</span><span className="mono">28 {new Date().toLocaleDateString("en-GB", { month: "long" })}</span></div>
              <div className="recon"><span>Net pay (latest)</span><span className="mono">{latestSlip ? kes(latestSlip.net) : "—"}</span></div>
              <div className="recon"><span>Annual leave balance</span><span className="mono">{annual ? `${annualLeft} / ${annual.entitled} days` : "—"}</span></div>
              <div className="recon"><span>Tasks assigned to me</span><span className="pill today">{myWeek.filter((t) => t.state !== "done" && (t.ownerEmail === (meEmail ?? "") || (t.assignees ?? []).some((a) => a.email === (meEmail ?? "")))).length} open</span></div>
              <div className="recon"><span>Employment type</span><span>{me ? contractTypes.find((c) => c.value === me.contractType)?.label ?? me.contractType : "—"}</span></div>
            </div>
            <div className="panel">
              <div className="panel-h"><h3>Waiting on me</h3><span className="meta">my actions</span></div>
              {selfOpen && (
                <div className="task" onClick={() => goTab("staffportal", "sp-perf")}><span className="id" style={{ color: "var(--ember)" }}>APR</span><span className="txt">Self-assessment open — {myAppraisal.cycle}<small>rate yourself against each KPI</small></span><span className="pill today">Complete</span></div>
              )}
              {pendingApps.length > 0 && (
                <div className="task" onClick={() => goTab("staffportal", "sp-leave")}><span className="id" style={{ color: "var(--ember)" }}>LV</span><span className="txt">{pendingApps.length} leave request{pendingApps.length > 1 ? "s" : ""} with HR<small>you can edit or withdraw while pending</small></span><span className="pill week">Pending</span></div>
              )}
              {pendingPetty.length > 0 && (
                <div className="task" onClick={() => goTab("staffportal", "sp-petty")}><span className="id" style={{ color: "var(--ember)" }}>PCR</span><span className="txt">{pendingPetty.length} petty-cash request{pendingPetty.length > 1 ? "s" : ""} awaiting approval<small>you can edit or withdraw while pending</small></span><span className="pill week">Pending</span></div>
              )}
              {myExit && myExit.state === "in_progress" && (
                <div className="task" onClick={() => goTab("staffportal", "sp-exit")}><span className="id" style={{ color: "var(--ember)" }}>EXT</span><span className="txt">Exit clearance in progress<small>{exitDone} of {myExit.clearance.length} areas cleared</small></span><span className="pill today">Continue</span></div>
              )}
              <div className="task" onClick={() => goTab("staffportal", "sp-files")}><span className="id" style={{ color: "var(--flame)" }}>CERT</span><span className="txt">Upload any new certifications or documents<small>the file type decides where it goes</small></span><span className="pill week">Optional</span></div>
              <div className="task" onClick={() => toast("Payslip", latestSlip ? `Latest: ${fmtPeriod(latestSlip.period)} — net ${kes(latestSlip.net)}` : "Your payslip appears after the first posted run")}><span className="id" style={{ color: "var(--flame)" }}>PAY</span><span className="txt">{latestSlip ? `${fmtPeriod(latestSlip.period)} payslip available` : "First payslip after the next run"}</span><span className="pill week">{latestSlip ? "Ready" : "Upcoming"}</span></div>
            </div>
          </div>
          <div className="panel" style={{ marginTop: 18 }}>
            <div className="panel-h"><h3>My payslips</h3><span className="meta">view &amp; breakdown</span></div>
            {payslips.length ? (
              <table className="tbl">
                <thead><tr><th>Period</th><th>Gross</th><th>Deductions</th><th>Net</th><th></th></tr></thead>
                <tbody>
                  {payslips.map((p) => (
                    <tr key={p.period}>
                      <td>{fmtPeriod(p.period)}</td>
                      <td className="mono">{kes(p.gross)}</td>
                      <td className="mono">{kes(p.gross - p.net)}</td>
                      <td className="mono">{kes(p.net)}</td>
                      <td><button className="btn" style={{ padding: "4px 10px", fontSize: 11 }} onClick={() => toast(`Payslip · ${fmtPeriod(p.period)}`, `Gross ${kes(p.gross)} · PAYE ${kes(p.paye)} · NSSF ${kes(p.nssf)} · SHIF ${kes(p.shif)} · Housing ${kes(p.housing)} · Net ${kes(p.net)}`)}>Open</button></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            ) : (
              <Note noBorder>No payslips yet — they appear here when payroll posts a run.</Note>
            )}
          </div>
        </div>
      )}

      {tab === "sp-reports" && (
        <div className="hr-panel active">
          <div className="panel">
            <div className="panel-h"><h3>This week</h3><span className="meta">Week of {fmtD(thisMonday)} · due Friday 11:50pm</span></div>
            {thisWeekReport ? (
              <>
                <div className="recon"><span>Status</span><span className={`pill ${thisWeekReport.state === "acknowledged" ? "done" : "today"}`} style={{ textTransform: "none" }}>{thisWeekReport.state === "acknowledged" ? "Acknowledged by HR" : "Submitted"}</span></div>
                {thisWeekReport.answers && thisWeekReport.answers.length ? (
                  thisWeekReport.answers.map((x, i) => (
                    <div key={i} style={{ padding: "12px 18px", borderBottom: "1px solid var(--hairline)" }}><div className="meta" style={{ marginBottom: 4 }}>{x.q}</div><div style={{ fontSize: 13.5, whiteSpace: "pre-wrap" }}>{x.a}</div></div>
                  ))
                ) : (
                  <>
                    <div style={{ padding: "12px 18px", borderBottom: "1px solid var(--hairline)" }}><div className="meta" style={{ marginBottom: 4 }}>What I did</div><div style={{ fontSize: 13.5, whiteSpace: "pre-wrap" }}>{thisWeekReport.did}</div></div>
                    {thisWeekReport.blockers && <div style={{ padding: "12px 18px", borderBottom: "1px solid var(--hairline)" }}><div className="meta" style={{ marginBottom: 4 }}>Blockers</div><div style={{ fontSize: 13.5, whiteSpace: "pre-wrap" }}>{thisWeekReport.blockers}</div></div>}
                    {thisWeekReport.nextWeek && <div style={{ padding: "12px 18px", borderBottom: "1px solid var(--hairline)" }}><div className="meta" style={{ marginBottom: 4 }}>Next week's plan</div><div style={{ fontSize: 13.5, whiteSpace: "pre-wrap" }}>{thisWeekReport.nextWeek}</div></div>}
                  </>
                )}
                {thisWeekReport.attachmentPath && <div style={{ padding: "12px 18px", borderBottom: "1px solid var(--hairline)" }}><div className="meta" style={{ marginBottom: 4 }}>Attachment</div><a href="#" onClick={(e) => { e.preventDefault(); window.open(uploadedFileUrl(thisWeekReport.attachmentPath!), "_blank", "noopener"); }} style={{ color: "var(--flame)", textDecoration: "none", fontSize: 13.5 }}>View attached file</a></div>}
                <Note>Submitted — thanks. You can <a href="#" onClick={(e) => { e.preventDefault(); openReportEdit(thisWeekReport); }} style={{ color: "var(--flame)", textDecoration: "none" }}>edit it</a> anytime this week; the latest version is what HR sees.</Note>
              </>
            ) : (
              <Note noBorder>You haven't submitted this week's report yet. Use <strong>Submit weekly report</strong> — a quick note on what you did, any blockers, and next week's plan. It's due <strong>Friday 11:50pm</strong> and goes to HR.</Note>
            )}
          </div>
          <div className="panel" style={{ marginTop: 18 }}>
            <div className="panel-h"><h3>My past reports</h3><span className="meta">{myReports.length} submitted</span></div>
            {myReports.length ? (
              <table className="tbl">
                <thead><tr><th>Ref</th><th>Week of</th><th>What I did</th><th>Attachment</th><th>Status</th></tr></thead>
                <tbody>
                  {myReports.map((r) => (
                    <tr key={r.id}>
                      <td className="mono">{r.ref}</td>
                      <td className="mono">{fmtD(r.weekStart)}</td>
                      <td style={{ maxWidth: 380, fontSize: 12.5, color: "var(--ink-soft)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{r.did}</td>
                      <td>{r.attachmentPath ? <a href="#" onClick={(e) => { e.preventDefault(); window.open(uploadedFileUrl(r.attachmentPath!), "_blank", "noopener"); }} style={{ color: "var(--flame)", textDecoration: "none", fontSize: 12.5 }}>View</a> : <span style={{ color: "var(--ink-soft)" }}>—</span>}</td>
                      <td><span className={`pill ${r.state === "acknowledged" ? "done" : "today"}`} style={{ textTransform: "none" }}>{r.state === "acknowledged" ? "Acknowledged" : "Submitted"}</span></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            ) : (
              <Note noBorder>No reports yet — your submissions will list here.</Note>
            )}
          </div>
        </div>
      )}

      {tab === "sp-leave" && (
        <div className="hr-panel active">
          <div className="grid g-2">
            <div className="panel">
              <div className="panel-h"><h3>My leave applications</h3><span className="meta"><a href="#" onClick={(e) => { e.preventDefault(); openLeave(); }} style={{ color: "var(--flame)", textDecoration: "none" }}>+ Apply for leave</a></span></div>
              {apps.length ? (
                <table className="tbl">
                  <thead><tr><th>Ref</th><th>Type</th><th>Dates</th><th>Days</th><th>Status</th><th></th></tr></thead>
                  <tbody>
                    {apps.map((a) => (
                      <tr key={a.id}>
                        <td className="mono">{a.id}</td>
                        <td>{cap(a.kind)}</td>
                        <td>{fmtD(a.from)} – {fmtD(a.to)}</td>
                        <td className="mono">{a.days}</td>
                        <td><span className={`pill ${statePill[a.state]?.cls || "today"}`} style={{ textTransform: "none" }}>{statePill[a.state]?.txt || a.state}</span></td>
                        <td>
                          {a.state === "pending" ? (
                            <span style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
                              <button className="btn" style={{ padding: "4px 10px", fontSize: 11.5 }} onClick={() => openLeaveEdit(a)}>Edit</button>
                              <button className="btn" style={{ padding: "4px 10px", fontSize: 11.5, color: "var(--red)" }} onClick={() => deleteLeave(a.id)}>Delete</button>
                            </span>
                          ) : (
                            <span className="meta" style={{ display: "block", textAlign: "right" }}>locked</span>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              ) : (
                <Note noBorder>No leave requests yet — use “Apply for leave” and it routes to HR.</Note>
              )}
              <Note>Applications route to your approver. Balances update on approval, not on application.</Note>
            </div>
            <div className="panel">
              <div className="panel-h"><h3>My balances</h3><span className="meta">days remaining</span></div>
              {balances.length
                ? balances.map((b) => (
                    <div className="recon" key={b.kind}><span>{cap(b.kind)}</span>
                      <span className="mono">{b.entitled - b.used - b.reserved} of {b.entitled}{b.reserved > 0 ? ` · ${b.reserved} pending` : ""}</span>
                    </div>
                  ))
                : <div className="recon"><span>Balances</span><span className="mono">loading…</span></div>}
              <Note>Weekends and public holidays are excluded from the day count.</Note>
            </div>
          </div>
        </div>
      )}

      {tab === "sp-petty" && (
        <div className="hr-panel active">
          <div className="panel">
            <div className="panel-h"><h3>My petty-cash requests</h3><span className="meta"><a href="#" onClick={(e) => { e.preventDefault(); openPetty(); }} style={{ color: "var(--flame)", textDecoration: "none" }}>+ Request petty cash</a></span></div>
            {myPetty.length ? (
              <table className="tbl">
                <thead><tr><th>Ref</th><th>Item</th><th>Amount</th><th>Needed by</th><th>Reason</th><th>Status</th><th></th></tr></thead>
                <tbody>
                  {myPetty.map((r) => (
                    <tr key={r.id}>
                      <td className="mono">{r.id}</td>
                      <td>{r.item}</td>
                      <td className="mono">{kes(r.amount)}</td>
                      <td className="mono">{r.needBy ? fmtD(r.needBy) : "—"}</td>
                      <td style={{ fontSize: 12.5, color: "var(--ink-soft)" }}>{r.reason || "—"}</td>
                      <td>
                        <span className={`pill ${statePill[r.state]?.cls || "today"}`} style={{ textTransform: "none" }} title={r.state !== "pending" && r.decidedBy ? `${r.decidedBy}${r.note ? " · " + r.note : ""}` : ""}>
                          {r.state === "pending" ? "Awaiting approval" : statePill[r.state]?.txt || r.state}
                        </span>
                      </td>
                      <td>
                        {r.state === "pending" ? (
                          <span style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
                            <button className="btn" style={{ padding: "4px 10px", fontSize: 11.5 }} onClick={() => openPettyEdit(r)}>Edit</button>
                            <button className="btn" style={{ padding: "4px 10px", fontSize: 11.5, color: "var(--red)" }} onClick={() => deletePettyRequest(r.id)}>Withdraw</button>
                          </span>
                        ) : r.state === "approved" ? (
                          <span style={{ display: "flex", gap: 8, justifyContent: "flex-end", flexWrap: "wrap" }}>
                            {r.invoicePath ? (
                              <>
                                <button className="btn" style={{ padding: "4px 10px", fontSize: 11.5 }} onClick={() => window.open(uploadedFileUrl(r.invoicePath!), "_blank", "noopener")}>View invoice</button>
                                <button className="btn" style={{ padding: "4px 10px", fontSize: 11.5, color: "var(--red)" }} onClick={() => removePettyInvoice(r.id, r.invoicePath!)}>Delete invoice</button>
                              </>
                            ) : (
                              <button className="btn primary" style={{ padding: "4px 10px", fontSize: 11.5 }} onClick={() => pickInvoice(r.id)}>Attach invoice</button>
                            )}
                          </span>
                        ) : (
                          <span className="meta" style={{ display: "block", textAlign: "right" }}>{r.state === "rejected" && r.note ? r.note : "locked"}</span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            ) : (
              <Note noBorder>No petty-cash requests yet — use “Request petty cash”. Give the item, amount, the date you need it and a reason; it routes to Finance / HR for approval.</Note>
            )}
            <Note>You can edit or withdraw a request while it is still <strong>Awaiting approval</strong>. Once <strong>Approved</strong>, attach the invoice/receipt (any file or image) — a Sub Admin can also attach it in Finance{pendingPetty.length ? ` · ${pendingPetty.length} pending now` : ""}.</Note>
          </div>
          <input ref={invoiceRef} type="file" style={{ display: "none" }} onChange={onInvoicePick} />
        </div>
      )}

      {tab === "sp-perf" && (
        <div className="hr-panel active">
          {myAppraisal ? (
            <div className="panel" style={{ marginBottom: 18 }}>
              <div className="panel-h"><h3>{myAppraisal.cycle} appraisal</h3><span className="meta">reviewer: {myAppraisal.reviewer} · {stageMeta[myAppraisal.stage] ?? myAppraisal.stage}</span></div>
              <div className="pad">
                <div className="steps">
                  <div className="step done"><span className="sdot">✓</span>KPIs agreed</div><div className="step-arrow" />
                  <div className={`step ${selfOpen ? "now" : "done"}`}><span className="sdot">2</span>Your self-assessment</div><div className="step-arrow" />
                  <div className={`step ${myAppraisal.stage === "manager" ? "now" : myAppraisal.stage === "signed_off" ? "done" : ""}`}><span className="sdot">3</span>Manager review</div><div className="step-arrow" />
                  <div className={`step ${myAppraisal.stage === "signed_off" ? "done" : ""}`}><span className="sdot">4</span>Sign-off</div>
                </div>
              </div>
              <div style={{ padding: "0 18px 6px", fontSize: 12, color: "var(--ink-soft)" }}>
                Your KPIs were agreed at the start of the cycle and can’t be changed now. {selfOpen ? "Mark each one you met; your manager rates the same KPIs independently." : myAppraisal.stage === "manager" ? "Your self-assessment is with your manager." : "The review is signed off — your manager's rating now shows beside yours, and the record is locked to your staff file."}
              </div>
              <div style={{ padding: "4px 18px 8px" }}>
                {myAppraisal.kpis.map((k, i) => (
                  <div key={k.k} onClick={() => selfOpen && selfAssessKpi(myAppraisal.id, i)} style={{ cursor: selfOpen ? "pointer" : "default" }}>
                    <Check done={k.selfMet}>
                      <span style={{ flex: 1, minWidth: 0 }}>{k.k}</span>
                      {myAppraisal.stage === "signed_off" && (
                        <span style={{
                          fontFamily: "var(--mono)", fontSize: 9.5, fontWeight: 600, padding: "2px 6px", borderRadius: 5, flexShrink: 0, whiteSpace: "nowrap",
                          background: k.met ? "var(--green-soft)" : "var(--ember-soft)", color: k.met ? "var(--green)" : "var(--ember)",
                        }}>
                          Manager {k.met ? "✓" : "✗"}
                        </span>
                      )}
                    </Check>
                  </div>
                ))}
              </div>
              {selfOpen && (
                <div style={{ padding: "0 18px 16px" }}>
                  <button className="btn primary" style={selfRated ? undefined : { opacity: 0.55 }} onClick={submitSelf}>Submit self-assessment</button>
                  {!selfRated && <span className="meta" style={{ marginLeft: 10 }}>tick at least one KPI to send</span>}
                </div>
              )}
            </div>
          ) : (
            <div className="panel" style={{ marginBottom: 18 }}>
              <div className="panel-h"><h3>My performance</h3><span className="meta">no cycle open</span></div>
              <div className="pad" style={{ fontSize: 13, color: "var(--ink-soft)" }}>No appraisal yet — your review appears here when HR opens the next cycle.</div>
            </div>
          )}
          <div className="grid g-2">
            <div className="panel">
              <div className="panel-h"><h3>Previous cycles</h3><span className="meta">signed off</span></div>
              {prevAppraisals.length === 0 && <div className="pad" style={{ fontSize: 13, color: "var(--ink-soft)" }}>Past reviews will build up here cycle by cycle.</div>}
              {prevAppraisals.map((a) => (
                <div className="recon" key={a.id}><span>{a.cycle}</span><span className={`pill ${a.stage === "signed_off" ? "done" : "today"}`} style={{ textTransform: "none" }}>{a.kpis.filter((k) => k.met).length} / {a.kpis.length} met{a.stage === "signed_off" ? " · signed off" : ""}</span></div>
              ))}
            </div>
            <div className="panel">
              <div className="panel-h"><h3>What your manager sees</h3><span className="meta">transparency</span></div>
              <div style={{ padding: "14px 18px", fontSize: 12.5, color: "var(--ink-soft)", lineHeight: 1.55 }}>Your manager sees the same KPIs and your self-rating. Their rating stays hidden until they share the review, so the two assessments are independent. Once signed off, the record locks to your staff file and neither side can edit it.</div>
            </div>
          </div>
        </div>
      )}

      {tab === "sp-files" && (
        <div className="hr-panel active">
          <div className="panel" style={{ marginBottom: 18 }}>
            <div className="panel-h"><h3>Certificates</h3><span className="meta">{myCerts.length} on file · you upload, HR verifies</span></div>
            {myCerts.length === 0 ? (
              <div className="pad" style={{ fontSize: 13, color: "var(--ink-soft)" }}>No certificates yet — click <strong>Add certification</strong> above to upload one. HR verifies it onto your file, and any certificate HR adds for you shows up here too.</div>
            ) : (
              <table className="tbl">
                <thead><tr><th>Certification</th><th>Issuer</th><th>Expiry</th><th>Certificate</th><th>Status</th></tr></thead>
                <tbody>
                  {myCerts.map((c) => (
                    <tr key={c.id}>
                      <td><strong>{c.name}</strong></td>
                      <td style={{ fontSize: 12.5 }}>{c.issuer || "—"}</td>
                      <td className="mono" style={{ fontSize: 12 }}>{c.expiry ? `${fmtD(c.expiry)} ${c.expiry.slice(0, 4)}` : "—"}</td>
                      <td>{c.docPath
                        ? <button className="btn" style={{ padding: "4px 10px", fontSize: 11.5 }} onClick={() => openDoc(c.docPath!)}>View</button>
                        : <span className="meta">no file</span>}</td>
                      <td>{c.state === "verified" ? <span className="rcv ok">verified</span> : c.state === "pending" ? <span className="pill today" style={{ textTransform: "none" }}>Awaiting HR</span> : <span className="rcv no">rejected</span>}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
            <Note>Upload the actual certificate — HR opens the file to verify it. Verified certifications join skills coverage and show in HR's register. Certificates HR uploads for you appear here automatically.</Note>
          </div>
          <div className="panel" style={{ marginBottom: 18 }}>
            <div className="panel-h"><h3>Files</h3><span className="meta">{docs.length} on file · visible to you and HR only</span></div>
            <div style={{ padding: "10px 18px 4px", display: "flex", gap: 7, flexWrap: "wrap" }}>
              {fileFilters.map((f) => (
                <button key={f.v} className={`btn ${fileFilter === f.v ? "primary" : ""}`} style={{ padding: "4px 11px", fontSize: 11.5 }} onClick={() => setFileFilter(f.v)}>{f.l}</button>
              ))}
            </div>
            <table className="tbl">
              <thead><tr><th>File</th><th>Type</th><th>Where it goes</th><th></th></tr></thead>
              <tbody>
                {filteredDocs.length === 0 && <tr><td colSpan={4} style={{ color: "var(--ink-soft)", fontSize: 13 }}>Nothing here yet — upload below.</td></tr>}
                {filteredDocs.map((d) => (
                  <tr key={d.name + d.version}>
                    <td>{d.name}<span className="meta" style={{ marginLeft: 8 }}>v{d.version}{d.leaveRef ? ` · ${d.leaveRef}` : ""}</span></td>
                    <td style={{ fontSize: 12 }}>{catLabel(d.category)}</td>
                    <td style={{ fontSize: 12, color: "var(--ink-soft)" }}>{routeNote[d.category ?? "other"] ?? routeNote.other}</td>
                    <td>
                      {d.path ? (
                        <span style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
                          <button className="btn" style={{ padding: "4px 10px", fontSize: 11.5 }} onClick={() => openDoc(d.path!)}>View</button>
                          <button className="btn" style={{ padding: "4px 10px", fontSize: 11.5, color: "var(--red)" }} onClick={() => deleteStaffDocument(d.path!, d.name)}>Delete</button>
                        </span>
                      ) : (
                        <span className="rcv ok" style={{ float: "right" }}>on file</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            <input ref={fileRef} type="file" accept=".pdf,.png,.jpg,.jpeg,.doc,.docx" style={{ display: "none" }} onChange={onPick} />
            <div className="recon"><span>Upload a file</span>
              <span style={{ display: "flex", gap: 8 }}>
                <select className="field" style={{ padding: "4px 8px", fontSize: 11.5, width: "auto" }} value={docCat} onChange={(e) => setDocCat(e.target.value)}>
                  {docCategories.map((c) => <option key={c.value} value={c.value}>{c.label}</option>)}
                </select>
                <button className="btn" style={{ padding: "4px 10px", fontSize: 11.5 }} disabled={busy} onClick={() => fileRef.current?.click()}>{busy ? "Uploading…" : "Upload"}</button>
              </span>
            </div>
            <Note>What you pick as the <strong>file type</strong> decides what happens next — a certificate goes for verification, a statutory document unblocks payroll, a sick note attaches to a leave request. Nothing here is visible to anyone but you and HR.</Note>
          </div>
        </div>
      )}

      {tab === "sp-fb" && (
        <div className="hr-panel active">
          <div className="grid g-2">
            <div className="panel">
              <div className="panel-h"><h3>Give feedback</h3><span className="meta"><a href="#" onClick={(e) => { e.preventDefault(); openHrModal({ kind: "feedback" }); }} style={{ color: "var(--flame)", textDecoration: "none" }}>+ New feedback</a></span></div>
              <div style={{ padding: "14px 18px 6px", fontSize: 12.5, color: "var(--ink-soft)", lineHeight: 1.55 }}>Choose who it goes to — a colleague, your manager, HR, or leadership. It goes to that recipient only; nobody else sees it unless you send it to them.</div>
              <div className="pad" style={{ paddingTop: 6 }}>
                <div className="recon" style={{ padding: "9px 0" }}><span><strong>A colleague</strong><br /><small style={{ color: "var(--ink-soft)" }}>peer feedback or thanks — always named</small></span><button className="btn" style={{ padding: "4px 10px", fontSize: 11 }} onClick={() => toast("Peer feedback", "Personal inboxes are coming next — for now send via HR / People or Leadership")}>Send</button></div>
                <div className="recon" style={{ padding: "9px 0" }}><span><strong>My manager</strong><br /><small style={{ color: "var(--ink-soft)" }}>upward feedback — can be anonymous</small></span><button className="btn" style={{ padding: "4px 10px", fontSize: 11 }} onClick={() => toast("Upward feedback", "Personal inboxes are coming next — for now send via HR / People or Leadership")}>Send</button></div>
                <div className="recon" style={{ padding: "9px 0" }}><span><strong>HR / People</strong><br /><small style={{ color: "var(--ink-soft)" }}>pay, policy, grievance — can be anonymous</small></span><button className="btn" style={{ padding: "4px 10px", fontSize: 11 }} onClick={() => openHrModal({ kind: "feedback" })}>Send</button></div>
                <div className="recon" style={{ padding: "9px 0" }}><span><strong>Leadership / MD</strong><br /><small style={{ color: "var(--ink-soft)" }}>company-wide suggestions — can be anonymous</small></span><button className="btn" style={{ padding: "4px 10px", fontSize: 11 }} onClick={() => openHrModal({ kind: "feedback" })}>Send</button></div>
              </div>
            </div>
            <div className="panel">
              <div className="panel-h"><h3>Feedback I&rsquo;ve sent</h3><span className="meta">and its status</span></div>
              {mySentFb.length === 0 && <div className="pad" style={{ fontSize: 13, color: "var(--ink-soft)" }}>Nothing sent yet — named feedback you send shows its status here.</div>}
              {mySentFb.map((f) => (
                <div className="task" key={f.ref} style={{ cursor: "default" }}>
                  <span className="id" style={{ color: "var(--flame)" }}>{f.ref}</span>
                  <span className="txt">{f.body}<small>to {f.audience === "hr" ? "HR / People" : "Leadership"} · named</small></span>
                  <span className={`pill ${fbPill[f.state]?.cls ?? "week"}`} style={{ textTransform: "none" }}>{fbPill[f.state]?.l ?? f.state}</span>
                </div>
              ))}
              <Note>Anonymous items carry no author reference in the system — the recipient sees the content, never your name, so they can't be listed here either.</Note>
            </div>
          </div>
        </div>
      )}

      {tab === "sp-exit" && (
        <div className="hr-panel active">
          {!myExit ? (
            <div className="panel">
              <div className="panel-h"><h3>Leaving Ignis</h3><span className="meta">your side of the exit</span></div>
              <div className="pad" style={{ fontSize: 13, color: "var(--ink-soft)" }}>No exit in progress — long may that continue. If you resign or your contract ends, your clearance checklist and exit documents appear here.</div>
            </div>
          ) : (
            <>
              <div className="panel" style={{ marginBottom: 18 }}>
                <div className="panel-h"><h3>Leaving Ignis — {myExit.ref}</h3><span className="meta">{myExit.reason || "—"}{myExit.finalDay ? ` · final day ${fmtD(myExit.finalDay)}` : ""}</span></div>
                <div className="pad">
                  <ExitSteps exit={myExit} />
                </div>
                <div style={{ padding: "0 18px 14px", fontSize: 12.5, color: "var(--ink-soft)", lineHeight: 1.55 }}>
                  {myExit.state === "cleared"
                    ? <>Fully cleared. <strong style={{ color: "var(--ink)" }}>Your access closes {myExit.accessUntil ? fmtDT(myExit.accessUntil) : "24 hours after clearance"}</strong> — download your documents below before then. After that your account is suspended and this login stops working.</>
                    : <>This replaces the paper exit form. Tick your own parts — supervisor handover and returned assets. IT, Finance and HR sign theirs in Offboarding &amp; Exit. When every area is signed off, your certificate of service, final payslip and P9 appear below, and your access closes 24 hours later.</>}
                </div>
              </div>
              <div className="grid g-2">
                <div className="panel">
                  <div className="panel-h"><h3>Clearance progress</h3><span className="meta">{exitDone} of {myExit.clearance.length} signed off</span></div>
                  <div className="pad" style={{ paddingTop: 6 }}>
                    {myExit.clearance.map((c, i) => {
                      const mine = c.owner === "staff" && myExit.state === "in_progress";
                      return (
                        <div key={c.area} onClick={() => mine && signMyExitStep(myExit.ref, i)} style={{ cursor: mine ? "pointer" : "default" }}>
                          <Check done={c.done}>
                            <span style={{ flex: 1, minWidth: 0 }}>{c.area}</span>
                            <span style={{
                              fontFamily: "var(--mono)", fontSize: 9.5, fontWeight: 600, padding: "2px 6px", borderRadius: 5, flexShrink: 0, whiteSpace: "nowrap",
                              ...(c.owner === "staff"
                                ? { background: "var(--flame-soft)", color: "var(--flame)" }
                                : { background: "#F1EDE5", color: "var(--ink-faint)" }),
                            }}>
                              {c.owner === "staff" ? "you tick this" : "signed by owner"}
                            </span>
                          </Check>
                        </div>
                      );
                    })}
                  </div>
                  <Note>Your two areas — supervisor handover and assets returned — are yours to tick. The rest are signed off in HR's Offboarding &amp; Exit by the function that owns each one.</Note>
                </div>
                <div className="panel">
                  <div className="panel-h"><h3>My exit documents</h3><span className="meta">released on final clearance</span></div>
                  <div className="recon"><span>Certificate of service</span>{myExit.state === "cleared" ? <span className="rcv ok">released</span> : <span className="rcv no">pending clearance</span>}</div>
                  <div className="recon"><span>Final payslip</span>{myExit.state === "cleared" ? <span className="rcv ok">released</span> : <span className="rcv no">pending clearance</span>}</div>
                  <div className="recon"><span>P9 tax form</span>{myExit.state === "cleared" ? <span className="rcv ok">released</span> : <span className="rcv no">pending clearance</span>}</div>
                  <Note>Kenyan law entitles you to a certificate of service on leaving. It is issued automatically here once HR signs off final clearance — you do not have to ask for it.</Note>
                </div>
              </div>
            </>
          )}
        </div>
      )}

      <MyCertModal />
      <PettyCashModal />
      <WeeklyReportModal />
      <FeedbackModal />
    </>
  );
}
