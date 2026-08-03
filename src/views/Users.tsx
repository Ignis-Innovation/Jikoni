import { useApp } from "../store";
import { roleMeta, accessModules, lvlName, Perms } from "../data";
import { Pulse } from "../components/ui";
import { PlusI, LockI, LockSmI } from "../components/icons";

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
  const { perms, openAccess, setInviteOpen, members } = useApp();

  // Live from public.app_users: people who have accepted are members; state 'invited'
  // are still pending their first sign-in (they set their own password from the email link).
  const active = members.filter((m) => m.state !== "invited");
  const pending = members.filter((m) => m.state === "invited");
  const isSuper = (email: string) => perms[email]?.users === 3;

  const superCount = active.filter((m) => isSuper(m.email)).length;
  const twoFaCount = active.filter((m) => m.twoFa).length;
  const onlineCount = active.filter((m) => m.status === "active").length;

  const pulse = [
    { k: "Members", tick: "t-blue", v: String(active.length), d: pending.length ? `${pending.length} invite${pending.length > 1 ? "s" : ""} pending` : "all accepted", dc: "flat" as const },
    { k: "Super admins", tick: "t-ember", v: String(superCount), d: "full user access", dc: "flat" as const },
    { k: "2FA enrolled", tick: "t-green", v: `${twoFaCount} / ${active.length}`, d: `${Math.max(active.length - twoFaCount, 0)} outstanding`, dc: "flat" as const },
    { k: "Active today", tick: "t-blue", v: String(onlineCount), d: "right now", dc: "flat" as const },
  ];

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
        <div className="panel-h">
          <h3>Members</h3>
          <span className="meta">{active.length} member{active.length === 1 ? "" : "s"}{pending.length ? ` · ${pending.length} invite${pending.length > 1 ? "s" : ""} pending` : ""}</span>
        </div>
        <table className="tbl">
          <thead><tr><th>Member</th><th>Role</th><th>Module access</th><th>2FA</th><th>Status</th><th></th></tr></thead>
          <tbody>
            {active.length === 0 && pending.length === 0 && (
              <tr>
                <td colSpan={6} style={{ padding: "22px 14px", color: "var(--ink-soft)" }}>
                  No members yet. Use <strong>Invite member</strong> to add your first person — they'll get an email link to set their own password and sign in.
                </td>
              </tr>
            )}
            {active.map((u) => {
              const rm = roleMeta[u.roleKey] ?? [u.roleKey, u.roleKey];
              const sm = stMap[u.status] ?? ["off-i", "Offline"];
              const sa = isSuper(u.email);
              return (
                <tr key={u.email}>
                  <td>
                    <div className="who">
                      <div className="av-sm" style={{ background: u.color ?? "#D8D2C7" }}>{u.name[0]}</div>
                      <div>
                        <div className="nm">{u.name}{sa && <> <span className="acc-chip full" style={{ fontSize: 9 }}>SUPER ADMIN</span></>}</div>
                        <div className="em">{u.email}</div>
                      </div>
                    </div>
                  </td>
                  <td>
                    <span className={`tag ${rm[0]}`}>{rm[1]}</span>
                    {u.roleTitle && <div style={{ fontSize: 11, color: "var(--ink-soft)", marginTop: 4 }}>{u.roleTitle}</div>}
                  </td>
                  <td><AccSummary p={perms[u.email]} /></td>
                  <td>{u.twoFa ? <span className="dot-s"><i className="active-i" />On</span> : <span className="dot-s"><i className="off-i" />Off</span>}</td>
                  <td><span className="dot-s"><i className={sm[0]} />{sm[1]}</span></td>
                  <td>
                    <button className="btn" style={{ padding: "6px 11px", fontSize: 12 }} onClick={() => openAccess(u.email)}>
                      <LockSmI />Manage access
                    </button>
                  </td>
                </tr>
              );
            })}
            {pending.map((u) => {
              const rm = roleMeta[u.roleKey] ?? [u.roleKey, u.roleKey];
              return (
                <tr key={u.email} style={{ opacity: 0.7 }}>
                  <td>
                    <div className="who">
                      <div className="av-sm" style={{ background: "#D8D2C7", color: "#74695D" }}>{u.name[0] ?? "+"}</div>
                      <div>
                        <div className="nm" style={{ color: "var(--ink-soft)" }}>{u.name}</div>
                        <div className="em">{u.email}</div>
                      </div>
                    </div>
                  </td>
                  <td><span className={`tag ${rm[0]}`}>{rm[1]}</span></td>
                  <td><span className="acc-chip none">Set on first sign-in</span></td>
                  <td>—</td>
                  <td><span className="dot-s" title="Invited — hasn't signed in yet"><i className="away-i" />Pending sign-in</span></td>
                  <td>
                    <button className="btn" style={{ padding: "6px 11px", fontSize: 12 }} onClick={() => openAccess(u.email)}>
                      <LockSmI />Manage access
                    </button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </>
  );
}
