import { useEffect, useState, type CSSProperties } from "react";
import { useApp } from "../store";
import { OrgI, BellI, CheckSqThinI, LinkI, LockI } from "../components/icons";

/* ---------- config-bound controls: every one persists to app_config ---------- */

// Read a boolean out of app_config (jsonb true / "true" both count).
function cfgBool(v: unknown) { return v === true || v === "true"; }

function ConfigToggle({ configKey, disabled }: { configKey: string; disabled?: boolean }) {
  const { appConfig, setAppConfig } = useApp();
  const on = cfgBool(appConfig[configKey]);
  return (
    <button
      className={`toggle ${on ? "on" : ""}`}
      style={disabled ? { opacity: 0.6, cursor: "not-allowed" } : undefined}
      onClick={() => { if (!disabled) setAppConfig(configKey, !on); }}
    />
  );
}

// An immutable, always-on toggle (e.g. the audit log) — can't be switched off.
function LockedToggle() {
  return <button className="toggle on" style={{ opacity: 0.6, cursor: "not-allowed" }} />;
}

function ConfigText({ configKey, placeholder, style }: { configKey: string; placeholder?: string; style?: CSSProperties }) {
  const { appConfig, setAppConfig } = useApp();
  const current = String(appConfig[configKey] ?? "");
  const [val, setVal] = useState(current);
  useEffect(() => { setVal(current); }, [current]);
  const commit = () => { if (val.trim() !== current) setAppConfig(configKey, val.trim()); };
  return (
    <input className="field" style={style} placeholder={placeholder} value={val}
      onChange={(e) => setVal(e.target.value)} onBlur={commit}
      onKeyDown={(e) => { if (e.key === "Enter") (e.target as HTMLInputElement).blur(); }} />
  );
}

function ConfigSelect({ configKey, options, style }: { configKey: string; options: { v: string; l: string }[]; style?: CSSProperties }) {
  const { appConfig, setAppConfig } = useApp();
  const current = String(appConfig[configKey] ?? options[0]?.v ?? "");
  return (
    <select className="field" style={style} value={current} onChange={(e) => setAppConfig(configKey, e.target.value)}>
      {options.map((o) => <option key={o.v} value={o.v}>{o.l}</option>)}
    </select>
  );
}

function ConfigSeg({ configKey, options }: { configKey: string; options: string[] }) {
  const { appConfig, setAppConfig } = useApp();
  const current = String(appConfig[configKey] ?? options[0]);
  return (
    <div className="seg-ctl">
      {options.map((o) => (
        <button key={o} className={current === o ? "on" : ""} onClick={() => setAppConfig(configKey, o)}>{o}</button>
      ))}
    </div>
  );
}

// Currency amount (stored as a plain number) with a KES prefix and thousands separators.
function ConfigMoney({ configKey }: { configKey: string }) {
  const { appConfig, setAppConfig } = useApp();
  const current = Number(appConfig[configKey] ?? 0);
  const [val, setVal] = useState(current.toLocaleString());
  useEffect(() => { setVal(current.toLocaleString()); }, [current]);
  const commit = () => {
    const n = parseFloat(val.replace(/[^0-9.]/g, "")) || 0;
    if (n !== current) setAppConfig(configKey, n);
    setVal((n || current).toLocaleString());
  };
  return (
    <span style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
      <span style={{ color: "var(--ink-soft)", fontSize: 12 }}>KES</span>
      <input className="field" style={{ minWidth: 130, textAlign: "right" }} value={val}
        onChange={(e) => setVal(e.target.value)} onBlur={commit}
        onKeyDown={(e) => { if (e.key === "Enter") (e.target as HTMLInputElement).blur(); }} />
    </span>
  );
}

