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

  // exit: start for Joan, sign all 7 steps → cleared + staff file exited
  const ex = await rpc(`public.start_exit('Joan','Relocation','2026-12-31'::date,'IGN-004')`);
  let last;
  for (let i = 0; i < 7; i++) last = await rpc(`public.sign_exit_step('${ex.id}', ${i})`);
  const [joan] = await q(`select state from staff_files where staff_no='IGN-004'`);
  console.log("— exit:", ex.id, "→", last.state, "· staff file:", joan.state);

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
  console.log("— portal: own KPI toggled ·", sa.stage);
  try {
    await c.query("savepoint s3");
    await rpc(`public.self_assess_kpi('${lily.id}'::uuid, 0)`);
    console.log("— portal: other review NOT BLOCKED (BUG)");
  } catch (e) { await c.query("rollback to s3"); console.log("— portal: other review blocked:", e.message); }
  const sub2 = await rpc(`public.submit_self_assessment('${lizAp.id}'::uuid)`);
  console.log("— portal: self-assessment submitted →", sub2.stage);
  const myCert = await rpc(`public.submit_my_certification('Prince2 Practitioner','Axelos','2028-06-30'::date)`);
  console.log("— portal: certification submitted →", myCert.state);

  console.log("ALL OK (rolled back)");
} catch (e) {
  console.error("SMOKE FAILED:", e.message);
  process.exitCode = 1;
} finally {
  await c.query("rollback");
  await c.end();
}
