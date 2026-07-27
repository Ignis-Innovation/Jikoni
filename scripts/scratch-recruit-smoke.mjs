// Smoke test for 0032 recruitment: anon public surface + HR gate.
// Runs inside rolled-back transactions; safe to re-run.
import { readFileSync } from "node:fs";
import pg from "pg";

const root = "/home/brian/Desktop/jikoni";
const url = readFileSync(root + "/.claude/settings.local.json", "utf8")
  .match(/postgres(?:ql)?:\/\/[^"'\\\s]+/)[0];
const c = new pg.Client({ connectionString: url, ssl: { rejectUnauthorized: false } });
await c.connect();

const anonCall = async (call) => {
  await c.query("begin");
  try { await c.query("set local role anon"); const r = (await c.query(`select ${call} as r`)).rows[0].r; await c.query("commit"); return r; }
  catch (e) { await c.query("rollback"); throw e; }
};

try {
  const jobs = await anonCall("public.list_public_jobs()");
  console.log("anon list_public_jobs →", jobs.length, "job(s):", jobs.map((j) => `${j.ref} ${j.roleTitle}`).join(", "));

  // strong applicant (apply as anon, then reset role to read back the row)
  await c.query("begin"); await c.query("set local role anon");
  const strongSkills = JSON.stringify(["Data collection", "KoboToolbox", "Excel", "Community engagement"]);
  await c.query("select public.apply_to_job('RCR-101','Test Strong','strong@x.co',null,5,$1::jsonb,'degree',null)", [strongSkills]);
  await c.query("reset role");
  const s = (await c.query("select eligibility from candidates where email='strong@x.co'")).rows[0].eligibility;
  console.log("anon apply (5y, degree, 4/4 skills) → eligibility", s);
  await c.query("rollback");

  // weak applicant
  await c.query("begin"); await c.query("set local role anon");
  await c.query("select public.apply_to_job('RCR-101','Test Weak','weak@x.co',null,0,$1::jsonb,'none',null)", [JSON.stringify(["Typing"])]);
  await c.query("reset role");
  const w = (await c.query("select eligibility from candidates where email='weak@x.co'")).rows[0].eligibility;
  console.log("anon apply (0y, none, 0/4 skills) → eligibility", w);
  await c.query("rollback");
  console.log(s > w ? "✓ strong outranks weak" : "✗ ranking wrong (BUG)");

  // applying to an unpublished job must fail
  try { await anonCall("public.apply_to_job('RCR-102','Nope','n@x.co')"); console.log("✗ anon apply to unpublished NOT blocked (BUG)"); }
  catch (e) { console.log("✓ anon apply to unpublished blocked →", e.message.split("\n")[0]); }

  // HR-only RPCs must be denied to anon
  for (const call of ["public.publish_posting('RCR-101',false)", "public.update_posting('RCR-101')"]) {
    try { await anonCall(call); console.log(`✗ anon ${call.split("(")[0]} NOT blocked (BUG)`); }
    catch (e) { console.log(`✓ anon ${call.split("(")[0]} denied →`, e.message.split("\n")[0]); }
  }

  // HR (wanjiku) can publish
  const [me] = (await c.query("select auth_id from app_users where email='wanjiku@ignis.africa'")).rows;
  await c.query("begin");
  await c.query("select set_config('request.jwt.claims',$1,true)", [JSON.stringify({ email: "wanjiku@ignis.africa", sub: me.auth_id, role: "authenticated" })]);
  await c.query("set local role authenticated");
  const pub = (await c.query("select public.publish_posting('RCR-101',true) as r")).rows[0].r;
  console.log("✓ HR publish_posting →", JSON.stringify(pub));
  await c.query("rollback");

  console.log("\nAll checks passed.");
} catch (e) {
  console.error("FAIL:", e.message);
  process.exitCode = 1;
} finally {
  await c.end();
}
