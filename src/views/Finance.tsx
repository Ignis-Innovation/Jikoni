import { useRef, useState, type ReactNode } from "react";
import { useApp, type PettyRequest, type ExpenseClaim, type TravelAdvance, type RecurringBill } from "../store";
import { Pulse, Note, ViewOnly } from "../components/ui";
import { ModalShell } from "../components/modals";
import { ReceiptList, LineReceiptsModal } from "../components/Receipts";
import { PlusI } from "../components/icons";
import { Crumb } from "../nav";
import { budgetLines } from "../data";

const kes = (n: number) => "KES " + Math.round(n).toLocaleString();

function EmptyBody({ children = "No data yet." }: { children?: ReactNode }) {
  return <div className="pad" style={{ fontSize: 12.5, color: "var(--ink-soft)", padding: "34px 20px", textAlign: "center" }}>{children}</div>;
}

// Create a cost centre / budget line (name + budget) so Budgets & Costing has a
// line to track against — surfaces the existing upsert_cost_centre RPC.
function CostCentreModal({ open, onClose, onSave }: {
  open: boolean; onClose: () => void; onSave: (name: string, budget: number) => void;
}) {
  const [name, setName] = useState("");
  const [budget, setBudget] = useState("");
  return (
    <ModalShell open={open} onClose={onClose} width={460}>
      <div className="mh">
        <h3>New cost centre</h3>
        <p>Adds a budget line. Requisitions check against it, and it fills the Budgets &amp; Costing table.</p>
      </div>
      <div className="mb">
        <div><label>Cost centre / budget line</label><input className="field" autoFocus placeholder="e.g. Field / MRV" value={name} onChange={(e) => setName(e.target.value)} /></div>
        <div><label>Budget (KES)</label><input className="field" type="number" min="0" placeholder="e.g. 900000" value={budget} onChange={(e) => setBudget(e.target.value)} /></div>
        <Note>Committed rises when a requisition is raised against this line and moves to actual when the invoice is paid.</Note>
      </div>
      <div className="mf">
        <button className="btn" onClick={onClose}>Cancel</button>
        <button className="btn primary" onClick={() => onSave(name.trim(), Number(budget))}>Add cost centre</button>
      </div>
    </ModalShell>
  );
}

// In-app popup to approve or reject a petty-cash request (replaces browser prompts).
function PettyDecideModal({ decision, onClose, onConfirm }: {
  decision: { req: PettyRequest; approve: boolean } | null;
  onClose: () => void;
  onConfirm: (ref: string, approve: boolean, note: string) => void;
}) {
  const [note, setNote] = useState("");
  const open = !!decision;
  const approve = decision?.approve ?? false;
  const req = decision?.req;
  return (
    <ModalShell open={open} onClose={onClose} width={460}>
      {req && (
        <>
          <div className="mh">
            <h3>{approve ? "Approve petty cash" : "Reject petty cash"}</h3>
            <p>{req.requester} · {req.item} · <strong>{kes(req.amount)}</strong>{req.needBy ? ` · needed ${new Date(req.needBy + "T00:00:00").toLocaleDateString("en-GB", { day: "numeric", month: "short" })}` : ""}</p>
          </div>
          <div className="mb">
            {req.reason && <div className="reqbox" style={{ background: "#FCFAF6", borderColor: "transparent", color: "var(--ink)" }}><div className="rl">Reason given</div>{req.reason}</div>}
            <div>
              <label>{approve ? "Note" : "Reason for rejecting"} <span style={{ textTransform: "none", fontWeight: 400, letterSpacing: 0 }}>· optional</span></label>
              <textarea className="field" rows={3} autoFocus placeholder={approve ? "e.g. Approved — collect from the float on Monday" : "e.g. Use the project card instead"} value={note} onChange={(e) => setNote(e.target.value)} />
            </div>
            <Note>The requester is notified of the decision and any note. This can't be undone from here.</Note>
          </div>
          <div className="mf">
            <button className="btn" onClick={onClose}>Cancel</button>
            <button className={`btn ${approve ? "primary" : ""}`} style={approve ? undefined : { color: "var(--red)" }}
              onClick={() => { onConfirm(req.id, approve, note); }}>
              {approve ? "Approve request" : "Reject request"}
            </button>
          </div>
        </>
      )}
    </ModalShell>
  );
}

const claimCat = (c: string) => c === "per_diem" ? "Per diem"
  : ({ transport: "Transport", accommodation: "Accommodation", meals: "Meals", airtime: "Airtime", supplies: "Supplies", other: "Other" } as Record<string, string>)[c] ?? c;

