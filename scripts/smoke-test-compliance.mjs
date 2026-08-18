// Exercise the Compliance & Governance RPCs (risk / policy / company document /
// contract / obligation) and confirm bootstrap() surfaces them — all inside a
// rolled-back transaction.
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
  // Run as any live user who can edit Compliance (level >= 2) — Super Admin or a Sub
  // Admin. Picked dynamically so the test doesn't depend on a specific seeded account.
  const [me] = await q(`select au.email, au.auth_id
    from app_users au join user_permissions up on up.email = lower(au.email)
    where up.module = 'compliance' and up.level >= 2 and au.auth_id is not null
    order by up.level desc limit 1`);
  if (!me) throw new Error("No live user with compliance edit (level >= 2) to run as");
  await c.query(`select set_config('request.jwt.claims', $1, false)`,
    [JSON.stringify({ email: me.email, sub: me.auth_id, role: "authenticated" })]);

  // --- access key present for the acting user ---
  const [perm] = await q(`select level from user_permissions where email=$1 and module='compliance'`, me.email.toLowerCase());
  check("compliance access key present", !!perm, `${me.email} · level ${perm?.level}`);

  // --- create risk: RSK- ref + severity from likelihood × impact ---
  const risk = await rpc(`public.create_risk('Smoke Test Risk','Delivery',4,4,'Mitigate via SOPs','Dennis')`);
  check("create_risk returns an RSK ref", /^RSK-\d+$/.test(risk.ref), risk.ref);

  // --- add policy: first version = v1, second bumps + supersedes ---
  const p1 = await rpc(`public.add_policy('IGN-TEST-001','Smoke Test Policy','2026-01-01',null)`);
  check("add_policy starts at version 1", p1.version === 1, `v${p1.version}`);
  const p2 = await rpc(`public.add_policy('IGN-TEST-001','Smoke Test Policy','2026-06-01',null)`);
  check("add_policy bumps to version 2", p2.version === 2, `v${p2.version}`);
  const [{ n: activeN }] = await q(`select count(*)::int n from policies where code='IGN-TEST-001' and state='active'`);
  check("only one active version after supersede", activeN === 1, `${activeN} active`);

  // --- add company document: upsert by name ---
  await rpc(`public.add_company_document('Smoke Test Permit','licence','2027-01-31',null)`);
  await rpc(`public.add_company_document('Smoke Test Permit','licence','2028-01-31',null)`);
  const [{ n: docN }] = await q(`select count(*)::int n from company_documents where name='Smoke Test Permit'`);
  check("add_company_document upserts by name (no dupes)", docN === 1, `${docN} rows`);

  // --- add contract (now carries an optional doc path) ---
  const con = await rpc(`public.add_contract('Smoke Test Vendor','vendor','Smoke Framework','Agreed rates','2027-12-31','contracts/smoke.pdf')`);
  check("add_contract returns counterparty + title", con.counterparty === "Smoke Test Vendor" && con.title === "Smoke Framework");
  const [{ doc: conDoc }] = await q(`select doc from contracts where counterparty='Smoke Test Vendor' and title='Smoke Framework'`);
  check("add_contract stores the doc path", conDoc === "contracts/smoke.pdf", `${conDoc}`);

  // --- mark an obligation filed advances next_due (skips if none seeded) ---
  const [ob] = await q(`select obligation, next_due from compliance_obligations order by next_due limit 1`);
  if (ob) {
    const filed = await rpc(`public.mark_obligation_filed(${literal(ob.obligation)})`);
    check("mark_obligation_filed advances next_due", new Date(filed.nextDue) > new Date(ob.next_due), `${ob.next_due} → ${filed.nextDue}`);
  } else {
    console.log("… no obligations seeded — skipping mark_obligation_filed check");
  }

  // --- bootstrap surfaces the compliance block ---
  const boot = await rpc(`public.bootstrap()`);
  check("bootstrap has a compliance block", !!boot.compliance);
  check("bootstrap policies includes the new policy", boot.compliance.policies.some((p) => p.code === "IGN-TEST-001"));
  check("bootstrap companyDocuments includes the new doc", boot.compliance.companyDocuments.some((d) => d.name === "Smoke Test Permit"));
  check("bootstrap risks includes the new risk", boot.compliance.risks.some((r) => r.ref === risk.ref));
  const bootContract = boot.compliance.contracts.find((k) => k.title === "Smoke Framework");
  check("bootstrap contracts includes the new contract", !!bootContract);
  check("bootstrap contract surfaces its doc path", bootContract?.doc === "contracts/smoke.pdf", `${bootContract?.doc}`);
  check("bootstrap obligations carry status pills", boot.compliance.obligations.length === 0 || !!boot.compliance.obligations[0].statusCls);
  const newRisk = boot.compliance.risks.find((r) => r.ref === risk.ref);
  check("risk severity pill mapped (4×4=16 → High)", newRisk?.statusTxt === "High", newRisk?.statusTxt);

  // --- audit trail written ---
  const [aud] = await q(`select count(*)::int n from audit_log where action in ('risk.created','policy.added','company_document.added','contract.added','compliance.filed')`);
  check("compliance actions wrote to audit_log", aud.n >= 5, `${aud.n} rows`);

  await c.query("rollback");
  console.log(failures === 0 ? "\nALL COMPLIANCE SMOKE CHECKS PASSED" : `\n${failures} CHECK(S) FAILED`);
} catch (e) {
  console.error("ERROR:", e.message);
  failures++;
} finally {
  await c.end();
  process.exit(failures === 0 ? 0 : 1);
}

// minimal SQL literal quoting for the obligation name
function literal(s) { return "'" + String(s).replace(/'/g, "''") + "'"; }
