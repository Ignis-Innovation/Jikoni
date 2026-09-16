import { useEffect, useRef, useState } from "react";
import { useApp, type ClaimLineInput } from "../store";
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
const claimPill: Record<string, { cls: string; txt: string }> = {
  pending: { cls: "today", txt: "Awaiting approval" },
  approved: { cls: "week", txt: "Approved" },
  rejected: { cls: "over", txt: "Rejected" },
  paid: { cls: "done", txt: "Reimbursed" },
  cancelled: { cls: "done", txt: "Cancelled" },
};
const advancePill: Record<string, { cls: string; txt: string }> = {
  pending: { cls: "today", txt: "Awaiting approval" },
  approved: { cls: "week", txt: "Approved — awaiting cash" },
  issued: { cls: "today", txt: "Issued — reconcile on return" },
  reconciled: { cls: "week", txt: "Reconciled" },
  settled: { cls: "done", txt: "Settled" },
  rejected: { cls: "over", txt: "Rejected" },
  cancelled: { cls: "done", txt: "Withdrawn" },
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
  const { pettyOpen, pettyEdit, closePetty, submitPettyRequest, updatePettyRequest, projectDetails, toast } = useApp();
  const [item, setItem] = useState("");
  const [amount, setAmount] = useState("");
  const [needBy, setNeedBy] = useState("");
  const [reason, setReason] = useState("");
  const [project, setProject] = useState("");
  const projects = Object.keys(projectDetails);
  useEffect(() => {
    if (pettyOpen) {
      setItem(pettyEdit?.item ?? "");
      setAmount(pettyEdit ? String(pettyEdit.amount) : "");
      setNeedBy(pettyEdit?.needBy ?? "");
      setReason(pettyEdit?.reason ?? "");
      setProject(pettyEdit?.project ?? "");
    }
  }, [pettyOpen, pettyEdit]);

  function save() {
    const amt = Number(amount);
    if (!item.trim()) { toast("What is it for?", "Add the item you're requesting money for"); return; }
    if (!amt || amt <= 0) { toast("Enter an amount", "How much do you need? (KES)"); return; }
    const v = { item: item.trim(), amount: amt, needBy, reason, project };
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
        <div>
          <label>Project <span style={{ textTransform: "none", fontWeight: 400, letterSpacing: 0 }}>· optional</span></label>
          <select className="field" style={{ width: "100%" }} value={project} onChange={(e) => setProject(e.target.value)}>
            <option value="">Not tied to a project</option>
            {projects.map((p) => <option key={p} value={p}>{p}</option>)}
          </select>
        </div>
        <div><label>Reason <span style={{ textTransform: "none", fontWeight: 400, letterSpacing: 0 }}>· optional</span></label><textarea className="field" rows={3} placeholder="What's it for and why now?" value={reason} onChange={(e) => setReason(e.target.value)} /></div>
        <Note>Once approved, this amount is coded to the chosen project and shows in its actuals. Approved requests show as <strong>Approved</strong> here; if turned down you'll see <strong>Rejected</strong> with any note.</Note>
      </div>
      <div className="mf">
        <button className="btn" onClick={closePetty}>Cancel</button>
        <button className="btn primary" onClick={save}>{pettyEdit ? "Save changes" : "Submit request"}</button>
      </div>
    </ModalShell>
  );
}

// The fixed expense categories — kept in sync with the DB check constraint (mig 0078),
// so spend-by-category reporting stays clean. Per-diem is a separate, computed line.
export const CLAIM_CATEGORIES = [
  { v: "transport", l: "Transport" },
  { v: "accommodation", l: "Accommodation" },
  { v: "meals", l: "Meals" },
  { v: "airtime", l: "Airtime" },
  { v: "supplies", l: "Supplies" },
  { v: "other", l: "Other" },
];
export const claimCatLabel = (c: string) => c === "per_diem" ? "Per diem" : CLAIM_CATEGORIES.find((x) => x.v === c)?.l ?? cap(c);

type EditLine = { category: string; detail: string; amount: string; receiptPath: string | null; uploading?: boolean };

