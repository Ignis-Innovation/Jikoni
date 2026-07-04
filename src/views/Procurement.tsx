import { useApp, Req } from "../store";
import { Pulse, Note } from "../components/ui";
import { Donut, ChartLegend, VBars } from "../components/charts";
import { PlusI } from "../components/icons";
import { Crumb } from "../nav";

const pulse = [
  { k: "Open POs", tick: "t-ember", v: "12", d: "3 awaiting you", dc: "flat" as const },
  { k: "Awaiting GRN", tick: "t-ember", v: "4", d: "deliveries due", dc: "flat" as const },
  { k: "To match", tick: "t-blue", v: "6", d: "invoices", dc: "flat" as const },
  { k: "Match exceptions", tick: "t-red", v: "1", d: "payment held", dc: "down" as const },
  { k: "Spend MTD", tick: "t-blue", v: "KES 1.1M", d: "vs budget", dc: "flat" as const },
  { k: "Active vendors", tick: "t-blue", v: "23", d: "all screened", dc: "flat" as const },
];
const cat = [
  { l: "Cookstoves", v: 520, c: "#12A3BE", d: "520k" },
  { l: "Fabrication", v: 180, c: "#E2632A", d: "180k" },
  { l: "Logistics", v: 150, c: "#3C8A5E", d: "150k" },
  { l: "Field / per-diems", v: 120, c: "#6D28D9", d: "120k" },
  { l: "Admin / IT", v: 90, c: "#A89C8E", d: "90k" },
];

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

