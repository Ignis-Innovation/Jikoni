import type { ReactNode } from "react";
import { useApp } from "../store";
import { Pulse, Note } from "../components/ui";
import { Crumb } from "../nav";

// Placeholder for a panel body that has no live data source wired yet.
function EmptyBody({ children = "No data yet." }: { children?: ReactNode }) {
  return <div className="pad" style={{ fontSize: 12.5, color: "var(--ink-soft)", padding: "34px 20px", textAlign: "center" }}>{children}</div>;
}

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
          <Pulse data={[]} />
          <div className="grid g-2">
            <div className="panel">
              <div className="panel-h"><h3>Where the money goes</h3><span className="meta">operating expenses</span></div>
              <EmptyBody>No expenses posted yet.</EmptyBody>
            </div>
            <div className="panel">
              <div className="panel-h"><h3>Revenue — last 6 months</h3><span className="meta">KES</span></div>
              <EmptyBody>No revenue recorded yet.</EmptyBody>
            </div>
          </div>
          <div className="grid g-2" style={{ marginTop: 18 }}>
            <div className="panel">
              <div className="panel-h"><h3>Income statement</h3><span className="meta">month to date · KES</span></div>
              <EmptyBody>No ledger activity this period.</EmptyBody>
            </div>
            <div className="panel">
              <div className="panel-h"><h3>Approvals waiting on you</h3><span className="meta">requisitions &amp; payments</span></div>
              <EmptyBody>Nothing awaiting your approval.</EmptyBody>
            </div>
          </div>
        </div>
      )}

      {tab === "f-gl" && (
        <div className="fin-panel active">
          <div className="grid g-2">
            <div className="panel">
              <div className="panel-h"><h3>Chart of accounts</h3><span className="meta">balances · KES</span></div>
              <EmptyBody>No balances yet — post a journal to begin.</EmptyBody>
            </div>
            <div className="panel">
              <div className="panel-h">
                <h3>Recent journal entries</h3>
                <span className="meta">
                  <a href="#" onClick={(e) => { e.preventDefault(); toast("New journal", "Opens a balanced double-entry form"); }} style={{ color: "var(--flame)", textDecoration: "none" }}>+ New journal</a>
                </span>
              </div>
              <EmptyBody>No journal entries yet.</EmptyBody>
            </div>
          </div>
          <div className="panel" style={{ marginTop: 18 }}>
            <div className="panel-h"><h3>Period &amp; close status</h3><span className="meta">trial balance</span></div>
            <div className="recon"><span>June 2026</span><span className="pill today">Open</span></div>
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
              <div className="panel-h"><h3>Supplier invoices</h3><span className="meta">to match &amp; pay</span></div>
              <EmptyBody>No supplier invoices yet.</EmptyBody>
            </div>
            <div className="panel">
              <div className="panel-h"><h3>Payables aging</h3><span className="meta">KES</span></div>
              <EmptyBody>No payables yet.</EmptyBody>
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
              <EmptyBody>No bank accounts added yet.</EmptyBody>
            </div>
            <div className="panel">
              <div className="panel-h">
                <h3>Reconciliation</h3>
                <span className="meta">
                  <a href="#" onClick={(e) => { e.preventDefault(); toast("Auto-match", "M-Pesa & bank statement lines matched to the ledger"); }} style={{ color: "var(--flame)", textDecoration: "none" }}>Auto-match</a>
                </span>
              </div>
              <EmptyBody>No statement lines imported yet.</EmptyBody>
            </div>
          </div>
          <div className="panel" style={{ marginTop: 18 }}>
            <div className="panel-h"><h3>8-week cash forecast</h3><span className="meta">projected position · KES</span></div>
            <EmptyBody>Not enough data to forecast yet.</EmptyBody>
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
                <a href="#" onClick={(e) => { e.preventDefault(); toast("Replenishment prepared", "Top-up routed for approval"); }} style={{ color: "var(--flame)", textDecoration: "none" }}>Replenish</a>
              </span>
            </div>
            <EmptyBody>No petty cash floats set up yet.</EmptyBody>
          </div>
          <div className="grid g-2">
            <div className="panel">
              <div className="panel-h"><h3>Recent vouchers</h3><span className="meta">coded · receipt-backed</span></div>
              <EmptyBody>No vouchers yet.</EmptyBody>
            </div>
            <div className="panel">
              <div className="panel-h"><h3>Reconciliation</h3><span className="meta">cash on hand vs ledger</span></div>
              <EmptyBody>Nothing to reconcile yet.</EmptyBody>
            </div>
          </div>
        </div>
      )}

      {tab === "f-budget" && (
        <div className="fin-panel active">
          <div className="grid g-2">
            <div className="panel">
              <div className="panel-h"><h3>Budget vs actual by cost centre</h3><span className="meta">month to date · % of budget</span></div>
              <EmptyBody>No spend against budget lines yet.</EmptyBody>
            </div>
            <div className="panel">
              <div className="panel-h"><h3>Project accounting</h3><span className="meta">budget · spent · margin</span></div>
              <EmptyBody>No projects yet.</EmptyBody>
              <Note noBorder>Cost &amp; profit centres, overhead allocation and rolling forecasts run off project codes.</Note>
            </div>
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
                <EmptyBody>No tax positions yet.</EmptyBody>
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
    </>
  );
}

function Receivables() {
  const { openInvoice, newInvoices } = useApp();
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
            <span className="meta">
              <a href="#" onClick={(e) => { e.preventDefault(); openInvoice(); }} style={{ color: "var(--flame)", textDecoration: "none" }}>+ New invoice</a>
            </span>
          </div>
          <table className="tbl">
            <thead><tr><th>Institution</th><th>Invoice</th><th>Amount</th><th>eTIMS</th><th>Due</th></tr></thead>
            <tbody>
              {newInvoices.length === 0 ? (
                <tr><td colSpan={5} style={{ textAlign: "center", color: "var(--ink-soft)", padding: "18px 0" }}>No customer invoices yet — use “+ New invoice”.</td></tr>
              ) : newInvoices.map((inv) => (
                <tr key={inv.id}>
                  <td>{inv.cust}</td>
                  <td className="mono">{inv.id}</td>
                  <td className="mono">{inv.tot.toLocaleString()}</td>
                  <td><span className="rcv ok">filed ✓</span></td>
                  <td><span className={`pill ${inv.pillCls}`}>{inv.pillTxt}</span></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="panel">
          <div className="panel-h"><h3>Debtor aging</h3><span className="meta">KES</span></div>
          <div className="pad" style={{ fontSize: 12.5, color: "var(--ink-soft)", padding: "34px 20px", textAlign: "center" }}>No receivables yet.</div>
        </div>
      </div>
    </div>
  );
}
