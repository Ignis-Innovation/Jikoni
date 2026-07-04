import { useApp } from "../store";
import { Pulse, Note } from "../components/ui";
import { Donut, ChartLegend, VBars, StaticBars } from "../components/charts";
import { Crumb } from "../nav";

const pulse = [
  { k: "Cash position", tick: "t-blue", v: "KES 4.2M", d: "+8% wk", dc: "up" as const },
  { k: "Payables due", tick: "t-ember", v: "KES 1.1M", d: "this week", dc: "flat" as const },
  { k: "Receivables", tick: "t-blue", v: "KES 2.8M", d: "KES 612k overdue", dc: "down" as const },
  { k: "Runway", tick: "t-blue", v: "7.2 mo", d: "at current burn", dc: "flat" as const },
  { k: "PAYS expected", tick: "t-ember", v: "KES 340k", d: "vs 318k received", dc: "flat" as const },
  { k: "Approvals pending", tick: "t-red", v: "5", d: "3 yours", dc: "flat" as const },
];
const opex = [
  { l: "Deployment", v: 430, c: "#12A3BE", d: "430k" },
  { l: "Field / MRV", v: 260, c: "#E2632A", d: "260k" },
  { l: "Operations", v: 210, c: "#3C8A5E", d: "210k" },
  { l: "BD / Fundraise", v: 160, c: "#6D28D9", d: "160k" },
  { l: "Admin", v: 100, c: "#A89C8E", d: "100k" },
];
const approvals = [
  { id: "REQ-208", t: "Field per diems — Makueni enumerators", a: "KES 96,000", p: "today" },
  { id: "PCV-114", t: "Petty cash replenishment — Joan", a: "KES 48,200", p: "today" },
  { id: "PO-061", t: "Cooker spares — maintenance batch", a: "KES 142,000", p: "week" },
];

