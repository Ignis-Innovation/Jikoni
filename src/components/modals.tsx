// Modals: invite member, assign task, raise requisition (live budget check +
// approval routing), raise PO from an approved requisition, raise sales invoice.
import React, { useEffect, useRef, useState } from "react";
import { useApp } from "../store";
import { budgetLines, kes, reqRouting, reqBudgetState, engStages, engChannels } from "../data";
import { useUsdKesRate, getUsdKesRate, FALLBACK_USD_KES } from "../lib/fx";

export function ModalShell({ open, onClose, width, className, children }: { open: boolean; onClose: () => void; width?: number; className?: string; children: React.ReactNode }) {
  return (
    <div className={`modal-bg ${open ? "show" : ""}`} onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className={`modal${className ? ` ${className}` : ""}`} style={width ? { width } : undefined}>
        <button className="modal-x" onClick={onClose} aria-label="Close">×</button>
        {children}
      </div>
    </div>
  );
}

/* ================= INVITE ================= */
export function InviteModal() {
  const { inviteOpen, setInviteOpen, toast, sendInvite } = useApp();
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [role, setRole] = useState("std");
  useEffect(() => { if (inviteOpen) { setName(""); setEmail(""); setRole("std"); } }, [inviteOpen]);

  function send() {
    if (!name.trim() || !email.trim()) { toast("Name and email needed", "So the invite reaches the right person"); return; }
    sendInvite(name.trim(), email.trim(), role);
  }

  return (
    <ModalShell open={inviteOpen} onClose={() => setInviteOpen(false)}>
      <div className="mh"><h3>Invite a member</h3><p>They'll get an email to set a password and enrol in two-factor.</p></div>
      <div className="mb">
        <div><label>Full name</label><input className="field" placeholder="e.g. Lily Achieng" value={name} onChange={(e) => setName(e.target.value)} /></div>
        <div><label>Work email</label><input className="field" placeholder="name@ignis.africa" value={email} onChange={(e) => setEmail(e.target.value)} /></div>
        <div>
          <label>Role &amp; access</label>
          <select className="field" value={role} onChange={(e) => setRole(e.target.value)}>
            <option value="super">Super Admin — full access + user grants + petty-cash approver</option>
            <option value="sub">Sub Admin — Admin access plus HR &amp; Compliance/Governance editing</option>
            <option value="admin">Admin — full access, can invite members</option>
            <option value="fin">Finance — ledgers, payables, approvals</option>
            <option value="std">Standard — assigned modules</option>
            <option value="view">View only — dashboards &amp; reports</option>
          </select>
        </div>
      </div>
      <div className="mf">
        <button className="btn" onClick={() => setInviteOpen(false)}>Cancel</button>
        <button className="btn primary" onClick={send}>Send invite</button>
      </div>
    </ModalShell>
  );
}

/* ================= ADD / ASSIGN TASK (with mini-tasks) ================= */
export function TaskModal() {
  const { taskOpen, taskMode, closeTask, createTask, members, me, toast } = useApp();
  const assign = taskMode === "assign";
  const others = members.filter((m) => m.email !== me?.email && m.state !== "invited");
  const [title, setTitle] = useState("");
  const [assignee, setAssignee] = useState("");
  const [due, setDue] = useState("week");
  const [dueDate, setDueDate] = useState("");
  const [link, setLink] = useState("");
  const [subs, setSubs] = useState<string[]>([]);
  const [subDraft, setSubDraft] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (taskOpen) {
      setTitle(""); setAssignee(others[0]?.email ?? ""); setDue("week"); setDueDate(""); setLink(""); setSubs([]); setSubDraft("");
      setTimeout(() => inputRef.current?.focus(), 60);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [taskOpen]);

  function addSub() {
    const t = subDraft.trim();
    if (!t) return;
    setSubs((s) => [...s, t]); setSubDraft("");
  }
  function save() {
    if (!title.trim()) { toast("Add a task description", "It can't be empty"); return; }
    if (assign && !assignee) { toast("Pick who it's for", "Choose a teammate to assign this to"); return; }
    // fold any half-typed sub-task into the list
    const allSubs = subDraft.trim() ? [...subs, subDraft.trim()] : subs;
    createTask({ title: title.trim(), due, dueDate: dueDate || undefined, link: link.trim(), assigneeEmail: assign ? assignee : undefined, subtasks: allSubs });
  }

  return (
    <ModalShell open={taskOpen} onClose={closeTask}>
      <div className="mh">
        <h3>{assign ? "Assign a task" : "Add a task"}</h3>
        <p>{assign ? "It lands in the assignee's My Week, notifies them and emails them." : "It's added to your own My Week. Break it into mini-tasks if you like."}</p>
      </div>
      <div className="mb">
        <div><label>Task</label><input ref={inputRef} className="field" placeholder="e.g. Send EAIF the updated financial model" value={title} onChange={(e) => setTitle(e.target.value)} /></div>
        <div style={{ display: "flex", gap: 12 }}>
          {assign && (
            <div style={{ flex: 1 }}>
              <label>Assign to</label>
              <select className="field" style={{ width: "100%" }} value={assignee} onChange={(e) => setAssignee(e.target.value)}>
                {others.length === 0 && <option value="">No teammates yet</option>}
                {others.map((m) => <option key={m.email} value={m.email}>{m.name}</option>)}
              </select>
            </div>
          )}
          <div style={{ flex: 1 }}>
            <label>Due {dueDate && <span style={{ textTransform: "none", fontWeight: 400, letterSpacing: 0, color: "var(--ink-soft)" }}>· using the date</span>}</label>
            <select className="field" style={{ width: "100%", opacity: dueDate ? 0.5 : 1 }} value={due} disabled={!!dueDate} onChange={(e) => setDue(e.target.value)}>
              <option value="today">Today</option><option value="week">This week</option><option value="nweek">Next week</option>
            </select>
          </div>
          <div style={{ flex: 1 }}>
            <label>Or pick a date <span style={{ textTransform: "none", fontWeight: 400, letterSpacing: 0 }}>· optional</span></label>
            <input type="date" className="field" style={{ width: "100%" }} value={dueDate} onChange={(e) => setDueDate(e.target.value)} />
          </div>
        </div>
        <div><label>Link / context <span style={{ textTransform: "none", fontWeight: 400, letterSpacing: 0 }}>· optional</span></label><input className="field" placeholder="e.g. ENG-012 · Charm Impact" value={link} onChange={(e) => setLink(e.target.value)} /></div>
        <div>
          <label>Mini-tasks <span style={{ textTransform: "none", fontWeight: 400, letterSpacing: 0 }}>· optional</span></label>
          {subs.length > 0 && (
            <div style={{ display: "flex", flexDirection: "column", gap: 6, marginBottom: 8 }}>
              {subs.map((s, i) => (
                <div key={i} style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 13 }}>
                  <span style={{ color: "var(--ink-soft)" }}>•</span>
                  <span style={{ flex: 1 }}>{s}</span>
                  <button className="btn" style={{ padding: "2px 8px", fontSize: 11 }} onClick={() => setSubs((x) => x.filter((_, j) => j !== i))}>Remove</button>
                </div>
              ))}
            </div>
          )}
          <div style={{ display: "flex", gap: 8 }}>
            <input className="field" style={{ flex: 1 }} placeholder="Add a mini-task and press Enter" value={subDraft}
              onChange={(e) => setSubDraft(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); addSub(); } }} />
            <button className="btn" onClick={addSub}>Add</button>
          </div>
        </div>
      </div>
      <div className="mf">
        <button className="btn" onClick={closeTask}>Cancel</button>
        <button className="btn primary" onClick={save}>{assign ? "Assign task" : "Add task"}</button>
      </div>
    </ModalShell>
  );
}

