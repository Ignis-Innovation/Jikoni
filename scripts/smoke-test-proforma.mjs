// Exercise the proforma-invoice RPCs (create / accept → tax invoice / decline) and
// confirm bootstrap() surfaces the register — all inside a rolled-back transaction.
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
  // Run as any live user with finance edit (level >= 2) — picked dynamically.
  const [me] = await q(`select au.email, au.auth_id
    from app_users au join user_permissions up on up.email = lower(au.email)
    where up.module = 'finance' and up.level >= 2 and au.auth_id is not null
    order by up.level desc limit 1`);
  if (!me) throw new Error("No live user with finance edit (level >= 2) to run as");
  await c.query(`select set_config('request.jwt.claims', $1, false)`,
    [JSON.stringify({ email: me.email, sub: me.auth_id, role: "authenticated" })]);

  const lines = JSON.stringify([
    { d: "Institutional steam stove (100L)", q: 6, p: 180000 },
    { d: "Installation & commissioning", q: 6, p: 35000 },
  ]).replace(/'/g, "''");
  const sub = 6 * 180000 + 6 * 35000;

  // --- create a proforma (no ledger impact) ---
  const created = await rpc(`public.create_proforma('Smoke County VTCs', null, 'Elizabeth', '2027-12-31',
    '50% deposit, balance on delivery', '3 weeks', 'Smoke test note', '${lines}'::jsonb)`);
  check("create_proforma returns a PF ref", /^PF-\d+$/.test(created.ref), created.ref);
  const ref = created.ref;
  const [pf] = await q(`select state from proformas where ref = $1`, ref);
  check("proforma starts issued", pf.state === "issued", pf.state);
  const [{ n: lineN }] = await q(`select count(*)::int n from proforma_lines pl join proformas p on p.id = pl.proforma_id where p.ref = $1`, ref);
  check("proforma lines stored", lineN === 2, `${lineN} lines`);

  // a proforma must NOT create a sales invoice on its own
  const [{ n: siBefore }] = await q(`select count(*)::int n from sales_invoices where description like $1`, `Proforma ${ref}%`);
  check("no tax invoice before acceptance", siBefore === 0, `${siBefore} invoices`);

  // --- decline is only valid on an issued proforma; make a second one to decline ---
  const created2 = await rpc(`public.create_proforma('Smoke Declined Co', null, 'Wilson', '2027-12-31',
    '100% on delivery', '2 weeks', null, '[{"d":"Stove","q":1,"p":120000}]'::jsonb)`);
  const dec = await rpc(`public.decline_proforma('${created2.ref}', 'Chose a lower-cost LPG option')`);
  check("decline_proforma returns the ref", dec.ref === created2.ref, dec.ref);
  const [pf2] = await q(`select state, decline_reason from proformas where ref = $1`, created2.ref);
  check("declined state + reason kept", pf2.state === "declined" && /LPG/.test(pf2.decline_reason || ""), `${pf2.state} · ${pf2.decline_reason}`);

  // --- accept converts to a real tax invoice (eTIMS + GL via submit_sales_invoice) ---
  const acc = await rpc(`public.accept_proforma('${ref}')`);
  check("accept_proforma returns a tax invoice ref", /^SI-/.test(acc.invoice || ""), acc.invoice);
  const [si] = await q(`select net, total, customer from sales_invoices where ref = $1`, acc.invoice);
  check("tax invoice net matches proforma subtotal", Number(si.net) === sub, `${si.net} vs ${sub}`);
  check("tax invoice total carries 16% VAT", Number(si.total) === Math.round(sub * 1.16), `${si.total}`);
  const [{ n: etimsN }] = await q(`select count(*)::int n from etims_submissions where invoice_ref = $1`, acc.invoice);
  check("acceptance filed the invoice to eTIMS", etimsN === 1, `${etimsN} filings`);
  const [pf3] = await q(`select state, invoice_ref from proformas where ref = $1`, ref);
  check("proforma marked accepted + linked to its invoice", pf3.state === "accepted" && pf3.invoice_ref === acc.invoice);

  // a second accept must be rejected (savepoint so the expected error doesn't poison the txn)
  let reAccept = false;
  await c.query("savepoint sp_reaccept");
  try { await rpc(`public.accept_proforma('${ref}')`); reAccept = true; }
  catch { await c.query("rollback to savepoint sp_reaccept"); }
  check("cannot accept an already-accepted proforma", !reAccept);

  // --- bootstrap surfaces the register with computed status pills ---
  const boot = await rpc(`public.bootstrap()`);
  check("bootstrap has a proformas array", Array.isArray(boot.proformas));
  const bref = boot.proformas.find((p) => p.ref === ref);
  check("bootstrap shows the accepted proforma", bref?.state === "accepted" && bref?.statusTxt === "Accepted", bref?.statusTxt);
  check("bootstrap proforma carries lines + subtotal", bref?.lines?.length === 2 && Number(bref?.subtotal) === sub, `${bref?.subtotal}`);

  // --- audit trail written ---
  const [aud] = await q(`select count(*)::int n from audit_log where action in ('proforma.created','proforma.accepted','proforma.declined')`);
  check("proforma actions wrote to audit_log", aud.n >= 4, `${aud.n} rows`);

  await c.query("rollback");
  console.log(failures === 0 ? "\nALL PROFORMA SMOKE CHECKS PASSED" : `\n${failures} CHECK(S) FAILED`);
} catch (e) {
  console.error("ERROR:", e.message);
  failures++;
} finally {
  await c.end();
  process.exit(failures === 0 ? 0 : 1);
}
