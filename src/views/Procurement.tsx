import { Fragment, useState, type ReactNode } from "react";
import { useApp, Req, PORow, ApInvoice, Grn } from "../store";
import { Pulse, Note, ViewOnly } from "../components/ui";
import { ModalShell } from "../components/modals";
import { PlusI } from "../components/icons";
import { Crumb } from "../nav";

const kes = (n: number) => "KES " + Math.round(n).toLocaleString();
const poPill: Record<string, { cls: string; txt: string }> = {
  open: { cls: "week", txt: "Open" },
  partially_received: { cls: "today", txt: "Part received" },
  closed: { cls: "done", txt: "Closed" },
  cancelled: { cls: "over", txt: "Cancelled" },
};
const screenPill = (s: string) =>
  s === "cleared" ? "done" : s === "flagged" ? "over" : "today";
const apPill: Record<string, { cls: string; txt: string }> = {
  captured: { cls: "today", txt: "Captured" },
  matched: { cls: "done", txt: "Matched" },
  approved: { cls: "done", txt: "Approved" },
  exception: { cls: "over", txt: "Exception" },
  paid: { cls: "done", txt: "Paid" },
};

function ReqStatusCell({ r }: { r: Req }) {
  const { approvePR, raisePO, submitReqFinal, withdrawReq, level } = useApp();
  const canEdit = level("procurement") >= 2;
  const canFull = level("procurement") >= 3;
  const btn = { padding: "4px 9px", fontSize: 11, marginLeft: 7 } as const;
  const approve = canFull ? <button className="btn" style={btn} onClick={() => approvePR(r.id)}>Approve</button> : null;
  const withdraw = canEdit ? <button className="btn" style={btn} onClick={() => withdrawReq(r.id)}>Withdraw</button> : null;
  if (r.status === "draft")
    return (
      <>
        <span className="pill week">Draft</span>
        {canEdit && <button className="btn primary" style={btn} onClick={() => submitReqFinal(r.id)}>Submit</button>}
        {canEdit && <button className="btn" style={btn} onClick={() => withdrawReq(r.id)}>Discard</button>}
      </>
    );
  if (r.status === "await") return <><span className="pill today">Awaiting approval</span>{approve}{withdraw}</>;
  if (r.status === "md") return <><span className="pill week">MD review</span>{approve}{withdraw}</>;
  if (r.status === "rejected") return <span className="pill over">Rejected</span>;
  if (r.status === "approved")
    return (
      <>
        <span className="pill done">Approved</span>
        {canEdit && <button className="btn primary" style={btn} onClick={() => raisePO(r.id)}>Raise PO →</button>}
      </>
    );
  return <span className="pill done">Converted → PO</span>;
}

function EmptyBody({ children }: { children: ReactNode }) {
  return <div className="pad" style={{ fontSize: 12.5, color: "var(--ink-soft)", padding: "34px 20px", textAlign: "center" }}>{children}</div>;
}

