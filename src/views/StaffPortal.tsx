import { useRef, useState } from "react";
import { useApp } from "../store";
import { Note } from "../components/ui";
import { PlusI } from "../components/icons";
import { kes } from "../data";

const docCategories = [
  { value: "id", label: "ID / KRA / statutory" },
  { value: "contract", label: "Contract / letter" },
  { value: "certificate", label: "Certificate" },
  { value: "other", label: "Other" },
];

const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);
const fmtD = (iso: string) => new Date(iso + "T00:00:00").toLocaleDateString("en-GB", { day: "numeric", month: "short" });
const fmtPeriod = (p: string) => { const [y, m] = p.split("-"); return new Date(+y, +m - 1, 1).toLocaleDateString("en-GB", { month: "long", year: "numeric" }); };
const statePill: Record<string, { cls: string; txt: string }> = {
  pending: { cls: "today", txt: "Awaiting HR" },
  approved: { cls: "done", txt: "Approved" },
  rejected: { cls: "over", txt: "Rejected" },
  cancelled: { cls: "done", txt: "Cancelled" },
};

export default function StaffPortalView() {
  const { toast, openLeave, openLeaveEdit, deleteLeave, hrMe, addStaffDocument, deleteStaffDocument, staffDocUrl } = useApp();
  const fileRef = useRef<HTMLInputElement>(null);
  const [docCat, setDocCat] = useState("other");
  const [busy, setBusy] = useState(false);

  async function openDoc(path: string) {
    const url = await staffDocUrl(path);
    if (url) window.open(url, "_blank", "noopener");
  }
  async function onPick(e: React.ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0];
    e.target.value = "";
    if (!f) return;
    setBusy(true);
    await addStaffDocument(f, f.name, docCat);
    setBusy(false);
  }

  const balances = hrMe?.leave ?? [];
  const apps = hrMe?.applications ?? [];
  const payslips = hrMe?.payslips ?? [];
  const docs = hrMe?.docs ?? [];
  const annual = balances.find((b) => b.kind === "annual");
  const annualLeft = annual ? annual.entitled - annual.used - annual.reserved : null;
  const latestSlip = payslips[0];

  return (
    <>
      <div className="vhead">
        <div>
          <h1>Staff Portal</h1>
          <p>Your self-service — payslips, leave, documents and the tasks assigned to you. This is the view every employee sees of themselves.</p>
        </div>
        <div className="actions">
          <button className="btn primary" onClick={openLeave}><PlusI />Apply for leave</button>
        </div>
      </div>
      <div className="grid g-2">
        <div className="panel sm">
          <div className="panel-h"><h3>This month</h3><span className="meta">Wanjiku · Chief of Staff</span></div>
          <div className="recon"><span>Latest payslip</span><span className="mono">{latestSlip ? fmtPeriod(latestSlip.period) : "—"}</span></div>
          <div className="recon"><span>Net pay</span><span className="mono">{latestSlip ? kes(latestSlip.net) : "—"}</span></div>
          <div className="recon"><span>Annual leave balance</span><span className="mono">{annual ? `${annualLeft} / ${annual.entitled} days` : "—"}</span></div>
          <div className="recon"><span>Tasks assigned to me</span><span className="pill today">6 open</span></div>
        </div>
        <div className="panel sm">
          <div className="panel-h"><h3>My leave balances</h3><span className="meta">days left this year</span></div>
          {balances.length
            ? balances.map((b) => (
                <div className="recon" key={b.kind}><span>{cap(b.kind)}</span>
                  <span className="mono">{b.entitled - b.used - b.reserved} of {b.entitled}{b.reserved > 0 ? ` · ${b.reserved} pending` : ""}</span>
                </div>
              ))
            : <div className="recon"><span>Balances</span><span className="mono">loading…</span></div>}
        </div>
      </div>
      <div className="grid g-2" style={{ marginTop: 14 }}>
        <div className="panel sm">
          <div className="panel-h"><h3>My payslips</h3><span className="meta">posted runs</span></div>
          {payslips.length
            ? payslips.map((p) => (
                <div className="recon" key={p.period}><span>{fmtPeriod(p.period)}<span className="meta" style={{ marginLeft: 8 }}>net {kes(p.net)}</span></span>
                  <button className="btn" style={{ padding: "5px 11px", fontSize: 12 }} onClick={() => toast(`Payslip · ${fmtPeriod(p.period)}`, `Gross ${kes(p.gross)} · PAYE ${kes(p.paye)} · NSSF ${kes(p.nssf)} · SHIF ${kes(p.shif)} · Housing ${kes(p.housing)} · Net ${kes(p.net)}`)}>View</button>
                </div>
              ))
            : <div className="recon"><span>No payslips yet</span><span className="pill today">awaiting first run</span></div>}
        </div>
        <div className="panel sm">
          <div className="panel-h"><h3>My documents</h3><span className="meta">personal file</span></div>
          {docs.length
            ? docs.map((d) => (
                <div className="recon" key={d.name + d.version}>
                  <span>{d.name}<span className="meta" style={{ marginLeft: 8 }}>v{d.version}{d.category ? ` · ${d.category}` : ""}</span></span>
                  {d.path
                    ? <span style={{ display: "flex", gap: 8 }}>
                        <button className="btn" style={{ padding: "4px 10px", fontSize: 11.5 }} onClick={() => openDoc(d.path!)}>View</button>
                        <button className="btn" style={{ padding: "4px 10px", fontSize: 11.5, color: "var(--red)" }} onClick={() => deleteStaffDocument(d.path!, d.name)}>Delete</button>
                      </span>
                    : <span className="rcv ok">on file</span>}
                </div>
              ))
            : <div className="recon"><span>No documents yet</span><span className="mono">—</span></div>}
          <input ref={fileRef} type="file" accept=".pdf,.png,.jpg,.jpeg,.doc,.docx" style={{ display: "none" }} onChange={onPick} />
          <div className="recon"><span>Add a document</span>
            <span style={{ display: "flex", gap: 8 }}>
              <select className="field" style={{ padding: "4px 8px", fontSize: 11.5, width: "auto" }} value={docCat} onChange={(e) => setDocCat(e.target.value)}>
                {docCategories.map((c) => <option key={c.value} value={c.value}>{c.label}</option>)}
              </select>
              <button className="btn" style={{ padding: "4px 10px", fontSize: 11.5 }} disabled={busy} onClick={() => fileRef.current?.click()}>{busy ? "Uploading…" : "Upload"}</button>
            </span>
          </div>
          <Note>You can see and upload to your own file. HR can view it; no one else can unless a super admin grants access.</Note>
        </div>
      </div>
      <div className="panel" style={{ marginTop: 14 }}>
        <div className="panel-h"><h3>My leave requests</h3><span className="meta">HR decision on each</span></div>
        {apps.length ? (
          <table className="tbl">
            <thead><tr><th>Ref</th><th>Type</th><th>Dates</th><th>Days</th><th>HR decision</th><th></th></tr></thead>
            <tbody>
              {apps.map((a) => (
                <tr key={a.id}>
                  <td className="mono">{a.id}</td>
                  <td>{cap(a.kind)}</td>
                  <td>{fmtD(a.from)} – {fmtD(a.to)}</td>
                  <td className="mono">{a.days}</td>
                  <td><span className={`pill ${statePill[a.state]?.cls || "today"}`} style={{ textTransform: "none" }}>{statePill[a.state]?.txt || a.state}</span></td>
                  <td>
                    {a.state === "pending" ? (
                      <span style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
                        <button className="btn" style={{ padding: "4px 10px", fontSize: 11.5 }} onClick={() => openLeaveEdit(a)}>Edit</button>
                        <button className="btn" style={{ padding: "4px 10px", fontSize: 11.5, color: "var(--red)" }} onClick={() => deleteLeave(a.id)}>Delete</button>
                      </span>
                    ) : (
                      <span className="meta" style={{ display: "block", textAlign: "right" }}>locked</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : (
          <Note>No leave requests yet — use “Apply for leave” above and it routes to HR.</Note>
        )}
      </div>
    </>
  );
}