/* ================= RAISE REQUISITION ================= */
export function ReqModal() {
  const { reqOpen, closeReq, submitReq, costCentres, projectDetails, toast } = useApp();
  const centres = costCentres.length ? costCentres.map((c) => c.code) : Object.keys(budgetLines);
  const projects = Object.keys(projectDetails);
  const [item, setItem] = useState("");
  const [qty, setQty] = useState("1");
  const [unit, setUnit] = useState("pcs");
  const [code, setCode] = useState("");
  const [project, setProject] = useState("");
  const [unitPrice, setUnitPrice] = useState("");
  const [justification, setJustification] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (reqOpen) {
      setItem(""); setQty("1"); setUnit("pcs"); setCode(centres[0] ?? ""); setProject(""); setUnitPrice(""); setJustification("");
      setTimeout(() => inputRef.current?.focus(), 60);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [reqOpen]);

  const total = (parseFloat(qty) || 0) * (parseFloat(unitPrice) || 0);
  const b = total > 0 && budgetLines[code] ? reqBudgetState(code, total) : null;
  const r = reqRouting(total);

  function validate() {
    if (!item.trim()) { toast("Add a description", "What are you requisitioning?"); return false; }
    if (!(parseFloat(qty) > 0)) { toast("Add a quantity", "How many?"); return false; }
    if (!code) { toast("Pick a cost centre", "Coding drives the budget check and the ledger"); return false; }
    if (!(parseFloat(unitPrice) > 0)) { toast("Add a unit price", "Needed for the total and budget check"); return false; }
    return true;
  }
  function go(asDraft: boolean) {
    if (!validate()) return;
    submitReq({ item: item.trim(), amt: total, code, qty: parseFloat(qty) || 1, unit, unitPrice: parseFloat(unitPrice) || 0, project, justification: justification.trim(), asDraft });
  }

  return (
    <ModalShell open={reqOpen} onClose={closeReq} width={520}>
      <div className="mh"><h3>Raise a requisition</h3><p>Budget is checked as you type; approval routes by amount. Coding is required — it drives the budget check now and the ledger later.</p></div>
      <div className="mb">
        <div><label>Item / description</label><input ref={inputRef} className="field" placeholder="e.g. Cooker spares — maintenance batch" value={item} onChange={(e) => setItem(e.target.value)} /></div>
        <div style={{ display: "flex", gap: 12 }}>
          <div style={{ width: 90 }}><label>Quantity</label><input className="field" style={{ width: "100%" }} type="number" min="0" value={qty} onChange={(e) => setQty(e.target.value)} /></div>
          <div style={{ width: 120 }}>
            <label>Unit</label>
            <select className="field" style={{ width: "100%" }} value={unit} onChange={(e) => setUnit(e.target.value)}>
              <option>pcs</option><option>kg</option><option>litre</option><option>box</option><option>service</option>
            </select>
          </div>
          <div style={{ flex: 1 }}><label>Est. unit price (KES)</label><input className="field" style={{ width: "100%" }} type="number" min="0" placeholder="0" value={unitPrice} onChange={(e) => setUnitPrice(e.target.value)} /></div>
        </div>
        <div style={{ display: "flex", gap: 12 }}>
          <div style={{ flex: 1 }}>
            <label>Cost centre</label>
            <select className="field" style={{ width: "100%" }} value={code} onChange={(e) => setCode(e.target.value)}>
              {centres.length === 0 && <option value="">No cost centres — add one in Settings → Coding</option>}
              {centres.map((k) => <option key={k}>{k}</option>)}
            </select>
          </div>
          <div style={{ flex: 1 }}>
            <label>Project <span style={{ textTransform: "none", fontWeight: 400, letterSpacing: 0 }}>· optional</span></label>
            <select className="field" style={{ width: "100%" }} value={project} onChange={(e) => setProject(e.target.value)}>
              <option value="">— none —</option>
              {projects.map((p) => <option key={p}>{p}</option>)}
            </select>
          </div>
        </div>
        <div className="recon" style={{ padding: "8px 0" }}><span>Estimated total</span><span className="mono"><strong>{kes(total)}</strong></span></div>
        <div className="reqbox" style={b ? { background: b.bg, color: b.fg, borderColor: "transparent" } : { background: "#FCFAF6", color: "var(--ink-soft)" }}>
          <div className="rl">Budget check</div>
          {b ? b.msg : "Enter quantity and unit price to check the budget."}
        </div>
        <div className="reqbox" style={{ background: "#FCFAF6", color: r ? "var(--ink)" : "var(--ink-soft)" }}>
          <div className="rl">Approval routing</div>
          {r ? <><strong>{r.label}</strong> — {r.who}.</> : "Set by amount, using Settings → Approvals."}
        </div>
        <div><label>Justification / notes <span style={{ textTransform: "none", fontWeight: 400, letterSpacing: 0 }}>· optional</span></label>
          <textarea className="field" style={{ width: "100%", minHeight: 60, resize: "vertical", fontFamily: "inherit" }} placeholder="Why this is needed" value={justification} onChange={(e) => setJustification(e.target.value)} />
        </div>
      </div>
      <div className="mf">
        <button className="btn" onClick={closeReq}>Cancel</button>
        <button className="btn" onClick={() => go(true)}>Save as Draft</button>
        <button className="btn primary" onClick={() => go(false)}>Submit for Approval</button>
      </div>
    </ModalShell>
  );
}