// Raise or edit an expense claim from the portal — lines (receipted expenses) plus an
// optional computed per-diem line. Routes to Finance/HR for approval, then reimbursement.
function ExpenseClaimModal() {
  const { claimOpen, claimEdit, closeClaim, submitClaim, updateClaim, projectDetails, perDiemRate, uploadFile, uploadedFileUrl, advances, meEmail, toast } = useApp();
  const [purpose, setPurpose] = useState("");
  const [project, setProject] = useState("");
  const [advanceCode, setAdvanceCode] = useState("");
  const [lines, setLines] = useState<EditLine[]>([{ category: "transport", detail: "", amount: "", receiptPath: null }]);
  const [perDiemDays, setPerDiemDays] = useState("");
  const [perDiemRateInput, setPerDiemRateInput] = useState("");
  const projects = Object.keys(projectDetails);
  // my own travel advances that could have run short (issued onward), newest first
  const myAdvances = advances.filter((a) => a.holderEmail.toLowerCase() === (meEmail ?? "").toLowerCase() && ["issued", "reconciled", "settled"].includes(a.state));

  useEffect(() => {
    if (!claimOpen) return;
    setPurpose(claimEdit?.purpose ?? "");
    setProject(claimEdit?.project ?? "");
    setAdvanceCode(claimEdit?.advance ?? "");
    if (claimEdit) {
      const rec = claimEdit.lines.filter((l) => !l.isPerDiem)
        .map((l) => ({ category: l.category, detail: l.detail ?? "", amount: String(l.amount), receiptPath: l.receiptPath }));
      setLines(rec.length ? rec : [{ category: "transport", detail: "", amount: "", receiptPath: null }]);
      const pd = claimEdit.lines.find((l) => l.isPerDiem);
      setPerDiemDays(pd?.perDiemDays ? String(pd.perDiemDays) : "");
      setPerDiemRateInput(pd?.perDiemRate ? String(pd.perDiemRate) : "");
    } else {
      setLines([{ category: "transport", detail: "", amount: "", receiptPath: null }]);
      setPerDiemDays("");
      setPerDiemRateInput("");
    }
  }, [claimOpen, claimEdit, perDiemRate]);

  const setLine = (i: number, patch: Partial<EditLine>) => setLines((ls) => ls.map((l, idx) => idx === i ? { ...l, ...patch } : l));
  const addLine = () => setLines((ls) => [...ls, { category: "transport", detail: "", amount: "", receiptPath: null }]);
  const removeLine = (i: number) => setLines((ls) => ls.length > 1 ? ls.filter((_, idx) => idx !== i) : ls);
  async function pickReceipt(i: number, file: File) {
    setLine(i, { uploading: true });
    const path = await uploadFile("claims", file);
    setLine(i, { receiptPath: path ?? null, uploading: false });
  }

  const days = Number(perDiemDays) || 0;
  const pdRate = Number(perDiemRateInput) || 0;
  const perDiemAmt = days > 0 ? days * pdRate : 0;
  const linesTotal = lines.reduce((s, l) => s + (Number(l.amount) || 0), 0);
  const total = linesTotal + perDiemAmt;

  function save() {
    if (!purpose.trim()) { toast("What's this claim for?", "Add a short purpose, e.g. Makueni field visit"); return; }
    const filled = lines.filter((l) => Number(l.amount) > 0 || l.detail.trim() || l.receiptPath);
    for (const l of filled) {
      if (!(Number(l.amount) > 0)) { toast("Each line needs an amount", "Enter the amount (KES) for every expense line"); return; }
    }
    if (!filled.length && days <= 0) { toast("Add at least one line", "Add an expense line, or per-diem days"); return; }
    if (days > 0 && !(pdRate > 0)) { toast("Enter a per-diem rate", "Type the amount paid per day (KES) — it's multiplied by the days"); return; }
    const payload: ClaimLineInput[] = filled.map((l) => ({
      category: l.category, detail: l.detail.trim() || undefined, amount: Number(l.amount), isPerDiem: false, receiptPath: l.receiptPath,
    }));
    if (days > 0) payload.push({ category: "per_diem", isPerDiem: true, perDiemDays: days, perDiemRate: pdRate });
    const v = { purpose: purpose.trim(), project, lines: payload, advanceCode };
    if (claimEdit) updateClaim(claimEdit.id, v); else submitClaim(v);
  }

  return (
    <ModalShell open={claimOpen} onClose={closeClaim} width={620}>
      <div className="mh">
        <h3>{claimEdit ? `Edit claim ${claimEdit.id}` : "File an expense claim"}</h3>
        <p>{claimEdit ? "You can change it while it's pending or after a rejection — editing a rejected claim sends it back for approval." : "For money you spent yourself and are owed back. Add a line per expense, plus per-diem days if any. It routes to Finance / HR to approve, then reimburse."}</p>
      </div>
      <div className="mb">
        <div><label>Purpose</label><input className="field" placeholder="e.g. Makueni site visit — 3 days" value={purpose} onChange={(e) => setPurpose(e.target.value)} /></div>
        <div>
          <label>Project <span style={{ textTransform: "none", fontWeight: 400, letterSpacing: 0 }}>· optional but recommended — this is what codes the cost to the project</span></label>
          <select className="field" style={{ width: "100%" }} value={project} onChange={(e) => setProject(e.target.value)}>
            <option value="">Not tied to a project</option>
            {projects.map((p) => <option key={p} value={p}>{p}</option>)}
          </select>
        </div>
        {myAdvances.length > 0 && (
          <div>
            <label>Link to a travel advance <span style={{ textTransform: "none", fontWeight: 400, letterSpacing: 0 }}>· optional</span></label>
            <select className="field" style={{ width: "100%" }} value={advanceCode} onChange={(e) => setAdvanceCode(e.target.value)}>
              <option value="">Not linked to an advance</option>
              {myAdvances.map((a) => <option key={a.id} value={a.id}>{a.id} — {a.purpose}</option>)}
            </select>
            {advanceCode && <Note>Linking says <em>“this out-of-pocket money was for that trip.”</em> Use it when the advance wasn't enough and you covered the extra yourself — reconcile the advance for what its cash paid, and claim only the extra here so nothing is counted twice.</Note>}
          </div>
        )}

        <label style={{ marginTop: 4 }}>Expense lines</label>
        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          {lines.map((l, i) => (
            <div key={i} style={{ display: "grid", gridTemplateColumns: "1.1fr 1.4fr 0.9fr auto", gap: 8, alignItems: "center" }}>
              <select className="field" value={l.category} onChange={(e) => setLine(i, { category: e.target.value })}>
                {CLAIM_CATEGORIES.map((c) => <option key={c.v} value={c.v}>{c.l}</option>)}
              </select>
              <input className="field" placeholder="Detail (optional)" value={l.detail} onChange={(e) => setLine(i, { detail: e.target.value })} />
              <input className="field" type="number" min="0" placeholder="Amount" value={l.amount} onChange={(e) => setLine(i, { amount: e.target.value })} />
              <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
                <label className="btn" style={{ padding: "4px 8px", fontSize: 11, cursor: "pointer", whiteSpace: "nowrap" }}>
                  {l.uploading ? "…" : l.receiptPath ? "✓ Receipt" : "Receipt"}
                  <input type="file" accept=".pdf,image/*" style={{ display: "none" }} onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ""; if (f) pickReceipt(i, f); }} />
                </label>
                {l.receiptPath && <a href="#" onClick={(e) => { e.preventDefault(); window.open(uploadedFileUrl(l.receiptPath!), "_blank", "noopener"); }} style={{ fontSize: 11, color: "var(--flame)" }}>view</a>}
                <button className="btn" style={{ padding: "4px 8px", fontSize: 11, color: "var(--red)" }} onClick={() => removeLine(i)} title="Remove line">×</button>
              </div>
            </div>
          ))}
        </div>
        <a href="#" onClick={(e) => { e.preventDefault(); addLine(); }} style={{ color: "var(--flame)", textDecoration: "none", fontSize: 12.5 }}>+ Add another line</a>

        <label style={{ marginTop: 4 }}>Per diem <span style={{ textTransform: "none", fontWeight: 400, letterSpacing: 0 }}>· optional — days × rate per day</span></label>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 8 }}>
          <div>
            <label>Days</label>
            <input className="field" type="number" min="0" placeholder="e.g. 2" value={perDiemDays} onChange={(e) => setPerDiemDays(e.target.value)} />
          </div>
          <div>
            <label>Rate / day (KES)</label>
            <input className="field" type="number" min="0" placeholder="e.g. 1000" value={perDiemRateInput} onChange={(e) => setPerDiemRateInput(e.target.value)} />
          </div>
          <div>
            <label>Amount</label>
            <input className="field" value={days > 0 && pdRate > 0 ? kes(perDiemAmt) : "—"} readOnly style={{ background: "var(--wash, #F7F4EE)" }} />
          </div>
        </div>
        <Note>Receipts aren't required to file — attach them here or later from your Claims tab, but every expense line needs a receipt before it can be <strong>approved</strong>. Per diem = rate per day × days{perDiemRate > 0 ? ` (company default ${kes(perDiemRate)}/day — you can change it)` : ""}. <strong>Total: {kes(total)}</strong></Note>
      </div>
      <div className="mf">
        <button className="btn" onClick={closeClaim}>Cancel</button>
        <button className="btn primary" onClick={save}>{claimEdit ? "Save changes" : "Submit claim"}</button>
      </div>
    </ModalShell>
  );
}

