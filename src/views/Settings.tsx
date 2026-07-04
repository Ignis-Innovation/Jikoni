import { useState } from "react";
import { useApp } from "../store";
import { OrgI, BellI, CheckSqThinI, LinkI, LockI } from "../components/icons";

function Toggle({ initial, disabled, onOn }: { initial: boolean; disabled?: boolean; onOn?: () => void }) {
  const [on, setOn] = useState(initial);
  return (
    <button
      className={`toggle ${on ? "on" : ""}`}
      style={disabled ? { opacity: 0.6, cursor: "not-allowed" } : undefined}
      onClick={() => {
        if (disabled) return;
        setOn(!on);
        if (!on && onOn) onOn();
      }}
    />
  );
}

const tabsDef = [
  { id: "s-org", l: "Organisation", icon: <OrgI /> },
  { id: "s-notif", l: "Notifications", icon: <BellI /> },
  { id: "s-appr", l: "Approvals", icon: <CheckSqThinI /> },
  { id: "s-integ", l: "Integrations", icon: <LinkI /> },
  { id: "s-sec", l: "Security & data", icon: <LockI width={16} height={16} /> },
];

export default function SettingsView() {
  const { toast } = useApp();
  const [tab, setTab] = useState("s-org");

  return (
    <>
      <div className="vhead">
        <div>
          <h1>Settings</h1>
          <p>Workspace configuration for Ignis. Changes are logged to the audit trail with your name and time.</p>
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
                <div className="row"><div className="rl">Legal name</div><input className="field" defaultValue="Ignis Innovation Limited" /></div>
                <div className="row">
                  <div className="rl">Primary entity<small>The default ledger for new records. Switch any record to Uganda from its own screen.</small></div>
                  <div className="seg-ctl"><button className="on">Kenya</button><button>Uganda</button><button>Consolidated</button></div>
                </div>
                <div className="row"><div className="rl">Base reporting currency</div>
                  <select className="field"><option>KES — Kenyan Shilling</option><option>USD — US Dollar</option><option>UGX — Ugandan Shilling</option></select>
                </div>
                <div className="row"><div className="rl">Fiscal year start</div>
                  <select className="field"><option>January</option><option>July</option></select>
                </div>
              </div>
              <div className="set-card">
                <div className="sh"><h3>Multi-country</h3><p>Each entity keeps its own tax codes, mobile-money rails and statutory calendar.</p></div>
                <div className="row"><div className="rl">Kenya<small>KRA eTIMS · M-Pesa Daraja · NSSF / SHIF</small></div><span className="conn yes">Active</span></div>
                <div className="row"><div className="rl">Uganda<small>URA EFRIS · MTN / Airtel Money · NSSF Uganda — onboarding for Q4 entry</small></div><span className="conn no">Setup pending</span></div>
              </div>
            </div>
          )}

          {tab === "s-notif" && (
            <div className="set-panel active">
              <div className="set-card">
                <div className="sh"><h3>How you're notified</h3><p>Applies to your account only. Channels route through Resend and Africa's Talking.</p></div>
                <div className="row"><div className="rl">In-app<small>The bell in the top bar and live badges</small></div><Toggle initial /></div>
                <div className="row"><div className="rl">Email digest<small>A morning summary of what's on your burners</small></div><Toggle initial /></div>
                <div className="row"><div className="rl">SMS for overdue approvals<small>Sent when something has waited on you over 24h</small></div><Toggle initial={false} /></div>
                <div className="row"><div className="rl">Stalled engagement alerts<small>An engagement with no touch in 14 days surfaces to its owner</small></div><Toggle initial /></div>
              </div>
            </div>
          )}

          {tab === "s-appr" && (
            <div className="set-panel active">
              <div className="set-card">
                <div className="sh"><h3>Approval thresholds</h3><p>Who must sign off, by amount. Requisitions above a band route up automatically.</p></div>
                <div className="row"><div className="rl">Auto-approve below<small>Routine spend clears without a signature</small></div><input className="field" style={{ minWidth: 140 }} defaultValue="KES 5,000" /></div>
                <div className="row"><div className="rl">Single approver up to</div><input className="field" style={{ minWidth: 140 }} defaultValue="KES 100,000" /></div>
                <div className="row"><div className="rl">Dual approval up to</div><input className="field" style={{ minWidth: 140 }} defaultValue="KES 500,000" /></div>
                <div className="row"><div className="rl">MD sign-off above<small>Routes to Dennis</small></div><input className="field" style={{ minWidth: 140 }} defaultValue="KES 500,000" /></div>
              </div>
            </div>
          )}

          {tab === "s-integ" && (
            <div className="set-panel active">
              <div className="set-card">
                <div className="sh"><h3>Connected services</h3><p>The rails Jikoni reads and writes through. Keys are held in the vault, never shown.</p></div>
                <div className="integ"><div className="ic" style={{ background: "#16A34A" }}>M</div><div className="it"><div className="nm">M-Pesa Daraja</div><div className="ds">Payments &amp; collections</div></div><span className="conn yes">Connected</span></div>
                <div className="integ"><div className="ic" style={{ background: "#B91C1C" }}>K</div><div className="it"><div className="nm">KRA eTIMS</div><div className="ds">Sales e-invoicing compliance</div></div><span className="conn yes">Connected</span></div>
                <div className="integ"><div className="ic" style={{ background: "#12A3BE" }}>R</div><div className="it"><div className="nm">Resend</div><div className="ds">Transactional &amp; digest email</div></div><span className="conn yes">Connected</span></div>
                <div className="integ"><div className="ic" style={{ background: "#E2632A" }}>A</div><div className="it"><div className="nm">Africa's Talking</div><div className="ds">SMS to field &amp; approvers</div></div><span className="conn yes">Connected</span></div>
                <div className="integ"><div className="ic" style={{ background: "#6D28D9" }}>C</div><div className="it"><div className="nm">Claude API</div><div className="ds">Receipt OCR · concept drafting · board narrative</div></div><span className="conn yes">Connected</span></div>
                <div className="integ"><div className="ic" style={{ background: "#7C2D12" }}>U</div><div className="it"><div className="nm">URA EFRIS</div><div className="ds">Uganda e-invoicing — for Q4 entry</div></div><span className="conn no">Not connected</span></div>
              </div>
            </div>
          )}

          {tab === "s-sec" && (
            <div className="set-panel active">
              <div className="set-card">
                <div className="sh"><h3>Security &amp; data</h3><p>The controls that make Jikoni defensible under diligence.</p></div>
                <div className="row"><div className="rl">Require two-factor for everyone<small>2 of 7 members not yet enrolled</small></div><Toggle initial /></div>
                <div className="row"><div className="rl">Immutable audit log<small>Every write recorded with who, what and when. Cannot be disabled.</small></div><Toggle initial disabled /></div>
                <div className="row"><div className="rl">Data-room mode<small>Read-only, watermarked, audit-logged view for investors and auditors</small></div>
                  <Toggle initial={false} onOn={() => toast("Data-room mode", "A controlled investor view is now shareable by link")} />
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
