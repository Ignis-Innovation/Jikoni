import { useState, type ReactNode } from "react";
import { useApp, type PettyRequest } from "../store";
import { Pulse, Note } from "../components/ui";
import { ModalShell } from "../components/modals";
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

const apPill: Record<string, { cls: string; txt: string }> = {
  captured: { cls: "today", txt: "Captured" },
  matched: { cls: "done", txt: "Matched" },
  approved: { cls: "done", txt: "Approved" },
  exception: { cls: "over", txt: "Exception" },
  paid: { cls: "done", txt: "Paid" },
};

export default function FinanceView() {
  const { tabs, toast, accounts, journals, apInvoices, approveInvoice, payInvoice, openCaptureInvoice, poRows, markInvoicePaid,
    pettyRequests, decidePettyRequest, canDecidePetty, openInvoice, createCostCentre, me, perms } = useApp();
  const tab = tabs.finance;
  const [costOpen, setCostOpen] = useState(false);

  // Two-stage petty cash: a request needs a Super Admin (users:3) AND HR (hr>=2)
  // approval, by two different people. Show each approver only the stage they can act on.
  const myPerms = perms[me?.email ?? ""];
  const iAmSuper = (myPerms?.users ?? 0) >= 3;
  const iAmHr = (myPerms?.hr ?? 0) >= 2;
  const canApproveSuper = (r: PettyRequest) => iAmSuper && !r.superApprovedBy && r.hrApprovedBy !== me?.name;
  const canApproveHr = (r: PettyRequest) => iAmHr && !r.hrApprovedBy && r.superApprovedBy !== me?.name;
  const canApprovePetty = (r: PettyRequest) => canApproveSuper(r) || canApproveHr(r);

  const pettyPending = pettyRequests.filter((r) => r.state === "pending");
  const pettyDecided = pettyRequests.filter((r) => r.state === "approved" || r.state === "rejected");
  const pettyPendingTotal = pettyPending.reduce((s, r) => s + r.amount, 0);
  const fmtDate = (iso: string | null) => (iso ? new Date(iso + "T00:00:00").toLocaleDateString("en-GB", { day: "numeric", month: "short" }) : "—");
  // which petty-cash request is being approved/rejected — drives the popup (no browser prompts)
  const [pettyDecide, setPettyDecide] = useState<{ req: PettyRequest; approve: boolean } | null>(null);

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
          {tab === "f-ar" && <button className="btn primary" onClick={openInvoice}><PlusI />New invoice</button>}
          {tab === "f-budget" && <button className="btn primary" onClick={() => setCostOpen(true)}><PlusI />New cost centre</button>}
          <button className="btn" onClick={() => toast("Period open", "Postings land in the current period until it is closed")}>Current period · Open</button>
        </div>
      </div>
      <Crumb view="finance" />

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
                    <span className="id" style={{ color: "var(--green)" }}>{i.ref}</span>
                    <span className="txt">{i.vendor} — {kes(i.amount)}<small>{i.po} · matched</small></span>
                    {i.capturedByMe ? <span className="pill week">you captured</span>
                      : <button className="btn primary" style={{ padding: "4px 9px", fontSize: 11 }} onClick={() => approveInvoice(i.ref)}>Approve</button>}
                  </div>
                ))}
                {toPay.map((i) => (
                  <div className="task" key={i.ref}>
                    <span className="id" style={{ color: "var(--green)" }}>{i.ref}</span>
                    <span className="txt">{i.vendor} — {kes(i.amount)}<small>{i.po} · approved</small></span>
                    <button className="btn primary" style={{ padding: "4px 9px", fontSize: 11 }} onClick={() => payInvoice(i.ref, "bank")}>Pay</button>
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
                  <thead><tr><th>Code</th><th>Account</th><th>Type</th><th style={{ textAlign: "right" }}>Balance</th></tr></thead>
                  <tbody>
                    {accounts.map((a) => (
                      <tr key={a.code}>
                        <td className="mono">{a.code}</td>
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
                        <strong className="mono">{j.ref}</strong>
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
                  {invoiceablePOs.length > 0
                    ? <a href="#" onClick={(e) => { e.preventDefault(); openCaptureInvoice(invoiceablePOs[0]); }} style={{ color: "var(--flame)", textDecoration: "none" }}>+ Capture invoice</a>
                    : <span style={{ color: "var(--ink-soft)" }}>no open PO</span>}
                </span>
              </div>
              <table className="tbl">
                <thead><tr><th>Invoice</th><th>Vendor</th><th>Amount</th><th>Match</th><th style={{ textAlign: "right" }}>Action</th></tr></thead>
                <tbody>
                  {apInvoices.length === 0 ? (
                    <tr><td colSpan={5} style={{ textAlign: "center", color: "var(--ink-soft)", padding: "18px 0" }}>No supplier invoices yet.</td></tr>
                  ) : apInvoices.map((i) => (
                    <tr key={i.ref}>
                      <td className="mono">{i.ref}</td>
                      <td>{i.vendor}</td>
                      <td className="mono">{i.amount.toLocaleString()}</td>
                      <td><span className={`pill ${apPill[i.state]?.cls || "week"}`} title={i.matchNote || ""}>{apPill[i.state]?.txt || i.state}</span></td>
                      <td style={{ textAlign: "right" }}>
                        {i.state === "paid"
                          ? <span className="pill done">Paid</span>
                          : <button className="btn primary" style={{ padding: "4px 9px", fontSize: 11 }} title={i.state === "exception" ? (i.matchNote || "Match exception — pay anyway") : "Mark this invoice paid"} onClick={() => markInvoicePaid(i.ref)}>Pay</button>}
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
                <thead><tr><th>Ref</th><th>Requester</th><th>Item</th><th>Amount</th><th>Approvals</th><th style={{ textAlign: "right" }}>Action</th></tr></thead>
                <tbody>
                  {pettyPending.length === 0 ? (
                    <tr><td colSpan={6} style={{ textAlign: "center", color: "var(--ink-soft)", padding: "18px 0" }}>No requests awaiting approval. Staff raise these in the Staff Portal → Petty Cash.</td></tr>
                  ) : pettyPending.map((r) => (
                    <tr key={r.id}>
                      <td className="mono">{r.id}</td>
                      <td>{r.requester}{r.reason ? <small style={{ display: "block", color: "var(--ink-soft)", fontSize: 11 }}>{r.reason}</small> : null}</td>
                      <td>{r.item}</td>
                      <td className="mono">{kes(r.amount)}</td>
                      <td style={{ fontSize: 11 }}>
                        <span className={`pill ${r.superApprovedBy ? "done" : "today"}`} title={r.superApprovedBy || "Awaiting a Super Admin"}>Super {r.superApprovedBy ? "✓" : "•"}</span>
                        {" "}
                        <span className={`pill ${r.hrApprovedBy ? "done" : "today"}`} title={r.hrApprovedBy || "Awaiting HR"}>HR {r.hrApprovedBy ? "✓" : "•"}</span>
                      </td>
                      <td style={{ textAlign: "right" }}>
                        {canDecidePetty ? (
                          <span style={{ display: "inline-flex", gap: 8, justifyContent: "flex-end" }}>
                            {canApprovePetty(r)
                              ? <button className="btn primary" style={{ padding: "4px 9px", fontSize: 11 }} onClick={() => setPettyDecide({ req: r, approve: true })}>Approve</button>
                              : <span className="pill today" title="Waiting on the other approver">Waiting</span>}
                            <button className="btn" style={{ padding: "4px 9px", fontSize: 11, color: "var(--red)" }} onClick={() => setPettyDecide({ req: r, approve: false })}>Reject</button>
                          </span>
                        ) : <span className="pill today">Pending</span>}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <Note>Requests come from the Staff Portal. Each needs a Super Admin <strong>and</strong> HR to approve (two different people, either order); either can reject. A request can't be approved by the person who raised it.</Note>
            </div>
            <div className="panel">
              <div className="panel-h"><h3>Summary</h3><span className="meta">KES</span></div>
              <div className="pad">
                <div className="recon"><span>Awaiting approval</span><span className="mono">{pettyPending.length}</span></div>
                <div className="recon"><span>Value pending</span><span className="mono">{kes(pettyPendingTotal)}</span></div>
                <div className="recon"><span>Approved to date</span><span className="mono">{kes(pettyRequests.filter((r) => r.state === "approved").reduce((s, r) => s + r.amount, 0))}</span></div>
              </div>
              <div className="panel-h" style={{ borderTop: "1px solid var(--line)" }}><h3>Recent decisions</h3><span className="meta">last {Math.min(pettyDecided.length, 8)}</span></div>
              {pettyDecided.length === 0 ? <EmptyBody>No decisions yet.</EmptyBody> : (
                <div>
                  {pettyDecided.slice(0, 8).map((r) => (
                    <div className="task" key={r.id}>
                      <span className="id" style={{ color: r.state === "approved" ? "var(--green)" : "var(--red)" }}>{r.id}</span>
                      <span className="txt">{r.item} — {kes(r.amount)}<small>{r.requester}{r.decidedBy ? ` · by ${r.decidedBy}` : ""}{r.note ? ` · ${r.note}` : ""}</small></span>
                      <span className={`pill ${r.state === "approved" ? "done" : "over"}`}>{r.state === "approved" ? "Approved" : "Rejected"}</span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
          <Note>Floats and vouchers (drawing down an approved amount, then reconciling receipts) build on this queue in a later increment.</Note>
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
  const { newInvoices, openReceipt } = useApp();
  const outstanding = newInvoices.filter((i) => i.pillTxt !== "Paid");
  return (
    <div className="fin-panel active">
      <div className="panel" style={{ marginBottom: 18 }}>
        <div className="panel-h"><h3>Order-to-cash</h3><span className="meta">eTIMS compliant</span></div>
        <div className="pad">
          <div className="steps">
            <div className="step"><span className="sdot">1</span>Sales order</div><div className="step-arrow" />
            <div className="step"><span className="sdot">2</span>Delivery / install</div><div className="step-arrow" />
            <div className="step"><span className="sdot">3</span>Invoice issued</div><div className="step-arrow" />
            <div className="step"><span className="sdot">4</span>Collection</div>
          </div>
        </div>
      </div>
      <div className="grid g-2">
        <div className="panel">
          <div className="panel-h">
            <h3>Customer invoices</h3>
            <span className="meta">issue · file eTIMS · collect</span>
          </div>
          <table className="tbl">
            <thead><tr><th>Institution</th><th>Invoice</th><th>Amount</th><th>eTIMS</th><th>Due</th><th style={{ textAlign: "right" }}>Action</th></tr></thead>
            <tbody>
              {newInvoices.length === 0 ? (
                <tr><td colSpan={6} style={{ textAlign: "center", color: "var(--ink-soft)", padding: "18px 0" }}>No customer invoices yet — use “+ New invoice”.</td></tr>
              ) : newInvoices.map((inv) => (
                <tr key={inv.id}>
                  <td>{inv.cust}</td>
                  <td className="mono">{inv.id}</td>
                  <td className="mono">{inv.tot.toLocaleString()}</td>
                  <td><span className="rcv ok">filed ✓</span></td>
                  <td><span className={`pill ${inv.pillCls}`}>{inv.pillTxt}</span></td>
                  <td style={{ textAlign: "right" }}>
                    {inv.pillTxt === "Paid"
                      ? <span className="pill done">Settled</span>
                      : <button className="btn primary" style={{ padding: "4px 9px", fontSize: 11 }} onClick={() => openReceipt(inv)}>Record receipt</button>}
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
