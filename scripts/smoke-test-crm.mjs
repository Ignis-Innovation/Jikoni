// Exercise the CRM create-forms RPCs (engagement / partner / opportunity) and
// confirm bootstrap() surfaces them — all inside a rolled-back transaction.
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

let failures = 0;
const check = (label, ok, extra = "") => {
  console.log(`${ok ? "✓" : "✗ FAIL"} ${label}${extra ? " — " + extra : ""}`);
  if (!ok) failures++;
};

try {
  await c.query("begin");
  const [me] = await q(`select auth_id from app_users where email='wanjiku@ignis.africa'`);
  await c.query(`select set_config('request.jwt.claims', $1, false)`,
    [JSON.stringify({ email: "wanjiku@ignis.africa", sub: me.auth_id, role: "authenticated" })]);

  // --- create engagement (upstream): no stage collected, note seeds the update log ---
  const eng = await rpc(`public.create_engagement('Smoke Test Fund',null,'Wilson','up','Intro call done — sent data pack','today')`);
  check("create_engagement returns a ref", /^ENG-\d+$/.test(eng.id), eng.id);
  check("engagement pill mapped from due key", eng.pl === "today" && eng.plt === "Today");
  check("upstream stage defaults to Discovery", eng.st === "Discovery", eng.st);
  const [engRow] = await q(`select id from engagements where ref=$1`, eng.id);
  const [engUpd] = await q(`select note, channel from engagement_updates where engagement_id=$1`, engRow.id);
  check("discussion note logged to engagement_updates", engUpd?.note === "Intro call done — sent data pack" && engUpd?.channel === "Note", engUpd?.note);

  // --- create engagement (downstream → DST ref, no note) ---
  const dst = await rpc(`public.create_engagement('Smoke Test VTC',null,'Elizabeth','down',null,'week')`);
  check("downstream engagement gets DST ref", /^DST-\d+$/.test(dst.id), dst.id);
  check("downstream stage defaults to Identification", dst.st === "Identification", dst.st);
  const [dstRow] = await q(`select id from engagements where ref=$1`, dst.id);
  const [{ n: dstUpdN }] = await q(`select count(*)::int n from engagement_updates where engagement_id=$1`, dstRow.id);
  check("no note → no update-log entry", dstUpdN === 0, `${dstUpdN} entries`);

  // --- create partner ---
  const partner = await rpc(`public.create_partner('Smoke Test Bank','Lender','KE','Wilson','Ready to fund')`);
  check("create_partner returns id + derived status class", !!partner.id && partner.statusCls === "done", partner.statusCls);

  // --- create opportunity ---
  const opp = await rpc(`public.create_opportunity('Smoke Test RFP','Tender','Q4','Downstream','On track')`);
  check("create_opportunity returns id + derived status class", !!opp.id && opp.statusCls === "done", opp.statusCls);

  // --- bootstrap surfaces them all ---
  const boot = await rpc(`public.bootstrap()`);
  check("bootstrap engagements.up includes new eng", boot.engagements.up.some((e) => e.id === eng.id));
  check("bootstrap engagements.down includes new dst", boot.engagements.down.some((e) => e.id === dst.id));
  check("bootstrap partners includes new partner", boot.partners.some((p) => p.name === "Smoke Test Bank"));
  check("bootstrap opportunities includes new opp", boot.opportunities.some((o) => o.name === "Smoke Test RFP"));
  check("bootstrap exposes editable dropdowns", Array.isArray(boot.crmDropdowns.partner_type) && boot.crmDropdowns.partner_type.length > 0,
    `${boot.crmDropdowns.partner_type?.length} partner types`);
  check("bootstrap exposes team names for owner pickers", Array.isArray(boot.teamNames) && boot.teamNames.length > 0,
    `${boot.teamNames?.length} names`);

  // --- audit trail written ---
  const [aud] = await q(`select count(*)::int n from audit_log where action in ('engagement.created','partner.created','opportunity.created')`);
  check("create actions wrote to audit_log", aud.n >= 4, `${aud.n} rows`);

  await c.query("rollback");
  console.log(failures === 0 ? "\nALL CRM SMOKE CHECKS PASSED" : `\n${failures} CHECK(S) FAILED`);
} catch (e) {
  console.error("ERROR:", e.message);
  failures++;
} finally {
  await c.end();
  process.exit(failures === 0 ? 0 : 1);
}
