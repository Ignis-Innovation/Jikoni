import { useApp } from "../store";
import { Pulse, Note } from "../components/ui";
import { Donut, ChartLegend, StaticBars } from "../components/charts";
import { PlusI, CheckBoldI } from "../components/icons";
import { Crumb } from "../nav";

const pulse = [
  { k: "Headcount", tick: "t-blue", v: "8", d: "7 staff · 1 onboarding", dc: "up" as const },
  { k: "On leave today", tick: "t-ember", v: "1", d: "Lily — annual", dc: "flat" as const },
  { k: "Leave approvals", tick: "t-ember", v: "3", d: "pending you", dc: "flat" as const },
  { k: "Contracts expiring", tick: "t-red", v: "2", d: "within 90 days", dc: "flat" as const },
  { k: "Reviews due", tick: "t-blue", v: "4", d: "this quarter", dc: "flat" as const },
  { k: "Payroll run", tick: "t-blue", v: "28 Jun", d: "inputs 6/7 ready", dc: "flat" as const },
];

const staff = [
  { n: "Dennis", r: "Managing Director", c: "Permanent", nssf: 1, shif: 1, kra: 1, lv: "12 / 21", f: "Complete", col: "#E2632A" },
  { n: "Brian", r: "Platform / Tech", c: "Permanent", nssf: 1, shif: 1, kra: 1, lv: "15 / 21", f: "Complete", col: "#12A3BE" },
  { n: "Joan", r: "Operations", c: "Permanent", nssf: 1, shif: 1, kra: 1, lv: "9 / 21", f: "Complete", col: "#3C8A5E" },
  { n: "Wilson", r: "BD — Upstream", c: "Permanent", nssf: 1, shif: 1, kra: 1, lv: "6 / 21", f: "Complete", col: "#6D28D9" },
  { n: "Elizabeth", r: "Partnerships", c: "Contract", nssf: 1, shif: 1, kra: 0, lv: "18 / 21", f: "1 missing", col: "#B91C1C" },
  { n: "Wanjiku", r: "Chief of Staff", c: "Permanent", nssf: 1, shif: 1, kra: 1, lv: "11 / 21", f: "Complete", col: "#0e7d91" },
  { n: "Lily", r: "Communications", c: "Contract", nssf: 0, shif: 1, kra: 1, lv: "20 / 21", f: "1 missing", col: "#A16207" },
];

const leaveReqs = [
  { id: "LV-044", t: "Wilson — Annual leave", s: "3 days · 24–26 Jun", p: "today", pl: "Today" },
  { id: "LV-045", t: "Joan — Sick leave", s: "1 day · today", p: "today", pl: "Today" },
  { id: "LV-046", t: "Elizabeth — Annual leave", s: "2 days · next week", p: "week", pl: "This week" },
];

const wf = [
  { l: "Field enumerators", v: 12, c: "#E2632A", d: "12" },
  { l: "Field / Ops", v: 3, c: "#12A3BE", d: "3" },
  { l: "Leadership", v: 2, c: "#3C8A5E", d: "2" },
  { l: "Commercial / BD", v: 2, c: "#6D28D9", d: "2" },
  { l: "Tech", v: 1, c: "#A89C8E", d: "1" },
];
const cm = [
  { l: "Permanent", v: 5, c: "#12A3BE", d: "5" },
  { l: "Contract", v: 2, c: "#E2632A", d: "2" },
  { l: "Casual / field", v: 12, c: "#A89C8E", d: "12" },
];

function StatChip({ ok, l }: { ok: number; l: string }) {
  return (
    <span style={{
      fontFamily: "var(--mono)", fontSize: 9.5, fontWeight: 600, padding: "2px 6px", borderRadius: 5,
      marginRight: 4, whiteSpace: "nowrap",
      background: ok ? "var(--green-soft)" : "var(--ember-soft)",
      color: ok ? "var(--green)" : "var(--ember)",
    }}>
      {l} {ok ? "✓" : "✗"}
    </span>
  );
}