// A numeric rule bound to app_config — saves on Enter or blur (Approval & Matching Rules).
function RuleInput({ configKey, suffix }: { configKey: string; suffix?: string }) {
  const { appConfig, setAppConfig } = useApp();
  const current = String(appConfig[configKey] ?? "");
  const [val, setVal] = useState(current);
  useEffect(() => { setVal(current); }, [current]);
  const commit = () => { const n = parseFloat(val); if (!isNaN(n) && String(n) !== current) setAppConfig(configKey, n); };
  return (
    <span style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
      <input className="field" style={{ minWidth: 110, textAlign: "right" }} value={val}
        onChange={(e) => setVal(e.target.value)} onBlur={commit}
        onKeyDown={(e) => { if (e.key === "Enter") (e.target as HTMLInputElement).blur(); }} />
      {suffix && <span style={{ color: "var(--ink-soft)", fontSize: 12 }}>{suffix}</span>}
    </span>
  );
}

const tabsDef = [
  { id: "s-org", l: "Organisation", icon: <OrgI /> },
  { id: "s-coding", l: "Coding", icon: <LinkI /> },
  { id: "s-notif", l: "Notifications", icon: <BellI /> },
  { id: "s-appr", l: "Approval & Matching", icon: <CheckSqThinI /> },
  { id: "s-audit", l: "Audit Trail", icon: <LockI width={16} height={16} /> },
  { id: "s-integ", l: "Integrations", icon: <LinkI /> },
  { id: "s-sec", l: "Security & data", icon: <LockI width={16} height={16} /> },
];

const integrations = [
  { key: "integ_mpesa", bg: "#16A34A", ch: "M", nm: "M-Pesa Daraja", ds: "Payments & collections" },
  { key: "integ_etims", bg: "#B91C1C", ch: "K", nm: "KRA eTIMS", ds: "Sales e-invoicing compliance" },
  { key: "integ_email", bg: "#12A3BE", ch: "G", nm: "Email (Gmail Workspace)", ds: "Transactional & digest email" },
  { key: "integ_sms", bg: "#E2632A", ch: "A", nm: "Africa's Talking", ds: "SMS to field & approvers" },
  { key: "integ_claude", bg: "#6D28D9", ch: "C", nm: "Claude API", ds: "Receipt OCR · concept drafting · board narrative" },
  { key: "integ_ura", bg: "#7C2D12", ch: "U", nm: "URA EFRIS", ds: "Uganda e-invoicing — for Q4 entry" },
];