export default function FinanceView() {
  const { tabs, toast } = useApp();
  const tab = tabs.finance;
  const genBtn = (label: string, title: string, sub: string) => (
    <div className="recon"><span>{label}</span>
      <button className="btn" style={{ padding: "5px 11px", fontSize: 12 }} onClick={() => toast(title, sub)}>Generate</button>
    </div>
  );

  return (
    <>
      <div className="vhead">
        <div>
          <h1>Finance &amp; Accounting</h1>
          <p>One chart of accounts across the business — Kenya and Uganda kept separate, consolidated on demand. Covers GL, payables, receivables, bank &amp; cash, petty cash, costing, tax and audit controls.</p>
        </div>
        <div className="actions">
          <button className="btn" onClick={() => toast("Period: June 2026", "Open · closes for posting on 5 July")}>June 2026 · Open</button>
        </div>
      </div>
      <Crumb view="finance" />

      {tab === "f-over" && (
        <div className="fin-panel active">
          <Pulse data={pulse} />
          <div className="grid g-2">
            <div className="panel">
              <div className="panel-h"><h3>Where the money goes</h3><span className="meta">June operating expenses</span></div>
              <div className="pad" style={{ display: "flex", alignItems: "center", gap: 24 }}>
                <Donut segs={opex} big="1.16M" small="opex" />
                <div style={{ flex: 1 }}><ChartLegend segs={opex} /></div>
              </div>
            </div>
            <div className="panel">
              <div className="panel-h"><h3>Revenue — last 6 months</h3><span className="meta">KES millions</span></div>
              <div className="pad">
                <VBars items={[{ l: "Jan", v: 1.6 }, { l: "Feb", v: 1.9 }, { l: "Mar", v: 2.1 }, { l: "Apr", v: 2.0 }, { l: "May", v: 2.3 }, { l: "Jun", v: 2.4 }]} color="#12A3BE" />
              </div>
            </div>
          </div>
          <div className="grid g-2" style={{ marginTop: 18 }}>
            <div className="panel">
              <div className="panel-h"><h3>Income statement — June</h3><span className="meta">month to date · KES</span></div>
              <div className="row"><div className="rl">Revenue</div><span className="mono">2,410,000</span></div>
              <div className="row"><div className="rl">Cost of sales</div><span className="mono" style={{ color: "var(--red)" }}>− 980,000</span></div>
              <div className="row"><div className="rl" style={{ fontWeight: 600 }}>Gross profit</div><span className="mono" style={{ fontWeight: 600 }}>1,430,000</span></div>
              <div className="row"><div className="rl">Operating expenses</div><span className="mono" style={{ color: "var(--red)" }}>− 1,160,000</span></div>
              <div className="row"><div className="rl" style={{ fontWeight: 600 }}>Net surplus</div><span className="mono" style={{ fontWeight: 600, color: "var(--green)" }}>270,000</span></div>
            </div>
            <div className="panel">
              <div className="panel-h"><h3>Approvals waiting on you</h3><span className="meta">requisitions &amp; payments</span></div>
              <div>
                {approvals.map((r) => (
                  <div className="task" key={r.id} onClick={() => toast(r.id, "Approve, query, or route up")}>
                    <span className="id">{r.id}</span>
                    <span className="txt">{r.t}<small className="mono">{r.a}</small></span>
                    <span className={`pill ${r.p}`}>{r.p === "today" ? "Today" : "This week"}</span>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
      )}

      {tab === "f-gl" && (
        <div className="fin-panel active">
          <div className="grid g-2">
            <div className="panel">
              <div className="panel-h"><h3>Chart of accounts</h3><span className="meta">balances · KES</span></div>
              <div className="coa-grp">Assets</div>
              <div className="coa"><span>1000 · Bank &amp; cash</span><span className="mono">4,210,000</span></div>
              <div className="coa"><span>1200 · Accounts receivable</span><span className="mono">2,800,000</span></div>
              <div className="coa"><span>1500 · Fixed assets (cookers, equipment)</span><span className="mono">9,640,000</span></div>
              <div className="coa-grp">Liabilities</div>
              <div className="coa"><span>2000 · Accounts payable</span><span className="mono">1,940,000</span></div>
              <div className="coa"><span>2300 · Statutory payable (PAYE/NSSF/SHIF)</span><span className="mono">506,000</span></div>
              <div className="coa-grp">Income &amp; expense</div>
              <div className="coa"><span>4000 · Deployment revenue</span><span className="mono">2,410,000</span></div>
              <div className="coa"><span>5000 · Field &amp; operations</span><span className="mono">1,160,000</span></div>
            </div>
            <div className="panel">
              <div className="panel-h">
                <h3>Recent journal entries</h3>
                <span className="meta">
                  <a href="#" onClick={(e) => { e.preventDefault(); toast("New journal", "Opens a balanced double-entry form"); }} style={{ color: "var(--flame)", textDecoration: "none" }}>+ New journal</a>
                </span>
              </div>
              <table className="tbl">
                <thead><tr><th>Ref</th><th>Description</th><th>Debit</th><th>Credit</th><th></th></tr></thead>
                <tbody>
                  <tr><td className="mono">JE-0461</td><td>Cooker batch capitalised</td><td className="mono">420,000</td><td className="mono">420,000</td><td><span className="pill done">Posted</span></td></tr>
                  <tr><td className="mono">JE-0462</td><td>June payroll accrual</td><td className="mono">1,840,000</td><td className="mono">1,840,000</td><td><span className="pill done">Posted</span></td></tr>
                  <tr><td className="mono">JE-0463</td><td>FX revaluation — USD grant</td><td className="mono">96,400</td><td className="mono">96,400</td><td><span className="pill today">Draft</span></td></tr>
                  <tr><td className="mono">JE-0464</td><td>Depreciation — June</td><td className="mono">214,000</td><td className="mono">214,000</td><td><span className="pill today">Draft</span></td></tr>
                </tbody>
              </table>
            </div>
          </div>
          <div className="panel" style={{ marginTop: 18 }}>
            <div className="panel-h"><h3>Period &amp; close status</h3><span className="meta">trial balance in balance</span></div>
            <div className="recon"><span>May 2026</span><span className="pill done">Closed</span></div>
            <div className="recon"><span>June 2026</span><span className="pill today">Open · 2 drafts to post</span></div>
            <div className="recon"><span>FY 2026 year-end</span><span className="mono" style={{ color: "var(--ink-soft)" }}>31 Dec 2026</span></div>
          </div>
        </div>
      )}

      {tab === "f-ap" && (
        <div className="fin-panel active">
          <div className="panel" style={{ marginBottom: 18 }}>
            <div className="panel-h"><h3>Procure-to-pay</h3><span className="meta">three-way match</span></div>
            <div className="pad">
              <div className="steps">
                <div className="step done"><span className="sdot">✓</span>Purchase order</div><div className="step-arrow" />
                <div className="step done"><span className="sdot">✓</span>Goods received</div><div className="step-arrow" />
                <div className="step now"><span className="sdot">3</span>Supplier invoice</div><div className="step-arrow" />
                <div className="step"><span className="sdot">4</span>Payment</div>
              </div>
            </div>
          </div>
          <div className="grid g-2">
            <div className="panel">
              <div className="panel-h">
                <h3>Supplier invoices</h3>
                <span className="meta">
                  <a href="#" onClick={(e) => { e.preventDefault(); toast("Schedule payment", "Batch via M-Pesa Daraja or bank"); }} style={{ color: "var(--flame)", textDecoration: "none" }}>Schedule payment</a>
                </span>
              </div>
              <table className="tbl">
                <thead><tr><th>Vendor</th><th>Invoice</th><th>Amount</th><th>Match</th><th>Due</th></tr></thead>
                <tbody>
                  <tr><td>BURN Manufacturing</td><td className="mono">INV-2291</td><td className="mono">640,000</td><td><span className="rcv ok">3-way ✓</span></td><td><span className="pill today">Today</span></td></tr>
                  <tr><td>Equity logistics</td><td className="mono">INV-2288</td><td className="mono">142,000</td><td><span className="rcv ok">3-way ✓</span></td><td><span className="pill week">This week</span></td></tr>
                  <tr><td>Safaricom</td><td className="mono">INV-2284</td><td className="mono">38,500</td><td><span className="rcv no">variance</span></td><td><span className="pill over">Overdue</span></td></tr>
                  <tr><td>Nakuru fabricators</td><td className="mono">INV-2280</td><td className="mono">310,000</td><td><span className="rcv ok">3-way ✓</span></td><td><span className="pill week">This week</span></td></tr>
                </tbody>
              </table>
            </div>
            <div className="panel">
              <div className="panel-h"><h3>Payables aging</h3><span className="meta">KES 1.94M total</span></div>
              <div className="pad">
                <StaticBars rows={[
                  { l: "Current", n: "1,120k", w: 58, c: "var(--flame)" },
                  { l: "31–60 days", n: "505k", w: 26, c: "var(--ember)" },
                  { l: "61–90 days", n: "215k", w: 11, c: "var(--ember)" },
                  { l: "90+ days", n: "100k", w: 5, c: "var(--red)" },
                ]} />
              </div>
            </div>
          </div>
        </div>
      )}

      {tab === "f-ar" && <Receivables />}

      {tab === "f-bank" && (
        <div className="fin-panel active">
          <div className="grid g-2">
            <div className="panel">
              <div className="panel-h"><h3>Bank &amp; cash accounts</h3><span className="meta">live balances</span></div>
              <div className="recon"><div><div style={{ fontWeight: 600 }}>KCB — current (KES)</div><div className="mono" style={{ fontSize: 11, color: "var(--ink-soft)" }}>**** 4021</div></div><span className="mono">2,640,000</span></div>
              <div className="recon"><div><div style={{ fontWeight: 600 }}>Equity — USD grant a/c</div><div className="mono" style={{ fontSize: 11, color: "var(--ink-soft)" }}>**** 7788</div></div><span className="mono">$11,400</span></div>
              <div className="recon"><div><div style={{ fontWeight: 600 }}>M-Pesa paybill</div><div className="mono" style={{ fontSize: 11, color: "var(--ink-soft)" }}>Daraja float</div></div><span className="mono">118,000</span></div>
              <div className="recon"><div><div style={{ fontWeight: 600 }}>Petty cash (all funds)</div><div className="mono" style={{ fontSize: 11, color: "var(--ink-soft)" }}>3 custodians</div></div><span className="mono">62,300</span></div>
            </div>
            <div className="panel">
              <div className="panel-h">
                <h3>Reconciliation — June</h3>
                <span className="meta">
                  <a href="#" onClick={(e) => { e.preventDefault(); toast("Auto-match", "M-Pesa & bank statement lines matched to the ledger"); }} style={{ color: "var(--flame)", textDecoration: "none" }}>Auto-match</a>
                </span>
              </div>
              <div className="recon"><span>Statement lines imported</span><span className="mono">214</span></div>
              <div className="recon"><span>Auto-matched</span><span className="pill done">198</span></div>
              <div className="recon"><span>Unmatched — needs review</span><span className="pill today">16</span></div>
              <div className="recon"><span>Last reconciled</span><span className="mono" style={{ color: "var(--ink-soft)" }}>16 Jun</span></div>
            </div>
          </div>
          <div className="panel" style={{ marginTop: 18 }}>
            <div className="panel-h"><h3>8-week cash forecast</h3><span className="meta">projected position · KES</span></div>
            <div className="pad">
              <StaticBars rows={[
                { l: "Wk 1", n: "4.2M", w: 88, c: "var(--flame)" },
                { l: "Wk 2", n: "3.8M", w: 80, c: "var(--flame)" },
                { l: "Wk 3", n: "3.3M", w: 70, c: "var(--ember)" },
                { l: "Wk 4", n: "4.0M", w: 84, c: "var(--flame)" },
                { l: "Wk 5–8", n: "2.9M", w: 62, c: "var(--ember)" },
              ]} />
            </div>
          </div>
        </div>
      )}

      {tab === "f-petty" && (
        <div className="fin-panel active">
          <div className="panel" style={{ marginBottom: 18 }}>
            <div className="panel-h">
              <h3>Petty cash funds</h3>
              <span className="meta">
                <a href="#" onClick={(e) => { e.preventDefault(); toast("New voucher", "Standardised, auto-numbered payment voucher"); }} style={{ color: "var(--flame)", textDecoration: "none" }}>+ New voucher</a>
                &nbsp;·&nbsp;
                <a href="#" onClick={(e) => { e.preventDefault(); toast("Replenishment prepared", "Top-up routed to Joan for approval"); }} style={{ color: "var(--flame)", textDecoration: "none" }}>Replenish</a>
              </span>
            </div>
            <div className="fundgrid">
              <div className="fund">
                <div className="fc">Head Office</div>
                <div className="fb">KES 18,400</div>
                <div className="fm">of 30,000 float · Joan</div>
                <div className="fbar"><div className="ff" style={{ width: "61%", background: "var(--flame)" }} /></div>
                <div style={{ fontSize: 11, color: "var(--ink-soft)", marginTop: 7 }}>Above threshold</div>
              </div>
              <div className="fund">
                <div className="fc">Field Team — Makueni</div>
                <div className="fb">KES 6,900</div>
                <div className="fm">of 40,000 float · S. Mutiso</div>
                <div className="fbar"><div className="ff" style={{ width: "17%", background: "var(--ember)" }} /></div>
                <div style={{ fontSize: 11, color: "var(--ember)", marginTop: 7, fontWeight: 600 }}>Below min — replenish</div>
              </div>
              <div className="fund">
                <div className="fc">Project — Sierra Leone</div>
                <div className="fb">KES 37,000</div>
                <div className="fm">of 50,000 float · Grant-funded</div>
                <div className="fbar"><div className="ff" style={{ width: "74%", background: "var(--flame)" }} /></div>
                <div style={{ fontSize: 11, color: "var(--ink-soft)", marginTop: 7 }}>Above threshold</div>
              </div>
            </div>
          </div>
          <div className="grid g-2">
            <div className="panel">
              <div className="panel-h"><h3>Recent vouchers</h3><span className="meta">coded · receipt-backed</span></div>
              <table className="tbl">
                <thead><tr><th>Voucher</th><th>Category</th><th>Coding</th><th>Amount</th><th>Receipt</th><th>Status</th></tr></thead>
                <tbody>
                  <tr><td className="mono">PCV-118</td><td>Fuel</td><td style={{ fontSize: 12 }}>Field · Makueni</td><td className="mono">3,200</td><td><span className="rcv ok">attached</span></td><td><span className="pill done">Approved</span></td></tr>
                  <tr><td className="mono">PCV-117</td><td>Transport</td><td style={{ fontSize: 12 }}>Operations</td><td className="mono">1,450</td><td><span className="rcv ok">attached</span></td><td><span className="pill done">Approved</span></td></tr>
                  <tr><td className="mono">PCV-116</td><td>Meals</td><td style={{ fontSize: 12 }}>Project · SL</td><td className="mono">2,800</td><td><span className="rcv no">missing</span></td><td><span className="pill today">Pending</span></td></tr>
                  <tr><td className="mono">PCV-115</td><td>Stationery</td><td style={{ fontSize: 12 }}>Admin</td><td className="mono">980</td><td><span className="rcv ok">attached</span></td><td><span className="pill done">Approved</span></td></tr>
                </tbody>
              </table>
            </div>
            <div className="panel">
              <div className="panel-h"><h3>Reconciliation — Head Office</h3><span className="meta">cash on hand vs ledger</span></div>
              <div className="recon"><span>Opening float</span><span className="mono">30,000</span></div>
              <div className="recon"><span>Vouchers posted</span><span className="mono" style={{ color: "var(--red)" }}>− 11,600</span></div>
              <div className="recon"><span>Receipts on file</span><span className="mono">10,620</span></div>
              <div className="recon"><span>Ledger balance</span><span className="mono">18,400</span></div>
              <div className="recon"><span>Physical cash counted</span><span className="mono">18,400</span></div>
              <div className="recon"><span style={{ fontWeight: 600 }}>Variance</span><span className="pill done">KES 0 · balanced</span></div>
              <Note noBorder>Replenishment due to restore float: <strong style={{ color: "var(--ink)" }}>KES 11,600</strong></Note>
            </div>
          </div>
        </div>
      )}

      {tab === "f-budget" && (
        <div className="fin-panel active">
          <div className="grid g-2">
            <div className="panel">
              <div className="panel-h"><h3>Budget vs actual by cost centre</h3><span className="meta">month to date · % of budget</span></div>
              <div className="pad">
                <StaticBars rows={[
                  { l: "Deployment", n: "74%", w: 74, c: "var(--ember)" },
                  { l: "Operations", n: "61%", w: 61, c: "var(--flame)" },
                  { l: "BD / Fundraise", n: "55%", w: 55, c: "var(--flame)" },
                  { l: "Field / MRV", n: "48%", w: 48, c: "var(--flame)" },
                  { l: "Admin", n: "40%", w: 40, c: "var(--flame)" },
                ]} />
              </div>
            </div>
            <div className="panel">
              <div className="panel-h"><h3>Project accounting</h3><span className="meta">budget · spent · margin</span></div>
              <table className="tbl">
                <thead><tr><th>Project</th><th>Budget</th><th>Spent</th><th>Billing</th></tr></thead>
                <tbody>
                  <tr><td>Makueni VTC rollout</td><td className="mono">3.2M</td><td className="mono">1.9M</td><td><span className="pill week">Milestone 2</span></td></tr>
                  <tr><td>Sierra Leone (PICREF)</td><td className="mono">$240k</td><td className="mono">$61k</td><td><span className="pill today">Drawdown</span></td></tr>
                  <tr><td>Kiambu cluster</td><td className="mono">1.8M</td><td className="mono">1.1M</td><td><span className="pill done">On track</span></td></tr>
                </tbody>
              </table>
              <Note noBorder>Cost &amp; profit centres, overhead allocation and rolling forecasts run off these same project codes.</Note>
            </div>
          </div>
        </div>
      )}

      {tab === "f-report" && (
        <div className="fin-panel active">
          <div className="grid g-2">
            <div className="panel">
              <div className="panel-h"><h3>Standard reports</h3><span className="meta">one click · from live data</span></div>
              {genBtn("Income statement (P&L)", "Generating P&L", "From live ledger — June 2026")}
              {genBtn("Balance sheet", "Generating balance sheet", "As at 30 June 2026")}
              {genBtn("Cash flow statement", "Generating cash flow", "Direct method")}
              {genBtn("Trial balance", "Generating trial balance", "In balance")}
              {genBtn("Management / board pack", "Generating board pack", "Narrative drafted via Claude API")}
            </div>
            <div>
              <div className="panel" style={{ marginBottom: 18 }}>
                <div className="panel-h"><h3>Tax &amp; statutory</h3><span className="meta">Kenya</span></div>
                <div className="recon"><span>VAT position — June</span><span className="mono">KES 184,000 payable</span></div>
                <div className="recon"><span>eTIMS invoices filed</span><span className="pill done">42 / 43</span></div>
                <div className="recon"><span>Withholding tax</span><span className="mono">KES 38,500</span></div>
                <div className="recon"><span>Next filing</span><span className="mono" style={{ color: "var(--ink-soft)" }}>20 Jul</span></div>
              </div>
              <div className="panel">
                <div className="panel-h"><h3>Multi-currency &amp; audit</h3><span className="meta">consolidation-ready</span></div>
                <div className="recon"><span>Reporting currencies</span><span className="mono">KES · USD · UGX</span></div>
                <div className="recon"><span>FX gain / loss — June</span><span className="mono" style={{ color: "var(--green)" }}>+ KES 12,400</span></div>
                <div className="recon"><span>Segregation of duties</span><span className="pill done">Enforced</span></div>
                <div className="recon"><span>IFRS for SMEs</span><span className="pill done">Applied</span></div>
              </div>
            </div>
          </div>
        </div>
      )}
    </>
  );
}

function Receivables() {
  const { toast, openInvoice, newInvoices } = useApp();
  return (
    <div className="fin-panel active">
      <div className="panel" style={{ marginBottom: 18 }}>
        <div className="panel-h"><h3>Order-to-cash</h3><span className="meta">eTIMS compliant</span></div>
        <div className="pad">
          <div className="steps">
            <div className="step done"><span className="sdot">✓</span>Sales order</div><div className="step-arrow" />
            <div className="step done"><span className="sdot">✓</span>Delivery / install</div><div className="step-arrow" />
            <div className="step now"><span className="sdot">3</span>Invoice issued</div><div className="step-arrow" />
            <div className="step"><span className="sdot">4</span>Collection</div>
          </div>
        </div>
      </div>
      <div className="grid g-2">
        <div className="panel">
          <div className="panel-h">
            <h3>Customer invoices</h3>
            <span className="meta">
              <a href="#" onClick={(e) => { e.preventDefault(); openInvoice(); }} style={{ color: "var(--flame)", textDecoration: "none" }}>+ New invoice</a>
            </span>
          </div>
          <table className="tbl">
            <thead><tr><th>Institution</th><th>Invoice</th><th>Amount</th><th>eTIMS</th><th>Due</th></tr></thead>
            <tbody>
              {newInvoices.map((inv) => (
                <tr key={inv.id}>
                  <td>{inv.cust}</td>
                  <td className="mono">{inv.id}</td>
                  <td className="mono">{inv.tot.toLocaleString()}</td>
                  <td><span className="rcv ok">filed ✓</span></td>
                  <td><span className={`pill ${inv.pillCls}`}>{inv.pillTxt}</span></td>
                </tr>
              ))}
              <tr><td>Makueni County VTCs</td><td className="mono">SI-0188</td><td className="mono">1,240,000</td><td><span className="rcv ok">filed ✓</span></td><td><span className="pill week">This week</span></td></tr>
              <tr><td>Catholic Diocese — Machakos</td><td className="mono">SI-0185</td><td className="mono">612,000</td><td><span className="rcv ok">filed ✓</span></td><td><span className="pill over">Overdue</span></td></tr>
              <tr><td>Kiambu cluster</td><td className="mono">SI-0182</td><td className="mono">480,000</td><td><span className="rcv ok">filed ✓</span></td><td><span className="pill week">This week</span></td></tr>
              <tr><td>CLASP (recurring)</td><td className="mono">SI-0179</td><td className="mono">468,000</td><td><span className="rcv no">pending</span></td><td><span className="pill today">Today</span></td></tr>
            </tbody>
          </table>
        </div>
        <div className="panel">
          <div className="panel-h"><h3>Debtor aging</h3><span className="meta">KES 2.8M · 612k overdue</span></div>
          <div className="pad">
            <StaticBars rows={[
              { l: "Current", n: "1,790k", w: 64, c: "var(--flame)" },
              { l: "31–60 days", n: "398k", w: 14, c: "var(--ember)" },
              { l: "61–90 days", n: "340k", w: 12, c: "var(--ember)" },
              { l: "90+ days", n: "272k", w: 10, c: "var(--red)" },
            ]} />
            <div style={{ marginTop: 14, paddingTop: 13, borderTop: "1px solid var(--hairline)", fontSize: 12, color: "var(--ink-soft)" }}>
              Dunning reminders sent via Africa's Talking on overdue accounts.
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
