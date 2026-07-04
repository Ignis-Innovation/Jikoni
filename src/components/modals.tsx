// Modals: invite member, assign task, raise requisition (live budget check +
// approval routing), raise PO from an approved requisition, raise sales invoice.
import React, { useEffect, useRef, useState } from "react";
import { useApp } from "../store";
import { budgetLines, kes, reqRouting, reqBudgetState } from "../data";

function ModalShell({ open, onClose, width, children }: { open: boolean; onClose: () => void; width?: number; children: React.ReactNode }) {
  return (
    <div className={`modal-bg ${open ? "show" : ""}`} onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="modal" style={width ? { width } : undefined}>{children}</div>
    </div>
  );
}

/* ================= INVITE ================= */
export function InviteModal() {
  const { inviteOpen, setInviteOpen, toast } = useApp();
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  useEffect(() => { if (inviteOpen) { setName(""); setEmail(""); } }, [inviteOpen]);

  function send() {
    const n = name.trim() || "New member";
    setInviteOpen(false);
    toast("Invite sent to " + n, "They'll set a password and enrol in 2FA");
  }

  return (
    <ModalShell open={inviteOpen} onClose={() => setInviteOpen(false)}>
      <div className="mh"><h3>Invite a member</h3><p>They'll get an email to set a password and enrol in two-factor.</p></div>
      <div className="mb">
        <div><label>Full name</label><input className="field" placeholder="e.g. Lily Achieng" value={name} onChange={(e) => setName(e.target.value)} /></div>
        <div><label>Work email</label><input className="field" placeholder="name@ignis.africa" value={email} onChange={(e) => setEmail(e.target.value)} /></div>
        <div>
          <label>Role &amp; access</label>
          <select className="field" defaultValue="std">
            <option value="admin">Admin — full access</option>
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

/* ================= ASSIGN TASK ================= */
export function TaskModal() {
  const { taskOpen, closeTask, saveTask, toast } = useApp();
  const [title, setTitle] = useState("");
  const [owner, setOwner] = useState("Wanjiku");
  const [due, setDue] = useState("week");
  const [link, setLink] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (taskOpen) {
      setTitle(""); setOwner("Wanjiku"); setDue("week"); setLink("");
      setTimeout(() => inputRef.current?.focus(), 60);
    }
  }, [taskOpen]);

  function save() {
    if (!title.trim()) { toast("Add a task description", "It can't be empty"); return; }
    saveTask(title.trim(), owner, due, link);
  }

  return (
    <ModalShell open={taskOpen} onClose={closeTask}>
      <div className="mh"><h3>Assign a task</h3><p>It lands in the assignee's My Week and notifies them.</p></div>
      <div className="mb">
        <div><label>Task</label><input ref={inputRef} className="field" placeholder="e.g. Send EAIF the updated financial model" value={title} onChange={(e) => setTitle(e.target.value)} /></div>
        <div style={{ display: "flex", gap: 12 }}>
          <div style={{ flex: 1 }}>
            <label>Assign to</label>
            <select className="field" style={{ width: "100%" }} value={owner} onChange={(e) => setOwner(e.target.value)}>
              <option>Wanjiku</option><option>Dennis</option><option>Brian</option><option>Joan</option><option>Wilson</option><option>Elizabeth</option><option>Lily</option>
            </select>
          </div>
          <div style={{ flex: 1 }}>
            <label>Due</label>
            <select className="field" style={{ width: "100%" }} value={due} onChange={(e) => setDue(e.target.value)}>
              <option value="today">Today</option><option value="week">This week</option><option value="nweek">Next week</option>
            </select>
          </div>
        </div>
        <div>
          <label>Link to (optional)</label>
          <select className="field" style={{ width: "100%" }} value={link} onChange={(e) => setLink(e.target.value)}>
            <option value="">— none —</option>
            <option>ENG-002 · IEA</option><option>ENG-012 · Charm Impact</option><option>DST-004 · Makueni VTC</option>
            <option>Finance &amp; Accounting</option><option>Deployment &amp; Carbon</option><option>Fundraise &amp; Diligence</option>
          </select>
        </div>
      </div>
      <div className="mf">
        <button className="btn" onClick={closeTask}>Cancel</button>
        <button className="btn primary" onClick={save}>Assign task</button>
      </div>
    </ModalShell>
  );
}