// Request or edit a travel advance — cash given BEFORE the trip. Just purpose, project
// and amount; the receipts come later, at reconciliation.
function AdvanceRequestModal() {
  const { advanceOpen, advanceEdit, closeAdvance, submitAdvance, updateAdvance, projectDetails, perDiemRate, toast } = useApp();
  const [purpose, setPurpose] = useState("");
  const [project, setProject] = useState("");
  const [lines, setLines] = useState<EditLine[]>([{ category: "transport", detail: "", amount: "", receiptPath: null }]);
  const [perDiemDays, setPerDiemDays] = useState("");
  const [perDiemRateInput, setPerDiemRateInput] = useState("");
  const projects = Object.keys(projectDetails);

  useEffect(() => {
    if (!advanceOpen) return;
    setPurpose(advanceEdit?.purpose ?? "");
    setProject(advanceEdit?.project ?? "");
    if (advanceEdit) {
      const rec = advanceEdit.plannedLines.filter((l) => !l.isPerDiem)
        .map((l) => ({ category: l.category, detail: l.detail ?? "", amount: String(l.amount), receiptPath: l.receiptPath }));
      setLines(rec.length ? rec : [{ category: "transport", detail: "", amount: "", receiptPath: null }]);
      const pd = advanceEdit.plannedLines.find((l) => l.isPerDiem);
      setPerDiemDays(pd?.perDiemDays ? String(pd.perDiemDays) : "");
      setPerDiemRateInput(pd?.perDiemRate ? String(pd.perDiemRate) : "");
    } else {
      setLines([{ category: "transport", detail: "", amount: "", receiptPath: null }]);
      setPerDiemDays("");
      setPerDiemRateInput("");
    }
  }, [advanceOpen, advanceEdit, perDiemRate]);

  const setLine = (i: number, patch: Partial<EditLine>) => setLines((ls) => ls.map((l, idx) => idx === i ? { ...l, ...patch } : l));
  const addLine = () => setLines((ls) => [...ls, { category: "transport", detail: "", amount: "", receiptPath: null }]);
  const removeLine = (i: number) => setLines((ls) => ls.length > 1 ? ls.filter((_, idx) => idx !== i) : ls);

  const days = Number(perDiemDays) || 0;
  const pdRate = Number(perDiemRateInput) || 0;
  const perDiemAmt = days > 0 ? days * pdRate : 0;
  const total = lines.reduce((s, l) => s + (Number(l.amount) || 0), 0) + perDiemAmt;

  function save() {
    if (!purpose.trim()) { toast("What's the advance for?", "e.g. Kitui field deployment — 3 days"); return; }
    const filled = lines.filter((l) => Number(l.amount) > 0 || l.detail.trim());
    for (const l of filled) if (!(Number(l.amount) > 0)) { toast("Each line needs an amount", "Enter the estimated amount (KES) for every line"); return; }
    if (!filled.length && days <= 0) { toast("Add at least one line", "Break the advance down into what it's for"); return; }
    if (days > 0 && !(pdRate > 0)) { toast("Enter a per-diem rate", "Type the amount per day (KES)"); return; }
    const payload: ClaimLineInput[] = filled.map((l) => ({ category: l.category, detail: l.detail.trim() || undefined, amount: Number(l.amount), isPerDiem: false }));
    if (days > 0) payload.push({ category: "per_diem", isPerDiem: true, perDiemDays: days, perDiemRate: pdRate });
    const v = { purpose: purpose.trim(), project, lines: payload };
    if (advanceEdit) updateAdvance(advanceEdit.id, v); else submitAdvance(v);
  }

  return (
    <ModalShell open={advanceOpen} onClose={closeAdvance} width={600}>
      <div className="mh">
        <h3>{advanceEdit ? `Edit advance ${advanceEdit.id}` : "Request a travel advance"}</h3>
        <p>{advanceEdit ? "You can change it while pending or after a rejection — editing a rejected advance re-sends it." : "Cash up front for a field trip. Break down what you need it for — the total is your advance amount."}</p>
      </div>
      <div className="mb">
        <div><label>Purpose</label><input className="field" placeholder="e.g. Kitui field deployment — 3 days" value={purpose} onChange={(e) => setPurpose(e.target.value)} /></div>
        <div>
          <label>Project <span style={{ textTransform: "none", fontWeight: 400, letterSpacing: 0 }}>· optional but recommended</span></label>
          <select className="field" style={{ width: "100%" }} value={project} onChange={(e) => setProject(e.target.value)}>
            <option value="">Not tied to a project</option>
            {projects.map((p) => <option key={p} value={p}>{p}</option>)}
          </select>
        </div>

        <label style={{ marginTop: 4 }}>What the advance is for <span style={{ textTransform: "none", fontWeight: 400, letterSpacing: 0 }}>· estimated amounts — the total is what you're asking for</span></label>
        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          {lines.map((l, i) => (
            <div key={i} style={{ display: "grid", gridTemplateColumns: "1.1fr 1.6fr 0.9fr auto", gap: 8, alignItems: "center" }}>
              <select className="field" value={l.category} onChange={(e) => setLine(i, { category: e.target.value })}>
                {CLAIM_CATEGORIES.map((c) => <option key={c.v} value={c.v}>{c.l}</option>)}
              </select>
              <input className="field" placeholder="Detail (optional)" value={l.detail} onChange={(e) => setLine(i, { detail: e.target.value })} />
              <input className="field" type="number" min="0" placeholder="Amount" value={l.amount} onChange={(e) => setLine(i, { amount: e.target.value })} />
              <button className="btn" style={{ padding: "4px 8px", fontSize: 11, color: "var(--red)" }} onClick={() => removeLine(i)} title="Remove line">×</button>
            </div>
          ))}
        </div>
        <a href="#" onClick={(e) => { e.preventDefault(); addLine(); }} style={{ color: "var(--flame)", textDecoration: "none", fontSize: 12.5 }}>+ Add another line</a>

        <label style={{ marginTop: 4 }}>Per diem <span style={{ textTransform: "none", fontWeight: 400, letterSpacing: 0 }}>· optional — days × rate per day</span></label>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 8 }}>
          <div><label>Days</label><input className="field" type="number" min="0" placeholder="e.g. 3" value={perDiemDays} onChange={(e) => setPerDiemDays(e.target.value)} /></div>
          <div><label>Rate / day (KES)</label><input className="field" type="number" min="0" placeholder="e.g. 1000" value={perDiemRateInput} onChange={(e) => setPerDiemRateInput(e.target.value)} /></div>
          <div><label>Amount</label><input className="field" value={days > 0 && pdRate > 0 ? kes(perDiemAmt) : "—"} readOnly style={{ background: "var(--wash, #F7F4EE)" }} /></div>
        </div>
        <Note>The lines add up to the advance — <strong>Total: {kes(total)}</strong>. This is your estimate; on return you reconcile with real receipts, and only what you actually spent is charged to the project.</Note>
      </div>
      <div className="mf">
        <button className="btn" onClick={closeAdvance}>Cancel</button>
        <button className="btn primary" onClick={save}>{advanceEdit ? "Save changes" : "Submit request"}</button>
      </div>
    </ModalShell>
  );
}

