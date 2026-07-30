import type { ReactNode } from "react";
import { useApp, Req } from "../store";
import { Pulse, Note } from "../components/ui";
import { PlusI } from "../components/icons";
import { Crumb } from "../nav";

function ReqStatusCell({ r }: { r: Req }) {
  const { approvePR, raisePO } = useApp();
  const approve = (
    <button className="btn" style={{ padding: "4px 9px", fontSize: 11, marginLeft: 7 }} onClick={() => approvePR(r.id)}>Approve</button>
  );
  if (r.status === "await") return <><span className="pill today">Awaiting approval</span>{approve}</>;
  if (r.status === "md") return <><span className="pill week">MD review</span>{approve}</>;
  if (r.status === "approved")
    return (
      <>
        <span className="pill done">Approved</span>
        <button className="btn primary" style={{ padding: "4px 9px", fontSize: 11, marginLeft: 7 }} onClick={() => raisePO(r.id)}>Raise PO →</button>
      </>
    );
  return <span className="pill done">Approved → PO</span>;
}

// Placeholder for a panel body with no live data yet.
function EmptyBody({ children }: { children: ReactNode }) {
  return <div className="pad" style={{ fontSize: 12.5, color: "var(--ink-soft)", padding: "34px 20px", textAlign: "center" }}>{children}</div>;
}