/* ================= RAISE REQUISITION ================= */
export function ReqModal() {
  const { reqOpen, closeReq, submitReq, toast } = useApp();
  const [item, setItem] = useState("");
  const [code, setCode] = useState("Deployment");
  const [amtStr, setAmtStr] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (reqOpen) {
      setItem(""); setCode("Deployment"); setAmtStr("");
      setTimeout(() => inputRef.current?.focus(), 60);
    }
  }, [reqOpen]);

  const a = parseFloat(amtStr) || 0;
  const b = a > 0 ? reqBudgetState(code, a) : null;
  const r = reqRouting(a);

  function submit() {
    if (!item.trim()) { toast("Add a description", "What are you requisitioning?"); return; }
    if (!a) { toast("Add an amount", "Needed for the budget check and routing"); return; }
    submitReq(item.trim(), a, code);
  }

  return (
    <ModalShell open={reqOpen} onClose={closeReq} width={500}>
      <div className="mh"><h3>Raise a requisition</h3><p>Budget is checked as you type; approval routes by amount.</p></div>
      <div className="mb">
        <div><label>What do you need?</label><input ref={inputRef} className="field" placeholder="e.g. Cooker spares — maintenance batch" value={item} onChange={(e) => setItem(e.target.value)} /></div>
        <div style={{ display: "flex", gap: 12 }}>
          <div style={{ flex: 1 }}>
            <label>Coding — cost centre / project</label>
            <select className="field" style={{ width: "100%" }} value={code} onChange={(e) => setCode(e.target.value)}>
              {Object.keys(budgetLines).map((k) => <option key={k}>{k}</option>)}
            </select>
          </div>
          <div style={{ width: 150 }}>
            <label>Amount (KES)</label>
            <input className="field" type="number" min="0" placeholder="0" style={{ width: "100%" }} value={amtStr} onChange={(e) => setAmtStr(e.target.value)} />
          </div>
        </div>
        <div className="reqbox" style={b ? { background: b.bg, color: b.fg, borderColor: "transparent" } : { background: "#FCFAF6", color: "var(--ink-soft)" }}>
          <div className="rl">Budget check</div>
          {b ? b.msg : "Enter an amount to check the budget."}
        </div>
        <div className="reqbox" style={{ background: "#FCFAF6", color: r ? "var(--ink)" : "var(--ink-soft)" }}>
          <div className="rl">Approval routing</div>
          {r ? <><strong>{r.label}</strong> — {r.who}.</> : "Set by amount, using Settings → Approvals."}
        </div>
      </div>
      <div className="mf">
        <button className="btn" onClick={closeReq}>Cancel</button>
        <button className="btn primary" onClick={submit}>Submit requisition</button>
      </div>
    </ModalShell>
  );
}

/* ================= RAISE PO ================= */
export function POModal() {
  const { poFor, closePO, submitPO } = useApp();
  const [vendor, setVendor] = useState("BURN Manufacturing");
  const [delivery, setDelivery] = useState("Standard · 7 days");
  useEffect(() => {
    if (poFor) { setVendor("BURN Manufacturing"); setDelivery("Standard · 7 days"); }
  }, [poFor]);

  return (
    <ModalShell open={!!poFor} onClose={closePO} width={500}>
      <div className="mh"><h3>Raise a purchase order</h3><p>{poFor ? `From requisition ${poFor.id} · ${poFor.code}` : "From requisition"}</p></div>
      <div className="mb">
        <div><label>Item</label><input className="field" readOnly style={{ background: "#FCFAF6" }} value={poFor?.item || ""} /></div>
        <div style={{ display: "flex", gap: 12 }}>
          <div style={{ flex: 1 }}>
            <label>Vendor</label>
            <select className="field" style={{ width: "100%" }} value={vendor} onChange={(e) => setVendor(e.target.value)}>
              <option>BURN Manufacturing</option><option>Nakuru Fabricators</option><option>Equity Logistics</option><option>Safaricom</option>
            </select>
          </div>
          <div style={{ width: 150 }}>
            <label>Value (KES)</label>
            <input className="field" readOnly style={{ width: "100%", background: "#FCFAF6" }} value={poFor ? poFor.amt.toLocaleString() : ""} />
          </div>
        </div>
        <div>
          <label>Delivery terms</label>
          <select className="field" style={{ width: "100%" }} value={delivery} onChange={(e) => setDelivery(e.target.value)}>
            <option>Standard · 7 days</option><option>Express · 3 days</option><option>Framework · agreed rate</option>
          </select>
        </div>
        <div className="reqbox" style={{ background: "var(--flame-soft)", color: "#0c6f82", borderColor: "transparent" }}>
          <div className="rl">Control</div>
          The vendor must have cleared sanctions screening. The PO closes only when the goods-received note and invoice match.
        </div>
      </div>
      <div className="mf">
        <button className="btn" onClick={closePO}>Cancel</button>
        <button className="btn primary" onClick={() => submitPO(vendor, delivery)}>Issue PO</button>
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
