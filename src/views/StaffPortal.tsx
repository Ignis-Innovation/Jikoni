import { useApp } from "../store";
import { Note } from "../components/ui";
import { PlusI } from "../components/icons";

export default function StaffPortalView() {
  const { toast } = useApp();
  const dl = (label: string, title: string, sub: string) => (
    <div className="recon"><span>{label}</span>
      <button className="btn" style={{ padding: "5px 11px", fontSize: 12 }} onClick={() => toast(title, sub)}>Download</button>
    </div>
  );

  return (
    <>
      <div className="vhead">
        <div>
          <h1>Staff Portal</h1>
          <p>Your self-service — payslips, leave, documents and the tasks assigned to you. This is the view every employee sees of themselves.</p>
        </div>
        <div className="actions">
          <button className="btn primary" onClick={() => toast("Leave request", "Opens a leave application routed to your manager")}><PlusI />Apply for leave</button>
        </div>
      </div>
      <div className="grid g-2">
        <div className="panel">
          <div className="panel-h"><h3>This month</h3><span className="meta">Wanjiku · Chief of Staff</span></div>
          <div className="recon"><span>Next payday</span><span className="mono">28 June</span></div>
          <div className="recon"><span>Net pay (est.)</span><span className="mono">KES 210,400</span></div>
          <div className="recon"><span>Annual leave balance</span><span className="mono">11 / 21 days</span></div>
          <div className="recon"><span>Tasks assigned to me</span><span className="pill today">6 open</span></div>
        </div>
        <div className="panel">
          <div className="panel-h"><h3>My leave</h3><span className="meta">balances &amp; requests</span></div>
          <div className="recon"><span>Annual</span><span className="mono">11 of 21</span></div>
          <div className="recon"><span>Sick</span><span className="mono">14 of 14</span></div>
          <div className="recon"><span>Compassionate</span><span className="mono">available</span></div>
          <div className="recon"><span>Last request</span><span className="pill done">Approved · 2 days, May</span></div>
        </div>
      </div>
      <div className="grid g-2" style={{ marginTop: 18 }}>
        <div className="panel">
          <div className="panel-h"><h3>My payslips</h3><span className="meta">download</span></div>
          <div className="recon"><span>June 2026</span><span className="pill today">Pending run</span></div>
          {dl("May 2026", "Payslip", "May 2026 payslip — PDF")}
          {dl("April 2026", "Payslip", "April 2026 payslip — PDF")}
          {dl("March 2026", "Payslip", "March 2026 payslip — PDF")}
        </div>
        <div className="panel">
          <div className="panel-h"><h3>My documents</h3><span className="meta">personal file</span></div>
          <div className="recon"><span>Employment contract</span><span className="rcv ok">on file</span></div>
          <div className="recon"><span>National ID</span><span className="rcv ok">on file</span></div>
          <div className="recon"><span>KRA PIN certificate</span><span className="rcv ok">on file</span></div>
          <div className="recon"><span>Academic certificates</span>
            <button className="btn" style={{ padding: "5px 11px", fontSize: 12 }} onClick={() => toast("Upload", "Add a document to your personal file")}>Upload</button>
          </div>
          <Note>You can see and upload to your own file. HR can view it; no one else can unless a super admin grants access.</Note>
        </div>
      </div>
    </>
  );
}