function Check({ done, children }: { done: boolean; children: React.ReactNode }) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 11, padding: "9px 0", borderBottom: "1px solid var(--hairline)", fontSize: 13.5, color: done ? undefined : "var(--ink-soft)" }}>
      <span style={{
        width: 20, height: 20, borderRadius: "50%", display: "grid", placeItems: "center", flexShrink: 0,
        ...(done ? { background: "var(--green-soft)", color: "var(--green)" } : { background: "#F1EDE5", border: "1px solid var(--hairline-2)" }),
      }}>
        {done && <CheckBoldI />}
      </span>
      {children}
    </div>
  );
}

export default function HrView() {
  const { tabs, toast, goTab } = useApp();
  const tab = tabs.hr;

  return (
    <>
      <div className="vhead">
        <div>
          <h1>Human Resources</h1>
          <p>Staff files, leave, payroll, recruitment and the field workforce — statutory IDs and documents versioned and access-controlled on every record.</p>
        </div>
        <div className="actions">
          <button className="btn" onClick={() => toast("Org chart", "Opens the live organogram by department")}>Org chart</button>
          <button className="btn primary" onClick={() => toast("New employee", "Opens the staff-file form — contract, statutory IDs, documents")}><PlusI />Add employee</button>
        </div>
      </div>
      <Crumb view="hr" />

      {tab === "h-over" && (
        <div className="hr-panel active">
          <Pulse data={pulse} />
          <div className="grid g-2">
            <div className="panel">
              <div className="panel-h"><h3>Workforce composition</h3><span className="meta">core + field</span></div>
              <div className="pad" style={{ display: "flex", alignItems: "center", gap: 24 }}>
                <Donut segs={wf} big="20" small="people" />
                <div style={{ flex: 1 }}><ChartLegend segs={wf} /></div>
              </div>
            </div>
            <div className="panel">
              <div className="panel-h"><h3>Contract mix</h3><span className="meta">by engagement type</span></div>
              <div className="pad" style={{ display: "flex", alignItems: "center", gap: 24 }}>
                <Donut segs={cm} big="19" small="staff" />
                <div style={{ flex: 1 }}><ChartLegend segs={cm} /></div>
              </div>
            </div>
          </div>
          <div className="grid g-2" style={{ marginTop: 18 }}>
            <div className="panel">
              <div className="panel-h"><h3>Headcount by function</h3><span className="meta">7 staff + field team</span></div>
              <div className="pad">
                <StaticBars rows={[
                  { l: "Field / Ops", n: "3", w: 100, c: "var(--flame)" },
                  { l: "Leadership", n: "2", w: 66, c: "var(--flame)" },
                  { l: "Commercial / BD", n: "2", w: 66, c: "var(--flame)" },
                  { l: "Tech", n: "1", w: 33, c: "var(--flame)" },
                  { l: "Field enumerators", n: "12", w: 100, c: "var(--ember)" },
                ]} />
              </div>
            </div>
            <div className="panel">
              <div className="panel-h"><h3>Needs attention</h3><span className="meta">HR to-dos</span></div>
              <div className="task" onClick={() => goTab("hr", "h-staff")}><span className="id" style={{ color: "var(--red)" }}>2FA</span><span className="txt">Elizabeth &amp; Lily not enrolled in two-factor</span><span className="pill over">Action</span></div>
              <div className="task" onClick={() => goTab("hr", "h-staff")}><span className="id" style={{ color: "var(--ember)" }}>DOCS</span><span className="txt">2 staff files incomplete<small>Elizabeth — KRA PIN · Lily — NSSF</small></span><span className="pill today">Review</span></div>
              <div className="task" onClick={() => toast("Contracts", "2 fixed-term contracts end within 90 days")}><span className="id" style={{ color: "var(--ember)" }}>CTR</span><span className="txt">2 contracts expiring within 90 days</span><span className="pill week">Renew</span></div>
              <div className="task" onClick={() => goTab("hr", "h-recruit")}><span className="id" style={{ color: "var(--flame)" }}>ONB</span><span className="txt">Tabitha Mwende onboarding — 3 of 6 done</span><span className="pill week">In progress</span></div>
            </div>
          </div>
        </div>
      )}

      {tab === "h-staff" && (
        <div className="hr-panel active">
          <div className="grid g-2">
            <div className="panel">
              <div className="panel-h"><h3>Staff files</h3><span className="meta">contract · statutory · documents</span></div>
              <table className="tbl">
                <thead><tr><th>Employee</th><th>Contract</th><th>Statutory IDs</th><th>Leave bal.</th><th>Files</th></tr></thead>
                <tbody>
                  {staff.map((s) => (
                    <tr key={s.n} style={{ cursor: "pointer" }} onClick={() => toast(s.n, "Opens the staff file — contract, statutory IDs, versioned docs")}>
                      <td>
                        <div className="who">
                          <div className="av-sm" style={{ background: s.col }}>{s.n[0]}</div>
                          <div><div className="nm">{s.n}</div><div className="em">{s.r}</div></div>
                        </div>
                      </td>
                      <td><span className={`tag ${s.c === "Permanent" ? "std" : "view"}`} style={{ textTransform: "none" }}>{s.c}</span></td>
                      <td style={{ whiteSpace: "nowrap" }}><StatChip ok={s.nssf} l="NSSF" /><StatChip ok={s.shif} l="SHIF" /><StatChip ok={s.kra} l="KRA" /></td>
                      <td className="mono" style={{ fontSize: 12 }}>{s.lv}</td>
                      <td>
                        {s.f === "Complete"
                          ? <span className="dot-s"><i className="active-i" />Complete</span>
                          : <span className="dot-s"><i className="away-i" />{s.f}</span>}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="panel">
              <div className="panel-h"><h3>Documents &amp; compliance</h3><span className="meta">access-controlled</span></div>
              <div className="recon"><span>Contracts on file</span><span className="pill done">7 / 7</span></div>
              <div className="recon"><span>KRA PIN captured</span><span className="pill today">6 / 7</span></div>
              <div className="recon"><span>NSSF registered</span><span className="pill today">6 / 7</span></div>
              <div className="recon"><span>SHIF registered</span><span className="pill done">7 / 7</span></div>
              <div className="recon"><span>Signed policy acknowledgements</span><span className="pill done">7 / 7</span></div>
              <Note>Each staff file is visible only to HR and the employee. Widening access is a super-admin action in User Management.</Note>
            </div>
          </div>
        </div>
      )}

      {tab === "h-leave" && (
        <div className="hr-panel active">
          <div className="grid g-2">
            <div className="panel">
              <div className="panel-h"><h3>Leave approvals</h3><span className="meta">waiting on you</span></div>
              <div>
                {leaveReqs.map((r) => (
                  <div className="task" key={r.id} onClick={() => toast(r.id, "Approve or decline — the balance updates live")}>
                    <span className="id">{r.id}</span>
                    <span className="txt">{r.t}<small>{r.s}</small></span>
                    <span className={`pill ${r.p}`}>{r.pl}</span>
                  </div>
                ))}
              </div>
              <Note><strong style={{ color: "var(--ink)" }}>Out today:</strong> Lily — annual leave</Note>
            </div>
            <div className="panel">
              <div className="panel-h"><h3>Leave balances</h3><span className="meta">annual · days</span></div>
              <table className="tbl">
                <thead><tr><th>Employee</th><th>Entitled</th><th>Taken</th><th>Remaining</th></tr></thead>
                <tbody>
                  <tr><td>Dennis</td><td className="mono">21</td><td className="mono">9</td><td className="mono">12</td></tr>
                  <tr><td>Joan</td><td className="mono">21</td><td className="mono">12</td><td className="mono">9</td></tr>
                  <tr><td>Wilson</td><td className="mono">21</td><td className="mono">15</td><td className="mono">6</td></tr>
                  <tr><td>Elizabeth</td><td className="mono">21</td><td className="mono">3</td><td className="mono">18</td></tr>
                  <tr><td>Wanjiku</td><td className="mono">21</td><td className="mono">10</td><td className="mono">11</td></tr>
                </tbody>
              </table>
            </div>
          </div>
          <div className="panel" style={{ marginTop: 18 }}>
            <div className="panel-h"><h3>Leave types &amp; policy</h3><span className="meta">Kenya · Employment Act</span></div>
            <div style={{ display: "flex", gap: 10, flexWrap: "wrap", padding: "16px 18px" }}>
              <span className="acc-chip">Annual · 21 days</span>
              <span className="acc-chip">Sick · 14 days full, 14 half</span>
              <span className="acc-chip">Maternity · 90 days</span>
              <span className="acc-chip">Paternity · 14 days</span>
              <span className="acc-chip">Compassionate</span>
              <span className="acc-chip">Unpaid</span>
              <span className="acc-chip">Study</span>
            </div>
          </div>
        </div>
      )}

      {tab === "h-pay" && (
        <div className="hr-panel active">
          <div className="grid g-2">
            <div className="panel">
              <div className="panel-h"><h3>Payroll inputs — June</h3><span className="meta">Kenya · run prep</span></div>
              <div className="pad" style={{ paddingBottom: 6 }}>
                <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 12 }}>
                  <div>
                    <div style={{ fontFamily: "var(--display)", fontSize: 25, fontWeight: 600, letterSpacing: -0.5 }}>KES 1.33M</div>
                    <div style={{ fontSize: 12, color: "var(--ink-soft)", marginTop: 2 }}>net pay · 7 staff · run 28 June</div>
                  </div>
                  <button className="btn primary" onClick={() => toast("Payroll run prepared", "Inputs locked and routed to Joan for sign-off")}>Prepare run</button>
                </div>
              </div>
              <div className="row"><div className="rl">Gross pay</div><span className="mono">KES 1,840,000</span></div>
              <div className="row"><div className="rl">PAYE</div><span className="mono" style={{ color: "var(--red)" }}>− KES 412,000</span></div>
              <div className="row"><div className="rl">NSSF</div><span className="mono" style={{ color: "var(--red)" }}>− KES 43,200</span></div>
              <div className="row"><div className="rl">SHIF · 2.75%</div><span className="mono" style={{ color: "var(--red)" }}>− KES 50,600</span></div>
              <div className="row"><div className="rl" style={{ fontWeight: 600 }}>Net pay</div><span className="mono" style={{ fontWeight: 600 }}>KES 1,334,200</span></div>
            </div>
            <div className="panel">
              <div className="panel-h"><h3>Statutory &amp; remittances</h3><span className="meta">filing status</span></div>
              <div className="recon"><span>PAYE (KRA)</span><span className="pill today">Due 9 Jul</span></div>
              <div className="recon"><span>NSSF</span><span className="pill today">Due 9 Jul</span></div>
              <div className="recon"><span>SHIF</span><span className="pill today">Due 9 Jul</span></div>
              <div className="recon"><span>Housing Levy · 1.5%</span><span className="pill today">Due 9 Jul</span></div>
              <div className="recon"><span>HELB</span><span className="pill done">N/A this run</span></div>
              <div className="recon"><span>NITA levy</span><span className="pill done">Filed</span></div>
              <Note>On sign-off, the payroll journal posts straight into the Finance general ledger and generates the M-Pesa / bank payment file.</Note>
            </div>
          </div>
        </div>
      )}

      {tab === "h-recruit" && (
        <div className="hr-panel active">
          <div className="grid g-2">
            <div className="panel">
              <div className="panel-h">
                <h3>Open requisitions</h3>
                <span className="meta">
                  <a href="#" onClick={(e) => { e.preventDefault(); toast("New requisition", "Raise a vacancy with approval routing"); }} style={{ color: "var(--flame)", textDecoration: "none" }}>+ New requisition</a>
                </span>
              </div>
              <table className="tbl">
                <thead><tr><th>Role</th><th>Function</th><th>Stage</th></tr></thead>
                <tbody>
                  <tr><td>Field Coordinator</td><td>Field / Ops</td><td><span className="pill done">Offer accepted</span></td></tr>
                  <tr><td>Enumerators ×5</td><td>Field</td><td><span className="pill today">Scoring</span></td></tr>
                  <tr><td>Finance Officer</td><td>Finance</td><td><span className="pill week">Screening</span></td></tr>
                </tbody>
              </table>
            </div>
            <div className="panel">
              <div className="panel-h"><h3>Applicant pipeline</h3><span className="meta">enumerator drive · 100-pt rubric</span></div>
              <div className="pad">
                <StaticBars rows={[
                  { l: "Applied", n: "38", w: 100, c: "var(--flame)" },
                  { l: "Screened", n: "24", w: 63, c: "var(--flame)" },
                  { l: "Scored", n: "18", w: 47, c: "var(--ember)" },
                  { l: "Shortlisted", n: "8", w: 21, c: "var(--ember)" },
                  { l: "Offer", n: "5", w: 13, c: "var(--green)" },
                ]} />
              </div>
            </div>
          </div>
          <div className="panel" style={{ marginTop: 18 }}>
            <div className="panel-h"><h3>Onboarding in progress</h3><span className="meta">checklist · 3 of 6</span></div>
            <div className="pad">
              <div style={{ display: "flex", alignItems: "center", gap: 11, marginBottom: 16 }}>
                <div className="av-sm" style={{ background: "#7C2D12" }}>T</div>
                <div>
                  <div style={{ fontWeight: 600, fontSize: 13.5 }}>Tabitha Mwende</div>
                  <div style={{ fontSize: 11.5, color: "var(--ink-soft)" }}>Field Coordinator · starts Mon 23 Jun</div>
                </div>
              </div>
              <div>
                <Check done>Contract signed</Check>
                <Check done>KRA PIN collected</Check>
                <Check done>Bank details captured</Check>
                <Check done={false}>NSSF &amp; SHIF registration</Check>
                <Check done={false}>Two-factor enrolment</Check>
                <div style={{ display: "flex", alignItems: "center", gap: 11, padding: "9px 0", fontSize: 13.5, color: "var(--ink-soft)" }}>
                  <span style={{ width: 20, height: 20, borderRadius: "50%", flexShrink: 0, background: "#F1EDE5", border: "1px solid var(--hairline-2)" }} />
                  Laptop &amp; field kit issued
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      {tab === "h-field" && (
        <div className="hr-panel active">
          <div className="grid g-2">
            <div className="panel">
              <div className="panel-h"><h3>Enumerator rosters by county</h3><span className="meta">12 active · 5 counties</span></div>
              <div className="pad">
                <StaticBars rows={[
                  { l: "Kiambu", n: "3", w: 100, c: "var(--flame)" },
                  { l: "Machakos", n: "2", w: 66, c: "var(--flame)" },
                  { l: "Makueni", n: "3", w: 100, c: "var(--flame)" },
                  { l: "Nakuru", n: "2", w: 66, c: "var(--flame)" },
                  { l: "Kajiado", n: "2", w: 66, c: "var(--ember)" },
                ]} />
              </div>
            </div>
            <div className="panel">
              <div className="panel-h"><h3>Per-diem &amp; field allowances</h3><span className="meta">awaiting approval</span></div>
              <div className="task" onClick={() => toast("PD-231", "Approve or query — posts to petty cash / payroll")}>
                <span className="id">PD-231</span><span className="txt">Makueni field visit — 3 enumerators × 2 days<small className="mono">KES 18,000</small></span><span className="pill today">Today</span>
              </div>
              <div className="task" onClick={() => toast("PD-230", "Approve or query")}>
                <span className="id">PD-230</span><span className="txt">Kajiado site assessment per-diems<small className="mono">KES 9,600</small></span><span className="pill week">This week</span>
              </div>
              <div className="recon"><span>Standard field rate</span><span className="mono">KES 3,000 / day</span></div>
            </div>
          </div>
          <div className="panel" style={{ marginTop: 18 }}>
            <div className="panel-h"><h3>Short-term &amp; casual contracts</h3><span className="meta">piece-rate &amp; fixed-term</span></div>
            <table className="tbl">
              <thead><tr><th>Engagement</th><th>Type</th><th>Count</th><th>Ends</th><th>Field sign-offs</th></tr></thead>
              <tbody>
                <tr><td>5-county data collection</td><td>Fixed-term</td><td className="mono">12</td><td className="mono">31 Jul</td><td><span className="pill done">214 logged</span></td></tr>
                <tr><td>Makueni install crew</td><td>Piece-rate</td><td className="mono">6</td><td className="mono">Ongoing</td><td><span className="pill week">48 GRNs</span></td></tr>
                <tr><td>Summit support staff</td><td>Casual</td><td className="mono">4</td><td className="mono">10 Jul</td><td><span className="pill today">Onboarding</span></td></tr>
              </tbody>
            </table>
            <Note>Field sign-offs (GRNs, installation reports) flow through to Deployment and to project accounting for cost allocation.</Note>
          </div>
        </div>
      )}
    </>
  );
}