export default function ProcurementView() {
  const { tabs, toast, goTab, openReq, openVendor, reqs, newPOs } = useApp();
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
          <Pulse data={pulse} />
          <div className="grid g-2">
            <div className="panel">
              <div className="panel-h"><h3>Spend by category</h3><span className="meta">this quarter</span></div>
              <div className="pad" style={{ display: "flex", alignItems: "center", gap: 24 }}>
                <Donut segs={cat} big="1.06M" small="spend" />
                <div style={{ flex: 1 }}><ChartLegend segs={cat} /></div>
              </div>
            </div>
            <div className="panel">
              <div className="panel-h"><h3>Spend — last 6 months</h3><span className="meta">KES millions</span></div>
              <div className="pad">
                <VBars items={[{ l: "Jan", v: 0.7 }, { l: "Feb", v: 1.1 }, { l: "Mar", v: 0.9 }, { l: "Apr", v: 1.3 }, { l: "May", v: 1.0 }, { l: "Jun", v: 1.1 }]} color="#12A3BE" />
              </div>
            </div>
          </div>
          <div className="panel" style={{ marginTop: 18 }}>
            <div className="panel-h"><h3>Procure-to-pay</h3><span className="meta">where things stand</span></div>
            <div className="pad">
              <div className="steps">
                <div className="step done"><span className="sdot">✓</span>Requisition</div><div className="step-arrow" />
                <div className="step done"><span className="sdot">✓</span>Sourcing / RFQ</div><div className="step-arrow" />
                <div className="step done"><span className="sdot">✓</span>Purchase order</div><div className="step-arrow" />
                <div className="step now"><span className="sdot">4</span>Goods received</div><div className="step-arrow" />
                <div className="step"><span className="sdot">5</span>Match &amp; pay</div>
              </div>
            </div>
          </div>
          <div className="panel" style={{ marginTop: 18 }}>
            <div className="panel-h"><h3>Needs attention</h3><span className="meta">across the chain</span></div>
            <div className="task" onClick={() => goTab("procurement", "p-req")}>
              <span className="id" style={{ color: "var(--ember)" }}>PR-208</span>
              <span className="txt">Field per diems — awaiting your approval<small className="mono">KES 96,000</small></span>
              <span className="pill today">Approve</span>
            </div>
            <div className="task" onClick={() => goTab("procurement", "p-grn")}>
              <span className="id" style={{ color: "var(--ember)" }}>PO-059</span>
              <span className="txt">Cooker batch — partial delivery, GRN pending<small>BURN Manufacturing</small></span>
              <span className="pill today">Receive</span>
            </div>
            <div className="task" onClick={() => goTab("procurement", "p-grn")}>
              <span className="id" style={{ color: "var(--red)" }}>INV-2284</span>
              <span className="txt">Safaricom invoice — 3-way match variance<small>quantity mismatch</small></span>
              <span className="pill over">Exception</span>
            </div>
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
                <tr style={{ cursor: "pointer" }} onClick={() => openVendor("BURN Manufacturing")}><td><strong>BURN Manufacturing</strong></td><td>Cookstoves</td><td><span className="rcv ok">compliant</span></td><td><span className="rcv ok">cleared ✓</span></td><td className="mono">4.8</td></tr>
                <tr style={{ cursor: "pointer" }} onClick={() => openVendor("Nakuru Fabricators")}><td><strong>Nakuru Fabricators</strong></td><td>Fabrication</td><td><span className="rcv ok">compliant</span></td><td><span className="rcv ok">cleared ✓</span></td><td className="mono">4.4</td></tr>
                <tr style={{ cursor: "pointer" }} onClick={() => openVendor("Equity Logistics")}><td><strong>Equity Logistics</strong></td><td>Transport</td><td><span className="rcv ok">compliant</span></td><td><span className="rcv ok">cleared ✓</span></td><td className="mono">4.2</td></tr>
                <tr style={{ cursor: "pointer" }} onClick={() => openVendor("Safaricom")}><td><strong>Safaricom</strong></td><td>Telecoms / data</td><td><span className="rcv ok">compliant</span></td><td><span className="rcv ok">cleared ✓</span></td><td className="mono">4.6</td></tr>
                <tr style={{ cursor: "pointer" }} onClick={() => openVendor("Mombasa Freight Co.")}><td><strong>Mombasa Freight Co.</strong></td><td>Clearing</td><td><span className="rcv no">pending PIN</span></td><td><span className="rcv no">in screening</span></td><td className="mono">—</td></tr>
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
                {reqs.map((r) => (
                  <tr key={r.id}>
                    <td className="mono">{r.id}</td>
                    <td>{r.item}</td>
                    <td style={{ fontSize: 12 }}>{r.code}</td>
                    <td className="mono">{r.amt.toLocaleString()}</td>
                    <td><span className={`rcv ${r.chip}`}>{r.chipTxt}</span></td>
                    <td><ReqStatusCell r={r} /></td>
                  </tr>
                ))}
                <tr><td className="mono">PR-208</td><td>Field per diems — Makueni</td><td style={{ fontSize: 12 }}>Field · Makueni</td><td className="mono">96,000</td><td><span className="rcv ok">within</span></td><td><span className="pill today">Awaiting you</span></td></tr>
                <tr><td className="mono">PR-207</td><td>Cooker spares batch</td><td style={{ fontSize: 12 }}>Deployment</td><td className="mono">142,000</td><td><span className="rcv ok">within</span></td><td><span className="pill done">Approved → PO</span></td></tr>
                <tr><td className="mono">PR-206</td><td>Laptops ×2</td><td style={{ fontSize: 12 }}>Admin</td><td className="mono">210,000</td><td><span className="rcv no">over 80%</span></td><td><span className="pill week">MD review</span></td></tr>
                <tr><td className="mono">PR-205</td><td>Enumerator airtime</td><td style={{ fontSize: 12 }}>Field / MRV</td><td className="mono">24,000</td><td><span className="rcv ok">within</span></td><td><span className="pill done">Approved</span></td></tr>
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
                {newPOs.map((p) => (
                  <tr key={p.id}>
                    <td className="mono">{p.id}</td>
                    <td><span style={{ cursor: "pointer", color: "var(--flame)" }} onClick={() => openVendor(p.vendor)}>{p.vendor}</span></td>
                    <td className="mono">{p.amt.toLocaleString()}</td>
                    <td className="mono">{p.delivery}</td>
                    <td><span className="pill week">Open</span></td>
                  </tr>
                ))}
                <tr><td className="mono">PO-061</td><td>Nakuru Fabricators</td><td className="mono">142,000</td><td className="mono">Due 8 Jul</td><td><span className="pill week">Open</span></td></tr>
                <tr><td className="mono">PO-059</td><td>BURN Manufacturing</td><td className="mono">640,000</td><td className="mono">Partial</td><td><span className="pill today">Partially received</span></td></tr>
                <tr><td className="mono">PO-058</td><td>Equity Logistics</td><td className="mono">142,000</td><td className="mono">Delivered</td><td><span className="pill done">Closed</span></td></tr>
                <tr><td className="mono">PO-056</td><td>Safaricom</td><td className="mono">38,500</td><td className="mono">Delivered</td><td><span className="pill over">Match variance</span></td></tr>
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
              <table className="tbl">
                <thead><tr><th>GRN</th><th>PO</th><th>Received</th><th>Evidence</th><th>Status</th></tr></thead>
                <tbody>
                  <tr><td className="mono">GRN-074</td><td className="mono">PO-059</td><td>Partial · 60%</td><td><span className="rcv ok">photo</span></td><td><span className="pill today">Open</span></td></tr>
                  <tr><td className="mono">GRN-073</td><td className="mono">PO-058</td><td>Full</td><td><span className="rcv ok">photo</span></td><td><span className="pill done">Matched</span></td></tr>
                  <tr><td className="mono">GRN-072</td><td className="mono">PO-056</td><td>Full</td><td><span className="rcv no">none</span></td><td><span className="pill over">Variance</span></td></tr>
                </tbody>
              </table>
            </div>
            <div className="panel">
              <div className="panel-h"><h3>Three-way match</h3><span className="meta">PO ↔ GRN ↔ invoice</span></div>
              <div className="recon"><span>Matched &amp; ready to pay</span><span className="pill done">2</span></div>
              <div className="recon"><span>Awaiting GRN</span><span className="pill today">1</span></div>
              <div className="recon"><span>Exceptions — held</span><span className="pill over">1</span></div>
              <Note>No invoice is released for payment unless the PO authorised it and the GRN confirms it arrived. Exceptions block payment until resolved.</Note>
            </div>
          </div>
        </div>
      )}

      {tab === "p-rfq" && (
        <div className="proc-panel active">
          <div className="panel">
            <div className="panel-h"><h3>Sourcing event — cooker spares batch</h3><span className="meta">RFQ-014 · 3 quotes</span></div>
            <table className="tbl">
              <thead><tr><th>Vendor</th><th>Quote</th><th>Lead time</th><th>Score</th><th></th></tr></thead>
              <tbody>
                <tr><td>Nakuru Fabricators</td><td className="mono">142,000</td><td>5 days</td><td className="mono">92</td><td><span className="pill done">Recommended</span></td></tr>
                <tr><td>BURN Manufacturing</td><td className="mono">158,000</td><td>3 days</td><td className="mono">88</td><td>—</td></tr>
                <tr><td>Coast Metalworks</td><td className="mono">136,000</td><td>12 days</td><td className="mono">74</td><td>—</td></tr>
              </tbody>
            </table>
            <Note>Award recommendation carries a justification and routes for approval; single-source buys require a documented reason.</Note>
          </div>
        </div>
      )}

      {tab === "p-contracts" && (
        <div className="proc-panel active">
          <div className="panel">
            <div className="panel-h"><h3>Framework agreements &amp; contracts</h3><span className="meta">linked to the contract registry</span></div>
            <table className="tbl">
              <thead><tr><th>Contract</th><th>Vendor</th><th>Type</th><th>Expiry</th><th>Status</th></tr></thead>
              <tbody>
                <tr style={{ cursor: "pointer" }} onClick={() => openVendor("BURN Manufacturing")}><td><strong>Cookstove supply framework</strong></td><td>BURN Manufacturing</td><td>Framework · agreed rates</td><td className="mono">Dec 2026</td><td><span className="pill done">Active</span></td></tr>
                <tr style={{ cursor: "pointer" }} onClick={() => openVendor("Equity Logistics")}><td><strong>Logistics framework</strong></td><td>Equity Logistics</td><td>Framework</td><td className="mono">Mar 2027</td><td><span className="pill done">Active</span></td></tr>
                <tr style={{ cursor: "pointer" }} onClick={() => openVendor("Safaricom")}><td><strong>Data &amp; connectivity</strong></td><td>Safaricom</td><td>Service agreement</td><td className="mono">Sep 2026</td><td><span className="pill today">Renew soon</span></td></tr>
              </tbody>
            </table>
            <Note>Call-off orders draw against these frameworks at agreed rates. Documents live in Compliance &amp; Governance › contract registry.</Note>
          </div>
        </div>
      )}
    </>
  );
}