/* ================= NEW PO — pick an approved requisition ================= */
export function PoPickerModal() {
  const { poPickerOpen, closePoPicker, reqs, raisePO } = useApp();
  const approved = reqs.filter((r) => r.status === "approved");
  return (
    <ModalShell open={poPickerOpen} onClose={closePoPicker} width={520}>
      <div className="mh"><h3>New purchase order</h3><p>A PO can only be raised from an approved requisition. Pick one to pre-fill the order.</p></div>
      <div className="mb">
        {approved.length === 0 ? (
          <div style={{ color: "var(--ink-soft)", fontSize: 13, padding: "10px 0" }}>No approved requisitions waiting to be converted. Approve one in the Requisitions tab first.</div>
        ) : (
          <table className="tbl">
            <thead><tr><th>PR</th><th>Item</th><th>Cost centre</th><th>Amount</th><th></th></tr></thead>
            <tbody>
              {approved.map((r) => (
                <tr key={r.id}>
                  <td className="mono">{r.id}</td>
                  <td>{r.item}{r.qty ? <small style={{ color: "var(--ink-soft)", display: "block" }}>{r.qty} {r.unit}</small> : null}</td>
                  <td style={{ fontSize: 12 }}>{r.code}</td>
                  <td className="mono">{r.amt.toLocaleString()}</td>
                  <td style={{ textAlign: "right" }}><button className="btn primary" style={{ padding: "4px 10px", fontSize: 11 }} onClick={() => { closePoPicker(); raisePO(r.id); }}>Select →</button></td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
      <div className="mf"><button className="btn" onClick={closePoPicker}>Cancel</button></div>
    </ModalShell>
  );
}

/* ================= RAISE PO (from the picked requisition) ================= */
export function POModal() {
  const { poFor, closePO, submitPO, vendors, toast } = useApp();
  // Only cleared vendors can be awarded a PO (the sanctions gate blocks the rest).
  const cleared = vendors.filter((v) => v.screenStatus === "cleared");
  const [vendor, setVendor] = useState("");
  const [delivery, setDelivery] = useState("Standard · 7 days");
  const [qty, setQty] = useState("1");
  const [unitPrice, setUnitPrice] = useState("0");
  useEffect(() => {
    if (poFor) {
      setVendor(cleared[0]?.name ?? ""); setDelivery("Standard · 7 days");
      setQty(String(poFor.qty ?? 1));
      setUnitPrice(String(poFor.unitPrice ?? (poFor.qty ? poFor.amt / poFor.qty : poFor.amt)));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [poFor]);
  const q = parseFloat(qty) || 0;
  const price = parseFloat(unitPrice) || 0;
  const value = q * price;

  return (
    <ModalShell open={!!poFor} onClose={closePO} width={520}>
      <div className="mh"><h3>Raise a purchase order</h3><p>{poFor ? `From requisition ${poFor.id} · ${poFor.code}` : "From requisition"}</p></div>
      <div className="mb">
        <div><label>Item</label><input className="field" readOnly style={{ background: "#FCFAF6" }} value={poFor?.item || ""} /></div>
        <div>
          <label>Vendor <span style={{ textTransform: "none", fontWeight: 400, letterSpacing: 0 }}>· cleared only</span></label>
          <select className="field" style={{ width: "100%" }} value={vendor} onChange={(e) => setVendor(e.target.value)}>
            {cleared.length === 0 && <option value="">No cleared vendors — onboard & screen one first</option>}
            {cleared.map((v) => <option key={v.id} value={v.name}>{v.name}</option>)}
          </select>
        </div>
        <table className="tbl">
          <thead><tr><th>Line</th><th>Qty</th><th>Unit price</th><th style={{ textAlign: "right" }}>Line total</th></tr></thead>
          <tbody>
            <tr>
              <td>{poFor?.item}</td>
              <td><input className="field" style={{ width: 70, padding: "4px 8px" }} type="number" min="0" value={qty} onChange={(e) => setQty(e.target.value)} /></td>
              <td><input className="field" style={{ width: 100, padding: "4px 8px" }} type="number" min="0" value={unitPrice} onChange={(e) => setUnitPrice(e.target.value)} /></td>
              <td className="mono" style={{ textAlign: "right" }}>{value.toLocaleString()}</td>
            </tr>
          </tbody>
        </table>
        <div>
          <label>Delivery terms</label>
          <select className="field" style={{ width: "100%" }} value={delivery} onChange={(e) => setDelivery(e.target.value)}>
            <option>Standard · 7 days</option><option>Express · 3 days</option><option>Framework · agreed rate</option>
          </select>
        </div>
        <div className="reqbox" style={{ background: "var(--flame-soft)", color: "#0c6f82", borderColor: "transparent" }}>
          <div className="rl">Control</div>
          The vendor must have cleared sanctions screening. The PO closes only when the goods-received note and invoice match on quantity.
        </div>
      </div>
      <div className="mf">
        <button className="btn" onClick={closePO}>Cancel</button>
        <button className="btn primary" onClick={() => { if (!vendor) { toast("Pick a cleared vendor", "Onboard and screen a vendor before raising a PO"); return; } if (q <= 0 || price <= 0) { toast("Check the line", "Quantity and unit price are required"); return; } submitPO(vendor, delivery, q, price); }}>Create Purchase Order</button>
      </div>
    </ModalShell>
  );
}

/* ================= NEW VENDOR ================= */
export function VendorModal() {
  const { vendorOpen, closeVendorForm, createVendor, toast } = useApp();
  const [name, setName] = useState("");
  const [category, setCategory] = useState("");
  const [country, setCountry] = useState("Kenya");
  const [kraPin, setKraPin] = useState("");
  const [bank, setBank] = useState("");
  useEffect(() => {
    if (vendorOpen) { setName(""); setCategory(""); setCountry("Kenya"); setKraPin(""); setBank(""); }
  }, [vendorOpen]);
  function save() {
    if (!name.trim()) { toast("Name the vendor", "What's the supplier called?"); return; }
    createVendor({ name: name.trim(), category: category.trim(), country: country.trim() || "Kenya", kraPin: kraPin.trim(), bank: bank.trim() });
  }
  return (
    <ModalShell open={vendorOpen} onClose={closeVendorForm} width={500}>
      <div className="mh"><h3>Onboard a vendor</h3><p>Registers the supplier. Sanctions screening comes next — a vendor can't be awarded a PO until it clears.</p></div>
      <div className="mb">
        <div><label>Vendor name</label><input className="field" placeholder="e.g. BURN Manufacturing" value={name} onChange={(e) => setName(e.target.value)} /></div>
        <div style={{ display: "flex", gap: 12 }}>
          <div style={{ flex: 1 }}><label>Category</label><input className="field" style={{ width: "100%" }} placeholder="e.g. Fabrication" value={category} onChange={(e) => setCategory(e.target.value)} /></div>
          <div style={{ width: 150 }}><label>Country</label><input className="field" style={{ width: "100%" }} value={country} onChange={(e) => setCountry(e.target.value)} /></div>
        </div>
        <div style={{ display: "flex", gap: 12 }}>
          <div style={{ flex: 1 }}><label>KRA PIN <span style={{ textTransform: "none", fontWeight: 400, letterSpacing: 0 }}>· tax status</span></label><input className="field" style={{ width: "100%" }} placeholder="A00…" value={kraPin} onChange={(e) => setKraPin(e.target.value)} /></div>
          <div style={{ flex: 1 }}><label>Bank <span style={{ textTransform: "none", fontWeight: 400, letterSpacing: 0 }}>· for payment</span></label><input className="field" style={{ width: "100%" }} placeholder="e.g. Equity ·001…" value={bank} onChange={(e) => setBank(e.target.value)} /></div>
        </div>
      </div>
      <div className="mf">
        <button className="btn" onClick={closeVendorForm}>Cancel</button>
        <button className="btn primary" onClick={save}>Onboard vendor</button>
      </div>
    </ModalShell>
  );
}

/* ================= RECORD GOODS-RECEIVED NOTE (by quantity) ================= */
export function GrnModal() {
  const { grnFor, closeGrn, recordGrn, poRows, toast } = useApp();
  const eligible = poRows.filter((p) => p.state === "open" || p.state === "partially_received");
  const [poId, setPoId] = useState("");
  const [qtyNow, setQtyNow] = useState("");
  const [note, setNote] = useState("");
  const [over, setOver] = useState<"accept" | "reject">("reject");
  const [photo, setPhoto] = useState<File | null>(null);
  useEffect(() => {
    if (grnFor) { setPoId(grnFor.id); setQtyNow(""); setNote(""); setOver("reject"); setPhoto(null); }
  }, [grnFor]);
  const po = poRows.find((p) => p.id === poId);
  const ordered = po?.qty ?? 0;
  const already = po?.received ?? 0;
  const remaining = Math.max(ordered - already, 0);
  const now = parseFloat(qtyNow) || 0;
  const isOver = now > remaining && remaining > 0;
  function save() {
    if (!poId) { toast("Pick a PO", "Which purchase order was delivered?"); return; }
    if (now <= 0) { toast("Enter a quantity", "How many units arrived now?"); return; }
    if (!photo) { toast("Photo required", "Attach a photo of the delivery"); return; }
    recordGrn(poId, now, note.trim(), isOver ? over : "", photo);
  }
  return (
    <ModalShell open={!!grnFor} onClose={closeGrn} width={500}>
      <div className="mh"><h3>Record goods received</h3><p>Confirms the quantity that arrived against a PO. The receiver must differ from the requester.</p></div>
      <div className="mb">
        <div>
          <label>Purchase order</label>
          <select className="field" style={{ width: "100%" }} value={poId} onChange={(e) => setPoId(e.target.value)}>
            {eligible.length === 0 && <option value="">No open POs</option>}
            {eligible.map((p) => <option key={p.id} value={p.id}>{p.id} · {p.vendor}</option>)}
          </select>
        </div>
        {po && (
          <table className="tbl" style={{ marginTop: 4 }}>
            <thead><tr><th>Line</th><th>Qty ordered</th><th>Already received</th><th>Receiving now</th></tr></thead>
            <tbody>
              <tr>
                <td>{po.vendor}<small style={{ color: "var(--ink-soft)", display: "block" }}>@ {po.unitPrice.toLocaleString()} / unit</small></td>
                <td className="mono">{ordered}</td>
                <td className="mono">{already}</td>
                <td><input className="field" style={{ width: 90, padding: "4px 8px" }} type="number" min="0" placeholder={String(remaining)} value={qtyNow} onChange={(e) => setQtyNow(e.target.value)} /></td>
              </tr>
            </tbody>
          </table>
        )}
        {isOver && (
          <div className="reqbox" style={{ background: "#FBEEE9", color: "var(--flame)", borderColor: "transparent" }}>
            <div className="rl">Over-delivery — {now} received, only {remaining} remaining</div>
            <div className="seg-ctl" style={{ marginTop: 6 }}>
              <button className={over === "reject" ? "on" : ""} onClick={() => setOver("reject")}>Reject excess (take {remaining})</button>
              <button className={over === "accept" ? "on" : ""} onClick={() => setOver("accept")}>Accept excess (amend PO)</button>
            </div>
          </div>
        )}
        <div><label>Condition / note</label><input className="field" placeholder="e.g. good condition" value={note} onChange={(e) => setNote(e.target.value)} /></div>
        <div>
          <label>Photo of delivery <span style={{ textTransform: "none", fontWeight: 400, letterSpacing: 0 }}>· required</span></label>
          <input className="field" type="file" accept="image/*" onChange={(e) => setPhoto(e.target.files?.[0] ?? null)} />
          {photo && <div className="meta" style={{ textTransform: "none", letterSpacing: 0, marginTop: 5 }}>{photo.name}</div>}
        </div>
      </div>
      <div className="mf">
        <button className="btn" onClick={closeGrn}>Cancel</button>
        <button className="btn primary" onClick={save} disabled={eligible.length === 0 || !photo}>Record GRN</button>
      </div>
    </ModalShell>
  );
}

/* ================= CAPTURE SUPPLIER INVOICE ================= */
export function CaptureInvoiceModal() {
  const { invoiceFor, closeCaptureInvoice, captureInvoice, poRows, appConfig, toast } = useApp();
  // must capture against an open/received PO (not cancelled, not already invoiced-closed handled server-side)
  const eligible = poRows.filter((p) => p.state !== "cancelled");
  const [poId, setPoId] = useState("");
  const [invNo, setInvNo] = useState("");
  const [invDate, setInvDate] = useState("");
  const [amount, setAmount] = useState("");
  const [currency, setCurrency] = useState("KES");
  const [wht, setWht] = useState(false);
  useEffect(() => {
    if (invoiceFor) { setPoId(invoiceFor.id); setAmount(String(invoiceFor.amt)); setInvNo(""); setInvDate(new Date().toISOString().slice(0, 10)); setCurrency("KES"); setWht(false); }
  }, [invoiceFor]);
  const po = poRows.find((p) => p.id === poId);
  const amt = parseFloat(amount) || 0;
  const whtRate = Number(appConfig.wht_rate_pct ?? 5);
  const whtAmt = wht ? Math.round(amt * whtRate / 100) : 0;
  function save() {
    if (!poId) { toast("Pick a PO", "Capture must be against an existing PO"); return; }
    if (amt <= 0) { toast("Enter an amount", "The invoice amount is required"); return; }
    if (!invNo.trim()) { toast("Invoice number required", "Needed for the duplicate check"); return; }
    captureInvoice({ poRef: poId, amount: amt, invoiceNumber: invNo.trim(), invoiceDate: invDate, currency, wht });
  }
  return (
    <ModalShell open={!!invoiceFor} onClose={closeCaptureInvoice} width={500}>
      <div className="mh"><h3>Capture supplier invoice</h3><p>Select the PO first — the vendor auto-fills. Runs the three-way match on save.</p></div>
      <div className="mb">
        <div>
          <label>Purchase order</label>
          <select className="field" style={{ width: "100%" }} value={poId} onChange={(e) => { setPoId(e.target.value); const m = eligible.find((x) => x.id === e.target.value); if (m) setAmount(String(m.amt)); }}>
            {eligible.length === 0 && <option value="">No POs</option>}
            {eligible.map((p) => <option key={p.id} value={p.id}>{p.id} · {p.vendor}</option>)}
          </select>
        </div>
        <div><label>Vendor <span style={{ textTransform: "none", fontWeight: 400, letterSpacing: 0 }}>· from the PO</span></label><input className="field" readOnly style={{ background: "#FCFAF6" }} value={po?.vendor || ""} /></div>
        <div style={{ display: "flex", gap: 12 }}>
          <div style={{ flex: 1 }}><label>Invoice number</label><input className="field" style={{ width: "100%" }} placeholder="e.g. INV-2291" value={invNo} onChange={(e) => setInvNo(e.target.value)} /></div>
          <div style={{ width: 160 }}><label>Invoice date</label><input className="field" style={{ width: "100%" }} type="date" value={invDate} onChange={(e) => setInvDate(e.target.value)} /></div>
        </div>
        <div style={{ display: "flex", gap: 12 }}>
          <div style={{ flex: 1 }}><label>Amount</label><input className="field" style={{ width: "100%" }} type="number" min="0" value={amount} onChange={(e) => setAmount(e.target.value)} /></div>
          <div style={{ width: 120 }}>
            <label>Currency</label>
            <select className="field" style={{ width: "100%" }} value={currency} onChange={(e) => setCurrency(e.target.value)}>
              <option>KES</option><option>USD</option>
            </select>
          </div>
        </div>
        <div className="row" style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "6px 0" }}>
          <div><label style={{ margin: 0 }}>Subject to withholding tax</label><div style={{ fontSize: 11.5, color: "var(--ink-soft)" }}>e.g. consultancy — {whtRate}% deducted at payment</div></div>
          <input type="checkbox" checked={wht} onChange={(e) => setWht(e.target.checked)} style={{ width: 18, height: 18, accentColor: "var(--flame)" }} />
        </div>
        {wht && amt > 0 && (
          <div className="recon" style={{ padding: "8px 0" }}><span>WHT ({whtRate}%) withheld · net to vendor</span><span className="mono">{whtAmt.toLocaleString()} · {(amt - whtAmt).toLocaleString()}</span></div>
        )}
      </div>
      <div className="mf">
        <button className="btn" onClick={closeCaptureInvoice}>Cancel</button>
        <button className="btn primary" onClick={save} disabled={eligible.length === 0}>Capture &amp; match</button>
      </div>
    </ModalShell>
  );
}

/* ================= RECORD AR RECEIPT ================= */
export function ReceiptModal() {
  const { receiptFor, closeReceipt, recordReceipt, toast } = useApp();
  const [amount, setAmount] = useState("");
  const [method, setMethod] = useState("bank");
  useEffect(() => {
    if (receiptFor) { setAmount(String(receiptFor.tot)); setMethod("bank"); }
  }, [receiptFor]);
  function save() {
    if (!receiptFor) return;
    const amt = parseFloat(amount) || 0;
    if (amt <= 0) { toast("Enter an amount", "The receipt amount is required"); return; }
    recordReceipt(receiptFor.id, amt, method);
  }
  return (
    <ModalShell open={!!receiptFor} onClose={closeReceipt} width={460}>
      <div className="mh"><h3>Record a receipt</h3><p>{receiptFor ? `Collection against ${receiptFor.id} · ${receiptFor.cust}` : "Collection"}</p></div>
      <div className="mb">
        <div style={{ display: "flex", gap: 12 }}>
          <div style={{ flex: 1 }}><label>Amount (KES)</label><input className="field" style={{ width: "100%" }} type="number" min="0" value={amount} onChange={(e) => setAmount(e.target.value)} /></div>
          <div style={{ width: 150 }}>
            <label>Method</label>
            <select className="field" style={{ width: "100%" }} value={method} onChange={(e) => setMethod(e.target.value)}>
              <option value="bank">Bank</option><option value="mpesa">M-Pesa</option>
            </select>
          </div>
        </div>
      </div>
      <div className="mf">
        <button className="btn" onClick={closeReceipt}>Cancel</button>
        <button className="btn primary" onClick={save}>Record receipt</button>
      </div>
    </ModalShell>
  );
}

/* ================= AMEND A PURCHASE ORDER ================= */
export function PoAmendModal() {
  const { poAmendFor, closePoAmend, amendPo, appConfig, toast } = useApp();
  const [amount, setAmount] = useState("");
  const [delivery, setDelivery] = useState("");
  const [reason, setReason] = useState("");
  useEffect(() => {
    if (poAmendFor) { setAmount(String(poAmendFor.amt)); setDelivery(poAmendFor.delivery || ""); setReason(""); }
  }, [poAmendFor]);
  const tol = Number(appConfig.po_amend_tolerance_pct ?? 5);
  const newAmt = parseFloat(amount) || 0;
  const deltaPct = poAmendFor && poAmendFor.amt > 0 ? Math.abs(newAmt - poAmendFor.amt) / poAmendFor.amt * 100 : 0;
  const willReapprove = deltaPct > tol;
  function save() {
    if (newAmt <= 0) { toast("Enter an amount", "The amended value is required"); return; }
    if (!reason.trim()) { toast("Give a reason", "Amendments must say why the PO changed"); return; }
    amendPo(poAmendFor!.id, newAmt, delivery.trim(), reason.trim());
  }
  return (
    <ModalShell open={!!poAmendFor} onClose={closePoAmend} width={480}>
      <div className="mh"><h3>Amend purchase order</h3><p>{poAmendFor ? `${poAmendFor.id} · ${poAmendFor.vendor}` : ""}</p></div>
      <div className="mb">
        <div style={{ display: "flex", gap: 12 }}>
          <div style={{ flex: 1 }}><label>New value (KES)</label><input className="field" style={{ width: "100%" }} type="number" min="0" value={amount} onChange={(e) => setAmount(e.target.value)} /></div>
          <div style={{ flex: 1 }}><label>Delivery</label><input className="field" style={{ width: "100%" }} value={delivery} onChange={(e) => setDelivery(e.target.value)} /></div>
        </div>
        <div><label>Reason</label><input className="field" placeholder="e.g. supplier price increase" value={reason} onChange={(e) => setReason(e.target.value)} /></div>
        {newAmt > 0 && (
          <div className="reqbox" style={{ background: willReapprove ? "#FBEEE9" : "var(--flame-soft)", color: willReapprove ? "var(--flame)" : "#0c6f82", borderColor: "transparent" }}>
            <div className="rl">{willReapprove ? "Re-approval" : "Within tolerance"}</div>
            {deltaPct.toFixed(1)}% change vs {tol}% tolerance — {willReapprove ? "this routes back for approval before the vendor sees the change, and blocks invoicing until approved." : "applies immediately."}
          </div>
        )}
      </div>
      <div className="mf">
        <button className="btn" onClick={closePoAmend}>Cancel</button>
        <button className="btn primary" onClick={save}>Amend PO</button>
      </div>
    </ModalShell>
  );
}

/* ================= VENDOR BANK-DETAIL CHANGE (request) ================= */
export function BankChangeModal() {
  const { bankChangeFor, closeBankChange, requestBankChange, toast } = useApp();
  const [bank, setBank] = useState("");
  useEffect(() => { if (bankChangeFor) setBank(""); }, [bankChangeFor]);
  function save() {
    if (!bank.trim()) { toast("Enter the new account", "The new bank details are required"); return; }
    requestBankChange(bankChangeFor!, bank.trim());
  }
  return (
    <ModalShell open={!!bankChangeFor} onClose={closeBankChange} width={460}>
      <div className="mh"><h3>Change bank details</h3><p>{bankChangeFor ? `For ${bankChangeFor}` : ""}</p></div>
      <div className="mb">
        <div><label>New bank account</label><input className="field" placeholder="e.g. KCB · 1234567890" value={bank} onChange={(e) => setBank(e.target.value)} /></div>
        <div className="reqbox" style={{ background: "#FBEEE9", color: "var(--flame)", borderColor: "transparent" }}>
          <div className="rl">Security control</div>
          This won't take effect until a different Finance user verifies it by phoning the vendor on the number already on file. Payments keep going to the current account until then.
        </div>
      </div>
      <div className="mf">
        <button className="btn" onClick={closeBankChange}>Cancel</button>
        <button className="btn primary" onClick={save}>Submit for verification</button>
      </div>
    </ModalShell>
  );
}

/* ================= RAISE SALES INVOICE ================= */
export function InvoiceModal() {
  const { invOpen, closeInvoice, submitInvoice, toast } = useApp();
  const [cust, setCust] = useState("Makueni County VTCs");
  const [desc, setDesc] = useState("");
  const [amtStr, setAmtStr] = useState("");
  const [due, setDue] = useState("week");
  const inputRef = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (invOpen) {
      setCust("Makueni County VTCs"); setDesc(""); setAmtStr(""); setDue("week");
      setTimeout(() => inputRef.current?.focus(), 60);
    }
  }, [invOpen]);

  const net = parseFloat(amtStr) || 0;
  const vat = net * 0.16;
  const tot = net + vat;

  function submit() {
    if (!net) { toast("Add an amount", "Needed to raise the invoice"); return; }
    submitInvoice(cust, desc.trim(), net, due);
  }

  return (
    <ModalShell open={invOpen} onClose={closeInvoice} width={500}>
      <div className="mh"><h3>Raise a sales invoice</h3><p>eTIMS-compliant · to an institution or customer</p></div>
      <div className="mb">
        <div>
          <label>Bill to</label>
          <select className="field" style={{ width: "100%" }} value={cust} onChange={(e) => setCust(e.target.value)}>
            <option>Makueni County VTCs</option><option>Catholic Diocese — Machakos</option><option>Kiambu cluster</option><option>CLASP</option><option>Nakuru institutions</option>
          </select>
        </div>
        <div><label>Description</label><input ref={inputRef} className="field" placeholder="e.g. Institutional cookstoves — deployment batch" value={desc} onChange={(e) => setDesc(e.target.value)} /></div>
        <div style={{ display: "flex", gap: 12 }}>
          <div style={{ flex: 1 }}>
            <label>Net amount (KES)</label>
            <input className="field" type="number" min="0" placeholder="0" style={{ width: "100%" }} value={amtStr} onChange={(e) => setAmtStr(e.target.value)} />
          </div>
          <div style={{ width: 150 }}>
            <label>Terms</label>
            <select className="field" style={{ width: "100%" }} value={due} onChange={(e) => setDue(e.target.value)}>
              <option value="today">On receipt</option><option value="week">14 days</option><option value="week30">30 days</option>
            </select>
          </div>
        </div>
        <div className="reqbox" style={{ background: "#FCFAF6", color: net > 0 ? "var(--ink)" : "var(--ink-soft)", borderColor: "transparent" }}>
          <div className="rl">VAT &amp; total</div>
          {net > 0 ? <>Net {kes(net)} · VAT 16% {kes(vat)} · <strong>Total {kes(tot)}</strong></> : "Enter an amount."}
        </div>
        <div className="reqbox" style={{ background: "var(--flame-soft)", color: "#0c6f82", borderColor: "transparent" }}>
          <div className="rl">eTIMS</div>
          The invoice is filed to KRA eTIMS on issue and tracked through to collection.
        </div>
      </div>
      <div className="mf">
        <button className="btn" onClick={closeInvoice}>Cancel</button>
        <button className="btn primary" onClick={submit}>Issue invoice</button>
      </div>
    </ModalShell>
  );
}

/* ================= APPLY FOR LEAVE ================= */
export function LeaveModal() {
  const { leaveOpen, closeLeave, applyLeave, updateLeave, leaveEdit, hrMe, toast } = useApp();
  const [kind, setKind] = useState("annual");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [reason, setReason] = useState("");
  useEffect(() => {
    if (leaveOpen) {
      setKind(leaveEdit?.kind ?? "annual");
      setFrom(leaveEdit?.from ?? "");
      setTo(leaveEdit?.to ?? "");
      setReason("");
    }
  }, [leaveOpen, leaveEdit]);

  const balances = hrMe?.leave ?? [];
  const bal = balances.find((b) => b.kind === kind);
  // when editing, the days this request already holds are released before the new hold is taken
  const held = leaveEdit && leaveEdit.kind === kind ? leaveEdit.days : 0;
  const available = (bal ? bal.entitled - bal.used - bal.reserved : 0) + held;
  const days = from && to ? Math.floor((new Date(to).getTime() - new Date(from).getTime()) / 86400000) + 1 : 0;
  const over = days > 0 && days > available;

  function submit() {
    if (!from || !to) { toast("Pick both dates", "When does the leave start and end?"); return; }
    if (days < 1) { toast("Check the dates", "The end date is before the start date"); return; }
    if (over) { toast("Not enough balance", `${days} days requested — only ${available} available`); return; }
    if (leaveEdit) updateLeave(leaveEdit.id, kind, from, to, reason);
    else applyLeave(kind, from, to, reason);
  }

  return (
    <ModalShell open={leaveOpen} onClose={closeLeave} width={500}>
      <div className="mh">
        <h3>{leaveEdit ? `Edit request ${leaveEdit.id}` : "Apply for leave"}</h3>
        <p>{leaveEdit ? "You can change a request until HR decides — the held days move with it." : "Days are held against your balance and the request routes to HR for approval."}</p>
      </div>
      <div className="mb">
        <div>
          <label>Leave type</label>
          <select className="field" style={{ width: "100%" }} value={kind} onChange={(e) => setKind(e.target.value)}>
            {(balances.length ? balances : [{ kind: "annual", entitled: 0, used: 0, reserved: 0, year: 0 }]).map((b) => (
              <option key={b.kind} value={b.kind}>
                {b.kind.charAt(0).toUpperCase() + b.kind.slice(1)} — {b.entitled - b.used - b.reserved + (leaveEdit?.kind === b.kind ? leaveEdit.days : 0)} of {b.entitled} days left
              </option>
            ))}
          </select>
        </div>
        <div style={{ display: "flex", gap: 12 }}>
          <div style={{ flex: 1 }}>
            <label>First day</label>
            <input className="field" type="date" style={{ width: "100%" }} value={from} onChange={(e) => setFrom(e.target.value)} />
          </div>
          <div style={{ flex: 1 }}>
            <label>Last day</label>
            <input className="field" type="date" style={{ width: "100%" }} value={to} onChange={(e) => setTo(e.target.value)} />
          </div>
        </div>
        <div><label>Reason (optional)</label><input className="field" placeholder={leaveEdit ? "Leave blank to keep the current reason" : "e.g. Family travel"} value={reason} onChange={(e) => setReason(e.target.value)} /></div>
        <div className="reqbox" style={over
          ? { background: "var(--red-soft)", color: "var(--red)", borderColor: "transparent" }
          : { background: "#FCFAF6", color: days > 0 ? "var(--ink)" : "var(--ink-soft)", borderColor: "transparent" }}>
          <div className="rl">Balance check</div>
          {days > 0
            ? over
              ? <>That's <strong>{days} days</strong> — you have {available} available. Shorten the range.</>
              : <><strong>{days} {days === 1 ? "day" : "days"}</strong> · {available - days} will remain available after this request.</>
            : "Pick the dates to check your balance."}
        </div>
      </div>
      <div className="mf">
        <button className="btn" onClick={closeLeave}>Cancel</button>
        <button className="btn primary" onClick={submit}>{leaveEdit ? "Save changes" : "Submit request"}</button>
      </div>
    </ModalShell>
  );
}

/* Small labelled <select> that draws its options from the editable crm_dropdown_options
   lookup table (via bootstrap → crm.dropdowns), so lists extend without a code change. */
function PickField({ label, value, onChange, options }: {
  label: string; value: string; onChange: (v: string) => void; options: string[];
}) {
  return (
    <div>
      <label>{label}</label>
      <select className="field" style={{ width: "100%" }} value={value} onChange={(e) => onChange(e.target.value)}>
        {options.length === 0 && <option value="">—</option>}
        {options.map((o) => <option key={o} value={o}>{o}</option>)}
      </select>
    </div>
  );
}

/* ================= NEW ENGAGEMENT ================= */
export function EngagementModal() {
  const { engFormOpen, closeEngForm, createEngagement, crm, members, me, toast } = useApp();
  const [name, setName] = useState("");
  const [pipeline, setPipeline] = useState<"up" | "down">("up");
  const [owner, setOwner] = useState("");
  const [due, setDue] = useState("week");
  const [note, setNote] = useState("");
  const [tagged, setTagged] = useState("");
  const [file, setFile] = useState<File | null>(null);

  useEffect(() => {
    if (engFormOpen) { setName(""); setPipeline("up"); setDue("week"); setNote(""); setTagged(""); setFile(null); setOwner(crm.teamNames[0] ?? ""); }
  }, [engFormOpen, crm.teamNames]);

  // Anyone with a login can be tagged, except yourself (you'd be notifying yourself).
  const taggable = members.filter((m) => m.email !== me?.email);

  function save() {
    if (!name.trim()) { toast("Name the partner", "Which organisation is this engagement with?"); return; }
    if (!owner) { toast("Pick an owner", "Who's carrying this engagement?"); return; }
    createEngagement(name.trim(), owner, pipeline, due, note, tagged, file);
  }

  return (
    <ModalShell open={engFormOpen} onClose={closeEngForm} width={500}>
      <div className="mh"><h3>New engagement</h3><p>Gets an auto reference (ENG- upstream, DST- downstream) and lands in the pipeline.</p></div>
      <div className="mb">
        <div><label>Partner / organisation</label><input className="field" placeholder="e.g. Charm Impact" value={name} onChange={(e) => setName(e.target.value)} /></div>
        <div>
          <label>Pipeline</label>
          <div className="seg-ctl">
            <button className={pipeline === "up" ? "on" : ""} onClick={() => setPipeline("up")}>Upstream · capital</button>
            <button className={pipeline === "down" ? "on" : ""} onClick={() => setPipeline("down")}>Downstream · deployment</button>
          </div>
        </div>
        <div style={{ display: "flex", gap: 12 }}>
          <div style={{ flex: 1 }}><PickField label="Owner" value={owner} onChange={setOwner} options={crm.teamNames} /></div>
          <div style={{ flex: 1 }}>
            <label>Next action due</label>
            <select className="field" style={{ width: "100%" }} value={due} onChange={(e) => setDue(e.target.value)}>
              <option value="today">Today</option>
              <option value="week">This week</option>
              <option value="nweek">Next week</option>
              <option value="over">Overdue</option>
            </select>
          </div>
        </div>
        <div>
          <label>Where we are on the discussion</label>
          <textarea
            className="field"
            style={{ width: "100%", minHeight: 88, resize: "vertical", fontFamily: "inherit" }}
            placeholder="e.g. Intro call done — they've asked for our data pack and a follow-up in two weeks."
            value={note}
            onChange={(e) => setNote(e.target.value)}
          />
        </div>
        <div>
          <label>Tag a teammate <span style={{ textTransform: "none", fontWeight: 400, letterSpacing: 0 }}>· optional</span></label>
          <select className="field" style={{ width: "100%" }} value={tagged} onChange={(e) => setTagged(e.target.value)}>
            <option value="">No one — don't notify anyone</option>
            {taggable.map((m) => <option key={m.email} value={m.email}>{m.name}</option>)}
          </select>
          {tagged && <div className="meta" style={{ textTransform: "none", letterSpacing: 0, marginTop: 5 }}>They'll get a bell notification and an email about this engagement.</div>}
        </div>
        <div>
          <label>Document <span style={{ textTransform: "none", fontWeight: 400, letterSpacing: 0 }}>· optional</span></label>
          <input className="field" type="file" onChange={(e) => setFile(e.target.files?.[0] ?? null)} />
          {file && <div className="meta" style={{ textTransform: "none", letterSpacing: 0, marginTop: 5 }}>{file.name} — attaches to this engagement</div>}
        </div>
      </div>
      <div className="mf">
        <button className="btn" onClick={closeEngForm}>Cancel</button>
        <button className="btn primary" onClick={save}>Create engagement</button>
      </div>
    </ModalShell>
  );
}

/* ================= LOG ENGAGEMENT UPDATE ================= */
export function EngUpdateModal() {
  const { engUpdateOpen, closeEngUpdate, engId, crm, logEngagementNote, toast } = useApp();
  const eng = [...crm.engUp, ...crm.engDown].find((e) => e.id === engId) || null;
  const pipeline: "up" | "down" = crm.engDown.some((e) => e.id === engId) ? "down" : "up";
  const ladder = engStages[pipeline];

  const [channel, setChannel] = useState("Note");
  const [who, setWho] = useState("");
  const [note, setNote] = useState("");
  const [stageTo, setStageTo] = useState("");
  const [file, setFile] = useState<File | null>(null);

  useEffect(() => {
    if (engUpdateOpen) {
      setChannel("Note"); setNote(""); setFile(null); setWho(crm.teamNames[0] ?? "");
      // default the stage picker to where the engagement already sits (or the first rung)
      setStageTo(eng && ladder.includes(eng.st) ? eng.st : ladder[0] ?? "");
    }
    /* eslint-disable-next-line react-hooks/exhaustive-deps */
  }, [engUpdateOpen]);

  function save() {
    if (!note.trim()) { toast("Add a note", "What happened in this update?"); return; }
    if (!engId) return;
    logEngagementNote(engId, { channel, who, note: note.trim(), stageTo, file });
  }

  const curIdx = eng ? ladder.indexOf(eng.st) : -1;
  const toIdx = ladder.indexOf(stageTo);
  const moved = eng && stageTo && stageTo !== eng.st;

  return (
    <ModalShell open={engUpdateOpen} onClose={closeEngUpdate} width={520}>
      <div className="mh">
        <h3>Log update{eng ? ` · ${eng.n}` : ""}</h3>
        <p>Adds a dated entry to the engagement's log. Move the stage to green-light it forward — everyone who opens this record sees the progress.</p>
      </div>
      <div className="mb">
        <div style={{ display: "flex", gap: 12 }}>
          <div style={{ flex: 1 }}>
            <label>Channel</label>
            <select className="field" style={{ width: "100%" }} value={channel} onChange={(e) => setChannel(e.target.value)}>
              {engChannels.map((c) => <option key={c} value={c}>{c}</option>)}
            </select>
          </div>
          <div style={{ flex: 1 }}><PickField label="Who" value={who} onChange={setWho} options={crm.teamNames} /></div>
        </div>
        <div>
          <label>What happened</label>
          <textarea
            className="field"
            style={{ width: "100%", minHeight: 88, resize: "vertical", fontFamily: "inherit" }}
            placeholder="e.g. Reviewed the term sheet on the call — they're comfortable, moving to committed."
            value={note}
            onChange={(e) => setNote(e.target.value)}
          />
        </div>
        <div>
          <label>Move stage {curIdx >= 0 && <span className="meta" style={{ textTransform: "none", letterSpacing: 0 }}>· currently {eng!.st || "—"}</span>}</label>
          <select className="field" style={{ width: "100%" }} value={stageTo} onChange={(e) => setStageTo(e.target.value)}>
            {ladder.map((s, i) => <option key={s} value={s}>{i + 1}. {s}</option>)}
          </select>
          {moved && (
            <div className="meta" style={{ textTransform: "none", letterSpacing: 0, marginTop: 6, color: toIdx > curIdx ? "var(--green)" : "var(--ink-soft)" }}>
              {eng!.st || "—"} → {stageTo}{toIdx > curIdx ? "  ✓ advancing" : ""}
            </div>
          )}
        </div>
        <div>
          <label>Document <span style={{ textTransform: "none", fontWeight: 400, letterSpacing: 0 }}>· optional</span></label>
          <input className="field" type="file" onChange={(e) => setFile(e.target.files?.[0] ?? null)} />
          {file && <div className="meta" style={{ textTransform: "none", letterSpacing: 0, marginTop: 5 }}>{file.name} — attaches to this engagement</div>}
        </div>
      </div>
      <div className="mf">
        <button className="btn" onClick={closeEngUpdate}>Cancel</button>
        <button className="btn primary" onClick={save}>Save update</button>
      </div>
    </ModalShell>
  );
}

/* ================= NEW PARTNER ================= */
export function PartnerModal() {
  const { partnerOpen, closePartnerForm, createPartner, crm, toast } = useApp();
  const [name, setName] = useState("");
  const [type, setType] = useState("");
  const [country, setCountry] = useState("KE");
  const [owner, setOwner] = useState("");
  const [status, setStatus] = useState("");
  const [contactName, setContactName] = useState("");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const types = crm.dropdowns.partner_type ?? [];
  const statuses = crm.dropdowns.partner_status ?? [];

  useEffect(() => {
    if (partnerOpen) {
      setName(""); setCountry("KE"); setContactName(""); setEmail(""); setPhone("");
      setType(types[0] ?? ""); setStatus(statuses[0] ?? ""); setOwner(crm.teamNames[0] ?? "");
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [partnerOpen]);

  function save() {
    if (!name.trim()) { toast("Name the organisation", "What's the partner called?"); return; }
    if (!type) { toast("Pick a type", "How would you classify this partner?"); return; }
    if (!owner) { toast("Pick an owner", "Who manages this relationship?"); return; }
    if (!status) { toast("Pick a status", "Where's the relationship at?"); return; }
    createPartner({ name: name.trim(), type, country: country.trim() || "KE", owner, status,
      contactName: contactName.trim(), email: email.trim(), phone: phone.trim() });
  }

  return (
    <ModalShell open={partnerOpen} onClose={closePartnerForm} width={500}>
      <div className="mh"><h3>Add partner</h3><p>Registers an organisation in the partner registry.</p></div>
      <div className="mb">
        <div><label>Organisation</label><input className="field" placeholder="e.g. Stanbic Bank" value={name} onChange={(e) => setName(e.target.value)} /></div>
        <div style={{ display: "flex", gap: 12 }}>
          <div style={{ flex: 1 }}><PickField label="Type" value={type} onChange={setType} options={types} /></div>
          <div style={{ flex: 1 }}><label>Country</label><input className="field" style={{ width: "100%" }} placeholder="e.g. KE" value={country} onChange={(e) => setCountry(e.target.value)} /></div>
        </div>
        <div style={{ display: "flex", gap: 12 }}>
          <div style={{ flex: 1 }}><PickField label="Owner" value={owner} onChange={setOwner} options={crm.teamNames} /></div>
          <div style={{ flex: 1 }}><PickField label="Status" value={status} onChange={setStatus} options={statuses} /></div>
        </div>
        <div><label>Contact full name</label><input className="field" placeholder="e.g. Jane Wanjiru" value={contactName} onChange={(e) => setContactName(e.target.value)} /></div>
        <div style={{ display: "flex", gap: 12 }}>
          <div style={{ flex: 1 }}><label>Email</label><input className="field" style={{ width: "100%" }} type="email" placeholder="jane@partner.co" value={email} onChange={(e) => setEmail(e.target.value)} /></div>
          <div style={{ flex: 1 }}><label>Phone</label><input className="field" style={{ width: "100%" }} placeholder="+254…" value={phone} onChange={(e) => setPhone(e.target.value)} /></div>
        </div>
      </div>
      <div className="mf">
        <button className="btn" onClick={closePartnerForm}>Cancel</button>
        <button className="btn primary" onClick={save}>Add partner</button>
      </div>
    </ModalShell>
  );
}

/* ================= NEW OPPORTUNITY ================= */
export function OpportunityModal() {
  const { oppOpen, closeOppForm, createOpportunity, crm, toast } = useApp();
  const [name, setName] = useState("");
  const [type, setType] = useState("");
  const [deadline, setDeadline] = useState("");
  const [linkedTo, setLinkedTo] = useState("");
  const [status, setStatus] = useState("");
  const types = crm.dropdowns.opp_type ?? [];
  const statuses = crm.dropdowns.opp_status ?? [];

  useEffect(() => {
    if (oppOpen) {
      setName(""); setDeadline(""); setLinkedTo("");
      setType(types[0] ?? ""); setStatus(statuses[0] ?? "");
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [oppOpen]);

  function save() {
    if (!name.trim()) { toast("Name the opportunity", "What's the RFP / call / window?"); return; }
    if (!type) { toast("Pick a type", "How would you classify it?"); return; }
    if (!status) { toast("Pick a status", "Where are you with it?"); return; }
    createOpportunity(name.trim(), type, deadline.trim(), linkedTo.trim(), status);
  }

  return (
    <ModalShell open={oppOpen} onClose={closeOppForm} width={500}>
      <div className="mh"><h3>New opportunity</h3><p>Tracks an RFP, funding call or window on the opportunity map.</p></div>
      <div className="mb">
        <div><label>Opportunity</label><input className="field" placeholder="e.g. FCDO Uganda window" value={name} onChange={(e) => setName(e.target.value)} /></div>
        <div style={{ display: "flex", gap: 12 }}>
          <div style={{ flex: 1 }}><PickField label="Type" value={type} onChange={setType} options={types} /></div>
          <div style={{ flex: 1 }}><label>Deadline</label><input className="field" style={{ width: "100%" }} placeholder="e.g. Q3 / 9 Aug" value={deadline} onChange={(e) => setDeadline(e.target.value)} /></div>
        </div>
        <div style={{ display: "flex", gap: 12 }}>
          <div style={{ flex: 1 }}><label>Linked to</label><input className="field" style={{ width: "100%" }} placeholder="e.g. ENG (FCDO)" value={linkedTo} onChange={(e) => setLinkedTo(e.target.value)} /></div>
          <div style={{ flex: 1 }}><PickField label="Status" value={status} onChange={setStatus} options={statuses} /></div>
        </div>
      </div>
      <div className="mf">
        <button className="btn" onClick={closeOppForm}>Cancel</button>
        <button className="btn primary" onClick={save}>Create opportunity</button>
      </div>
    </ModalShell>
  );
}

/* ================= ADD RISK ================= */
export function RiskModal() {
  const { riskOpen, closeRiskForm, createRisk, crm, toast } = useApp();
  const [risk, setRisk] = useState("");
  const [category, setCategory] = useState("Delivery");
  const [likelihood, setLikelihood] = useState(3);
  const [impact, setImpact] = useState(3);
  const [mitigation, setMitigation] = useState("");
  const [owner, setOwner] = useState("");
  useEffect(() => {
    if (riskOpen) { setRisk(""); setCategory("Delivery"); setLikelihood(3); setImpact(3); setMitigation(""); setOwner(crm.teamNames[0] ?? ""); }
  }, [riskOpen, crm.teamNames]);

  const score = likelihood * impact;
  const sev = score >= 12 ? { txt: "High", bg: "var(--red-soft)", fg: "var(--red)" }
    : score >= 6 ? { txt: "Medium", bg: "#FDF3E3", fg: "#8a5a12" }
    : { txt: "Low", bg: "#FCFAF6", fg: "var(--ink-soft)" };

  function save() {
    if (!risk.trim()) { toast("Describe the risk", "What could go wrong?"); return; }
    createRisk({ risk: risk.trim(), category, likelihood, impact, mitigation: mitigation.trim(), owner });
  }

  return (
    <ModalShell open={riskOpen} onClose={closeRiskForm} width={520}>
      <div className="mh"><h3>Log a risk</h3><p>Gets an RSK- reference; severity is likelihood × impact.</p></div>
      <div className="mb">
        <div><label>Risk</label><input className="field" placeholder="e.g. Single-funder dependency (Wave 1)" value={risk} onChange={(e) => setRisk(e.target.value)} /></div>
        <div style={{ display: "flex", gap: 12 }}>
          <div style={{ flex: 1 }}>
            <label>Category</label>
            <select className="field" style={{ width: "100%" }} value={category} onChange={(e) => setCategory(e.target.value)}>
              <option>Funding</option><option>Market</option><option>Supply</option><option>Delivery</option><option>People</option><option>Compliance</option>
            </select>
          </div>
          <div style={{ flex: 1 }}><PickField label="Owner" value={owner} onChange={setOwner} options={crm.teamNames} /></div>
        </div>
        <div style={{ display: "flex", gap: 12 }}>
          <div style={{ flex: 1 }}>
            <label>Likelihood (1–5)</label>
            <select className="field" style={{ width: "100%" }} value={likelihood} onChange={(e) => setLikelihood(Number(e.target.value))}>
              {[1, 2, 3, 4, 5].map((n) => <option key={n} value={n}>{n}</option>)}
            </select>
          </div>
          <div style={{ flex: 1 }}>
            <label>Impact (1–5)</label>
            <select className="field" style={{ width: "100%" }} value={impact} onChange={(e) => setImpact(Number(e.target.value))}>
              {[1, 2, 3, 4, 5].map((n) => <option key={n} value={n}>{n}</option>)}
            </select>
          </div>
        </div>
        <div><label>Mitigation</label><input className="field" placeholder="e.g. Diversify pipeline — 7 funders live" value={mitigation} onChange={(e) => setMitigation(e.target.value)} /></div>
        <div className="reqbox" style={{ background: sev.bg, color: sev.fg, borderColor: "transparent" }}>
          <div className="rl">Severity</div>
          <strong>{sev.txt}</strong> · score {score} (L{likelihood} × I{impact})
        </div>
      </div>
      <div className="mf">
        <button className="btn" onClick={closeRiskForm}>Cancel</button>
        <button className="btn primary" onClick={save}>Log risk</button>
      </div>
    </ModalShell>
  );
}

/* ================= UPLOAD POLICY / NEW VERSION ================= */
export function PolicyModal() {
  const { policyOpen, closePolicyForm, addPolicy, toast } = useApp();
  const [code, setCode] = useState("");
  const [title, setTitle] = useState("");
  const [effectiveFrom, setEffectiveFrom] = useState("");
  const [file, setFile] = useState<File | null>(null);
  useEffect(() => {
    if (policyOpen) { setCode(""); setTitle(""); setEffectiveFrom(""); setFile(null); }
  }, [policyOpen]);

  function save() {
    if (!code.trim()) { toast("Add a reference", "e.g. IGN-GOV-002"); return; }
    if (!title.trim()) { toast("Name the policy", "What's the document called?"); return; }
    addPolicy({ code: code.trim(), title: title.trim(), effectiveFrom, file });
  }

  return (
    <ModalShell open={policyOpen} onClose={closePolicyForm} width={500}>
      <div className="mh"><h3>Upload policy / new version</h3><p>Re-using an existing reference supersedes the current version and bumps the version number.</p></div>
      <div className="mb">
        <div style={{ display: "flex", gap: 12 }}>
          <div style={{ width: 180 }}><label>Reference</label><input className="field" style={{ width: "100%" }} placeholder="IGN-GOV-002" value={code} onChange={(e) => setCode(e.target.value)} /></div>
          <div style={{ flex: 1 }}><label>Effective from</label><input className="field" type="date" style={{ width: "100%" }} value={effectiveFrom} onChange={(e) => setEffectiveFrom(e.target.value)} /></div>
        </div>
        <div><label>Title</label><input className="field" placeholder="e.g. Code of Conduct" value={title} onChange={(e) => setTitle(e.target.value)} /></div>
        <div>
          <label>Document <span style={{ textTransform: "none", fontWeight: 400, letterSpacing: 0 }}>· optional</span></label>
          <input className="field" type="file" onChange={(e) => setFile(e.target.files?.[0] ?? null)} />
          {file && <div className="meta" style={{ textTransform: "none", letterSpacing: 0, marginTop: 5 }}>{file.name} — attaches to this version</div>}
        </div>
      </div>
      <div className="mf">
        <button className="btn" onClick={closePolicyForm}>Cancel</button>
        <button className="btn primary" onClick={save}>Save policy</button>
      </div>
    </ModalShell>
  );
}

/* ================= ADD COMPANY DOCUMENT ================= */
export function DocumentModal() {
  const { docOpen, closeDocForm, addCompanyDocument, toast } = useApp();
  const [name, setName] = useState("");
  const [kind, setKind] = useState("statutory");
  const [expiresOn, setExpiresOn] = useState("");
  const [file, setFile] = useState<File | null>(null);
  useEffect(() => {
    if (docOpen) { setName(""); setKind("statutory"); setExpiresOn(""); setFile(null); }
  }, [docOpen]);

  function save() {
    if (!name.trim()) { toast("Name the document", "e.g. Single Business Permit"); return; }
    addCompanyDocument({ name: name.trim(), kind, expiresOn, file });
  }

  return (
    <ModalShell open={docOpen} onClose={closeDocForm} width={500}>
      <div className="mh"><h3>Add / upload document</h3><p>Statutory documents are versioned and access-controlled. Leave expiry blank for documents that don't expire.</p></div>
      <div className="mb">
        <div><label>Document</label><input className="field" placeholder="e.g. Single Business Permit" value={name} onChange={(e) => setName(e.target.value)} /></div>
        <div style={{ display: "flex", gap: 12 }}>
          <div style={{ flex: 1 }}>
            <label>Kind</label>
            <select className="field" style={{ width: "100%" }} value={kind} onChange={(e) => setKind(e.target.value)}>
              <option value="statutory">Statutory</option><option value="licence">Licence</option><option value="registration">Registration</option>
            </select>
          </div>
          <div style={{ flex: 1 }}><label>Expiry <span style={{ textTransform: "none", fontWeight: 400, letterSpacing: 0 }}>· optional</span></label><input className="field" type="date" style={{ width: "100%" }} value={expiresOn} onChange={(e) => setExpiresOn(e.target.value)} /></div>
        </div>
        <div>
          <label>Document <span style={{ textTransform: "none", fontWeight: 400, letterSpacing: 0 }}>· optional</span></label>
          <input className="field" type="file" onChange={(e) => setFile(e.target.files?.[0] ?? null)} />
          {file && <div className="meta" style={{ textTransform: "none", letterSpacing: 0, marginTop: 5 }}>{file.name} — attaches to this document</div>}
        </div>
      </div>
      <div className="mf">
        <button className="btn" onClick={closeDocForm}>Cancel</button>
        <button className="btn primary" onClick={save}>Save document</button>
      </div>
    </ModalShell>
  );
}

/* ================= ADD CONTRACT ================= */
export function ContractModal() {
  const { contractOpen, closeContractForm, addContract, toast } = useApp();
  const [counterparty, setCounterparty] = useState("");
  const [kind, setKind] = useState("vendor");
  const [title, setTitle] = useState("");
  const [detail, setDetail] = useState("");
  const [expiresOn, setExpiresOn] = useState("");
  useEffect(() => {
    if (contractOpen) { setCounterparty(""); setKind("vendor"); setTitle(""); setDetail(""); setExpiresOn(""); }
  }, [contractOpen]);

  function save() {
    if (!counterparty.trim()) { toast("Name the counterparty", "Who's the contract with?"); return; }
    if (!title.trim()) { toast("Name the contract", "e.g. Cookstove supply framework"); return; }
    addContract({ counterparty: counterparty.trim(), kind, title: title.trim(), detail: detail.trim(), expiresOn });
  }

  return (
    <ModalShell open={contractOpen} onClose={closeContractForm} width={500}>
      <div className="mh"><h3>Add contract</h3><p>Registers an agreement in the contracts registry — Procurement and CRM read the same records.</p></div>
      <div className="mb">
        <div style={{ display: "flex", gap: 12 }}>
          <div style={{ flex: 1 }}><label>Counterparty</label><input className="field" style={{ width: "100%" }} placeholder="e.g. BURN Manufacturing" value={counterparty} onChange={(e) => setCounterparty(e.target.value)} /></div>
          <div style={{ width: 150 }}>
            <label>Type</label>
            <select className="field" style={{ width: "100%" }} value={kind} onChange={(e) => setKind(e.target.value)}>
              <option value="vendor">Vendor</option><option value="funder">Funder</option><option value="customer">Customer</option><option value="partner">Partner</option>
            </select>
          </div>
        </div>
        <div><label>Contract</label><input className="field" placeholder="e.g. Cookstove supply framework" value={title} onChange={(e) => setTitle(e.target.value)} /></div>
        <div><label>Detail <span style={{ textTransform: "none", fontWeight: 400, letterSpacing: 0 }}>· optional</span></label><input className="field" placeholder="e.g. Framework · agreed rates" value={detail} onChange={(e) => setDetail(e.target.value)} /></div>
        <div><label>Expiry <span style={{ textTransform: "none", fontWeight: 400, letterSpacing: 0 }}>· optional</span></label><input className="field" type="date" style={{ width: "100%" }} value={expiresOn} onChange={(e) => setExpiresOn(e.target.value)} /></div>
      </div>
      <div className="mf">
        <button className="btn" onClick={closeContractForm}>Cancel</button>
        <button className="btn primary" onClick={save}>Add contract</button>
      </div>
    </ModalShell>
  );
}

/* ================= NEW / EDIT PROJECT ================= */
export function ProjectModal() {
  const { projectFormOpen, closeProjectForm, createProject, projectEdit, closeProjectEdit, updateProject, projectDetails, crm, toast } = useApp();
  const editing = projectEdit != null;
  const open = projectFormOpen || editing;
  const onClose = editing ? closeProjectEdit : closeProjectForm;
  const [name, setName] = useState("");
  const [funder, setFunder] = useState("");
  const [budget, setBudget] = useState("");
  const [startDate, setStartDate] = useState("");
  const [endDate, setEndDate] = useState("");
  const [team, setTeam] = useState("");
  const [status, setStatus] = useState("Setup");
  const [location, setLocation] = useState("");
  const [currency, setCurrency] = useState<"KES" | "USD">("KES");
  const rate = useUsdKesRate();
  useEffect(() => {
    if (!open) return;
    if (editing) {
      const p = projectDetails[projectEdit!];
      setName(projectEdit!); setFunder(p?.funder && p.funder !== "—" ? p.funder : "");
      setBudget(p?.budgetAmount ? String(p.budgetAmount) : "");
      setStartDate(p?.startDate ?? ""); setEndDate(p?.endDate ?? "");
      setStatus(p?.status || "Setup"); setTeam(p?.team ?? ""); setLocation(p?.location ?? ""); setCurrency("KES");
    } else {
      setName(""); setFunder(""); setBudget(""); setStartDate(""); setEndDate(""); setStatus("Setup"); setTeam(crm.teamNames[0] ?? ""); setLocation(""); setCurrency("KES");
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, editing, projectEdit]);

  async function save() {
    if (!name.trim()) { toast("Name the project", "What's the project called?"); return; }
    const entered = parseFloat(budget) || 0;
    if (entered <= 0) { toast("Budget is required", `Enter the total budget in ${currency} — milestones draw against it`); return; }
    if (startDate && endDate && endDate < startDate) { toast("Check the dates", "The end date can't be before the start date"); return; }
    // money is stored in KES (the base currency); convert a USD budget at the current rate
    let budgetAmount = entered;
    if (currency === "USD") {
      const r = rate ?? await getUsdKesRate();
      budgetAmount = Math.round(entered * r);
    }
    if (editing) {
      const id = projectDetails[projectEdit!]?.id;
      if (!id) { toast("Project not found", "Reload and try again"); return; }
      updateProject(id, { funder: funder.trim(), budgetAmount, startDate, endDate, team, status, location: location.trim() });
    } else {
      createProject({ name: name.trim(), funder: funder.trim(), budgetAmount, startDate, endDate, team, status, location: location.trim() });
    }
  }

  return (
    <ModalShell open={open} onClose={onClose} width={520}>
      <div className="mh"><h3>{editing ? "Edit project" : "New project"}</h3><p>{editing ? "Update this project's budget, dates, owner and location." : "Creates a project on its own code — budget, milestones, drawdowns and field activity track against it."}</p></div>
      <div className="mb">
        <div><label>Project name</label><input className="field" placeholder="e.g. Makueni VTC rollout" value={name} onChange={(e) => setName(e.target.value)} disabled={editing} /></div>
        <div style={{ display: "flex", gap: 12 }}>
          <div style={{ flex: 1 }}><label>Funder <span style={{ textTransform: "none", fontWeight: 400, letterSpacing: 0 }}>· optional</span></label><input className="field" style={{ width: "100%" }} placeholder="e.g. Charm Impact" value={funder} onChange={(e) => setFunder(e.target.value)} /></div>
          <div style={{ width: 96 }}>
            <label>Currency</label>
            <select className="field" style={{ width: "100%" }} value={currency} onChange={(e) => setCurrency(e.target.value as "KES" | "USD")}>
              <option value="KES">KES</option><option value="USD">USD</option>
            </select>
          </div>
          <div style={{ width: 150 }}><label>Budget ({currency})</label><input className="field" style={{ width: "100%" }} type="number" min="0" placeholder={currency === "USD" ? "e.g. 25000" : "e.g. 3200000"} value={budget} onChange={(e) => setBudget(e.target.value)} /></div>
        </div>
        {currency === "USD" && (parseFloat(budget) || 0) > 0 && (
          <div style={{ fontSize: 11.5, color: "var(--ink-soft)", marginTop: -6 }}>
            ≈ KES {Math.round((parseFloat(budget) || 0) * (rate ?? FALLBACK_USD_KES)).toLocaleString()} at 1 USD = KES {(rate ?? FALLBACK_USD_KES).toFixed(2)}{rate ? " (live)" : ""} · stored in KES
          </div>
        )}
        <div><label>Location <span style={{ textTransform: "none", fontWeight: 400, letterSpacing: 0 }}>· where the work happens</span></label><input className="field" placeholder="e.g. Makueni County" value={location} onChange={(e) => setLocation(e.target.value)} /></div>
        <div style={{ display: "flex", gap: 12 }}>
          <div style={{ flex: 1 }}><label>Start date</label><input className="field" style={{ width: "100%" }} type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} /></div>
          <div style={{ flex: 1 }}><label>End date</label><input className="field" style={{ width: "100%" }} type="date" value={endDate} onChange={(e) => setEndDate(e.target.value)} /></div>
        </div>
        <div style={{ display: "flex", gap: 12 }}>
          <div style={{ flex: 1 }}><PickField label="Owner / team" value={team} onChange={setTeam} options={crm.teamNames} /></div>
          <div style={{ flex: 1 }}>
            <label>Status</label>
            <select className="field" style={{ width: "100%" }} value={status} onChange={(e) => setStatus(e.target.value)}>
              <option>Setup</option><option>On track</option><option>At risk</option><option>Complete</option>
            </select>
          </div>
        </div>
      </div>
      <div className="mf">
        <button className="btn" onClick={onClose}>Cancel</button>
        <button className="btn primary" onClick={save}>{editing ? "Save changes" : "Create project"}</button>
      </div>
    </ModalShell>
  );
}

/* ================= NEW FIELD ACTIVITY (assign someone to check a site) ================= */
export function FieldActivityModal() {
  const { fieldActivityOpen, closeFieldActivity, createFieldActivity, projectDetails, toast } = useApp();
  const projectNames = Object.keys(projectDetails);
  const [project, setProject] = useState("");
  const [assignee, setAssignee] = useState("");
  const [phone, setPhone] = useState("");
  const [email, setEmail] = useState("");
  const [date, setDate] = useState("");
  const [note, setNote] = useState("");
  useEffect(() => {
    if (fieldActivityOpen) {
      setProject(projectNames[0] ?? ""); setAssignee(""); setPhone(""); setEmail("");
      setDate(new Date().toISOString().slice(0, 10)); setNote("");
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fieldActivityOpen]);

  function save() {
    if (!project) { toast("Pick a project", "Which project is this field activity for?"); return; }
    if (!assignee.trim()) { toast("Who's going?", "Enter the name of the person assigned"); return; }
    createFieldActivity({ projectName: project, assignee: assignee.trim(), phone: phone.trim(), email: email.trim(), date, note: note.trim() });
  }

  return (
    <ModalShell open={fieldActivityOpen} onClose={closeFieldActivity} width={500}>
      <div className="mh"><h3>Add field activity</h3><p>Assign someone to visit a site — e.g. "go fix the pipes at Makueni". Logged against the project.</p></div>
      <div className="mb">
        <div>
          <label>Project</label>
          <select className="field" style={{ width: "100%" }} value={project} onChange={(e) => setProject(e.target.value)}>
            {projectNames.length === 0 && <option value="">No projects yet — add one first</option>}
            {projectNames.map((n) => <option key={n} value={n}>{n}</option>)}
          </select>
        </div>
        <div><label>Assignee</label><input className="field" placeholder="e.g. Peter Otieno" value={assignee} onChange={(e) => setAssignee(e.target.value)} /></div>
        <div style={{ display: "flex", gap: 12 }}>
          <div style={{ flex: 1 }}><label>Phone</label><input className="field" style={{ width: "100%" }} placeholder="+254…" value={phone} onChange={(e) => setPhone(e.target.value)} /></div>
          <div style={{ flex: 1 }}><label>Email</label><input className="field" style={{ width: "100%" }} type="email" placeholder="peter@…" value={email} onChange={(e) => setEmail(e.target.value)} /></div>
        </div>
        <div style={{ width: 180 }}><label>Date</label><input className="field" style={{ width: "100%" }} type="date" value={date} onChange={(e) => setDate(e.target.value)} /></div>
        <div><label>Task note</label><input className="field" placeholder="e.g. Fix the water pipes at the test site" value={note} onChange={(e) => setNote(e.target.value)} /></div>
      </div>
      <div className="mf">
        <button className="btn" onClick={closeFieldActivity}>Cancel</button>
        <button className="btn primary" onClick={save} disabled={projectNames.length === 0}>Assign</button>
      </div>
    </ModalShell>
  );
}
