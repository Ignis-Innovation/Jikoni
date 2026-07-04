import { useApp } from "../store";
import { users, roleMeta, superAdmins, accessModules, lvlName, Perms } from "../data";
import { Pulse } from "../components/ui";
import { PlusI, LockI, LockSmI } from "../components/icons";

const pulse = [
  { k: "Members", tick: "t-blue", v: "7", d: "1 invite pending", dc: "flat" as const },
  { k: "Super admins", tick: "t-ember", v: "2", d: "Dennis · you", dc: "flat" as const },
  { k: "2FA enrolled", tick: "t-green", v: "5 / 7", d: "2 outstanding", dc: "flat" as const },
  { k: "Active today", tick: "t-blue", v: "3", d: "right now", dc: "flat" as const },
];

const stMap: Record<string, [string, string]> = {
  active: ["active-i", "Online"],
  away: ["away-i", "Away"],
  off: ["off-i", "Offline"],
};

function AccSummary({ p }: { p?: Perms }) {
  if (!p) return <span className="acc-chip none">Not set</span>;
  const vals = Object.values(p);
  const granted = vals.filter((v) => v >= 1).length;
  if (vals.length && vals.every((v) => v === 3)) return <span className="acc-chip full">All modules · Full</span>;
  if (granted === 0) return <span className="acc-chip none">No access yet</span>;
  const top = Math.max(...vals);
  return (
    <div className="acc-sum">
      <span className="acc-chip">{granted} of {accessModules.length} modules</span>
      <span className="acc-chip">up to {lvlName[top]}</span>
    </div>
  );
}

export default function UsersView() {
  const { toast, perms, openAccess, setInviteOpen } = useApp();

  return (
    <>
      <div className="vhead">
        <div>
          <h1>User Management</h1>
          <p>Who can see and do what inside Jikoni. Roles, access, two-factor, and the audit trail behind every change.</p>
        </div>
        <div className="actions">
          <button className="btn primary" onClick={() => setInviteOpen(true)}><PlusI />Invite member</button>
        </div>
      </div>
      <Pulse data={pulse} />
      <div className="sa-banner" style={{ marginBottom: 18 }}>
        <LockI />
        <div>
          You're signed in as a <strong>super admin</strong>, so you can grant or revoke module access. Members only see what
          they've been given — every other module stays hidden from them. Changes are written to the audit log.
        </div>
      </div>
      <div className="panel">
        <div className="panel-h"><h3>Members</h3><span className="meta">{users.length} members · 1 invite pending</span></div>
        <table className="tbl">
          <thead><tr><th>Member</th><th>Role</th><th>Module access</th><th>2FA</th><th>Status</th><th></th></tr></thead>
          <tbody>
            {users.map((u) => {
              const rm = roleMeta[u.role];
              const sm = stMap[u.st];
              const isSA = superAdmins.includes(u.e);
              return (
                <tr key={u.e}>
                  <td>
                    <div className="who">
                      <div className="av-sm" style={{ background: u.c }}>{u.n[0]}</div>
                      <div>
                        <div className="nm">{u.n}{isSA && <> <span className="acc-chip full" style={{ fontSize: 9 }}>SUPER ADMIN</span></>}</div>
                        <div className="em">{u.e}</div>
                      </div>
                    </div>
                  </td>
                  <td>
                    <span className={`tag ${rm[0]}`}>{rm[1]}</span>
                    <div style={{ fontSize: 11, color: "var(--ink-soft)", marginTop: 4 }}>{u.rt}</div>
                  </td>
                  <td><AccSummary p={perms[u.e]} /></td>
                  <td>{u.two ? <span className="dot-s"><i className="active-i" />On</span> : <span className="dot-s"><i className="off-i" />Off</span>}</td>
                  <td><span className="dot-s"><i className={sm[0]} />{sm[1]}</span></td>
                  <td>
                    <button className="btn" style={{ padding: "6px 11px", fontSize: 12 }} onClick={() => openAccess(u.e)}>
                      <LockSmI />Manage access
                    </button>
                  </td>
                </tr>
              );
            })}
            <tr style={{ opacity: 0.7 }}>
              <td>
                <div className="who">
                  <div className="av-sm" style={{ background: "#D8D2C7", color: "#74695D" }}>+</div>
                  <div>
                    <div className="nm" style={{ color: "var(--ink-soft)" }}>Invitation pending</div>
                    <div className="em">tabitha@ignis.africa</div>
                  </div>
                </div>
              </td>
              <td><span className="tag std">Standard</span></td>
              <td><span className="acc-chip none">Set on first sign-in</span></td>
              <td>—</td>
              <td><span className="dot-s"><i className="away-i" />Invited</span></td>
              <td>
                <button className="btn" style={{ padding: "6px 11px", fontSize: 12 }} onClick={() => toast("Invite resent", "We've emailed the link again")}>Resend</button>
              </td>
            </tr>
          </tbody>
        </table>
      </div>
    </>
  );
}
