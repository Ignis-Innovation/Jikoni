// Exercise the HR personnel suite (0026): appraisals, certifications,
// feedback, exits, staff profile — inside a rolled-back transaction.
import { readFileSync } from "node:fs";
import pg from "pg";

const root = "/home/brian/Desktop/jikoni";
const url = readFileSync(root + "/.claude/settings.local.json", "utf8")
  .match(/postgres(?:ql)?:\/\/[^"'\\\s]+/)[0];
const c = new pg.Client({ connectionString: url, ssl: { rejectUnauthorized: false } });
await c.connect();
const q = async (sql, ...args) => (await c.query(sql, args)).rows;
const rpc = async (call) => (await c.query(`select ${call} as r`)).rows[0].r;

try {
  await c.query("begin");
  const [me] = await q(`select auth_id from app_users where email='wanjiku@ignis.africa'`);
  await c.query(`select set_config('request.jwt.claims', $1, false)`,
    [JSON.stringify({ email: "wanjiku@ignis.africa", sub: me.auth_id, role: "authenticated" })]);

  // seeds present
  const [counts] = await q(`select
    (select count(*) from appraisals) a, (select count(*) from certifications) c,
    (select count(*) from staff_feedback) f, (select count(*) from staff_exits) x`);
  console.log("— seeds: appraisals", counts.a, "· certs", counts.c, "· feedback", counts.f, "· exits", counts.x);

  // appraisal: toggle a KPI, advance a stage
  const [ap] = await q(`select a.id, a.stage, a.kpis from appraisals a join app_users u on u.id=a.app_user_id where u.name='Wilson'`);
  const t = await rpc(`public.toggle_appraisal_kpi('${ap.id}'::uuid, 3)`);
  console.log("— KPI toggled:", t.kpis[3].k, "→", t.kpis[3].met);
  const adv = await rpc(`public.advance_appraisal('${ap.id}'::uuid)`);
  console.log("— appraisal advanced:", ap.stage, "→", adv.stage);

  // signed-off review locks its KPIs
  const [lily] = await q(`select a.id from appraisals a join app_users u on u.id=a.app_user_id where u.name='Lily'`);
  try {
    await c.query("savepoint s1");
    await rpc(`public.toggle_appraisal_kpi('${lily.id}'::uuid, 0)`);
    console.log("— signed-off lock: NOT ENFORCED (BUG)");
  } catch (e) { await c.query("rollback to s1"); console.log("— signed-off lock:", e.message); }

  // 0028: agree a custom KPI list while not_started — ratings reset to false
  const [liz0] = await q(`select a.id from appraisals a join app_users u on u.id=a.app_user_id where u.email='elizabeth@ignis.africa'`);
  const setk = await rpc(`public.set_appraisal_kpis('${liz0.id}'::uuid,
    '[{"k":"Delivery against plan"},{"k":"Quality & compliance"},{"k":"Collaboration & culture"},{"k":"Growth objective"},{"k":"Smoke KPI five"}]'::jsonb)`);
  console.log("— KPIs agreed:", setk.kpis.length, "· ratings reset:", setk.kpis.every((k) => !k.met && !k.self_met));
  try {
    await c.query("savepoint s1b");
    await rpc(`public.set_appraisal_kpis('${lily.id}'::uuid, '[{"k":"X"}]'::jsonb)`);
    console.log("— KPI edit lock: NOT ENFORCED (BUG)");
  } catch (e) { await c.query("rollback to s1b"); console.log("— KPI edit lock:", e.message); }
  try {
    await c.query("savepoint s1c");
    await rpc(`public.set_appraisal_kpis('${liz0.id}'::uuid, '[{"k":"Same"},{"k":"same"}]'::jsonb)`);
    console.log("— KPI dup guard: NOT ENFORCED (BUG)");
  } catch (e) { await c.query("rollback to s1c"); console.log("— KPI dup guard:", e.message); }

  // certification: add pending, then verify
  const cert = await rpc(`public.add_certification('Wanjiku','Prince2 Practitioner','Axelos','2028-06-30'::date,'IGN-002',false)`);
  const ver = await rpc(`public.verify_certification('${cert.id}'::uuid, true)`);
  console.log("— certification:", cert.name, "added →", ver.state);

  // feedback: named + anonymous, then acknowledge
  const fb = await rpc(`public.submit_feedback('Smoke test — please ignore','Tools & systems','hr',false)`);
  const anon = await rpc(`public.submit_feedback('Anonymous smoke test','People','leadership',true)`);
  const [anonRow] = await q(`select author_id from staff_feedback where ref=$1`, anon.id);
  console.log("— feedback:", fb.id, "named ·", anon.id, "anonymous (author null:", anonRow.author_id === null, ")");
  const st = await rpc(`public.set_feedback_state('${fb.id}','acknowledged')`);
  console.log("— feedback state:", st.state);

  // exit: start for Joan, sign all 7 steps → cleared + staff file exited + 24h clock
  const ex = await rpc(`public.start_exit('Joan','Relocation','2026-12-31'::date,'IGN-004')`);
  let last;
  for (let i = 0; i < 7; i++) last = await rpc(`public.sign_exit_step('${ex.id}', ${i})`);
  const [joan] = await q(`select state from staff_files where staff_no='IGN-004'`);
  const [jx] = await q(`select cleared_at, access_until from staff_exits where ref=$1`, ex.id);
  console.log("— exit:", ex.id, "→", last.state, "· staff file:", joan.state,
    "· cleared_at set:", jx.cleared_at != null, "· access closes ~24h:", jx.access_until != null);

  // duplicate in-progress exit must be blocked
  try {
    await c.query("savepoint s2");
    await rpc(`public.start_exit('Lily','Test','2026-12-31'::date,'IGN-007')`);
    console.log("— duplicate exit: NOT BLOCKED (BUG)");
  } catch (e) { await c.query("rollback to s2"); console.log("— duplicate exit blocked:", e.message); }

  // staff profile: dept + contract end + next of kin
  const up = await rpc(`public.update_staff_hr_profile('IGN-005', null, '2027-01-31'::date,
    '[{"name":"Test Kin","relationship":"Spouse","phone":"+254 700 000 000","cover":"medical"}]'::jsonb)`);
  const [wil] = await q(`select dept, contract_end, next_of_kin from staff_files where staff_no='IGN-005'`);
  console.log("— profile:", up.staffNo, "dept", wil.dept, "· ends", wil.contract_end?.toISOString?.().slice(0,10) ?? wil.contract_end, "· kin", wil.next_of_kin.length);

  // --- staff-portal self-service (0027): me-scoped, no HR access needed ---
  const [lizAp] = await q(`select a.id from appraisals a join app_users u on u.id=a.app_user_id where u.email='elizabeth@ignis.africa'`);
  const [lizAuth] = await q(`select auth_id from app_users where email='elizabeth@ignis.africa'`);
  await c.query(`select set_config('request.jwt.claims', $1, false)`,
    [JSON.stringify({ email: "elizabeth@ignis.africa", sub: lizAuth.auth_id, role: "authenticated" })]);
  const sa = await rpc(`public.self_assess_kpi('${lizAp.id}'::uuid, 3)`);
  console.log("— portal: own KPI self-rated ·", sa.stage,
    "· self_met flipped:", sa.kpis[3].self_met === true, "· manager met untouched:", sa.kpis[3].met === false);
  try {
    await c.query("savepoint s3");
    await rpc(`public.self_assess_kpi('${lily.id}'::uuid, 0)`);
    console.log("— portal: other review NOT BLOCKED (BUG)");
  } catch (e) { await c.query("rollback to s3"); console.log("— portal: other review blocked:", e.message); }
  const sub2 = await rpc(`public.submit_self_assessment('${lizAp.id}'::uuid)`);
  console.log("— portal: self-assessment submitted →", sub2.stage);
  const myCert = await rpc(`public.submit_my_certification('Prince2 Practitioner','Axelos','2028-06-30'::date)`);
  console.log("— portal: certification submitted →", myCert.state);

  // back as HR: manager rating writes met, never self_met
  await c.query(`select set_config('request.jwt.claims', $1, false)`,
    [JSON.stringify({ email: "wanjiku@ignis.africa", sub: me.auth_id, role: "authenticated" })]);
  const mt = await rpc(`public.toggle_appraisal_kpi('${lizAp.id}'::uuid, 3)`);
  console.log("— ratings independent: manager met flipped:", mt.kpis[3].met === true,
    "· self rating preserved:", mt.kpis[3].self_met === true);

  // --- 0029: exit self-service + suspension after the 24h grace ---
  // Lily ticks her own areas on her in-progress seed exit
  const [lilyU] = await q(`select auth_id from app_users where email='lily@ignis.africa'`);
  const [lilyExit] = await q(`select x.ref, x.clearance from staff_exits x join app_users u on u.id=x.app_user_id
    where u.email='lily@ignis.africa' and x.state='in_progress'`);
  await c.query(`select set_config('request.jwt.claims', $1, false)`,
    [JSON.stringify({ email: "lily@ignis.africa", sub: lilyU.auth_id, role: "authenticated" })]);
  const before0 = lilyExit.clearance[0].done;
  const msx = await rpc(`public.sign_my_exit_step('${lilyExit.ref}', 0)`);
  console.log("— my exit: staff area toggled:", msx.clearance[0].done === !before0, "· owner:", lilyExit.clearance[0].owner);
  try {
    await c.query("savepoint s4");
    await rpc(`public.sign_my_exit_step('${lilyExit.ref}', 1)`);
    console.log("— my exit: company area NOT BLOCKED (BUG)");
  } catch (e) { await c.query("rollback to s4"); console.log("— my exit: company area blocked:", e.message); }
  await c.query(`select set_config('request.jwt.claims', $1, false)`,
    [JSON.stringify({ email: "elizabeth@ignis.africa", sub: lizAuth.auth_id, role: "authenticated" })]);
  try {
    await c.query("savepoint s5");
    await rpc(`public.sign_my_exit_step('${lilyExit.ref}', 0)`);
    console.log("— my exit: other person NOT BLOCKED (BUG)");
  } catch (e) { await c.query("rollback to s5"); console.log("— my exit: other person blocked:", e.message); }

  // suspension sweep: force Joan's grace window into the past
  await c.query(`select set_config('request.jwt.claims', $1, false)`,
    [JSON.stringify({ email: "wanjiku@ignis.africa", sub: me.auth_id, role: "authenticated" })]);
  await q(`update staff_exits set access_until = now() - interval '1 minute' where ref=$1`, ex.id);
  const sw = await rpc(`public.enforce_exit_suspensions()`);
  const [joanU] = await q(`select a.state, a.status, a.auth_id, u.banned_until,
      (select coalesce(max(level),0) from user_permissions where email=a.email) mx
    from app_users a left join auth.users u on u.id=a.auth_id where a.email='joan@ignis.africa'`);
  console.log("— suspension: swept", sw.suspended, "· state:", joanU.state, "· status:", joanU.status,
    "· max perm:", joanU.mx, "· auth banned:", joanU.banned_until != null);
  await c.query(`select set_config('request.jwt.claims', $1, false)`,
    [JSON.stringify({ email: "joan@ignis.africa", sub: joanU.auth_id, role: "authenticated" })]);
  const acc = await rpc(`public.my_access_state()`);
  console.log("— my_access_state as Joan:", acc.state);

  // cancel_exit reverses a mistaken (and here already-suspended) exit
  await c.query(`select set_config('request.jwt.claims', $1, false)`,
    [JSON.stringify({ email: "wanjiku@ignis.africa", sub: me.auth_id, role: "authenticated" })]);
  const canc = await rpc(`public.cancel_exit('${ex.id}')`);
  const [joan2] = await q(`select a.state, a.status, u.banned_until,
      (select state from staff_files where app_user_id=a.id) sf,
      exists(select 1 from staff_exits where ref=$1) still_there
    from app_users a left join auth.users u on u.id=a.auth_id where a.email='joan@ignis.africa'`, ex.id);
  console.log("— cancel_exit:", ex.id, "reinstated:", canc.reinstated, "· user:", joan2.state,
    "· staff file:", joan2.sf, "· auth unbanned:", joan2.banned_until == null, "· exit removed:", joan2.still_there === false);

  console.log("ALL OK (rolled back)");
} catch (e) {
  console.error("SMOKE FAILED:", e.message);
  process.exitCode = 1;
} finally {
  await c.query("rollback");
  await c.end();
}
