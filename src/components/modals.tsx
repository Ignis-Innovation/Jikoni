// Modals: invite member, assign task, raise requisition (live budget check +
// approval routing), raise PO from an approved requisition, raise sales invoice.
import React, { useEffect, useRef, useState } from "react";
import { useApp } from "../store";
import { budgetLines, kes, reqRouting, reqBudgetState } from "../data";

export function ModalShell({ open, onClose, width, children }: { open: boolean; onClose: () => void; width?: number; children: React.ReactNode }) {
  return (
    <div className={`modal-bg ${open ? "show" : ""}`} onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="modal" style={width ? { width } : undefined}>{children}</div>
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
  const { engFormOpen, closeEngForm, createEngagement, crm, toast } = useApp();
  const [name, setName] = useState("");
  const [pipeline, setPipeline] = useState<"up" | "down">("up");
  const [owner, setOwner] = useState("");
  const [due, setDue] = useState("week");
  const [note, setNote] = useState("");

  useEffect(() => {
    if (engFormOpen) { setName(""); setPipeline("up"); setDue("week"); setNote(""); setOwner(crm.teamNames[0] ?? ""); }
  }, [engFormOpen, crm.teamNames]);

  function save() {
    if (!name.trim()) { toast("Name the partner", "Which organisation is this engagement with?"); return; }
    if (!owner) { toast("Pick an owner", "Who's carrying this engagement?"); return; }
    createEngagement(name.trim(), owner, pipeline, due, note);
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
      </div>
      <div className="mf">
        <button className="btn" onClick={closeEngForm}>Cancel</button>
        <button className="btn primary" onClick={save}>Create engagement</button>
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
  const types = crm.dropdowns.partner_type ?? [];
  const statuses = crm.dropdowns.partner_status ?? [];

  useEffect(() => {
    if (partnerOpen) {
      setName(""); setCountry("KE");
      setType(types[0] ?? ""); setStatus(statuses[0] ?? ""); setOwner(crm.teamNames[0] ?? "");
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [partnerOpen]);

  function save() {
    if (!name.trim()) { toast("Name the organisation", "What's the partner called?"); return; }
    if (!type) { toast("Pick a type", "How would you classify this partner?"); return; }
    if (!owner) { toast("Pick an owner", "Who manages this relationship?"); return; }
    if (!status) { toast("Pick a status", "Where's the relationship at?"); return; }
    createPartner(name.trim(), type, country.trim() || "KE", owner, status);
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