export default function ProcurementView() {
  const { tabs, toast, openReq, openVendor, reqs, newPOs } = useApp();
  const tab = tabs.procurement;

  return (
    <>
      <div className="vhead">
        <div>
          <h1>Procurement</h1>
          <p>Procure-to-pay on one chain — requisition, sourcing, PO, goods received and three-way match — with sanctions screening and every step audit-logged.</p>
        </div>
        <div className="actions">
          <button className="btn primary" onClick={openReq}><PlusI />New requisition</button>
        </div>
      </div>
      <Crumb view="procurement" />

      {tab === "p-over" && (
        <div className="proc-panel active">
          <Pulse data={[]} />
          <div className="grid g-2">
            <div className="panel">
              <div className="panel-h"><h3>Spend by category</h3><span className="meta">this quarter</span></div>
              <EmptyBody>No spend recorded yet.</EmptyBody>
            </div>
            <div className="panel">
              <div className="panel-h"><h3>Spend — last 6 months</h3><span className="meta">KES</span></div>
              <EmptyBody>No spend data yet.</EmptyBody>
            </div>
          </div>
          <div className="panel" style={{ marginTop: 18 }}>
            <div className="panel-h"><h3>Procure-to-pay</h3><span className="meta">where things stand</span></div>
            <div className="pad">
              <div className="steps">
                <div className="step"><span className="sdot">1</span>Requisition</div><div className="step-arrow" />
                <div className="step"><span className="sdot">2</span>Sourcing / RFQ</div><div className="step-arrow" />
                <div className="step"><span className="sdot">3</span>Purchase order</div><div className="step-arrow" />
                <div className="step"><span className="sdot">4</span>Goods received</div><div className="step-arrow" />
                <div className="step"><span className="sdot">5</span>Match &amp; pay</div>
              </div>
            </div>
          </div>
          <div className="panel" style={{ marginTop: 18 }}>
            <div className="panel-h"><h3>Needs attention</h3><span className="meta">across the chain</span></div>
            <EmptyBody>Nothing needs attention yet.</EmptyBody>
          </div>
        </div>
      )}

      {tab === "p-vendors" && (
        <div className="proc-panel active">
          <div className="panel">
            <div className="panel-h">
              <h3>Vendor registry</h3>
              <span className="meta">
                <a href="#" onClick={(e) => { e.preventDefault(); toast("New vendor", "Onboard with KRA PIN, tax status and sanctions screening"); }} style={{ color: "var(--flame)", textDecoration: "none" }}>+ Add vendor</a>
              </span>
            </div>
            <table className="tbl">
              <thead><tr><th>Vendor</th><th>Category</th><th>Tax status</th><th>Screening</th><th>Rating</th></tr></thead>
              <tbody>
                <tr><td colSpan={5} style={{ textAlign: "center", color: "var(--ink-soft)", padding: "18px 0" }}>No vendors onboarded yet — use “+ Add vendor”.</td></tr>
              </tbody>
            </table>
          </div>
        </div>
      )}

      {tab === "p-req" && (
        <div className="proc-panel active">
          <div className="panel">
            <div className="panel-h">
              <h3>Purchase requisitions</h3>
              <span className="meta">
                <a href="#" onClick={(e) => { e.preventDefault(); openReq(); }} style={{ color: "var(--flame)", textDecoration: "none" }}>+ New requisition</a>
              </span>
            </div>
            <table className="tbl">
              <thead><tr><th>PR</th><th>Item</th><th>Coding</th><th>Amount</th><th>Budget</th><th>Status</th></tr></thead>
              <tbody>
                {reqs.length === 0 ? (
                  <tr><td colSpan={6} style={{ textAlign: "center", color: "var(--ink-soft)", padding: "18px 0" }}>No requisitions yet — raise one with “+ New requisition”.</td></tr>
                ) : reqs.map((r) => (
                  <tr key={r.id}>
                    <td className="mono">{r.id}</td>
                    <td>{r.item}</td>
                    <td style={{ fontSize: 12 }}>{r.code}</td>
                    <td className="mono">{r.amt.toLocaleString()}</td>
                    <td><span className={`rcv ${r.chip}`}>{r.chipTxt}</span></td>
                    <td><ReqStatusCell r={r} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {tab === "p-po" && (
        <div className="proc-panel active">
          <div className="panel">
            <div className="panel-h"><h3>Purchase orders</h3><span className="meta">open · partial · closed</span></div>
            <table className="tbl">
              <thead><tr><th>PO</th><th>Vendor</th><th>Value</th><th>Delivery</th><th>Status</th></tr></thead>
              <tbody>
                {newPOs.length === 0 ? (
                  <tr><td colSpan={5} style={{ textAlign: "center", color: "var(--ink-soft)", padding: "18px 0" }}>No purchase orders yet — raise one from an approved requisition.</td></tr>
                ) : newPOs.map((p) => (
                  <tr key={p.id}>
                    <td className="mono">{p.id}</td>
                    <td><span style={{ cursor: "pointer", color: "var(--flame)" }} onClick={() => openVendor(p.vendor)}>{p.vendor}</span></td>
                    <td className="mono">{p.amt.toLocaleString()}</td>
                    <td className="mono">{p.delivery}</td>
                    <td><span className="pill week">Open</span></td>
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
                <span className="meta">
                  <a href="#" onClick={(e) => { e.preventDefault(); toast("New GRN", "Confirm delivery against a PO, with photo evidence"); }} style={{ color: "var(--flame)", textDecoration: "none" }}>+ Record delivery</a>
                </span>
              </div>
              <EmptyBody>No deliveries recorded yet.</EmptyBody>
            </div>
            <div className="panel">
              <div className="panel-h"><h3>Three-way match</h3><span className="meta">PO ↔ GRN ↔ invoice</span></div>
              <EmptyBody>Nothing to match yet.</EmptyBody>
              <Note>No invoice is released for payment unless the PO authorised it and the GRN confirms it arrived.</Note>
            </div>
          </div>
        </div>
      )}

      {tab === "p-rfq" && (
        <div className="proc-panel active">
          <div className="panel">
            <div className="panel-h"><h3>Sourcing events</h3><span className="meta">RFQs &amp; quotes</span></div>
            <EmptyBody>No sourcing events yet.</EmptyBody>
            <Note>Award recommendation carries a justification and routes for approval; single-source buys require a documented reason.</Note>
          </div>
        </div>
      )}

      {tab === "p-contracts" && (
        <div className="proc-panel active">
          <div className="panel">
            <div className="panel-h"><h3>Framework agreements &amp; contracts</h3><span className="meta">linked to the contract registry</span></div>
            <EmptyBody>No contracts yet.</EmptyBody>
            <Note>Call-off orders draw against frameworks at agreed rates. Documents live in Compliance &amp; Governance › contract registry.</Note>
          </div>
        </div>
      )}
    </>
  );
}