// Approve or reject an expense claim — shows the line breakdown and blocks approval
// while any expense line is missing a receipt (the server enforces this too).
function ClaimDecideModal({ decision, onClose, onConfirm }: {
  decision: { claim: ExpenseClaim; approve: boolean } | null;
  onClose: () => void;
  onConfirm: (ref: string, approve: boolean, note: string) => void;
}) {
  const { claims, attachClaimReceipts, removeClaimReceipt } = useApp();
  const [note, setNote] = useState("");
  const [busyLine, setBusyLine] = useState<string | null>(null);
  const open = !!decision;
  const approve = decision?.approve ?? false;
  // read the live claim so receipts HR adds/removes here show straight away
  const c = decision ? (claims.find((x) => x.id === decision.claim.id) ?? decision.claim) : undefined;
  const missing = c ? c.lines.filter((l) => !l.isPerDiem && !l.receiptPaths.length).length : 0;
  async function addReceipts(lineId: string, files: File[]) {
    setBusyLine(lineId);
    await attachClaimReceipts(lineId, files);
    setBusyLine(null);
  }
  return (
    <ModalShell open={open} onClose={onClose} width={560}>
      {c && (
        <>
          <div className="mh">
            <h3>{approve ? "Approve expense claim" : "Reject expense claim"}</h3>
            <p>{c.requester} · {c.purpose} · <strong>{kes(c.total)}</strong>{c.project ? ` · ${c.project}` : ""}{c.advance ? <> · <span style={{ color: "var(--flame)" }}>out-of-pocket for advance {c.advance}</span></> : null}</p>
          </div>
          <div className="mb">
            <table className="tbl" style={{ marginBottom: 4 }}>
              <thead><tr><th>Category</th><th>Detail</th><th>Amount</th><th>Receipts</th></tr></thead>
              <tbody>
                {c.lines.map((l, i) => (
                  <tr key={i}>
                    <td>{claimCat(l.category)}</td>
                    <td style={{ fontSize: 12 }}>{l.isPerDiem ? `${l.perDiemDays} day${l.perDiemDays === 1 ? "" : "s"} × ${kes(l.perDiemRate || 0)}` : (l.detail || "—")}</td>
                    <td className="mono">{kes(l.amount)}</td>
                    <td style={{ fontSize: 12 }}>
                      {l.isPerDiem || !l.id ? <span style={{ color: "var(--ink-soft)" }}>n/a</span>
                        : <ReceiptList paths={l.receiptPaths} busy={busyLine === l.id} addLabel="Add"
                            onAdd={(fs) => addReceipts(l.id!, fs)} onRemove={(p) => removeClaimReceipt(l.id!, p)} />}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            {approve && missing > 0 && <Note>{missing} expense line{missing > 1 ? "s have" : " has"} no receipt yet — you can still approve, attach {missing > 1 ? "them" : "it"} here, or the claimant can add {missing > 1 ? "them" : "it"} later from their Claims tab.</Note>}
            <div>
              <label>{approve ? "Note" : "Reason for rejecting"} <span style={{ textTransform: "none", fontWeight: 400, letterSpacing: 0 }}>· optional</span></label>
              <textarea className="field" rows={2} autoFocus placeholder={approve ? "e.g. Approved — reimbursed with July payroll" : "e.g. Split the per-diem days out and re-file"} value={note} onChange={(e) => setNote(e.target.value)} />
            </div>
            <Note>The claimant is notified. On approval the amount is coded to {c.project ? <strong>{c.project}</strong> : "its project"}'s actuals, then Finance marks it paid once reimbursed.</Note>
          </div>
          <div className="mf">
            <button className="btn" onClick={onClose}>Cancel</button>
            <button className={`btn ${approve ? "primary" : ""}`}
              style={approve ? undefined : { color: "var(--red)" }}
              onClick={() => { onConfirm(c.id, approve, note); }}>
              {approve ? "Approve claim" : "Reject claim"}
            </button>
          </div>
        </>
      )}
    </ModalShell>
  );
}

// Record an approved claim as reimbursed (Finance). Does not touch project actuals —
// the cost was coded on approval; this only closes the money-owed-to-staff loop.
function ClaimPayModal({ claim, onClose, onConfirm }: {
  claim: ExpenseClaim | null; onClose: () => void; onConfirm: (ref: string, paymentRef: string) => void;
}) {
  const [ref, setRef] = useState("");
  return (
    <ModalShell open={!!claim} onClose={onClose} width={440}>
      {claim && (
        <>
          <div className="mh"><h3>Mark reimbursement paid</h3><p>{claim.requester} · {claim.purpose} · <strong>{kes(claim.total)}</strong></p></div>
          <div className="mb">
            <div><label>Payment reference <span style={{ textTransform: "none", fontWeight: 400, letterSpacing: 0 }}>· optional</span></label>
              <input className="field" autoFocus placeholder="e.g. M-Pesa code / bank transfer ref" value={ref} onChange={(e) => setRef(e.target.value)} /></div>
            <Note>Records the claim as <strong>reimbursed</strong> and notifies the claimant. It does not change the project actuals — the cost was coded when the claim was approved.</Note>
          </div>
          <div className="mf">
            <button className="btn" onClick={onClose}>Cancel</button>
            <button className="btn primary" onClick={() => onConfirm(claim.id, ref)}>Mark paid</button>
          </div>
        </>
      )}
    </ModalShell>
  );
}

// Approve or reject a travel-advance request (authorises the cash; Finance issues after).
function AdvanceDecideModal({ decision, onClose, onConfirm }: {
  decision: { adv: TravelAdvance; approve: boolean } | null;
  onClose: () => void; onConfirm: (ref: string, approve: boolean, note: string) => void;
}) {
  const [note, setNote] = useState("");
  const open = !!decision; const approve = decision?.approve ?? false; const a = decision?.adv;
  return (
    <ModalShell open={open} onClose={onClose} width={520}>
      {a && (
        <>
          <div className="mh"><h3>{approve ? "Approve travel advance" : "Reject travel advance"}</h3>
            <p>{a.holder} · {a.purpose} · <strong>{kes(a.amount)}</strong>{a.project ? ` · ${a.project}` : ""}</p></div>
          <div className="mb">
            {a.plannedLines.length > 0 && (
              <table className="tbl" style={{ marginBottom: 4 }}>
                <thead><tr><th>What it's for</th><th>Detail</th><th style={{ textAlign: "right" }}>Amount</th></tr></thead>
                <tbody>
                  {a.plannedLines.map((l, i) => (
                    <tr key={i}>
                      <td>{claimCat(l.category)}</td>
                      <td style={{ fontSize: 12 }}>{l.isPerDiem ? `${l.perDiemDays} day${l.perDiemDays === 1 ? "" : "s"} × ${kes(l.perDiemRate || 0)}` : (l.detail || "—")}</td>
                      <td className="mono" style={{ textAlign: "right" }}>{kes(l.amount)}</td>
                    </tr>
                  ))}
                  <tr><td colSpan={2} style={{ textAlign: "right", fontWeight: 600 }}>Total requested</td><td className="mono" style={{ textAlign: "right", fontWeight: 600 }}>{kes(a.amount)}</td></tr>
                </tbody>
              </table>
            )}
            <div><label>{approve ? "Note" : "Reason for rejecting"} <span style={{ textTransform: "none", fontWeight: 400, letterSpacing: 0 }}>· optional</span></label>
              <textarea className="field" rows={2} autoFocus value={note} onChange={(e) => setNote(e.target.value)}
                placeholder={approve ? "e.g. Approved — collect from the float before you travel" : "e.g. Use a company card for the hotel instead"} /></div>
            <Note>This is the planned breakdown that builds up the amount. Approving authorises the advance — Finance then issues the cash, and it stays owed by the holder until reconciled on return.</Note>
          </div>
          <div className="mf">
            <button className="btn" onClick={onClose}>Cancel</button>
            <button className={`btn ${approve ? "primary" : ""}`} style={approve ? undefined : { color: "var(--red)" }} onClick={() => onConfirm(a.id, approve, note)}>{approve ? "Approve advance" : "Reject advance"}</button>
          </div>
        </>
      )}
    </ModalShell>
  );
}

// Issue the cash for an approved advance — becomes an open receivable, not project cost.
function AdvanceIssueModal({ adv, onClose, onConfirm }: {
  adv: TravelAdvance | null; onClose: () => void; onConfirm: (ref: string, issueRef: string) => void;
}) {
  const [ref, setRef] = useState("");
  return (
    <ModalShell open={!!adv} onClose={onClose} width={440}>
      {adv && (
        <>
          <div className="mh"><h3>Issue travel advance</h3><p>{adv.holder} · {adv.purpose} · <strong>{kes(adv.amount)}</strong></p></div>
          <div className="mb">
            <div><label>Payment reference <span style={{ textTransform: "none", fontWeight: 400, letterSpacing: 0 }}>· optional</span></label>
              <input className="field" autoFocus placeholder="e.g. M-Pesa code / bank ref" value={ref} onChange={(e) => setRef(e.target.value)} /></div>
            <Note>Records the cash as issued to the holder. It becomes an <strong>open advance</strong> — a receivable owed by them — until they reconcile it. It is <strong>not</strong> a project cost yet.</Note>
          </div>
          <div className="mf"><button className="btn" onClick={onClose}>Cancel</button><button className="btn primary" onClick={() => onConfirm(adv.id, ref)}>Issue advance</button></div>
        </>
      )}
    </ModalShell>
  );
}

// Settle a reconciled advance — confirm the balance was returned / topped up.
function AdvanceSettleModal({ adv, onClose, onConfirm }: {
  adv: TravelAdvance | null; onClose: () => void; onConfirm: (ref: string, note: string) => void;
}) {
  const [note, setNote] = useState("");
  const bal = adv?.balance ?? 0;
  return (
    <ModalShell open={!!adv} onClose={onClose} width={460}>
      {adv && (
        <>
          <div className="mh"><h3>Settle travel advance</h3><p>{adv.holder} · {adv.purpose} · spent {kes(adv.spent ?? 0)} of {kes(adv.amount)}</p></div>
          <div className="mb">
            <div className="reqbox" style={{ background: "#FCFAF6", borderColor: "transparent", color: "var(--ink)" }}>
              <div className="rl">Balance</div>
              <strong>{kes(Math.abs(bal))}</strong> {bal > 0 ? "to be returned by the holder" : bal < 0 ? "to be topped up to the holder" : "— exact, nothing to move"}
            </div>
            <div><label>Note <span style={{ textTransform: "none", fontWeight: 400, letterSpacing: 0 }}>· optional</span></label>
              <input className="field" placeholder={bal > 0 ? "e.g. KES returned to float" : bal < 0 ? "e.g. top-up paid with July payroll" : "e.g. settled, nothing owed"} value={note} onChange={(e) => setNote(e.target.value)} /></div>
            <Note>Confirms the balance was moved. The spent amount is already on the project — settling does not change project cost.</Note>
          </div>
          <div className="mf"><button className="btn" onClick={onClose}>Cancel</button><button className="btn primary" onClick={() => onConfirm(adv.id, note)}>Mark settled</button></div>
        </>
      )}
    </ModalShell>
  );
}

// Super Admin pays or rejects a recurring-bill payment request.
function BillDecideModal({ decision, onClose, onConfirm }: {
  decision: { bill: RecurringBill; approve: boolean } | null;
  onClose: () => void; onConfirm: (ref: string, approve: boolean, paymentRef: string, note: string) => void;
}) {
  const [ref, setRef] = useState("");
  const [note, setNote] = useState("");
  const open = !!decision; const approve = decision?.approve ?? false; const b = decision?.bill;
  return (
    <ModalShell open={open} onClose={onClose} width={460}>
      {b && (
        <>
          <div className="mh"><h3>{approve ? "Pay bill" : "Reject bill payment"}</h3>
            <p>{b.item}{b.vendor ? ` · ${b.vendor}` : ""} · <strong>{kes(b.amount)}</strong>{b.requestedBy ? ` · requested by ${b.requestedBy}` : ""}</p></div>
          <div className="mb">
            {approve
              ? <div><label>Payment reference <span style={{ textTransform: "none", fontWeight: 400, letterSpacing: 0 }}>· optional</span></label>
                  <input className="field" autoFocus placeholder="e.g. M-Pesa code / bank ref" value={ref} onChange={(e) => setRef(e.target.value)} /></div>
              : <div><label>Reason for rejecting <span style={{ textTransform: "none", fontWeight: 400, letterSpacing: 0 }}>· optional</span></label>
                  <textarea className="field" rows={2} autoFocus placeholder="e.g. Query the amount with the vendor first" value={note} onChange={(e) => setNote(e.target.value)} /></div>}
            <Note>HR is notified of the outcome. {approve ? "This records the bill as paid — HR can request it again next month." : ""}</Note>
          </div>
          <div className="mf">
            <button className="btn" onClick={onClose}>Cancel</button>
            <button className={`btn ${approve ? "primary" : ""}`} style={approve ? undefined : { color: "var(--red)" }} onClick={() => onConfirm(b.id, approve, ref, note)}>{approve ? "Mark paid" : "Reject"}</button>
          </div>
        </>
      )}
    </ModalShell>
  );
}

const apPill: Record<string, { cls: string; txt: string }> = {
  captured: { cls: "today", txt: "Captured" },
  matched: { cls: "done", txt: "Matched" },
  approved: { cls: "done", txt: "Approved" },
  exception: { cls: "over", txt: "Exception" },
  paid: { cls: "done", txt: "Paid" },
};

export default function FinanceView() {
  const { tabs, toast, accounts, journals, apInvoices, approveInvoice, payInvoice, openCaptureInvoice, poRows, markInvoicePaid,
    pettyRequests, decidePettyRequest, canDecidePetty, attachPettyInvoice, removePettyInvoice, uploadedFileUrl,
    claims, decideClaim, markClaimPaid, canDecideClaims, perDiemRate, setAppConfig,
    advances, decideAdvance, issueAdvance, settleAdvance, canDecideAdvances,
    recurringBills, decideBill, canApproveBills,
    openInvoice, createCostCentre, me, perms, level } = useApp();
  const tab = tabs.finance;
  const [costOpen, setCostOpen] = useState(false);
  // Finance access: View (1) is read-only; Edit (2) can raise/capture; Full (3) can
  // approve & pay. (Petty-cash approvals keep their own two-stage users:3/hr:2 gate.)
  const finLvl = level("finance");
  const canEdit = finLvl >= 2;
  const canFull = finLvl >= 3;

  // Single-approval petty cash, routed by who raised it (approver_role on the request):
  //   'hr'    → HR (hr>=2) approves a regular employee's request
  //   'super' → a Super Admin (users:3) approves HR's own request
  //   'auto'  → a Super Admin's own request was auto-approved on submit (never pending here)
  // Only the routed role sees Approve; nobody can decide their own request.
  const myPerms = perms[me?.email ?? ""];
  const iAmSuper = (myPerms?.users ?? 0) >= 3;
  const iAmHr = (myPerms?.hr ?? 0) >= 2;
  const canApprovePetty = (r: PettyRequest) =>
    r.requesterEmail !== me?.email &&
    (r.approverRole === "super" ? iAmSuper
      : r.approverRole === "hr" ? iAmHr
      : (iAmSuper || iAmHr)); // legacy rows with no stamped route
  // Who this request is waiting on (shown to approvers who can't act on it).
  const pettyRouteLabel = (r: PettyRequest) => (r.approverRole === "super" ? "Super Admin" : "HR");
  const pettyWaitLabel = (r: PettyRequest) => `Awaiting ${pettyRouteLabel(r)}`;

  const pettyPending = pettyRequests.filter((r) => r.state === "pending");
  const pettyPendingTotal = pettyPending.reduce((s, r) => s + r.amount, 0);

  // Expense claims — same routing model as petty cash (approver_role on the claim).
  const canApproveClaim = (r: ExpenseClaim) =>
    r.requesterEmail !== me?.email &&
    (r.approverRole === "super" ? iAmSuper : r.approverRole === "hr" ? iAmHr : (iAmSuper || iAmHr));
  const claimRouteLabel = (r: ExpenseClaim) => (r.approverRole === "super" ? "Super Admin" : "HR");
  const claimsPending = claims.filter((r) => r.state === "pending");
  const claimsPendingTotal = claimsPending.reduce((s, r) => s + r.total, 0);
  const claimsToPay = claims.filter((r) => r.state === "approved");
  const [claimDecide, setClaimDecide] = useState<{ claim: ExpenseClaim; approve: boolean } | null>(null);
  const [claimPay, setClaimPay] = useState<ExpenseClaim | null>(null);
  // Recurring bills — a Super Admin (users:3) pays or rejects HR's payment requests.
  const billsPending = recurringBills.filter((b) => b.state === "pending");
  const [billDecide, setBillDecide] = useState<{ bill: RecurringBill; approve: boolean } | null>(null);
  const billStatePill: Record<string, { cls: string; txt: string }> = {
    active: { cls: "week", txt: "On the list" }, pending: { cls: "today", txt: "Awaiting payment" },
    paid: { cls: "done", txt: "Paid" }, rejected: { cls: "over", txt: "Rejected" },
  };
  const billCat = (c: string | null) => c ? ({ rent: "Rent", utilities: "Utilities", internet: "Internet / phone", subscription: "Subscription", insurance: "Insurance", other: "Other" } as Record<string, string>)[c] ?? c : "—";
  const [rateDraft, setRateDraft] = useState<string | null>(null);  // per-diem rate inline editor (null = not editing)
  function saveRate() {
    const n = Number(rateDraft);
    if (!(n >= 0)) { toast("Enter a valid rate", "The per-diem daily rate must be a number (KES)"); return; }
    setAppConfig("per_diem_daily_rate", n);
    setRateDraft(null);
  }
  const claimStatePill: Record<string, { cls: string; txt: string }> = {
    pending: { cls: "today", txt: "Pending" }, approved: { cls: "week", txt: "Approved" },
    rejected: { cls: "over", txt: "Rejected" }, paid: { cls: "done", txt: "Reimbursed" }, cancelled: { cls: "week", txt: "Withdrawn" },
  };

  // Travel advances — same routing as claims; the flow adds issue → reconcile → settle.
  const canApproveAdvance = (r: TravelAdvance) =>
    r.holderEmail !== me?.email &&
    (r.approverRole === "super" ? iAmSuper : r.approverRole === "hr" ? iAmHr : (iAmSuper || iAmHr));
  const advanceRouteLabel = (r: TravelAdvance) => (r.approverRole === "super" ? "Super Admin" : "HR");
  const advancesPending = advances.filter((r) => r.state === "pending");
  const advancesToIssue = advances.filter((r) => r.state === "approved");
  const advancesOpen = advances.filter((r) => r.state === "issued");          // issued receivables, awaiting reconcile
  const advancesToSettle = advances.filter((r) => r.state === "reconciled");
  const [advanceDecide, setAdvanceDecide] = useState<{ adv: TravelAdvance; approve: boolean } | null>(null);
  const [advanceIssue, setAdvanceIssue] = useState<TravelAdvance | null>(null);
  const [advanceSettle, setAdvanceSettle] = useState<TravelAdvance | null>(null);
  const advanceStatePill: Record<string, { cls: string; txt: string }> = {
    pending: { cls: "today", txt: "Pending" }, approved: { cls: "week", txt: "Approved" },
    issued: { cls: "today", txt: "Issued (open)" }, reconciled: { cls: "week", txt: "Reconciled" },
    settled: { cls: "done", txt: "Settled" }, rejected: { cls: "over", txt: "Rejected" }, cancelled: { cls: "week", txt: "Withdrawn" },
  };
  const fmtDate = (iso: string | null) => (iso ? new Date(iso + "T00:00:00").toLocaleDateString("en-GB", { day: "numeric", month: "short" }) : "—");
  // which petty-cash request is being approved/rejected — drives the popup (no browser prompts)
  const [pettyDecide, setPettyDecide] = useState<{ req: PettyRequest; approve: boolean } | null>(null);
  // receipts on a filed claim / reconciled advance (line-by-line receipts modal)
  const [receiptsFor, setReceiptsFor] = useState<{ kind: "claim" | "advance"; id: string } | null>(null);
  const pettyStatePill: Record<string, { cls: string; txt: string }> = {
    pending: { cls: "today", txt: "Pending" }, approved: { cls: "done", txt: "Approved" },
    rejected: { cls: "over", txt: "Rejected" }, cancelled: { cls: "week", txt: "Withdrawn" },
  };

  const bal = (code: string) => accounts.find((a) => a.code === code)?.balance ?? 0;
  const sumKind = (k: string) => accounts.filter((a) => a.kind === k).reduce((s, a) => s + a.balance, 0);
  const revenue = sumKind("income");
  const expense = sumKind("expense");
  const cash = bal("1000");
  const apOutstanding = apInvoices.filter((i) => i.state !== "paid").reduce((s, i) => s + i.amount, 0);
  const exceptions = apInvoices.filter((i) => i.state === "exception").length;
  const toApprove = apInvoices.filter((i) => i.state === "matched");
  const toPay = apInvoices.filter((i) => i.state === "approved");
  const invoiceablePOs = poRows.filter((p) => p.state !== "cancelled");

  const genBtn = (label: string, title: string, sub: string) => (
    <div className="recon"><span>{label}</span>
      <button className="btn" style={{ padding: "5px 11px", fontSize: 12 }} onClick={() => toast(title, sub)}>Generate</button>
    </div>
  );

  const pulse = [
    { k: "Revenue", tick: "t-green", v: kes(revenue), d: "posted to date", dc: "flat" as const },
    { k: "Expenses", tick: "t-ember", v: kes(expense), d: "posted to date", dc: "flat" as const },
    { k: "Net", tick: revenue - expense >= 0 ? "t-green" : "t-red", v: kes(revenue - expense), d: "revenue − expense", dc: "flat" as const },
    { k: "Cash on hand", tick: "t-blue", v: kes(cash), d: "ledger balance", dc: "flat" as const },
    { k: "Payables", tick: apOutstanding ? "t-ember" : "t-blue", v: kes(apOutstanding), d: "unpaid invoices", dc: "flat" as const },
    { k: "Match exceptions", tick: exceptions ? "t-red" : "t-blue", v: String(exceptions), d: "payment held", dc: "flat" as const },
  ];

  return (
    <>
      <div className="vhead">
        <div>
          <h1>Finance &amp; Accounting</h1>
          <p>One chart of accounts across the business — every module posts a balanced journal here. Covers GL, payables, receivables, bank &amp; cash, petty cash, costing, tax and audit controls.</p>
        </div>
        <div className="actions">
          {tab === "f-ar" && canEdit && <button className="btn primary" onClick={openInvoice}><PlusI />New invoice</button>}
          {tab === "f-budget" && canEdit && <button className="btn primary" onClick={() => setCostOpen(true)}><PlusI />New cost centre</button>}
          <button className="btn" onClick={() => toast("Period open", "Postings land in the current period until it is closed")}>Current period · Open</button>
        </div>
      </div>
      <Crumb view="finance" />
      <ViewOnly show={finLvl === 1} />

      {tab === "f-over" && (
        <div className="fin-panel active">
          <Pulse data={pulse} />
          <div className="grid g-2" style={{ marginTop: 18 }}>
            <div className="panel">
              <div className="panel-h"><h3>Income statement</h3><span className="meta">from the ledger · KES</span></div>
              {revenue === 0 && expense === 0 ? <EmptyBody>No ledger activity yet.</EmptyBody> : (
                <div className="pad">
                  <div className="recon"><span>Revenue</span><span className="mono">{kes(revenue)}</span></div>
                  <div className="recon"><span>Expenses</span><span className="mono">({kes(expense)})</span></div>
                  <div className="recon"><span><strong>Net surplus / (deficit)</strong></span><span className="mono"><strong>{kes(revenue - expense)}</strong></span></div>
                </div>
              )}
            </div>
            <div className="panel">
              <div className="panel-h"><h3>Approvals waiting on you</h3><span className="meta">match → approve → pay</span></div>
              {toApprove.length === 0 && toPay.length === 0 ? <EmptyBody>Nothing awaiting your approval.</EmptyBody> : <>
                {toApprove.map((i) => (
                  <div className="task" key={i.ref}>
                    <span className="txt">{i.vendor} — {kes(i.amount)}<small>{i.po} · matched</small></span>
                    {i.capturedByMe ? <span className="pill week">you captured</span>
                      : canFull ? <button className="btn primary" style={{ padding: "4px 9px", fontSize: 11 }} onClick={() => approveInvoice(i.ref)}>Approve</button>
                      : <span className="pill">awaiting approval</span>}
                  </div>
                ))}
                {toPay.map((i) => (
                  <div className="task" key={i.ref}>
                    <span className="txt">{i.vendor} — {kes(i.amount)}<small>{i.po} · approved</small></span>
                    {canFull && <button className="btn primary" style={{ padding: "4px 9px", fontSize: 11 }} onClick={() => payInvoice(i.ref, "bank")}>Pay</button>}
                  </div>
                ))}
              </>}
            </div>
          </div>
        </div>
      )}

      {tab === "f-gl" && (
        <div className="fin-panel active">
          <div className="grid g-2">
            <div className="panel">
              <div className="panel-h"><h3>Chart of accounts</h3><span className="meta">balances · KES</span></div>
              {accounts.length === 0 ? <EmptyBody>No balances yet — post a journal to begin.</EmptyBody> : (
                <table className="tbl">
                  <thead><tr><th>Account</th><th>Type</th><th style={{ textAlign: "right" }}>Balance</th></tr></thead>
                  <tbody>
                    {accounts.map((a) => (
                      <tr key={a.code}>
                        <td>{a.name}</td>
                        <td style={{ fontSize: 12, color: "var(--ink-soft)" }}>{a.kind}</td>
                        <td className="mono" style={{ textAlign: "right" }}>{a.balance.toLocaleString()}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
            <div className="panel">
              <div className="panel-h"><h3>Recent journal entries</h3><span className="meta">double-entry · posted</span></div>
              {journals.length === 0 ? <EmptyBody>No journal entries yet.</EmptyBody> : (
                <div className="pad" style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                  {journals.slice(0, 12).map((j) => (
                    <div key={j.ref} style={{ borderBottom: "1px solid var(--line)", paddingBottom: 8 }}>
                      <div style={{ display: "flex", justifyContent: "space-between", fontSize: 12.5 }}>
                        <span style={{ color: "var(--ink-soft)" }}>{j.sourceType}</span>
                      </div>
                      <div style={{ fontSize: 12, color: "var(--ink-soft)", margin: "2px 0 4px" }}>{j.memo}</div>
                      {j.lines.map((l, i) => (
                        <div key={i} style={{ display: "flex", justifyContent: "space-between", fontSize: 11.5, fontFamily: "var(--mono)" }}>
                          <span>{l.account}</span>
                          <span>{l.debit ? "Dr " + l.debit.toLocaleString() : "Cr " + l.credit.toLocaleString()}</span>
                        </div>
                      ))}
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
          <div className="panel" style={{ marginTop: 18 }}>
            <div className="panel-h"><h3>Trial balance</h3><span className="meta">debits = credits</span></div>
            <div className="pad">
              <div className="recon"><span>Total debits</span><span className="mono">{kes(accounts.reduce((s, a) => s + a.debit, 0))}</span></div>
              <div className="recon"><span>Total credits</span><span className="mono">{kes(accounts.reduce((s, a) => s + a.credit, 0))}</span></div>
              <div className="recon"><span>In balance</span><span className={`pill ${Math.round(accounts.reduce((s, a) => s + a.debit - a.credit, 0)) === 0 ? "done" : "over"}`}>{Math.round(accounts.reduce((s, a) => s + a.debit - a.credit, 0)) === 0 ? "Balanced" : "Out"}</span></div>
            </div>
          </div>
        </div>
      )}

      {tab === "f-ap" && (
        <div className="fin-panel active">
          <div className="panel" style={{ marginBottom: 18 }}>
            <div className="panel-h"><h3>Procure-to-pay</h3><span className="meta">three-way match</span></div>
            <div className="pad">
              <div className="steps">
                <div className="step"><span className="sdot">1</span>Purchase order</div><div className="step-arrow" />
                <div className="step"><span className="sdot">2</span>Goods received</div><div className="step-arrow" />
                <div className="step"><span className="sdot">3</span>Supplier invoice</div><div className="step-arrow" />
                <div className="step"><span className="sdot">4</span>Payment</div>
              </div>
            </div>
          </div>
          <div className="grid g-2">
            <div className="panel">
              <div className="panel-h">
                <h3>Supplier invoices</h3>
                <span className="meta">
                  {canEdit && invoiceablePOs.length > 0
                    ? <a href="#" onClick={(e) => { e.preventDefault(); openCaptureInvoice(invoiceablePOs[0]); }} style={{ color: "var(--flame)", textDecoration: "none" }}>+ Capture invoice</a>
                    : <span style={{ color: "var(--ink-soft)" }}>{canEdit ? "no open PO" : ""}</span>}
                </span>
              </div>
              <table className="tbl">
                <thead><tr><th>Vendor</th><th>Amount</th><th>Match</th><th style={{ textAlign: "right" }}>Action</th></tr></thead>
                <tbody>
                  {apInvoices.length === 0 ? (
                    <tr><td colSpan={4} style={{ textAlign: "center", color: "var(--ink-soft)", padding: "18px 0" }}>No supplier invoices yet.</td></tr>
                  ) : apInvoices.map((i) => (
                    <tr key={i.ref}>
                      <td>{i.vendor}</td>
                      <td className="mono">{i.amount.toLocaleString()}</td>
                      <td><span className={`pill ${apPill[i.state]?.cls || "week"}`} title={i.matchNote || ""}>{apPill[i.state]?.txt || i.state}</span></td>
                      <td style={{ textAlign: "right" }}>
                        {i.state === "paid"
                          ? <span className="pill done">Paid</span>
                          : canFull ? <button className="btn primary" style={{ padding: "4px 9px", fontSize: 11 }} title={i.state === "exception" ? (i.matchNote || "Match exception — pay anyway") : "Mark this invoice paid"} onClick={() => markInvoicePaid(i.ref)}>Pay</button>
                          : <span className="pill week">unpaid</span>}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <Note>No payment without a clean three-way match; a mismatch holds until it is investigated.</Note>
            </div>
            <div className="panel">
              <div className="panel-h"><h3>Payables aging</h3><span className="meta">KES</span></div>
              <div className="pad">
                <div className="recon"><span>Captured (matching)</span><span className="mono">{kes(apInvoices.filter((i) => i.state === "captured").reduce((s, i) => s + i.amount, 0))}</span></div>
                <div className="recon"><span>Matched — awaiting approval</span><span className="mono">{kes(toApprove.reduce((s, i) => s + i.amount, 0))}</span></div>
                <div className="recon"><span>Approved — ready to pay</span><span className="mono">{kes(toPay.reduce((s, i) => s + i.amount, 0))}</span></div>
                <div className="recon"><span>Exceptions — held</span><span className="mono">{kes(apInvoices.filter((i) => i.state === "exception").reduce((s, i) => s + i.amount, 0))}</span></div>
                <div className="recon"><span><strong>Outstanding</strong></span><span className="mono"><strong>{kes(apOutstanding)}</strong></span></div>
              </div>
            </div>
          </div>
        </div>
      )}

      {tab === "f-ar" && <Receivables />}

      {tab === "f-bank" && (
        <div className="fin-panel active">
          <div className="panel">
            <div className="panel-h"><h3>Bank &amp; cash</h3><span className="meta">ledger balances</span></div>
            <div className="pad">
              <div className="recon"><span>Cash / bank (1000)</span><span className="mono">{kes(cash)}</span></div>
              <Note>Statement import, auto-match and the cash forecast are a later increment — the ledger cash balance is live now.</Note>
            </div>
          </div>
        </div>
      )}

      {tab === "f-petty" && (
        <div className="fin-panel active">
          <div className="grid g-2">
            <div className="panel">
              <div className="panel-h">
                <h3>Petty-cash requests</h3>
                <span className="meta">{pettyPending.length} awaiting approval{canDecidePetty ? "" : " · view only"}</span>
              </div>
              <table className="tbl">
                <thead><tr><th>Requester</th><th>Item</th><th>Amount</th><th>Route to</th><th style={{ textAlign: "right" }}>Action</th></tr></thead>
                <tbody>
                  {pettyPending.length === 0 ? (
                    <tr><td colSpan={5} style={{ textAlign: "center", color: "var(--ink-soft)", padding: "18px 0" }}>No requests awaiting approval. Staff raise these in the Staff Portal → Petty Cash.</td></tr>
                  ) : pettyPending.map((r) => (
                    <tr key={r.id}>
                      <td>{r.requester}{r.reason ? <small style={{ display: "block", color: "var(--ink-soft)", fontSize: 11 }}>{r.reason}</small> : null}</td>
                      <td>{r.item}{r.project ? <small style={{ display: "block", color: "var(--flame)", fontSize: 11 }}>→ {r.project}</small> : null}</td>
                      <td className="mono">{kes(r.amount)}</td>
                      <td style={{ fontSize: 11 }}>
                        <span className="pill today" title={r.approverRole === "super" ? "HR's own request — a Super Admin approves it" : "A Super Admin or HR approves it"}>→ {pettyRouteLabel(r)}</span>
                      </td>
                      <td style={{ textAlign: "right" }}>
                        {canDecidePetty ? (
                          <span className="row-actions" style={{ display: "inline-flex", gap: 8, justifyContent: "flex-end", flexWrap: "wrap" }}>
                            {canApprovePetty(r)
                              ? <button className="btn primary sm" onClick={() => setPettyDecide({ req: r, approve: true })}>Approve</button>
                              : <span className="pill today" title={`This request is awaiting ${pettyRouteLabel(r)} approval`}>{pettyWaitLabel(r)}</span>}
                            {canApprovePetty(r) && <button className="btn sm" style={{ color: "var(--red)" }} onClick={() => setPettyDecide({ req: r, approve: false })}>Reject</button>}
                          </span>
                        ) : <span className="pill today">Pending</span>}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <Note>Requests come from the Staff Portal and route by who raised them: a staff member's request goes to <strong>HR</strong>; HR's own request goes to a <strong>Super Admin</strong>; a Super Admin's own request is auto-approved. One approval settles it, and you can't decide your own request.</Note>
            </div>
            <div className="panel">
              <div className="panel-h"><h3>Summary</h3><span className="meta">KES</span></div>
              <div className="pad">
                <div className="recon"><span>Awaiting approval</span><span className="mono">{pettyPending.length}</span></div>
                <div className="recon"><span>Value pending</span><span className="mono">{kes(pettyPendingTotal)}</span></div>
                <div className="recon"><span>Approved to date</span><span className="mono">{kes(pettyRequests.filter((r) => r.state === "approved").reduce((s, r) => s + r.amount, 0))}</span></div>
                <div className="recon"><span>Invoices attached</span><span className="mono">{pettyRequests.filter((r) => r.invoicePaths.length).length}</span></div>
              </div>
            </div>
          </div>

          {/* Full history — every request, with invoice attach/view/delete on approved rows */}
          <div className="panel" style={{ marginTop: 18 }}>
            <div className="panel-h"><h3>Petty-cash history</h3><span className="meta">{pettyRequests.length} request{pettyRequests.length === 1 ? "" : "s"} · all statuses</span></div>
            {pettyRequests.length === 0 ? <EmptyBody>No petty-cash requests yet.</EmptyBody> : (
              <table className="tbl">
                <thead><tr><th>Requester</th><th>Item</th><th>Amount</th><th>Status</th><th>Invoices / receipts</th></tr></thead>
                <tbody>
                  {pettyRequests.map((r) => (
                    <tr key={r.id}>
                      <td>{r.requester}</td>
                      <td>{r.item}</td>
                      <td className="mono">{kes(r.amount)}</td>
                      <td><span className={`pill ${pettyStatePill[r.state]?.cls || "today"}`} style={{ textTransform: "none" }} title={r.decidedBy ? `${r.decidedBy}${r.note ? " · " + r.note : ""}` : ""}>{pettyStatePill[r.state]?.txt || r.state}</span></td>
                      <td>
                        {r.state === "approved" && canDecidePetty
                          ? <ReceiptList paths={r.invoicePaths} addLabel={r.invoicePaths.length ? "Attach more" : "Attach invoices"}
                              onAdd={(fs) => attachPettyInvoice(r.id, fs)} onRemove={(p) => removePettyInvoice(r.id, p)} />
                          : r.invoicePaths.length ? <ReceiptList paths={r.invoicePaths} readOnly />
                          : <span style={{ color: "var(--ink-soft)" }}>—</span>}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
            <Note>Once a request is <strong>Approved</strong>, the requester or a Sub Admin can attach one or more invoices/receipts (any file or image). Floats and vouchers build on this queue in a later increment.</Note>
          </div>
        </div>
      )}

      {tab === "f-claims" && (
        <div className="fin-panel active">
          <div className="grid g-2">
            <div className="panel">
              <div className="panel-h">
                <h3>Expense claims</h3>
                <span className="meta">{claimsPending.length} awaiting approval{canDecideClaims ? "" : " · view only"}</span>
              </div>
              <table className="tbl">
                <thead><tr><th>Claimant</th><th>Purpose</th><th>Amount</th><th>Route to</th><th style={{ textAlign: "right" }}>Action</th></tr></thead>
                <tbody>
                  {claimsPending.length === 0 ? (
                    <tr><td colSpan={5} style={{ textAlign: "center", color: "var(--ink-soft)", padding: "18px 0" }}>No claims awaiting approval. Staff file these in the Staff Portal → Expense Claims.</td></tr>
                  ) : claimsPending.map((r) => {
                    const missing = r.lines.filter((l) => !l.isPerDiem && !l.receiptPaths.length).length;
                    return (
                      <tr key={r.id}>
                        <td>{r.requester}{r.project ? <small style={{ display: "block", color: "var(--flame)", fontSize: 11 }}>→ {r.project}</small> : null}</td>
                        <td>{r.purpose}{missing > 0 ? <small style={{ display: "block", color: "var(--red)", fontSize: 11 }}>{missing} receipt{missing > 1 ? "s" : ""} missing</small> : null}</td>
                        <td className="mono">{kes(r.total)}</td>
                        <td style={{ fontSize: 11 }}><span className="pill today">→ {claimRouteLabel(r)}</span></td>
                        <td style={{ textAlign: "right" }}>
                          {canDecideClaims ? (
                            <span className="row-actions" style={{ display: "inline-flex", gap: 8, justifyContent: "flex-end", flexWrap: "wrap" }}>
                              {canApproveClaim(r)
                                ? <button className="btn primary sm" onClick={() => setClaimDecide({ claim: r, approve: true })}>Review</button>
                                : <span className="pill today" title={`This claim is awaiting ${claimRouteLabel(r)} approval`}>Awaiting {claimRouteLabel(r)}</span>}
                              {canApproveClaim(r) && <button className="btn sm" style={{ color: "var(--red)" }} onClick={() => setClaimDecide({ claim: r, approve: false })}>Reject</button>}
                            </span>
                          ) : <span className="pill today">Pending</span>}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
              <Note>Claims come from the Staff Portal and route by who raised them — a staff member's to <strong>HR</strong>, HR's own to a <strong>Super Admin</strong>. You can't decide your own claim. Receipts don't block approval — each line can carry several, added by the claimant or HR at any time.</Note>
            </div>
            <div className="panel">
              <div className="panel-h"><h3>Summary</h3><span className="meta">KES</span></div>
              <div className="pad">
                <div className="recon"><span>Awaiting approval</span><span className="mono">{claimsPending.length}</span></div>
                <div className="recon"><span>Value pending</span><span className="mono">{kes(claimsPendingTotal)}</span></div>
                <div className="recon"><span>Approved — awaiting payment</span><span className="mono">{kes(claimsToPay.reduce((s, r) => s + r.total, 0))}</span></div>
                <div className="recon"><span>Reimbursed to date</span><span className="mono">{kes(claims.filter((r) => r.state === "paid").reduce((s, r) => s + r.total, 0))}</span></div>
                <div className="recon" style={{ borderTop: "1px solid var(--hairline)", marginTop: 6, paddingTop: 10 }}>
                  <span>Per-diem rate / day</span>
                  {rateDraft === null ? (
                    <span className="mono" style={{ display: "inline-flex", gap: 8, alignItems: "center" }}>
                      {kes(perDiemRate)}
                      {canEdit && <a href="#" onClick={(e) => { e.preventDefault(); setRateDraft(String(perDiemRate)); }} style={{ color: "var(--flame)", textDecoration: "none", fontSize: 11.5 }}>Edit</a>}
                    </span>
                  ) : (
                    <span style={{ display: "inline-flex", gap: 6, alignItems: "center" }}>
                      <input className="field" type="number" min="0" value={rateDraft} onChange={(e) => setRateDraft(e.target.value)} style={{ width: 110, padding: "3px 8px" }} autoFocus />
                      <button className="btn primary sm" onClick={saveRate}>Save</button>
                      <button className="btn sm" onClick={() => setRateDraft(null)}>Cancel</button>
                    </span>
                  )}
                </div>
                <Note>The per-diem rate is configuration — changing it here applies to new claims; existing claims keep the rate they were filed at.</Note>
              </div>
            </div>
          </div>

          {/* Full history — approved claims can be marked paid here */}
          <div className="panel" style={{ marginTop: 18 }}>
            <div className="panel-h"><h3>Claims history</h3><span className="meta">{claims.length} claim{claims.length === 1 ? "" : "s"} · all statuses</span></div>
            {claims.length === 0 ? <EmptyBody>No expense claims yet.</EmptyBody> : (
              <table className="tbl">
                <thead><tr><th>Claimant</th><th>Purpose</th><th>Project</th><th>Amount</th><th>Status</th><th style={{ textAlign: "right" }}>Action</th></tr></thead>
                <tbody>
                  {claims.map((r) => (
                    <tr key={r.id}>
                      <td>{r.requester}</td>
                      <td>{r.purpose}{r.advance ? <small style={{ display: "block", color: "var(--flame)", fontSize: 11 }}>→ advance {r.advance}</small> : null}</td>
                      <td style={{ fontSize: 12, color: "var(--ink-soft)" }}>{r.project || "—"}</td>
                      <td className="mono">{kes(r.total)}</td>
                      <td><span className={`pill ${claimStatePill[r.state]?.cls || "today"}`} style={{ textTransform: "none" }} title={r.state === "paid" && r.paymentRef ? `Ref ${r.paymentRef}` : r.decidedBy ? `${r.decidedBy}${r.note ? " · " + r.note : ""}` : ""}>{claimStatePill[r.state]?.txt || r.state}</span></td>
                      <td style={{ textAlign: "right" }}>
                        <span style={{ display: "inline-flex", gap: 8, alignItems: "center", justifyContent: "flex-end" }}>
                          {canDecideClaims && r.state !== "cancelled" && (
                            <button className="btn" style={{ padding: "4px 10px", fontSize: 11.5 }} onClick={() => setReceiptsFor({ kind: "claim", id: r.id })}
                              title="Attach or view receipts">Receipts{(() => { const n = r.lines.reduce((s, l) => s + l.receiptPaths.length, 0); return n ? ` (${n})` : ""; })()}</button>
                          )}
                          {r.state === "approved" && canEdit
                            ? <button className="btn primary" style={{ padding: "4px 10px", fontSize: 11.5 }} onClick={() => setClaimPay(r)}>Mark paid</button>
                            : r.state === "paid"
                              ? <span className="meta">{r.paidBy ? `Paid · ${r.paidBy}` : "Reimbursed"}</span>
                              : null}
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
            <Note>An approved claim is already coded to its project's actuals; <strong>Mark paid</strong> records the reimbursement to the claimant and does not change the project cost.</Note>
          </div>
        </div>
      )}

      {tab === "f-advances" && (
        <div className="fin-panel active">
          <div className="grid g-2">
            <div className="panel">
              <div className="panel-h">
                <h3>Travel advances</h3>
                <span className="meta">{advancesPending.length} to approve · {advancesToIssue.length} to issue · {advancesToSettle.length} to settle{canDecideAdvances ? "" : " · view only"}</span>
              </div>
              <table className="tbl">
                <thead><tr><th>Holder</th><th>Purpose</th><th>Amount</th><th>Stage</th><th style={{ textAlign: "right" }}>Action</th></tr></thead>
                <tbody>
                  {advancesPending.length + advancesToIssue.length + advancesToSettle.length === 0 ? (
                    <tr><td colSpan={5} style={{ textAlign: "center", color: "var(--ink-soft)", padding: "18px 0" }}>Nothing needs action. Staff request advances in the Staff Portal → Travel Advances.</td></tr>
                  ) : (
                    <>
                      {advancesPending.map((r) => (
                        <tr key={r.id}>
                          <td>{r.holder}{r.project ? <small style={{ display: "block", color: "var(--flame)", fontSize: 11 }}>→ {r.project}</small> : null}</td>
                          <td>{r.purpose}</td>
                          <td className="mono">{kes(r.amount)}</td>
                          <td style={{ fontSize: 11 }}><span className="pill today">→ approve · {advanceRouteLabel(r)}</span></td>
                          <td style={{ textAlign: "right" }}>
                            {canDecideAdvances ? (
                              <span className="row-actions" style={{ display: "inline-flex", gap: 8, justifyContent: "flex-end", flexWrap: "wrap" }}>
                                {canApproveAdvance(r)
                                  ? <><button className="btn primary sm" onClick={() => setAdvanceDecide({ adv: r, approve: true })}>Approve</button>
                                     <button className="btn sm" style={{ color: "var(--red)" }} onClick={() => setAdvanceDecide({ adv: r, approve: false })}>Reject</button></>
                                  : <span className="pill today">Awaiting {advanceRouteLabel(r)}</span>}
                              </span>
                            ) : <span className="pill today">Pending</span>}
                          </td>
                        </tr>
                      ))}
                      {advancesToIssue.map((r) => (
                        <tr key={r.id}>
                          <td>{r.holder}</td>
                          <td>{r.purpose}</td>
                          <td className="mono">{kes(r.amount)}</td>
                          <td style={{ fontSize: 11 }}><span className="pill week">→ issue cash</span></td>
                          <td style={{ textAlign: "right" }}>{canEdit ? <button className="btn primary sm" onClick={() => setAdvanceIssue(r)}>Issue</button> : <span className="pill week">approved</span>}</td>
                        </tr>
                      ))}
                      {advancesToSettle.map((r) => (
                        <tr key={r.id}>
                          <td>{r.holder}</td>
                          <td>{r.purpose}<small style={{ display: "block", color: "var(--ink-soft)", fontSize: 11 }}>spent {kes(r.spent ?? 0)} · balance {kes(Math.abs(r.balance ?? 0))} {(r.balance ?? 0) > 0 ? "to return" : (r.balance ?? 0) < 0 ? "top-up" : ""}</small></td>
                          <td className="mono">{kes(r.amount)}</td>
                          <td style={{ fontSize: 11 }}><span className="pill week">→ settle balance</span></td>
                          <td style={{ textAlign: "right" }}>{canEdit ? <button className="btn primary sm" onClick={() => setAdvanceSettle(r)}>Settle</button> : <span className="pill week">reconciled</span>}</td>
                        </tr>
                      ))}
                    </>
                  )}
                </tbody>
              </table>
              <Note>The flow is <strong>approve → issue → (holder reconciles) → settle</strong>. An issued advance is a receivable owed by the holder — it only becomes project cost when the holder reconciles it, and only for what they actually spent.</Note>
            </div>
            <div className="panel">
              <div className="panel-h"><h3>Summary</h3><span className="meta">KES</span></div>
              <div className="pad">
                <div className="recon"><span>To approve</span><span className="mono">{advancesPending.length}</span></div>
                <div className="recon"><span>Approved — to issue</span><span className="mono">{kes(advancesToIssue.reduce((s, r) => s + r.amount, 0))}</span></div>
                <div className="recon"><span>Open advances (receivable)</span><span className="mono">{kes(advancesOpen.reduce((s, r) => s + r.amount, 0))}</span></div>
                <div className="recon"><span>Awaiting settlement</span><span className="mono">{advancesToSettle.length}</span></div>
                <div className="recon"><span>Settled to date</span><span className="mono">{kes(advances.filter((r) => r.state === "settled").reduce((s, r) => s + (r.spent ?? 0), 0))}</span></div>
              </div>
            </div>
          </div>

          {/* Full history */}
          <div className="panel" style={{ marginTop: 18 }}>
            <div className="panel-h"><h3>Advance history</h3><span className="meta">{advances.length} advance{advances.length === 1 ? "" : "s"} · all stages</span></div>
            {advances.length === 0 ? <EmptyBody>No travel advances yet.</EmptyBody> : (
              <table className="tbl">
                <thead><tr><th>Holder</th><th>Purpose</th><th>Project</th><th>Amount</th><th>Spent</th><th>Balance</th><th>Stage</th><th style={{ textAlign: "right" }}>Receipts</th></tr></thead>
                <tbody>
                  {advances.map((r) => (
                    <tr key={r.id}>
                      <td>{r.holder}</td>
                      <td>{r.purpose}</td>
                      <td style={{ fontSize: 12, color: "var(--ink-soft)" }}>{r.project || "—"}</td>
                      <td className="mono">{kes(r.amount)}</td>
                      <td className="mono">{r.spent != null ? kes(r.spent) : "—"}</td>
                      <td className="mono">{r.balance != null ? kes(r.balance) : "—"}</td>
                      <td><span className={`pill ${advanceStatePill[r.state]?.cls || "today"}`} style={{ textTransform: "none" }} title={r.state === "rejected" && r.note ? r.note : r.issueRef ? `Issue ref ${r.issueRef}` : ""}>{advanceStatePill[r.state]?.txt || r.state}</span></td>
                      <td style={{ textAlign: "right" }}>
                        {r.lines.length > 0 && (canDecideAdvances || canEdit)
                          ? <button className="btn" style={{ padding: "4px 10px", fontSize: 11.5 }} onClick={() => setReceiptsFor({ kind: "advance", id: r.id })}>
                              {(() => { const n = r.lines.reduce((s, l) => s + l.receiptPaths.length, 0); return n ? `View (${n})` : "Attach"; })()}
                            </button>
                          : <span className="meta">—</span>}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
            <Note>Open advances sit as a receivable from the holder until reconciled — the discipline that stops an unspent advance ever overstating a project's cost.</Note>
          </div>
        </div>
      )}

      {tab === "f-bills" && (
        <div className="fin-panel active">
          <div className="grid g-2">
            <div className="panel">
              <div className="panel-h">
                <h3>Bill payments to make</h3>
                <span className="meta">{billsPending.length} awaiting payment{canApproveBills ? "" : " · Super Admin only"}</span>
              </div>
              <table className="tbl">
                <thead><tr><th>Item</th><th>Category</th><th>Requested by</th><th>Amount</th><th style={{ textAlign: "right" }}>Action</th></tr></thead>
                <tbody>
                  {billsPending.length === 0 ? (
                    <tr><td colSpan={5} style={{ textAlign: "center", color: "var(--ink-soft)", padding: "18px 0" }}>No bills awaiting payment. HR raises these in HR → Recurring Bills.</td></tr>
                  ) : billsPending.map((b) => (
                    <tr key={b.id}>
                      <td>{b.item}{b.vendor ? <small style={{ display: "block", color: "var(--ink-soft)", fontSize: 11 }}>{b.vendor}</small> : null}</td>
                      <td style={{ fontSize: 12 }}>{billCat(b.category)}</td>
                      <td style={{ fontSize: 12 }}>{b.requestedBy || "—"}</td>
                      <td className="mono">{kes(b.amount)}</td>
                      <td style={{ textAlign: "right" }}>
                        {canApproveBills ? (
                          <span className="row-actions" style={{ display: "inline-flex", gap: 8, justifyContent: "flex-end", flexWrap: "wrap" }}>
                            <button className="btn primary sm" onClick={() => setBillDecide({ bill: b, approve: true })}>Pay</button>
                            <button className="btn sm" style={{ color: "var(--red)" }} onClick={() => setBillDecide({ bill: b, approve: false })}>Reject</button>
                          </span>
                        ) : <span className="pill today">Pending</span>}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <Note>HR keeps the recurring bills and requests payment when each is due. As a Super Admin you pay or reject here; HR is notified either way and can request a paid bill again next month.</Note>
            </div>
            <div className="panel">
              <div className="panel-h"><h3>Summary</h3><span className="meta">KES</span></div>
              <div className="pad">
                <div className="recon"><span>Awaiting payment</span><span className="mono">{billsPending.length}</span></div>
                <div className="recon"><span>Value pending</span><span className="mono">{kes(billsPending.reduce((s, b) => s + b.amount, 0))}</span></div>
                <div className="recon"><span>Bills on the list</span><span className="mono">{recurringBills.length}</span></div>
                <div className="recon"><span>Paid to date</span><span className="mono">{kes(recurringBills.filter((b) => b.state === "paid").reduce((s, b) => s + b.amount, 0))}</span></div>
              </div>
            </div>
          </div>

          <div className="panel" style={{ marginTop: 18 }}>
            <div className="panel-h"><h3>All recurring bills</h3><span className="meta">{recurringBills.length} bill{recurringBills.length === 1 ? "" : "s"}</span></div>
            {recurringBills.length === 0 ? <EmptyBody>No recurring bills yet.</EmptyBody> : (
              <table className="tbl">
                <thead><tr><th>Item</th><th>Category</th><th>Due</th><th>Amount</th><th>Status</th></tr></thead>
                <tbody>
                  {recurringBills.map((b) => (
                    <tr key={b.id}>
                      <td>{b.item}</td>
                      <td style={{ fontSize: 12, color: "var(--ink-soft)" }}>{billCat(b.category)}</td>
                      <td style={{ fontSize: 12, color: "var(--ink-soft)" }}>{b.dueDay ? `Day ${b.dueDay}` : "—"}</td>
                      <td className="mono">{kes(b.amount)}</td>
                      <td><span className={`pill ${billStatePill[b.state]?.cls || "week"}`} style={{ textTransform: "none" }} title={b.state === "paid" && b.paymentRef ? `Ref ${b.paymentRef}` : b.state === "rejected" && b.decisionNote ? b.decisionNote : ""}>{billStatePill[b.state]?.txt || b.state}</span></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </div>
      )}

      {tab === "f-budget" && (
        <div className="fin-panel active">
          <div className="panel">
            <div className="panel-h"><h3>Budget vs actual by cost centre</h3><span className="meta">committed + actual · % of budget</span></div>
            <table className="tbl">
              <thead><tr><th>Budget line</th><th>Budget</th><th>Used</th><th>Remaining</th><th>Utilisation</th></tr></thead>
              <tbody>
                {Object.entries(budgetLines).map(([code, l]) => {
                  const pct = l.b ? Math.round((l.u / l.b) * 100) : 0;
                  return (
                    <tr key={code}>
                      <td>{code}</td>
                      <td className="mono">{l.b.toLocaleString()}</td>
                      <td className="mono">{l.u.toLocaleString()}</td>
                      <td className="mono">{(l.b - l.u).toLocaleString()}</td>
                      <td><span className={`pill ${pct >= 100 ? "over" : pct >= 80 ? "today" : "done"}`}>{pct}%</span></td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
            <Note>This is the figure the requisition budget check reads against — committed at requisition, moved to actual on payment.</Note>
          </div>
        </div>
      )}

      {tab === "f-report" && (
        <div className="fin-panel active">
          <div className="grid g-2">
            <div className="panel">
              <div className="panel-h"><h3>Standard reports</h3><span className="meta">one click · from live data</span></div>
              {genBtn("Income statement (P&L)", "Generating P&L", "From live ledger")}
              {genBtn("Balance sheet", "Generating balance sheet", "As at period end")}
              {genBtn("Cash flow statement", "Generating cash flow", "Direct method")}
              {genBtn("Trial balance", "Generating trial balance", "In balance")}
              {genBtn("Management / board pack", "Generating board pack", "Narrative drafted via Claude API")}
            </div>
            <div>
              <div className="panel" style={{ marginBottom: 18 }}>
                <div className="panel-h"><h3>Tax &amp; statutory</h3><span className="meta">Kenya</span></div>
                <div className="pad">
                  <div className="recon"><span>Output VAT (2100)</span><span className="mono">{kes(bal("2100"))}</span></div>
                  <div className="recon"><span>eTIMS</span><span className="pill done">Filed on issue</span></div>
                  <Note noBorder>PAYE, NSSF, SHIF, Housing Levy and withholding returns come from payroll + AP data — a later increment builds the return forms.</Note>
                </div>
              </div>
              <div className="panel">
                <div className="panel-h"><h3>Multi-currency &amp; audit</h3><span className="meta">consolidation-ready</span></div>
                <div className="recon"><span>Reporting currencies</span><span className="mono">KES · USD · UGX</span></div>
                <div className="recon"><span>Segregation of duties</span><span className="pill done">Enforced</span></div>
                <div className="recon"><span>IFRS for SMEs</span><span className="pill done">Applied</span></div>
              </div>
            </div>
          </div>
        </div>
      )}

      <PettyDecideModal
        key={pettyDecide ? pettyDecide.req.id + (pettyDecide.approve ? "-a" : "-r") : "none"}
        decision={pettyDecide}
        onClose={() => setPettyDecide(null)}
        onConfirm={(ref, approve, note) => { decidePettyRequest(ref, approve, note); setPettyDecide(null); }}
      />

      <ClaimDecideModal
        key={claimDecide ? claimDecide.claim.id + (claimDecide.approve ? "-a" : "-r") : "claim-none"}
        decision={claimDecide}
        onClose={() => setClaimDecide(null)}
        onConfirm={(ref, approve, note) => { decideClaim(ref, approve, note); setClaimDecide(null); }}
      />

      <ClaimPayModal
        key={claimPay ? claimPay.id : "pay-none"}
        claim={claimPay}
        onClose={() => setClaimPay(null)}
        onConfirm={(ref, paymentRef) => { markClaimPaid(ref, paymentRef); setClaimPay(null); }}
      />

      <AdvanceDecideModal
        key={advanceDecide ? advanceDecide.adv.id + (advanceDecide.approve ? "-a" : "-r") : "adv-none"}
        decision={advanceDecide}
        onClose={() => setAdvanceDecide(null)}
        onConfirm={(ref, approve, note) => { decideAdvance(ref, approve, note); setAdvanceDecide(null); }}
      />
      <AdvanceIssueModal
        key={advanceIssue ? advanceIssue.id : "issue-none"}
        adv={advanceIssue}
        onClose={() => setAdvanceIssue(null)}
        onConfirm={(ref, issueRef) => { issueAdvance(ref, issueRef); setAdvanceIssue(null); }}
      />
      <AdvanceSettleModal
        key={advanceSettle ? advanceSettle.id : "settle-none"}
        adv={advanceSettle}
        onClose={() => setAdvanceSettle(null)}
        onConfirm={(ref, note) => { settleAdvance(ref, note); setAdvanceSettle(null); }}
      />
      <LineReceiptsModal kind={receiptsFor?.kind ?? "claim"} id={receiptsFor?.id ?? null} onClose={() => setReceiptsFor(null)} />

      <BillDecideModal
        key={billDecide ? billDecide.bill.id + (billDecide.approve ? "-p" : "-r") : "bill-none"}
        decision={billDecide}
        onClose={() => setBillDecide(null)}
        onConfirm={(ref, approve, paymentRef, note) => { decideBill(ref, approve, paymentRef, note); setBillDecide(null); }}
      />

      <CostCentreModal
        key={costOpen ? "cost-open" : "cost-closed"}
        open={costOpen}
        onClose={() => setCostOpen(false)}
        onSave={(name, budget) => {
          if (!name) { toast("Name the cost centre", "e.g. Field / MRV"); return; }
          if (!budget || budget <= 0) { toast("Enter a budget", "How much is allocated to this line? (KES)"); return; }
          createCostCentre(name, budget);
          setCostOpen(false);
        }}
      />
    </>
  );
}

function Receivables() {
  const { newInvoices, openReceipt, level, proformas, openProforma, openProformaRec } = useApp();
  const canEdit = level("finance") >= 2;
  const outstanding = newInvoices.filter((i) => i.pillTxt !== "Paid");
  const [pfFilter, setPfFilter] = useState("all");
  // register filters map to the display status text set in bootstrap()
  const pfFilters: [string, string][] = [
    ["all", "All"], ["Awaiting", "Awaiting response"], ["Accepted", "Accepted"],
    ["Declined", "Declined"], ["Expired", "Lapsed / expired"],
  ];
  const pfMatches = (s: string, f: string) =>
    f === "all" ? true : f === "Expired" ? (s === "Expired" || s === "Lapsed") : s === f;
  const pfRows = proformas.filter((p) => pfMatches(p.statusTxt, pfFilter));
  const accepted = proformas.filter((p) => p.state === "accepted").length;
  return (
    <div className="fin-panel active">
      <div className="panel" style={{ marginBottom: 18 }}>
        <div className="panel-h"><h3>Order-to-cash</h3><span className="meta">proforma is an offer · tax invoice is the sale</span></div>
        <div className="pad">
          <div className="steps">
            <div className="step done"><span className="sdot">1</span>Proforma issued</div><div className="step-arrow" />
            <div className="step now"><span className="sdot">2</span>Accepted</div><div className="step-arrow" />
            <div className="step"><span className="sdot">3</span>Tax invoice + eTIMS</div><div className="step-arrow" />
            <div className="step"><span className="sdot">4</span>Receipt</div>
          </div>
          <div style={{ padding: "8px 2px 0", fontSize: 12, color: "var(--ink-soft)" }}>A proforma is a quote, not revenue. Nothing posts to the ledger and no VAT is due until it's accepted and converted to a tax invoice. The register tracks issued, accepted, declined and expired.</div>
        </div>
      </div>

      <div className="panel" style={{ marginBottom: 18 }}>
        <div className="panel-h">
          <h3>Proforma invoices</h3>
          {canEdit
            ? <span className="meta"><a role="button" tabIndex={0} onClick={openProforma} onKeyDown={(e) => { if (e.key === "Enter") openProforma(); }} style={{ color: "var(--flame)", textDecoration: "none", cursor: "pointer" }}>+ Raise proforma</a></span>
            : <span className="meta">offer · not revenue</span>}
        </div>
        <div style={{ padding: "10px 18px 4px", display: "flex", gap: 7, flexWrap: "wrap" }}>
          {pfFilters.map(([k, l]) => (
            <button key={k} className={`btn sm ${pfFilter === k ? "primary" : ""}`} onClick={() => setPfFilter(k)}>{l}</button>
          ))}
        </div>
        <table className="tbl">
          <thead><tr><th>Customer</th><th>Value</th><th>Valid to</th><th>Status</th></tr></thead>
          <tbody>
            {pfRows.length === 0 ? (
              <tr><td colSpan={4} style={{ padding: "16px 18px", color: "var(--ink-soft)", fontSize: 12.5 }}>{proformas.length === 0 ? "No proformas yet — use “+ Raise proforma”." : "None in this view."}</td></tr>
            ) : pfRows.map((p) => (
              <tr key={p.ref} style={{ cursor: "pointer" }} onClick={() => openProformaRec(p.ref)}>
                <td><strong>{p.customer}</strong></td>
                <td className="mono">{kes(p.subtotal)}</td>
                <td className="mono">{p.validTo}</td>
                <td><span className={`pill ${p.statusCls}`}>{p.statusTxt}</span></td>
              </tr>
            ))}
          </tbody>
        </table>
        <div style={{ padding: "12px 18px", fontSize: 12, color: "var(--ink-soft)", borderTop: "1px solid var(--hairline)" }}>
          {proformas.length > 0 && <strong style={{ color: "var(--ink)" }}>Conversion: {accepted} of {proformas.length} accepted ({Math.round((accepted / proformas.length) * 100)}%). </strong>}
          Click a proforma to open it, accept it into a tax invoice, or record why it was declined.
        </div>
      </div>

      <div className="grid g-2">
        <div className="panel">
          <div className="panel-h">
            <h3>Customer invoices</h3>
            <span className="meta">issue · file eTIMS · collect</span>
          </div>
          <table className="tbl">
            <thead><tr><th>Institution</th><th>Amount</th><th>eTIMS</th><th>Due</th><th style={{ textAlign: "right" }}>Action</th></tr></thead>
            <tbody>
              {newInvoices.length === 0 ? (
                <tr><td colSpan={5} style={{ textAlign: "center", color: "var(--ink-soft)", padding: "18px 0" }}>No customer invoices yet — use “+ New invoice”.</td></tr>
              ) : newInvoices.map((inv) => (
                <tr key={inv.id}>
                  <td>{inv.cust}</td>
                  <td className="mono">{inv.tot.toLocaleString()}</td>
                  <td><span className="rcv ok">filed ✓</span></td>
                  <td><span className={`pill ${inv.pillCls}`}>{inv.pillTxt}</span></td>
                  <td style={{ textAlign: "right" }}>
                    {inv.pillTxt === "Paid"
                      ? <span className="pill done">Settled</span>
                      : canEdit ? <button className="btn primary" style={{ padding: "4px 9px", fontSize: 11 }} onClick={() => openReceipt(inv)}>Record receipt</button>
                      : <span className="pill week">outstanding</span>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="panel">
          <div className="panel-h"><h3>Debtor aging</h3><span className="meta">KES</span></div>
          <div className="pad">
            <div className="recon"><span>Outstanding invoices</span><span className="mono">{outstanding.length}</span></div>
            <div className="recon"><span>Outstanding value</span><span className="mono">{kes(outstanding.reduce((s, i) => s + i.tot, 0))}</span></div>
            <Note>A receipt posts cash and clears the receivable; part-payments are a later increment.</Note>
          </div>
        </div>
      </div>
    </div>
  );
}