export default function SettingsView() {
  const { toast, appConfig, members } = useApp();
  const [tab, setTab] = useState("s-org");
  const notEnrolled = members.filter((m) => !m.twoFa && m.state !== "invited").length;

  return (
    <>
      <div className="vhead">
        <div>
          <h1>Settings</h1>
          <p>Workspace configuration for Ignis. Changes are saved live and logged to the audit trail with your name and time.</p>
        </div>
      </div>
      <div className="set-wrap">
        <div className="set-nav">
          {tabsDef.map((t) => (
            <button key={t.id} className={tab === t.id ? "active" : ""} onClick={() => setTab(t.id)}>
              {t.icon}{t.l}
            </button>
          ))}
        </div>

        <div>
          {tab === "s-org" && (
            <div className="set-panel active">
              <div className="set-card">
                <div className="sh"><h3>Organisation profile</h3><p>How Ignis presents across the workspace and on generated documents.</p></div>
                <div className="row"><div className="rl">Legal name</div><ConfigText configKey="org_legal_name" placeholder="Ignis Innovation Limited" /></div>
                <div className="row">
                  <div className="rl">Primary entity<small>The default ledger for new records. Switch any record to Uganda from its own screen.</small></div>
                  <ConfigSeg configKey="primary_entity" options={["Kenya", "Uganda", "Consolidated"]} />
                </div>
                <div className="row"><div className="rl">Base reporting currency</div>
                  <ConfigSelect configKey="base_currency" options={[{ v: "KES", l: "KES — Kenyan Shilling" }, { v: "USD", l: "USD — US Dollar" }, { v: "UGX", l: "UGX — Ugandan Shilling" }]} />
                </div>
                <div className="row"><div className="rl">Fiscal year start</div>
                  <ConfigSelect configKey="fiscal_year_start" options={[{ v: "January", l: "January" }, { v: "July", l: "July" }]} />
                </div>
              </div>
              <div className="set-card">
                <div className="sh"><h3>Multi-country</h3><p>Each entity keeps its own tax codes, mobile-money rails and statutory calendar.</p></div>
                <div className="row"><div className="rl">Kenya<small>KRA eTIMS · M-Pesa Daraja · NSSF / SHIF</small></div><span className="conn yes">Active</span></div>
                <div className="row"><div className="rl">Uganda<small>URA EFRIS · MTN / Airtel Money · NSSF Uganda — onboarding for Q4 entry</small></div><span className={`conn ${cfgBool(appConfig.integ_ura) ? "yes" : "no"}`}>{cfgBool(appConfig.integ_ura) ? "Active" : "Setup pending"}</span></div>
              </div>
            </div>
          )}

          {tab === "s-coding" && <CodingPanel />}

          {tab === "s-notif" && (
            <div className="set-panel active">
              <div className="set-card">
                <div className="sh"><h3>How you're notified</h3><p>Applies to this workspace. Email routes through Gmail Workspace; SMS through Africa's Talking.</p></div>
                <div className="row"><div className="rl">In-app<small>The bell in the top bar and live badges</small></div><ConfigToggle configKey="notif_in_app" /></div>
                <div className="row"><div className="rl">Email digest<small>A morning summary of what's on your burners</small></div><ConfigToggle configKey="notif_email_digest" /></div>
                <div className="row"><div className="rl">SMS for overdue approvals<small>Sent when something has waited on you over 24h</small></div><ConfigToggle configKey="notif_sms_overdue" /></div>
                <div className="row"><div className="rl">Stalled engagement alerts<small>An engagement with no touch in 14 days surfaces to its owner</small></div><ConfigToggle configKey="notif_stalled_eng" /></div>
              </div>
            </div>
          )}

          {tab === "s-appr" && (
            <div className="set-panel active">
              <div className="set-card">
                <div className="sh"><h3>Approval thresholds</h3><p>Who must sign off, by amount. Requisitions above a band route up automatically.</p></div>
                <div className="row"><div className="rl">Auto-approve below<small>Routine spend clears without a signature</small></div><ConfigMoney configKey="approve_auto_below" /></div>
                <div className="row"><div className="rl">Single approver up to</div><ConfigMoney configKey="single_approver_max" /></div>
                <div className="row"><div className="rl">Dual approval up to</div><ConfigMoney configKey="dual_approval_max" /></div>
                <div className="row"><div className="rl">MD sign-off above<small>Routes to the Managing Director</small></div><ConfigMoney configKey="md_signoff_above" /></div>
              </div>
              <div className="set-card">
                <div className="sh"><h3>Matching &amp; amendment rules</h3><p>Live controls the procure-to-pay chain reads. Changes take effect on the next match, amendment or reminder — and are logged.</p></div>
                <div className="row"><div className="rl">Three-way match tolerance<small>Invoice vs PO variance allowed before it holds as an exception</small></div><RuleInput configKey="match_tolerance_pct" suffix="%" /></div>
                <div className="row"><div className="rl">PO amendment tolerance<small>A PO change above this re-routes for approval before invoicing</small></div><RuleInput configKey="po_amend_tolerance_pct" suffix="%" /></div>
                <div className="row"><div className="rl">Manual journal maker-checker above<small>A manual journal over this needs a second approver</small></div><RuleInput configKey="manual_journal_threshold" suffix="KES" /></div>
                <div className="row"><div className="rl">Reminder after<small>An untouched assignment is re-sent to the actor</small></div><RuleInput configKey="reminder_hours" suffix="hours" /></div>
                <div className="row"><div className="rl">Escalate after<small>An ignored reminder escalates to the next approver</small></div><RuleInput configKey="escalation_hours" suffix="hours" /></div>
              </div>
            </div>
          )}

          {tab === "s-audit" && <AuditTrail />}

          {tab === "s-integ" && (
            <div className="set-panel active">
              <div className="set-card">
                <div className="sh"><h3>Connected services</h3><p>The rails Jikoni reads and writes through. Toggle a service on or off — keys are held in the vault, never shown.</p></div>
                {integrations.map((ig) => {
                  const on = cfgBool(appConfig[ig.key]);
                  return (
                    <div className="integ" key={ig.key}>
                      <div className="ic" style={{ background: ig.bg }}>{ig.ch}</div>
                      <div className="it"><div className="nm">{ig.nm}</div><div className="ds">{ig.ds}</div></div>
                      <span className={`conn ${on ? "yes" : "no"}`} style={{ marginRight: 12 }}>{on ? "Connected" : "Not connected"}</span>
                      <ConfigToggle configKey={ig.key} />
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {tab === "s-sec" && (
            <div className="set-panel active">
              <div className="set-card">
                <div className="sh"><h3>Security &amp; data</h3><p>The controls that make Jikoni defensible under diligence.</p></div>
                <div className="row"><div className="rl">Require two-factor for everyone<small>{notEnrolled} of {members.length} member{members.length === 1 ? "" : "s"} not yet enrolled</small></div><ConfigToggle configKey="require_2fa" /></div>
                <div className="row"><div className="rl">Immutable audit log<small>Every write recorded with who, what and when. Cannot be disabled.</small></div><LockedToggle /></div>
                <div className="row"><div className="rl">Data-room mode<small>Read-only, watermarked, audit-logged view for investors and auditors</small></div>
                  <ConfigToggle configKey="dataroom_mode" />
                </div>
                <div className="row"><div className="rl">Export all data<small>Full workspace export — you own the data and can move it any time</small></div>
                  <button className="btn" onClick={() => toast("Export queued", "We'll email you a download link when it's ready")}>Request export</button>
                </div>
              </div>
            </div>
          )}
        </div>
      </div>
    </>
  );
}

function CodingPanel() {
  const { costCentres, createCostCentre, projectDetails } = useApp();
  const [name, setName] = useState("");
  const [budget, setBudget] = useState("");
  const projects = Object.keys(projectDetails);
  function add() {
    const b = parseFloat(budget) || 0;
    if (name.trim()) createCostCentre(name.trim(), b);
    setName(""); setBudget("");
  }
  return (
    <div className="set-panel active">
      <div className="set-card">
        <div className="sh"><h3>Cost centres</h3><p>The coding every requisition, budget line and ledger posting resolves to. Create them here — this is the dropdown source everywhere else.</p></div>
        <table className="tbl">
          <thead><tr><th>Cost centre</th><th>Budget</th><th>Used</th><th>Remaining</th></tr></thead>
          <tbody>
            {costCentres.length === 0 ? (
              <tr><td colSpan={4} style={{ textAlign: "center", color: "var(--ink-soft)", padding: "16px 0" }}>No cost centres yet — add the first below.</td></tr>
            ) : costCentres.map((c) => (
              <tr key={c.code}>
                <td><strong>{c.code}</strong></td>
                <td className="mono">{c.budget.toLocaleString()}</td>
                <td className="mono">{c.used.toLocaleString()}</td>
                <td className="mono">{(c.budget - c.used).toLocaleString()}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <div style={{ display: "flex", gap: 10, marginTop: 12, alignItems: "flex-end" }}>
          <div style={{ flex: 1 }}><label style={{ fontSize: 12, color: "var(--ink-soft)" }}>Name</label><input className="field" style={{ width: "100%" }} placeholder="e.g. Field / MRV" value={name} onChange={(e) => setName(e.target.value)} /></div>
          <div style={{ width: 180 }}><label style={{ fontSize: 12, color: "var(--ink-soft)" }}>Budget (KES)</label><input className="field" style={{ width: "100%" }} type="number" min="0" placeholder="0" value={budget} onChange={(e) => setBudget(e.target.value)} /></div>
          <button className="btn primary" onClick={add} disabled={!name.trim()}>+ New Cost Centre</button>
        </div>
      </div>
      <div className="set-card">
        <div className="sh"><h3>Projects</h3><p>Project codes are created in the Projects &amp; Programmes module and shared here — they're the optional second coding on a requisition.</p></div>
        {projects.length === 0 ? (
          <div className="row"><div className="rl">No projects yet<small>Create them under Projects &amp; Programmes</small></div></div>
        ) : projects.map((p) => (
          <div className="row" key={p}><div className="rl">{p}<small>{projectDetails[p].funder || "—"}</small></div><span className="conn yes">Active</span></div>
        ))}
      </div>
    </div>
  );
}

function AuditTrail() {
  const { audit } = useApp();
  const [moduleF, setModuleF] = useState("all");
  const [userF, setUserF] = useState("all");
  const [qy, setQy] = useState("");
  const modules = Array.from(new Set(audit.map((a) => a.recordType))).sort();
  const users = Array.from(new Set(audit.map((a) => a.actor))).sort();
  const rows = audit.filter((a) =>
    (moduleF === "all" || a.recordType === moduleF) &&
    (userF === "all" || a.actor === userF) &&
    (qy.trim() === "" || `${a.action} ${a.recordRef ?? ""} ${JSON.stringify(a.detail)}`.toLowerCase().includes(qy.toLowerCase()))
  );
  const when = (iso: string) => new Date(iso).toLocaleString("en-GB", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" });
  return (
    <div className="set-panel active">
      <div className="set-card">
        <div className="sh"><h3>Audit trail</h3><p>Who did what, and when — the immutable log every write lands in. Answers "who approved what and when" directly, filterable by record, actor and text.</p></div>
        <div style={{ display: "flex", gap: 10, flexWrap: "wrap", marginBottom: 12 }}>
          <select className="field" value={moduleF} onChange={(e) => setModuleF(e.target.value)}>
            <option value="all">All record types</option>
            {modules.map((m) => <option key={m} value={m}>{m}</option>)}
          </select>
          <select className="field" value={userF} onChange={(e) => setUserF(e.target.value)}>
            <option value="all">All users</option>
            {users.map((u) => <option key={u} value={u}>{u}</option>)}
          </select>
          <input className="field" style={{ flex: 1, minWidth: 160 }} placeholder="Search action, ref or detail…" value={qy} onChange={(e) => setQy(e.target.value)} />
        </div>
        <table className="tbl">
          <thead><tr><th>When</th><th>Actor</th><th>Action</th><th>Record</th></tr></thead>
          <tbody>
            {rows.length === 0 ? (
              <tr><td colSpan={4} style={{ textAlign: "center", color: "var(--ink-soft)", padding: "18px 0" }}>No matching audit entries.</td></tr>
            ) : rows.slice(0, 100).map((a) => (
              <tr key={a.id}>
                <td className="mono" style={{ fontSize: 12, whiteSpace: "nowrap" }}>{when(a.when)}</td>
                <td style={{ fontSize: 12 }}>{a.actor}</td>
                <td>{a.action}</td>
                <td className="mono" style={{ fontSize: 12 }}>{a.recordType}{a.recordRef ? ` · ${a.recordRef}` : ""}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <div style={{ fontSize: 11.5, color: "var(--ink-soft)", marginTop: 8 }}>Showing {Math.min(rows.length, 100)} of {rows.length} matching entries (latest 200 loaded).</div>
      </div>
    </div>
  );
}
