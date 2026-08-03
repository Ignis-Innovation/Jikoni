import { useEffect, useState, type CSSProperties } from "react";
import { useApp } from "../store";
import { OrgI, BellI, LinkI, LockI } from "../components/icons";

/* ---------- config-bound controls: every one persists to app_config ---------- */
function cfgBool(v: unknown) { return v === true || v === "true"; }

function ConfigToggle({ configKey, disabled }: { configKey: string; disabled?: boolean }) {
  const { appConfig, setAppConfig } = useApp();
  const on = cfgBool(appConfig[configKey]);
  return (
    <button className={`toggle ${on ? "on" : ""}`} style={disabled ? { opacity: 0.6, cursor: "not-allowed" } : undefined}
      onClick={() => { if (!disabled) setAppConfig(configKey, !on); }} />
  );
}

function LockedToggle() {
  return <button className="toggle on" style={{ opacity: 0.6, cursor: "not-allowed" }} />;
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

const tabsDef = [
  { id: "s-org", l: "Organisation", icon: <OrgI /> },
  { id: "s-profile", l: "Profile", icon: <OrgI /> },
  { id: "s-notif", l: "Notifications", icon: <BellI /> },
  { id: "s-audit", l: "Audit Trail", icon: <LockI width={16} height={16} /> },
  { id: "s-integ", l: "Integrations", icon: <LinkI /> },
  { id: "s-sec", l: "Security & data", icon: <LockI width={16} height={16} /> },
];

export default function SettingsView() {
  const { toast, members, settingsTab, setSettingsTab } = useApp();
  const tab = settingsTab;
  const setTab = setSettingsTab;
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
                <div className="row"><div className="rl">Legal name<small>Fixed on the registered entity</small></div><div style={{ fontWeight: 600 }}>Ignis Innovation Limited</div></div>
                <div className="row"><div className="rl">Primary entity<small>The ledger new records post to</small></div><span className="conn yes">Kenya</span></div>
                <div className="row"><div className="rl">Base reporting currency</div>
                  <ConfigSelect configKey="base_currency" options={[{ v: "KES", l: "KES — Kenyan Shilling" }, { v: "USD", l: "USD — US Dollar" }]} />
                </div>
                <div className="row"><div className="rl">Fiscal year start</div>
                  <ConfigSelect configKey="fiscal_year_start" options={[{ v: "January", l: "January" }, { v: "July", l: "July" }]} />
                </div>
              </div>
            </div>
          )}

          {tab === "s-profile" && <ProfilePanel />}

          {tab === "s-notif" && (
            <div className="set-panel active">
              <div className="set-card">
                <div className="sh"><h3>How you're notified</h3><p>Applies to this workspace. Email routes through Gmail Workspace.</p></div>
                <div className="row"><div className="rl">In-app<small>The bell in the top bar and live badges</small></div><ConfigToggle configKey="notif_in_app" /></div>
                <div className="row">
                  <div className="rl">Email digest<small>A weekly summary of your tasks, approvals and notifications — sent every Monday</small></div>
                  <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                    <DigestNow />
                    <ConfigToggle configKey="notif_email_digest" />
                  </div>
                </div>
                <div className="row"><div className="rl">Stalled engagement alerts<small>An engagement with no touch in 14 days surfaces to its owner</small></div><ConfigToggle configKey="notif_stalled_eng" /></div>
              </div>
            </div>
          )}

          {tab === "s-audit" && <AuditTrail />}

          {tab === "s-integ" && <IntegrationsPanel />}

          {tab === "s-sec" && (
            <div className="set-panel active">
              <div className="set-card">
                <div className="sh"><h3>Security &amp; data</h3><p>The controls that make Jikoni defensible under diligence.</p></div>
                <div className="row"><div className="rl">Require two-factor for everyone<small>{notEnrolled} of {members.length} member{members.length === 1 ? "" : "s"} not yet enrolled</small></div><ConfigToggle configKey="require_2fa" /></div>
                <div className="row"><div className="rl">Immutable audit log<small>Every write recorded with who, what and when. Cannot be disabled.</small></div><LockedToggle /></div>
                <div className="row"><div className="rl">Data-room mode<small>Read-only, watermarked, audit-logged view for investors and auditors</small></div><ConfigToggle configKey="dataroom_mode" /></div>
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

/* ---------- Profile: edit your own name, title, colour + change password ---------- */
const SWATCHES = ["#0e7d91", "#E2632A", "#3C8A5E", "#6D28D9", "#C99A2E", "#B5455B", "#2E7D9A", "#74695D"];

function ProfilePanel() {
  const { me, updateMyProfile, changePassword, toast } = useApp();
  const [name, setName] = useState(me?.name ?? "");
  const [roleTitle, setRoleTitle] = useState(me?.roleTitle ?? "");
  const [color, setColor] = useState(me?.color ?? SWATCHES[0]);
  useEffect(() => { setName(me?.name ?? ""); setRoleTitle(me?.roleTitle ?? ""); setColor(me?.color ?? SWATCHES[0]); }, [me]);

  const [pw, setPw] = useState(""); const [pw2, setPw2] = useState(""); const [pwMsg, setPwMsg] = useState("");

  function saveProfile() {
    if (!name.trim()) { toast("Name can't be empty", "Enter your display name"); return; }
    updateMyProfile({ name: name.trim(), roleTitle: roleTitle.trim(), color });
  }
  async function savePassword() {
    setPwMsg("");
    if (pw.length < 8) { setPwMsg("Use at least 8 characters."); return; }
    if (pw !== pw2) { setPwMsg("The two passwords don't match."); return; }
    const err = await changePassword(pw);
    if (err) { setPwMsg(err); return; }
    setPw(""); setPw2(""); setPwMsg("Password changed.");
  }

  return (
    <div className="set-panel active">
      <div className="set-card">
        <div className="sh"><h3>My profile</h3><p>How you appear across the workspace. Your sign-in email stays fixed.</p></div>
        <div className="row"><div className="rl">Display name</div><input className="field" value={name} onChange={(e) => setName(e.target.value)} /></div>
        <div className="row"><div className="rl">Role / title</div><input className="field" placeholder="e.g. Managing Director" value={roleTitle} onChange={(e) => setRoleTitle(e.target.value)} /></div>
        <div className="row"><div className="rl">Email<small>Your login — can't be changed here</small></div><div className="mono" style={{ color: "var(--ink-soft)" }}>{me?.email}</div></div>
        <div className="row">
          <div className="rl">Avatar colour</div>
          <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
            <span className="av-sm" style={{ background: color }}>{(name || "?")[0]?.toUpperCase()}</span>
            {SWATCHES.map((c) => (
              <button key={c} onClick={() => setColor(c)} aria-label={c}
                style={{ width: 22, height: 22, borderRadius: 6, background: c, cursor: "pointer", border: color === c ? "2px solid var(--ink)" : "2px solid transparent" }} />
            ))}
          </div>
        </div>
        <div style={{ marginTop: 12 }}><button className="btn primary" onClick={saveProfile}>Save profile</button></div>
      </div>

      <div className="set-card">
        <div className="sh"><h3>Change password</h3><p>Sets the password you'll use to sign in from now on.</p></div>
        <div className="row"><div className="rl">New password</div><input className="field" type="password" autoComplete="new-password" value={pw} onChange={(e) => setPw(e.target.value)} placeholder="At least 8 characters" /></div>
        <div className="row"><div className="rl">Confirm password</div><input className="field" type="password" autoComplete="new-password" value={pw2} onChange={(e) => setPw2(e.target.value)} /></div>
        {pwMsg && <div style={{ fontSize: 12.5, color: pwMsg === "Password changed." ? "var(--flame)" : "var(--red)", marginTop: 4 }}>{pwMsg}</div>}
        <div style={{ marginTop: 12 }}><button className="btn primary" onClick={savePassword} disabled={!pw || !pw2}>Update password</button></div>
      </div>
    </div>
  );
}

function DigestNow() {
  const { sendMyDigest } = useApp();
  return <button className="btn" style={{ padding: "5px 11px", fontSize: 12 }} onClick={sendMyDigest}>Send me one now</button>;
}

/* ---------- Integrations: real connections (Claude · Gmail · Google Drive) ---------- */
function IntegrationsPanel() {
  const { oauthStatus, connectClaude, toast } = useApp();
  const googleOn = !!oauthStatus.google?.connected;
  const claudeOn = !!oauthStatus.claude?.connected;
  const [showClaude, setShowClaude] = useState(false);
  const [key, setKey] = useState("");
  const [busy, setBusy] = useState(false);

  async function saveClaude() {
    setBusy(true);
    const err = await connectClaude(key.trim());
    setBusy(false);
    if (err) { toast("Claude not connected", err); return; }
    setKey(""); setShowClaude(false);
  }

  const Row = ({ bg, ch, nm, ds, on, action }: { bg: string; ch: string; nm: string; ds: string; on: boolean; action: React.ReactNode }) => (
    <div className="integ">
      <div className="ic" style={{ background: bg }}>{ch}</div>
      <div className="it"><div className="nm">{nm}</div><div className="ds">{ds}</div></div>
      <span className={`conn ${on ? "yes" : "no"}`} style={{ marginRight: 12 }}>{on ? "Connected" : "Not connected"}</span>
      {action}
    </div>
  );

  return (
    <div className="set-panel active">
      <div className="set-card">
        <div className="sh"><h3>Connected services</h3><p>Link the tools Jikoni works through. Tokens and keys are held server-side, never shown.</p></div>

        <Row bg="#6D28D9" ch="C" nm="Claude API" ds="Receipt OCR · concept drafting · CV screening" on={claudeOn}
          action={<button className="btn" onClick={() => setShowClaude((s) => !s)}>{claudeOn ? "Update key" : "Connect"}</button>} />
        {showClaude && (
          <div className="row" style={{ gap: 10 }}>
            <input className="field" style={{ flex: 1 }} type="password" placeholder="Anthropic API key (sk-ant-…)" value={key} onChange={(e) => setKey(e.target.value)} />
            <button className="btn primary" onClick={saveClaude} disabled={busy || !key.trim()}>{busy ? "Checking…" : "Save"}</button>
          </div>
        )}

        <Row bg="#12A3BE" ch="G" nm="Gmail" ds="Read & send workspace email" on={googleOn}
          action={<button className="btn" onClick={() => { window.location.href = "/api/google-auth"; }}>{googleOn ? "Reconnect" : "Connect Google"}</button>} />
        <Row bg="#16A34A" ch="D" nm="Google Drive" ds="Attach & pull documents from Drive" on={googleOn}
          action={<button className="btn" onClick={() => { window.location.href = "/api/google-auth"; }}>{googleOn ? "Reconnect" : "Connect Google"}</button>} />

        {googleOn && oauthStatus.google?.email && (
          <div style={{ fontSize: 11.5, color: "var(--ink-soft)", marginTop: 8 }}>Google account: {oauthStatus.google.email}</div>
        )}
        <div style={{ fontSize: 11.5, color: "var(--ink-soft)", marginTop: 8 }}>
          Google connect needs the workspace Google OAuth client configured. One "Connect Google" grants Gmail + Drive.
        </div>
      </div>
    </div>
  );
}

/* ---------- Audit trail: filters + search + 25-per-page pagination ---------- */
function AuditTrail() {
  const { audit } = useApp();
  const [moduleF, setModuleF] = useState("all");
  const [userF, setUserF] = useState("all");
  const [qy, setQy] = useState("");
  const [page, setPage] = useState(1);
  const PAGE = 25;
  const modules = Array.from(new Set(audit.map((a) => a.recordType))).sort();
  const users = Array.from(new Set(audit.map((a) => a.actor))).sort();
  const rows = audit.filter((a) =>
    (moduleF === "all" || a.recordType === moduleF) &&
    (userF === "all" || a.actor === userF) &&
    (qy.trim() === "" || `${a.action} ${a.recordRef ?? ""} ${JSON.stringify(a.detail)}`.toLowerCase().includes(qy.toLowerCase()))
  );
  useEffect(() => { setPage(1); }, [moduleF, userF, qy]);
  const pages = Math.max(1, Math.ceil(rows.length / PAGE));
  const clamped = Math.min(page, pages);
  const slice = rows.slice((clamped - 1) * PAGE, clamped * PAGE);
  const when = (iso: string) => new Date(iso).toLocaleString("en-GB", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" });
  return (
    <div className="set-panel active">
      <div className="set-card">
        <div className="sh"><h3>Audit trail</h3><p>Who did what, and when — the immutable log every write lands in. Filter by record, actor and text.</p></div>
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
            {slice.length === 0 ? (
              <tr><td colSpan={4} style={{ textAlign: "center", color: "var(--ink-soft)", padding: "18px 0" }}>No matching audit entries.</td></tr>
            ) : slice.map((a) => (
              <tr key={a.id}>
                <td className="mono" style={{ fontSize: 12, whiteSpace: "nowrap" }}>{when(a.when)}</td>
                <td style={{ fontSize: 12 }}>{a.actor}</td>
                <td>{a.action}</td>
                <td className="mono" style={{ fontSize: 12 }}>{a.recordType}{a.recordRef ? ` · ${a.recordRef}` : ""}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginTop: 10, fontSize: 11.5, color: "var(--ink-soft)" }}>
          <span>{rows.length === 0 ? "No entries" : `Showing ${(clamped - 1) * PAGE + 1}–${Math.min(clamped * PAGE, rows.length)} of ${rows.length} · page ${clamped}/${pages}`}</span>
          <span style={{ display: "flex", gap: 8 }}>
            <button className="btn" style={{ padding: "4px 10px", fontSize: 12 }} disabled={clamped <= 1} onClick={() => setPage(clamped - 1)}>Prev</button>
            <button className="btn" style={{ padding: "4px 10px", fontSize: 12 }} disabled={clamped >= pages} onClick={() => setPage(clamped + 1)}>Next</button>
          </span>
        </div>
      </div>
    </div>
  );
}