export default function ProcurementView() {
  const {
    tabs, openReq, openVendor, reqs, vendors, poRows, grns, apInvoices,
    openVendorForm, screenVendor, openGrn, openCaptureInvoice, approveInvoice, payInvoice, goTab,
    openPoAmend, approvePoAmendment, openBankChange, approveBankChange, bankChanges, openPoPicker,
    openContractForm, compliance, level,
  } = useApp();
  const tab = tabs.procurement;
  // Procurement access: View (1) is read-only; Edit (2) can raise/create records;
  // Full (3) can approve / final sign-off.
  const procLvl = level("procurement");
  const canEdit = procLvl >= 2;
  const canFull = procLvl >= 3;
  // supplier contracts come from the shared contracts registry (kind = vendor)
  const supplierContracts = (compliance?.contracts ?? []).filter((c) => c.kind === "vendor");
  const pendingBankChanges = bankChanges.filter((b) => b.state === "pending");
  // Bank-change callback verification — replaces window.prompt with a real popup.
  const [verifyFor, setVerifyFor] = useState<{ id: string; vendor: string } | null>(null);
  const [verifyNote, setVerifyNote] = useState("");

  const openPOs = poRows.filter((p) => p.state === "open" || p.state === "partially_received");
  const receivablePOs = openPOs;                                   // can still take a GRN
  const invoiceablePOs = poRows.filter((p) => p.state !== "cancelled"); // can still take an invoice
  const awaiting = reqs.filter((r) => r.status === "await" || r.status === "md");
  const toPay = apInvoices.filter((i) => i.state === "matched" || i.state === "approved");
  const exceptions = apInvoices.filter((i) => i.state === "exception");

  const pulse = [
    { k: "Vendors", tick: "t-blue", v: String(vendors.length), d: `${vendors.filter((x) => x.screenStatus === "cleared").length} cleared`, dc: "flat" as const },
    { k: "Awaiting approval", tick: awaiting.length ? "t-ember" : "t-blue", v: String(awaiting.length), d: "requisitions", dc: "flat" as const },
    { k: "Open POs", tick: "t-blue", v: String(openPOs.length), d: "awaiting delivery", dc: "flat" as const },
    { k: "Ready to pay", tick: toPay.length ? "t-green" : "t-blue", v: String(toPay.length), d: "matched invoices", dc: "flat" as const },
    { k: "Match exceptions", tick: exceptions.length ? "t-red" : "t-blue", v: String(exceptions.length), d: "payment held", dc: "flat" as const },
    { k: "Deliveries", tick: "t-blue", v: String(grns.length), d: "goods-received notes", dc: "flat" as const },
  ];

  return (
    <>
      <div className="vhead">
        <div>
          <h1>Procurement</h1>
          <p>Procure-to-pay on one chain — requisition, sourcing, PO, goods received and three-way match — with sanctions screening and every step audit-logged.</p>
        </div>
        <div className="actions">
          {tab === "p-req" && canEdit && <button className="btn primary" onClick={openReq}><PlusI />New requisition</button>}
          {tab === "p-vendors" && canEdit && <button className="btn primary" onClick={openVendorForm}><PlusI />Add vendor</button>}
          {tab === "p-po" && canEdit && <button className="btn primary" onClick={openPoPicker}><PlusI />New PO</button>}
          {tab === "p-contracts" && canEdit && <button className="btn primary" onClick={openContractForm}><PlusI />Add contract</button>}
        </div>
      </div>
      <Crumb view="procurement" />
      <ViewOnly show={procLvl === 1} />

      {tab === "p-over" && (
        <div className="proc-panel active">
          <Pulse data={pulse} />
          <div className="panel" style={{ marginTop: 18 }}>
            <div className="panel-h"><h3>Procure-to-pay</h3><span className="meta">where things stand</span></div>
            <div className="pad">
              <div className="steps">
                <div className="step"><span className="sdot">1</span>Requisition</div><div className="step-arrow" />
                <div className="step"><span className="sdot">2</span>Purchase order</div><div className="step-arrow" />
                <div className="step"><span className="sdot">3</span>Goods received</div><div className="step-arrow" />
                <div className="step"><span className="sdot">4</span>Match &amp; pay</div>
              </div>
            </div>
          </div>
          <div className="panel" style={{ marginTop: 18 }}>
            <div className="panel-h"><h3>Needs attention</h3><span className="meta">across the chain</span></div>
            {awaiting.map((r) => (
              <div className="task" key={"aw" + r.id} onClick={() => goTab("procurement", "p-req")}>
                <span className="id" style={{ color: "var(--ember)" }}>{r.id}</span>
                <span className="txt">{r.item}<small>requisition awaiting approval</small></span>
                <span className="pill today">Approve</span>
              </div>
            ))}
            {exceptions.map((i) => (
              <div className="task" key={"ex" + i.ref} onClick={() => goTab("procurement", "p-grn")}>
                <span className="id" style={{ color: "var(--red)" }}>{i.ref}</span>
                <span className="txt">{i.vendor} — {i.po}<small>{i.matchNote || "match exception"}</small></span>
                <span className="pill over">Held</span>
              </div>
            ))}
            {toPay.map((i) => (
              <div className="task" key={"pay" + i.ref} onClick={() => goTab("procurement", "p-grn")}>
                <span className="id" style={{ color: "var(--green)" }}>{i.ref}</span>
                <span className="txt">{i.vendor} — {kes(i.amount)}<small>matched — ready to pay</small></span>
                <span className="pill done">Pay</span>
              </div>
            ))}
            {!awaiting.length && !exceptions.length && !toPay.length && <EmptyBody>Nothing needs attention right now.</EmptyBody>}
          </div>
        </div>
      )}

      {tab === "p-vendors" && (
        <div className="proc-panel active">
          <div className="panel">
            <div className="panel-h">
              <h3>Vendor registry</h3>
              {canEdit && <span className="meta"><a href="#" onClick={(e) => { e.preventDefault(); openVendorForm(); }} style={{ color: "var(--flame)", textDecoration: "none" }}>+ Add vendor</a></span>}
            </div>
            <table className="tbl">
              <thead><tr><th>Vendor</th><th>Category</th><th>Tax status</th><th>Screening</th><th>State</th><th style={{ textAlign: "right" }}>Action</th></tr></thead>
              <tbody>
                {vendors.length === 0 ? (
                  <tr><td colSpan={6} style={{ textAlign: "center", color: "var(--ink-soft)", padding: "18px 0" }}>No vendors onboarded yet — use “+ Add vendor”.</td></tr>
                ) : vendors.map((v) => (
                  <tr key={v.id}>
                    <td><strong style={{ cursor: "pointer", color: "var(--flame)" }} onClick={() => openVendor(v.name)}>{v.name}</strong></td>
                    <td>{v.category || "—"}</td>
                    <td style={{ fontSize: 12 }}>{v.taxStatus}</td>
                    <td><span className={`pill ${screenPill(v.screenStatus)}`}>{v.screenStatus}</span></td>
                    <td style={{ fontSize: 12 }}>{v.state}</td>
                    <td style={{ textAlign: "right" }}>
                      {v.screenStatus !== "cleared"
                        ? (canFull ? <button className="btn primary" style={{ padding: "4px 9px", fontSize: 11 }} onClick={() => screenVendor(v.name, "cleared", "Manual sanctions & tax check")}>Clear screening</button> : <span className="pill week">not cleared</span>)
                        : (canEdit ? <button className="btn" style={{ padding: "4px 9px", fontSize: 11 }} onClick={() => openBankChange(v.name)}>Change bank</button> : <span className="pill done">Cleared</span>)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            <Note>Sanctions screening is a hard gate — a vendor cannot be awarded a PO until it is cleared (Procurement Manual IGN-PROC-001).</Note>
          </div>
          {pendingBankChanges.length > 0 && (
            <div className="panel" style={{ marginTop: 18 }}>
              <div className="panel-h"><h3>Bank-detail changes — verify by callback</h3><span className="meta">payment-diversion control</span></div>
              <table className="tbl">
                <thead><tr><th>Vendor</th><th>Old account</th><th>New account</th><th style={{ textAlign: "right" }}>Action</th></tr></thead>
                <tbody>
                  {pendingBankChanges.map((b) => (
                    <tr key={b.id}>
                      <td><strong>{b.vendor}</strong></td>
                      <td style={{ fontSize: 12 }}>{b.oldBank || "—"}</td>
                      <td style={{ fontSize: 12 }}>{b.newBank}</td>
                      <td style={{ textAlign: "right" }}>
                        {canFull
                          ? <button className="btn primary" style={{ padding: "4px 9px", fontSize: 11 }}
                              onClick={() => { setVerifyNote(""); setVerifyFor({ id: b.id, vendor: b.vendor }); }}>
                              Verify by callback
                            </button>
                          : <span className="pill today">Pending verify</span>}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <Note>The requester cannot verify their own change, and it must be confirmed by phone using the number already on file — not the one in the request. The old details stay in use until verified.</Note>
            </div>
          )}
        </div>
      )}

      {tab === "p-req" && (
        <div className="proc-panel active">
          <div className="panel">
            <div className="panel-h">
              <h3>Purchase requisitions</h3>
              {canEdit && <span className="meta"><a href="#" onClick={(e) => { e.preventDefault(); openReq(); }} style={{ color: "var(--flame)", textDecoration: "none" }}>+ New requisition</a></span>}
            </div>
            <table className="tbl">
              <thead><tr><th>PR</th><th>Item</th><th>Cost centre</th><th>Amount</th><th>Budget</th><th>Raised by</th><th>Status</th></tr></thead>
              <tbody>
                {reqs.length === 0 ? (
                  <tr><td colSpan={7} style={{ textAlign: "center", color: "var(--ink-soft)", padding: "18px 0" }}>No requisitions yet — raise one with “+ New requisition”.</td></tr>
                ) : reqs.map((r) => (
                  <tr key={r.id}>
                    <td className="mono">{r.id}</td>
                    <td>{r.item}{r.qty ? <small style={{ color: "var(--ink-soft)", display: "block" }}>{r.qty} {r.unit}{r.project ? ` · ${r.project}` : ""}</small> : null}</td>
                    <td style={{ fontSize: 12 }}>{r.code}</td>
                    <td className="mono">{r.amt.toLocaleString()}</td>
                    <td><span className={`rcv ${r.chip}`}>{r.chipTxt}</span></td>
                    <td style={{ fontSize: 12 }}>{r.raisedBy || "—"}</td>
                    <td><ReqStatusCell r={r} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
            <Note>Coding drives the live budget check; approval routes by threshold and a requester can never approve their own request.</Note>
          </div>
        </div>
      )}

      {tab === "p-po" && (
        <div className="proc-panel active">
          <div className="panel">
            <div className="panel-h"><h3>Purchase orders</h3><span className="meta">open · partial · closed</span></div>
            <table className="tbl">
              <thead><tr><th>PO</th><th>Vendor</th><th>Value</th><th>Delivery</th><th>Status</th><th style={{ textAlign: "right" }}>Action</th></tr></thead>
              <tbody>
                {poRows.length === 0 ? (
                  <tr><td colSpan={6} style={{ textAlign: "center", color: "var(--ink-soft)", padding: "18px 0" }}>No purchase orders yet — raise one from an approved requisition.</td></tr>
                ) : poRows.map((p) => (
                  <tr key={p.id}>
                    <td className="mono">{p.id}</td>
                    <td><span style={{ cursor: "pointer", color: "var(--flame)" }} onClick={() => openVendor(p.vendor)}>{p.vendor}</span></td>
                    <td className="mono">{p.amt.toLocaleString()}</td>
                    <td className="mono">{p.delivery}</td>
                    <td>
                      <span className={`pill ${poPill[p.state]?.cls || "week"}`}>{poPill[p.state]?.txt || p.state}</span>
                      {p.reapproval && <span className="pill over" style={{ marginLeft: 6 }}>Re-approval</span>}
                    </td>
                    <td style={{ textAlign: "right" }}>
                      {p.reapproval
                        ? (canFull ? <button className="btn primary" style={{ padding: "4px 9px", fontSize: 11 }} onClick={() => approvePoAmendment(p.id)}>Approve amendment</button> : <span className="pill over">Re-approval pending</span>)
                        : (p.state === "open" || p.state === "partially_received")
                          ? (canEdit ? <>
                              <button className="btn" style={{ padding: "4px 9px", fontSize: 11 }} onClick={() => openPoAmend(p)}>Amend</button>
                              <button className="btn" style={{ padding: "4px 9px", fontSize: 11, marginLeft: 6 }} onClick={() => openGrn(p)}>Record GRN</button>
                            </> : <span className="pill week">{poPill[p.state]?.txt || p.state}</span>)
                          : <span className="pill done">Complete</span>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            <Note>A PO can only be raised from an approved requisition, and closes only when the GRN and invoice match.</Note>
          </div>
        </div>
      )}

      {tab === "p-grn" && (
        <div className="proc-panel active">
          <div className="grid g-2">
            <div className="panel">
              <div className="panel-h">
                <h3>Goods received / delivery notes</h3>
                <span className="meta">{grns.length} recorded</span>
              </div>
              <table className="tbl">
                <thead><tr><th>GRN</th><th>PO</th><th>Vendor</th><th>Received</th></tr></thead>
                <tbody>
                  {grns.length === 0 ? (
                    <tr><td colSpan={4} style={{ textAlign: "center", color: "var(--ink-soft)", padding: "18px 0" }}>No deliveries recorded yet — use “Record GRN” on an open PO.</td></tr>
                  ) : grns.map((g) => (
                    <tr key={g.id}>
                      <td className="mono">{g.id}</td>
                      <td className="mono">{g.po}</td>
                      <td>{g.vendor}</td>
                      <td><span className={`pill ${g.coverage === "full" ? "done" : "today"}`}>{g.pct}%</span></td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <Note>Receiver must differ from the requester — the independent third leg of the match.</Note>
            </div>
            <div className="panel">
              <div className="panel-h"><h3>Three-way match</h3><span className="meta">PO ↔ GRN ↔ invoice</span></div>
              <ApTable invoices={apInvoices} invoiceablePOs={invoiceablePOs} poRows={poRows} grns={grns} openCaptureInvoice={openCaptureInvoice} approveInvoice={approveInvoice} payInvoice={payInvoice} />
              <Note>No invoice is released for payment unless the PO authorised it and the GRN confirms it arrived.</Note>
            </div>
          </div>
        </div>
      )}

      {tab === "p-contracts" && (
        <div className="proc-panel active">
          <div className="panel">
            <div className="panel-h">
              <h3>Supplier contracts</h3>
              {canEdit && <span className="meta"><a href="#" onClick={(e) => { e.preventDefault(); openContractForm(); }} style={{ color: "var(--flame)", textDecoration: "none" }}>+ Add contract</a></span>}
            </div>
            <table className="tbl">
              <thead><tr><th>Supplier</th><th>Contract</th><th>Detail</th><th>Expiry</th><th>Status</th></tr></thead>
              <tbody>
                {supplierContracts.length === 0 ? (
                  <tr><td colSpan={5} style={{ textAlign: "center", color: "var(--ink-soft)", padding: "18px 0" }}>No supplier contracts yet — use “+ Add contract”.</td></tr>
                ) : supplierContracts.map((c) => (
                  <tr key={c.counterparty + c.title}>
                    <td><strong>{c.counterparty}</strong></td>
                    <td>{c.title}</td>
                    <td style={{ fontSize: 12, color: "var(--ink-soft)" }}>{c.detail || "—"}</td>
                    <td className="mono">{c.expiry || "—"}</td>
                    <td><span className={`pill ${c.statusCls}`}>{c.statusTxt}</span></td>
                  </tr>
                ))}
              </tbody>
            </table>
            <Note>Framework and supply agreements with vendors. These are the same records as Compliance &amp; Governance › contracts registry — add here or there, one source of truth.</Note>
          </div>
        </div>
      )}

      <ModalShell open={!!verifyFor} onClose={() => setVerifyFor(null)} width={480}>
        {verifyFor && (
          <>
            <div className="mh">
              <h3>Verify bank change by callback</h3>
              <p>Confirm you called <strong>{verifyFor.vendor}</strong> on the number <strong>on file</strong> — not the one in the request — and verified this change.</p>
            </div>
            <div className="mb">
              <div>
                <label>Who did you speak to?</label>
                <input className="field" autoFocus placeholder="e.g. Jane Otieno, Finance Officer" value={verifyNote} onChange={(e) => setVerifyNote(e.target.value)} />
              </div>
              <Note>The requester cannot verify their own change. The old details stay in use until this is confirmed.</Note>
            </div>
            <div className="mf">
              <button className="btn" onClick={() => setVerifyFor(null)}>Cancel</button>
              <button className="btn primary" disabled={!verifyNote.trim()} onClick={() => { approveBankChange(verifyFor.id, verifyNote.trim()); setVerifyFor(null); }}>Confirm verification</button>
            </div>
          </>
        )}
      </ModalShell>
    </>
  );
}

function ApTable({ invoices, invoiceablePOs, poRows, grns, openCaptureInvoice, approveInvoice, payInvoice }: {
  invoices: ApInvoice[]; invoiceablePOs: PORow[]; poRows: PORow[]; grns: Grn[];
  openCaptureInvoice: (po: PORow) => void; approveInvoice: (ref: string) => void; payInvoice: (ref: string, method: string) => void;
}) {
  const { level } = useApp();
  const canEdit = level("procurement") >= 2;
  const canFull = level("procurement") >= 3;
  const [open, setOpen] = useState<string | null>(null);
  return (
    <>
      <div style={{ padding: "8px 14px 0", textAlign: "right" }}>
        <span className="meta">
          {canEdit && invoiceablePOs.length > 0
            ? <a href="#" onClick={(e) => { e.preventDefault(); openCaptureInvoice(invoiceablePOs[0]); }} style={{ color: "var(--flame)", textDecoration: "none" }}>+ Capture invoice</a>
            : <span style={{ color: "var(--ink-soft)" }}>{canEdit ? "no open PO to invoice" : ""}</span>}
        </span>
      </div>
      <table className="tbl">
        <thead><tr><th>Invoice</th><th>PO</th><th>Amount</th><th>Match</th><th style={{ textAlign: "right" }}>Action</th></tr></thead>
        <tbody>
          {invoices.length === 0 ? (
            <tr><td colSpan={5} style={{ textAlign: "center", color: "var(--ink-soft)", padding: "18px 0" }}>Nothing to match yet.</td></tr>
          ) : invoices.map((i) => (
            <Fragment key={i.ref}>
              <tr>
                <td className="mono">{i.ref}{i.invoiceNumber ? <small style={{ color: "var(--ink-soft)", display: "block" }}>{i.invoiceNumber}</small> : null}</td>
                <td className="mono">{i.po}</td>
                <td className="mono">{i.amount.toLocaleString()}{i.wht > 0 ? <small style={{ color: "var(--ink-soft)", display: "block" }}>WHT {i.wht.toLocaleString()}</small> : null}</td>
                <td>
                  <span className={`pill ${apPill[i.state]?.cls || "week"}`}>{apPill[i.state]?.txt || i.state}</span>
                  <button className="btn" style={{ padding: "2px 7px", fontSize: 10.5, marginLeft: 6 }} onClick={() => setOpen(open === i.ref ? null : i.ref)}>{open === i.ref ? "Hide" : i.state === "exception" ? "Investigate" : "Run Match"}</button>
                </td>
                <td style={{ textAlign: "right" }}>
                  {i.state === "matched"
                    ? (i.capturedByMe
                        ? <span className="pill week" title="Segregation of duties">You captured — needs another approver</span>
                        : canFull ? <button className="btn primary" style={{ padding: "4px 9px", fontSize: 11 }} onClick={() => approveInvoice(i.ref)}>Approve for Payment</button>
                        : <span className="pill done">Matched</span>)
                    : i.state === "approved" ? (canFull ? <button className="btn primary" style={{ padding: "4px 9px", fontSize: 11 }} onClick={() => payInvoice(i.ref, "bank")}>Pay</button> : <span className="pill done">Approved</span>)
                    : i.state === "paid" ? <span className="pill done">Paid</span>
                    : i.state === "exception" ? <span className="pill over">Held</span>
                    : <span className="pill today">Matching…</span>}
                </td>
              </tr>
              {open === i.ref && (
                <tr><td colSpan={5} style={{ background: "#FCFAF6", padding: 0 }}><RunMatch inv={i} po={poRows.find((p) => p.id === i.po)} grns={grns.filter((g) => g.po === i.po)} /></td></tr>
              )}
            </Fragment>
          ))}
        </tbody>
      </table>
    </>
  );
}

// Side-by-side three-way comparison: Invoice vs PO vs GRN (qty + price), mismatches flagged.
function RunMatch({ inv, po, grns }: { inv: ApInvoice; po?: PORow; grns: Grn[] }) {
  if (!po) return <div style={{ padding: 14, fontSize: 12.5, color: "var(--ink-soft)" }}>PO {inv.po} not found.</div>;
  const recv = grns.reduce((s, g) => s + g.qtyReceived, 0);
  const invQty = po.unitPrice ? inv.amount / po.unitPrice : po.qty;
  const qtyOk = recv === po.qty;
  const amtOk = Math.abs(inv.amount - po.amt) < 0.01;
  const over = recv > po.qty;
  const cell = (ok: boolean) => ({ color: ok ? "inherit" : "var(--flame)", fontWeight: ok ? 400 : 700 } as const);
  return (
    <div style={{ padding: 14 }}>
      <table className="tbl" style={{ margin: 0 }}>
        <thead><tr><th>Leg</th><th style={{ textAlign: "right" }}>Qty</th><th style={{ textAlign: "right" }}>Unit price</th><th style={{ textAlign: "right" }}>Total</th></tr></thead>
        <tbody>
          <tr><td>Purchase order {po.id}</td><td className="mono" style={{ textAlign: "right" }}>{po.qty}</td><td className="mono" style={{ textAlign: "right" }}>{po.unitPrice.toLocaleString()}</td><td className="mono" style={{ textAlign: "right" }}>{po.amt.toLocaleString()}</td></tr>
          <tr><td>Goods received</td><td className="mono" style={{ textAlign: "right", ...cell(qtyOk) }}>{recv}{over ? " ⚠ over" : ""}</td><td className="mono" style={{ textAlign: "right" }}>—</td><td className="mono" style={{ textAlign: "right" }}>—</td></tr>
          <tr><td>Invoice {inv.ref}</td><td className="mono" style={{ textAlign: "right", ...cell(Math.abs(invQty - po.qty) < 0.001) }}>{invQty % 1 === 0 ? invQty : invQty.toFixed(2)}</td><td className="mono" style={{ textAlign: "right" }}>{po.unitPrice.toLocaleString()}</td><td className="mono" style={{ textAlign: "right", ...cell(amtOk) }}>{inv.amount.toLocaleString()}</td></tr>
        </tbody>
      </table>
      <div style={{ fontSize: 12, marginTop: 8, color: qtyOk && amtOk ? "var(--green)" : "var(--flame)" }}>
        {qtyOk && amtOk ? "✓ Invoice, PO and GRN agree on quantity and value." : `Doesn't tie out: ${!qtyOk ? (over ? "over-delivery" : "goods not fully received") : ""}${!qtyOk && !amtOk ? " · " : ""}${!amtOk ? "amount mismatch vs PO" : ""}.${inv.matchNote ? ` (${inv.matchNote})` : ""}`}
      </div>
    </div>
  );
}