// Reconcile an issued advance — enter what was actually spent (receipted lines + per-diem).
// The system computes spent-vs-advanced; only the spent amount posts to the project.
function AdvanceReconcileModal() {
  const { reconcileTarget, closeReconcile, reconcileAdvance, perDiemRate, uploadFile, uploadedFileUrl, toast } = useApp();
  const open = !!reconcileTarget;
  const [lines, setLines] = useState<EditLine[]>([{ category: "transport", detail: "", amount: "", receiptPath: null }]);
  const [perDiemDays, setPerDiemDays] = useState("");
  const [perDiemRateInput, setPerDiemRateInput] = useState("");

  useEffect(() => {
    if (!open) return;
    setLines([{ category: "transport", detail: "", amount: "", receiptPath: null }]);
    setPerDiemDays("");
    setPerDiemRateInput("");
  }, [open, perDiemRate]);

  const setLine = (i: number, patch: Partial<EditLine>) => setLines((ls) => ls.map((l, idx) => idx === i ? { ...l, ...patch } : l));
  const addLine = () => setLines((ls) => [...ls, { category: "transport", detail: "", amount: "", receiptPath: null }]);
  const removeLine = (i: number) => setLines((ls) => ls.length > 1 ? ls.filter((_, idx) => idx !== i) : ls);
  async function pickReceipt(i: number, file: File) {
    setLine(i, { uploading: true });
    const path = await uploadFile("advances", file);
    setLine(i, { receiptPath: path ?? null, uploading: false });
  }

  const days = Number(perDiemDays) || 0;
  const pdRate = Number(perDiemRateInput) || 0;
  const perDiemAmt = days > 0 ? days * pdRate : 0;
  const spent = lines.reduce((s, l) => s + (Number(l.amount) || 0), 0) + perDiemAmt;
  const advAmt = reconcileTarget?.amount ?? 0;
  const balance = advAmt - spent;

  function save() {
    const filled = lines.filter((l) => Number(l.amount) > 0 || l.detail.trim() || l.receiptPath);
    for (const l of filled) if (!(Number(l.amount) > 0)) { toast("Each line needs an amount", "Enter the amount (KES) for every spent line"); return; }
    if (!filled.length && days <= 0) { toast("Add at least one line", "Add what you spent, or per-diem days"); return; }
    if (days > 0 && !(pdRate > 0)) { toast("Enter a per-diem rate", "Type the amount paid per day (KES)"); return; }
    const payload: ClaimLineInput[] = filled.map((l) => ({
      category: l.category, detail: l.detail.trim() || undefined, amount: Number(l.amount), isPerDiem: false, receiptPath: l.receiptPath,
    }));
    if (days > 0) payload.push({ category: "per_diem", isPerDiem: true, perDiemDays: days, perDiemRate: pdRate });
    reconcileAdvance(reconcileTarget!.id, payload);
  }

  return (
    <ModalShell open={open} onClose={closeReconcile} width={620}>
      {reconcileTarget && (
        <>
          <div className="mh">
            <h3>Reconcile advance {reconcileTarget.id}</h3>
            <p>{reconcileTarget.purpose} · advanced <strong>{kes(advAmt)}</strong>{reconcileTarget.project ? ` · ${reconcileTarget.project}` : ""}. Enter what you actually spent.</p>
          </div>
          <div className="mb">
            <label>What you spent</label>
            <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
              {lines.map((l, i) => (
                <div key={i} style={{ display: "grid", gridTemplateColumns: "1.1fr 1.4fr 0.9fr auto", gap: 8, alignItems: "center" }}>
                  <select className="field" value={l.category} onChange={(e) => setLine(i, { category: e.target.value })}>
                    {CLAIM_CATEGORIES.map((c) => <option key={c.v} value={c.v}>{c.l}</option>)}
                  </select>
                  <input className="field" placeholder="Detail (optional)" value={l.detail} onChange={(e) => setLine(i, { detail: e.target.value })} />
                  <input className="field" type="number" min="0" placeholder="Amount" value={l.amount} onChange={(e) => setLine(i, { amount: e.target.value })} />
                  <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
                    <label className="btn" style={{ padding: "4px 8px", fontSize: 11, cursor: "pointer", whiteSpace: "nowrap" }}>
                      {l.uploading ? "…" : l.receiptPath ? "✓ Receipt" : "Receipt"}
                      <input type="file" accept=".pdf,image/*" style={{ display: "none" }} onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ""; if (f) pickReceipt(i, f); }} />
                    </label>
                    {l.receiptPath && <a href="#" onClick={(e) => { e.preventDefault(); window.open(uploadedFileUrl(l.receiptPath!), "_blank", "noopener"); }} style={{ fontSize: 11, color: "var(--flame)" }}>view</a>}
                    <button className="btn" style={{ padding: "4px 8px", fontSize: 11, color: "var(--red)" }} onClick={() => removeLine(i)} title="Remove line">×</button>
                  </div>
                </div>
              ))}
            </div>
            <a href="#" onClick={(e) => { e.preventDefault(); addLine(); }} style={{ color: "var(--flame)", textDecoration: "none", fontSize: 12.5 }}>+ Add another line</a>

            <label style={{ marginTop: 4 }}>Per diem <span style={{ textTransform: "none", fontWeight: 400, letterSpacing: 0 }}>· optional — days × rate per day</span></label>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 8 }}>
              <div><label>Days</label><input className="field" type="number" min="0" placeholder="e.g. 2" value={perDiemDays} onChange={(e) => setPerDiemDays(e.target.value)} /></div>
              <div><label>Rate / day (KES)</label><input className="field" type="number" min="0" placeholder="e.g. 1000" value={perDiemRateInput} onChange={(e) => setPerDiemRateInput(e.target.value)} /></div>
              <div><label>Amount</label><input className="field" value={days > 0 && pdRate > 0 ? kes(perDiemAmt) : "—"} readOnly style={{ background: "var(--wash, #F7F4EE)" }} /></div>
            </div>
            <Note>Spent <strong>{kes(spent)}</strong> of {kes(advAmt)} advanced · balance <strong>{kes(Math.abs(balance))}</strong> {balance > 0 ? "to return" : balance < 0 ? "to be topped up" : "— exact"}. Only the {kes(spent)} spent is charged to the project.</Note>
          </div>
          <div className="mf">
            <button className="btn" onClick={closeReconcile}>Cancel</button>
            <button className="btn primary" onClick={save}>Submit reconciliation</button>
          </div>
        </>
      )}
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
    claims, openClaim, openClaimEdit, deleteClaim,
    advances, openAdvance, openAdvanceEdit, deleteAdvance, openReconcile,
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
  // my own expense claims (the queue lives in Finance → Claims)
  const myClaims = claims.filter((r) => r.requesterEmail.toLowerCase() === (meEmail ?? "").toLowerCase());
  const pendingClaims = myClaims.filter((r) => r.state === "pending");
  // my own travel advances (the queue lives in Finance → Advances)
  const myAdvances = advances.filter((r) => r.holderEmail.toLowerCase() === (meEmail ?? "").toLowerCase());
  const openAdvances = myAdvances.filter((r) => r.state === "issued");
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
          {tab === "sp-claims" && <button className="btn primary" onClick={openClaim}><PlusI />File expense claim</button>}
          {tab === "sp-advances" && <button className="btn primary" onClick={openAdvance}><PlusI />Request travel advance</button>}
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
              {pendingClaims.length > 0 && (
                <div className="task" onClick={() => goTab("staffportal", "sp-claims")}><span className="id" style={{ color: "var(--ember)" }}>CLM</span><span className="txt">{pendingClaims.length} expense claim{pendingClaims.length > 1 ? "s" : ""} awaiting approval<small>you can edit or withdraw while pending</small></span><span className="pill week">Pending</span></div>
              )}
              {openAdvances.length > 0 && (
                <div className="task" onClick={() => goTab("staffportal", "sp-advances")}><span className="id" style={{ color: "var(--ember)" }}>ADV</span><span className="txt">{openAdvances.length} travel advance{openAdvances.length > 1 ? "s" : ""} to reconcile<small>account for it with receipts on your return</small></span><span className="pill today">Reconcile</span></div>
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
                <thead><tr><th>Week of</th><th>What I did</th><th>Attachment</th><th>Status</th></tr></thead>
                <tbody>
                  {myReports.map((r) => (
                    <tr key={r.id}>
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
                  <thead><tr><th>Type</th><th>Dates</th><th>Days</th><th>Status</th><th></th></tr></thead>
                  <tbody>
                    {apps.map((a) => (
                      <tr key={a.id}>
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
                <thead><tr><th>Item</th><th>Amount</th><th>Needed by</th><th>Reason</th><th>Status</th><th></th></tr></thead>
                <tbody>
                  {myPetty.map((r) => (
                    <tr key={r.id}>
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

      {tab === "sp-claims" && (
        <div className="hr-panel active">
          <div className="panel">
            <div className="panel-h"><h3>My expense claims</h3><span className="meta"><a href="#" onClick={(e) => { e.preventDefault(); openClaim(); }} style={{ color: "var(--flame)", textDecoration: "none" }}>+ File expense claim</a></span></div>
            {myClaims.length ? (
              <table className="tbl">
                <thead><tr><th>Purpose</th><th>Project</th><th>Amount</th><th>Status</th><th></th></tr></thead>
                <tbody>
                  {myClaims.map((r) => {
                    const needsReceipt = r.state === "pending" && r.lines.some((l) => !l.isPerDiem && !l.receiptPath);
                    return (
                      <tr key={r.id}>
                        <td>{r.purpose}{r.advance ? <small style={{ display: "block", color: "var(--flame)", fontSize: 11 }}>→ advance {r.advance}</small> : null}</td>
                        <td style={{ fontSize: 12.5, color: "var(--ink-soft)" }}>{r.project || "—"}</td>
                        <td className="mono">{kes(r.total)}</td>
                        <td>
                          <span className={`pill ${claimPill[r.state]?.cls || "today"}`} style={{ textTransform: "none" }} title={r.state !== "pending" && r.decidedBy ? `${r.decidedBy}${r.note ? " · " + r.note : ""}` : ""}>
                            {claimPill[r.state]?.txt || r.state}
                          </span>
                          {needsReceipt && <span className="pill over" style={{ textTransform: "none", marginLeft: 6 }}>receipt needed</span>}
                        </td>
                        <td>
                          {(r.state === "pending" || r.state === "rejected") ? (
                            <span style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
                              <button className="btn" style={{ padding: "4px 10px", fontSize: 11.5 }} onClick={() => openClaimEdit(r)}>Edit</button>
                              <button className="btn" style={{ padding: "4px 10px", fontSize: 11.5, color: "var(--red)" }} onClick={() => deleteClaim(r.id)}>Withdraw</button>
                            </span>
                          ) : (
                            <span className="meta" style={{ display: "block", textAlign: "right" }}>{r.state === "paid" ? (r.paymentRef ? `Paid · ${r.paymentRef}` : "Reimbursed") : "locked"}</span>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            ) : (
              <Note noBorder>No expense claims yet — use “File expense claim”. Add a line per expense with its receipt, plus per-diem days; it routes to Finance / HR for approval, then reimbursement. Every line is coded to the project you choose.</Note>
            )}
            <Note>Edit or withdraw a claim while it is <strong>Awaiting approval</strong>, or after a <strong>Rejection</strong> — editing a rejected claim re-sends it for approval. Every expense line needs a receipt attached before it can be approved{pendingClaims.length ? ` · ${pendingClaims.length} pending now` : ""}.</Note>
          </div>
        </div>
      )}

      {tab === "sp-advances" && (
        <div className="hr-panel active">
          <div className="panel">
            <div className="panel-h"><h3>My travel advances</h3><span className="meta"><a href="#" onClick={(e) => { e.preventDefault(); openAdvance(); }} style={{ color: "var(--flame)", textDecoration: "none" }}>+ Request travel advance</a></span></div>
            {myAdvances.length ? (
              <table className="tbl">
                <thead><tr><th>Purpose</th><th>Project</th><th>Advanced</th><th>Status</th><th></th></tr></thead>
                <tbody>
                  {myAdvances.map((r) => (
                    <tr key={r.id}>
                      <td>{r.purpose}</td>
                      <td style={{ fontSize: 12.5, color: "var(--ink-soft)" }}>{r.project || "—"}</td>
                      <td className="mono">{kes(r.amount)}{r.state === "reconciled" || r.state === "settled" ? <small style={{ display: "block", color: "var(--ink-soft)", fontSize: 11 }}>spent {kes(r.spent ?? 0)}{typeof r.balance === "number" && r.balance !== 0 ? ` · ${kes(Math.abs(r.balance))} ${r.balance > 0 ? "to return" : "top-up"}` : ""}</small> : null}</td>
                      <td>
                        <span className={`pill ${advancePill[r.state]?.cls || "today"}`} style={{ textTransform: "none" }} title={r.state === "rejected" && r.note ? r.note : ""}>
                          {advancePill[r.state]?.txt || r.state}
                        </span>
                      </td>
                      <td>
                        {(r.state === "pending" || r.state === "rejected") ? (
                          <span style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
                            <button className="btn" style={{ padding: "4px 10px", fontSize: 11.5 }} onClick={() => openAdvanceEdit(r)}>Edit</button>
                            <button className="btn" style={{ padding: "4px 10px", fontSize: 11.5, color: "var(--red)" }} onClick={() => deleteAdvance(r.id)}>Withdraw</button>
                          </span>
                        ) : r.state === "issued" ? (
                          <span style={{ display: "flex", justifyContent: "flex-end" }}>
                            <button className="btn primary" style={{ padding: "4px 10px", fontSize: 11.5 }} onClick={() => openReconcile(r)}>Reconcile</button>
                          </span>
                        ) : (
                          <span className="meta" style={{ display: "block", textAlign: "right" }}>{r.state === "settled" ? "Closed" : r.state === "reconciled" ? "With Finance" : "—"}</span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            ) : (
              <Note noBorder>No travel advances yet — use “Request travel advance” for cash up front before a field trip. It's approved, issued by Finance, then you reconcile it with receipts on your return.</Note>
            )}
            <Note>An <strong>Issued</strong> advance is money you owe until you reconcile it. Reconcile with what you actually spent — only that amount is charged to the project, and you return any balance{openAdvances.length ? ` · ${openAdvances.length} to reconcile now` : ""}.</Note>
          </div>
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
                <div className="panel-h"><h3>Leaving Ignis</h3><span className="meta">{myExit.reason || "—"}{myExit.finalDay ? ` · final day ${fmtD(myExit.finalDay)}` : ""}</span></div>
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
      <ExpenseClaimModal />
      <AdvanceRequestModal />
      <AdvanceReconcileModal />
      <WeeklyReportModal />
      <FeedbackModal />
    </>
  );
}
