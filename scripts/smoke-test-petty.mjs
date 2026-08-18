// Exercise the single-approver petty-cash routing (0066): an employee's request → HR,
// HR's own → Super Admin, a Super Admin's own → auto-approved; the routed role's guard;
// and the requester bell on decision. All inside a rolled-back transaction.
import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const url = readFileSync(resolve(root, ".claude/settings.local.json"), "utf8")
  .match(/postgres(?:ql)?:\/\/[^"'\\\s]+/)[0];
const c = new pg.Client({ connectionString: url, ssl: { rejectUnauthorized: false } });
await c.connect();

const q = async (sql, ...args) => (await c.query(sql, args)).rows;
const rpc = async (call) => (await c.query(`select ${call} as r`)).rows[0].r;
const asUser = (u) => c.query(`select set_config('request.jwt.claims', $1, false)`,
  [JSON.stringify({ email: u.email, sub: u.auth_id, role: "authenticated" })]);

let failures = 0;
const check = (label, ok, extra = "") => {
  console.log(`${ok ? "✓" : "✗ FAIL"} ${label}${extra ? " — " + extra : ""}`);
  if (!ok) failures++;
};

try {
  await c.query("begin");

  // Pick one live user per role (all need a real auth_id to act as them).
  const [sup] = await q(`select au.id, au.email, au.auth_id from app_users au
    join user_permissions p on p.email = lower(au.email)
    where p.module = 'users' and p.level >= 3 and au.auth_id is not null limit 1`);
  const [hr] = await q(`select au.id, au.email, au.auth_id from app_users au
    join user_permissions p on p.email = lower(au.email)
    where p.module = 'hr' and p.level >= 2 and au.auth_id is not null
      and not exists (select 1 from user_permissions p2 where p2.email = lower(au.email) and p2.module = 'users' and p2.level >= 3)
    limit 1`);
  const [emp] = await q(`select au.id, au.email, au.auth_id from app_users au
    where au.auth_id is not null
      and not exists (select 1 from user_permissions p where p.email = lower(au.email)
        and ((p.module = 'hr' and p.level >= 2) or (p.module = 'users' and p.level >= 3)))
    limit 1`);
  check("found a Super Admin to test with", !!sup, sup?.email);
  check("found an HR user to test with", !!hr, hr?.email);
  if (!sup || !hr) throw new Error("Need at least one Super Admin and one HR user");

  // 1) employee raises → routed to HR
  if (emp) {
    await asUser(emp);
    const r1 = await rpc(`public.submit_petty_cash_request('Fuel for site visit', 3500, null, 'Smoke test')`);
    check("employee request routes to HR", r1.approverRole === "hr", r1.approverRole);
    const [n1] = await q(`select count(*)::int n from notifications where link_ref = $1 and kind = 'petty_cash_request' and recipient_email = lower($2)`, r1.id, hr.email);
    check("HR was belled about the employee request", n1.n === 1, `${n1.n}`);

    // HR approves it → approved + requester belled
    await asUser(hr);
    const dec = await rpc(`public.decide_petty_cash_request('${r1.id}', true, null)`);
    check("HR approval returns the requester email", (dec.requesterEmail || "").toLowerCase() === emp.email.toLowerCase(), dec.requesterEmail);
    const [{ state: s1 }] = await q(`select state from petty_cash_requests where ref = $1`, r1.id);
    check("employee request is now approved", s1 === "approved", s1);
    const [n2] = await q(`select count(*)::int n from notifications where link_ref = $1 and kind = 'petty_cash_decided' and title = 'Petty cash approved'`, r1.id);
    check("requester belled 'Petty cash approved'", n2.n === 1, `${n2.n}`);
  } else {
    console.log("… no plain-employee account with auth_id — skipping the employee→HR case");
  }

  // 2) HR raises → routed to Super Admin; HR cannot approve it, Super Admin can
  await asUser(hr);
  const r2 = await rpc(`public.submit_petty_cash_request('HR team lunch', 8000, null, null)`);
  check("HR's own request routes to Super Admin", r2.approverRole === "super", r2.approverRole);
  const [n3] = await q(`select count(*)::int n from notifications where link_ref = $1 and kind = 'petty_cash_request' and recipient_email = lower($2)`, r2.id, sup.email);
  check("Super Admin belled about HR's request", n3.n === 1, `${n3.n}`);

  // another HR (or the same) must NOT be able to approve a 'super'-routed request
  await asUser(hr);
  let hrBlocked = false;
  await c.query("savepoint sp_hr");
  try { await rpc(`public.decide_petty_cash_request('${r2.id}', true, null)`); }
  catch { hrBlocked = true; await c.query("rollback to savepoint sp_hr"); }
  check("HR cannot approve a Super-Admin-routed request", hrBlocked);

  // Super Admin approves it
  await asUser(sup);
  await rpc(`public.decide_petty_cash_request('${r2.id}', true, null)`);
  const [{ state: s2 }] = await q(`select state from petty_cash_requests where ref = $1`, r2.id);
  check("Super Admin approval settles HR's request", s2 === "approved", s2);

  // 3) Super Admin raises their own → auto-approved on submit
  await asUser(sup);
  const r3 = await rpc(`public.submit_petty_cash_request('MD stationery', 1200, null, null)`);
  check("Super Admin's own request is auto-approved", r3.autoApproved === true && r3.state === "approved", `${r3.state}`);
  const [n4] = await q(`select count(*)::int n from notifications where link_ref = $1 and kind = 'petty_cash_request'`, r3.id);
  check("auto-approved request bells no approver", n4.n === 0, `${n4.n}`);

  // 4) reject path (HR rejects a fresh employee/HR-less request routed to them)
  if (emp) {
    await asUser(emp);
    const r5 = await rpc(`public.submit_petty_cash_request('Taxi', 900, null, null)`);
    await asUser(hr);
    await rpc(`public.decide_petty_cash_request('${r5.id}', false, 'Use the office cab')`);
    const [{ state: s5 }] = await q(`select state from petty_cash_requests where ref = $1`, r5.id);
    check("reject sets state rejected", s5 === "rejected", s5);
  }

  await c.query("rollback");
  console.log(failures === 0 ? "\nALL PETTY-CASH SMOKE CHECKS PASSED" : `\n${failures} CHECK(S) FAILED`);
} catch (e) {
  console.error("ERROR:", e.message);
  failures++;
} finally {
  await c.end();
  process.exit(failures === 0 ? 0 : 1);
}
