// General Ledger test (mig 0089/0090) — runs inside ONE transaction and rolls it back,
// so nothing persists. `--with-migrations` applies 0089 + 0090 inside the transaction
// first (a dry run before they go live). Proves the spec's "done" list (A1–A8):
//   A1 chart has the five types, statutory + M-Pesa / advances / FX / opening accounts
//   A2 module events post automatically: petty cash, claims, travel advances
//      (issue / reconcile / settle), recurring bills, invoices, receipts (+ FX, M-Pesa)
//   A3 unbalanced / unknown-account / duplicate postings rejected; posted entries immutable
//   A4 postings follow gl_mappings (re-map → next posting uses the new account); lines coded
//   A5 trial balance agrees; balance sheet balances; P&L = current earnings
//   A6 project actuals come from ledger lines by project code
//   A7 period moves Open → Reconciled → TB agreed → Closed only when checks pass;
//      a closed period refuses postings
//   A8 manual journals: supporting docs, IGN-FIN-001 bands, no self-approval,
//      control accounts blocked, corrected by reversal; one locked opening journal
// Prints GL_TESTS_PASS only if every assertion holds.
import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const url = readFileSync(resolve(root, ".claude/settings.local.json"), "utf8").match(/postgres(?:ql)?:\/\/[^"'\\\s]+/)[0];
const c = new pg.Client({ connectionString: url, ssl: { rejectUnauthorized: false } });
const withMig = process.argv.includes("--with-migrations");

let failures = 0;
function ok(cond, label, extra = "") { console.log(`${cond ? "PASS" : "FAIL"} — ${label}${extra !== "" ? " :: " + extra : ""}`); if (!cond) failures++; }
async function as(u) {
  await c.query("reset role");
  await c.query("select set_config('request.jwt.claims', json_build_object('sub',$1::text,'email',$2::text,'role','authenticated')::text, true)", [u.auth_id, u.email]);
  await c.query("set local role authenticated");
}
async function expectThrow(fn, label, re = null) {
  await c.query("savepoint sp");
  try { await fn(); ok(false, label, "no exception raised"); await c.query("release savepoint sp"); }
  catch (e) { ok(!re || re.test(e.message), label, e.message); await c.query("rollback to savepoint sp"); }
}
const q1 = async (sql, args = []) => (await c.query(sql, args)).rows[0];
const j = async (sql, args = []) => (await q1(sql, args)).j;
const je = async (key) => {
  const h = await q1("select id, ref, kind, state, entry_date::text d, period from public.journal_entries where source_key=$1", [key]);
  if (!h) return null;
  const lines = (await c.query("select account_code a, debit::numeric d, credit::numeric c, project_code p, cost_centre cc, fund_code f from public.journal_lines where journal_id=$1 order by account_code, debit desc", [h.id]))
    .rows.map((r) => ({ ...r, d: Number(r.d), c: Number(r.c) }));
  return { ...h, lines };
};
const line = (e, a) => e?.lines.find((l) => l.a === a);
const today = new Date().toLocaleDateString("en-CA", { timeZone: "Africa/Nairobi" });
const period = today.slice(0, 7);

try {
  await c.connect();
  await c.query("begin");
  if (withMig) {
    for (const f of ["0089_general_ledger.sql", "0090_gl_module_postings.sql"]) {
      await c.query(readFileSync(resolve(root, "supabase/migrations", f), "utf8"));
      console.log(`(applied ${f} inside the test transaction)`);
    }
  }
  const user = async (email) => q1("select id, auth_id, email, name from public.app_users where lower(email)=$1", [email]);
  const editor = await user("jwanjiku@ignis-innovation.com");
  const md = await user("dnderitu@ignis-innovation.com");
  const third = await user("brian55mwangi@gmail.com");
  console.log(`editor=${editor.email} md=${md.email} third=${third?.email}\n`);
  const ke = (await q1("select id from public.entities where code='KE'")).id;

  // ---------- A1 ----------
  const kinds = (await c.query("select distinct kind from public.chart_of_accounts where entity_id=$1", [ke])).rows.map((r) => r.kind).sort();
  ok(JSON.stringify(kinds) === JSON.stringify(["asset", "equity", "expense", "income", "liability"]), "A1 chart has the five account types", kinds.join(","));
  const need = ["1000", "1010", "1150", "2100", "2200", "2210", "2220", "2230", "2240", "3900", "4900"];
  const have = (await c.query("select code from public.chart_of_accounts where entity_id=$1 and code = any($2)", [ke, need])).rows.length;
  ok(have === need.length, "A1 bank, M-Pesa, advances, VAT/WHT/PAYE/NSSF/SHIF/Housing, opening equity, FX accounts exist", `${have}/${need.length}`);
  const noEntity = await q1("select count(*)::int n from public.chart_of_accounts where entity_id is null");
  ok(noEntity.n === 0, "A1 every account belongs to an entity", noEntity.n);

  // ---------- A3 engine rules ----------
  await as(editor);
  await expectThrow(() => q1("select public.post_journal('x','test','T1','[{\"account\":\"1000\",\"debit\":5},{\"account\":\"4000\",\"credit\":5}]'::jsonb)"),
    "A3 the posting engine is not callable directly by users", /permission denied/);
  await c.query("reset role");
  await expectThrow(() => q1("select public.post_journal('x','test','T1','[{\"account\":\"1000\",\"debit\":5},{\"account\":\"4000\",\"credit\":4}]'::jsonb)"),
    "A3 unbalanced journal rejected", /must balance/);
  await expectThrow(() => q1("select public.post_journal('x','test','T1','[{\"account\":\"9999\",\"debit\":5},{\"account\":\"4000\",\"credit\":5}]'::jsonb)"),
    "A3 unknown account rejected", /not in the chart/);
  const k1 = (await q1("select public.post_journal('Test sale','test','T1','[{\"account\":\"1000\",\"debit\":500},{\"account\":\"4000\",\"credit\":500}]'::jsonb, null, 'test:T1') as r")).r;
  ok(/^JE-/.test(k1), "engine posts a balanced journal", k1);
  await expectThrow(() => q1("select public.post_journal('Test sale','test','T1','[{\"account\":\"1000\",\"debit\":500},{\"account\":\"4000\",\"credit\":500}]'::jsonb, null, 'test:T1')"),
    "A3 the same source cannot post twice", /Already posted/);
  const t1 = await je("test:T1");
  ok(line(t1, "4000")?.cc === "HQ" && t1.period === period, "A4 an uncoded income line lands on the default cost centre; entry is dated + period-stamped", `${line(t1, "4000")?.cc} ${t1.period}`);
  await expectThrow(() => c.query("update public.journal_lines set debit = 1 where journal_id=$1", [t1.id]), "A3 posted lines cannot be edited", /cannot be edited/);
  await expectThrow(() => c.query("delete from public.journal_entries where id=$1", [t1.id]), "A3 posted entries cannot be deleted", /cannot be deleted/);

  // ---------- A2 module postings ----------
  // petty cash (project-coded, fund from the project)
  const proj = await q1("select name from public.projects order by created_at limit 1");
  if (proj) await c.query("update public.projects set fund_code='IRENA' where name=$1", [proj.name]);
  await c.query("insert into public.petty_cash_requests(ref, entity_id, item, amount, state, project_code) values ('PCR-GLT-1',$1,'Fuel for site visit',3000,'approved',$2)", [ke, proj?.name ?? null]);
  const pc = await je("petty_cash:PCR-GLT-1");
  ok(pc && line(pc, "5000")?.d === 3000 && line(pc, "1020")?.c === 3000, "A2 approved petty cash posts Dr expense / Cr petty cash float", JSON.stringify(pc?.lines));
  if (proj) ok(line(pc, "5000")?.p === proj.name && line(pc, "5000")?.f === "IRENA", "A4 petty cash line carries the project and the project's fund", `${line(pc, "5000")?.p} / ${line(pc, "5000")?.f}`);

  // expense claim paid → per-category expense, bank
  const clm = (await q1("insert into public.expense_claims(ref, entity_id, requester_name, purpose, total_amount, state, project_code) values ('CLM-GLT-1',$1,'Tester','Field trip',4500,'approved',$2) returning id", [ke, proj?.name ?? null])).id;
  await c.query("insert into public.expense_claim_lines(claim_id, category, amount) values ($1,'transport',3000),($1,'meals',1500)", [clm]);
  await c.query("update public.expense_claims set state='paid' where id=$1", [clm]);
  const cl = await je("expense_claim:CLM-GLT-1");
  ok(cl && line(cl, "5110")?.d === 3000 && line(cl, "5120")?.d === 1500 && line(cl, "1000")?.c === 4500, "A2 reimbursed claim posts expense by category / Cr bank", JSON.stringify(cl?.lines));

  // travel advance: issue 10,000 → reconcile 7,000 → settle (3,000 returned)
  const adv = (await q1("insert into public.travel_advances(ref, entity_id, holder_name, purpose, amount, state, project_code) values ('ADV-GLT-1',$1,'Tester','Kisumu trip',10000,'approved',$2) returning id", [ke, proj?.name ?? null])).id;
  await c.query("update public.travel_advances set state='issued' where id=$1", [adv]);
  const ai = await je("travel_advance:ADV-GLT-1:issue");
  ok(ai && line(ai, "1150")?.d === 10000 && line(ai, "1000")?.c === 10000, "A2 issued advance: Dr employee advances / Cr bank", JSON.stringify(ai?.lines));
  await c.query("insert into public.travel_advance_lines(advance_id, category, amount, is_estimate) values ($1,'transport',3000,false),($1,'accommodation',4000,false),($1,'meals',9999,true)", [adv]);
  await c.query("update public.travel_advances set state='reconciled', spent_amount=7000, balance=3000 where id=$1", [adv]);
  const ar = await je("travel_advance:ADV-GLT-1:reconcile");
  ok(ar && line(ar, "5110")?.d === 3000 && line(ar, "5100")?.d === 4000 && line(ar, "1150")?.c === 7000 && !line(ar, "5120"),
    "A2 reconciled advance: actual spend expensed, advance reduced (planned lines ignored)", JSON.stringify(ar?.lines));
  await c.query("update public.travel_advances set state='settled' where id=$1", [adv]);
  const as_ = await je("travel_advance:ADV-GLT-1:settle");
  ok(as_ && line(as_, "1000")?.d === 3000 && line(as_, "1150")?.c === 3000, "A2 settled advance: returned balance Dr bank / Cr advances", JSON.stringify(as_?.lines));
  const advBal = await q1("select coalesce(sum(l.debit-l.credit),0)::numeric b from public.journal_lines l join public.journal_entries e on e.id=l.journal_id where l.account_code='1150' and e.source_ref='ADV-GLT-1'");
  ok(Number(advBal.b) === 0, "the advance is fully cleared from employee advances", advBal.b);

  // recurring bill paid
  await c.query("insert into public.recurring_bills(ref, entity_id, item, amount, state) values ('BILL-GLT-1',$1,'Internet',6000,'pending')", [ke]);
  await c.query("update public.recurring_bills set state='paid', decided_at=now() where ref='BILL-GLT-1'");
  const bl = await q1("select source_key k from public.journal_entries where source_ref='BILL-GLT-1'");
  const bj = bl ? await je(bl.k) : null;
  ok(bj && line(bj, "5160")?.d === 6000 && line(bj, "1000")?.c === 6000, "A2 paid recurring bill: Dr utilities & bills / Cr bank", JSON.stringify(bj?.lines));

  // sales invoice (USD) + receipt at a better rate → FX gain; M-Pesa receipt → 1010
  await as(editor);
  let inv = await j("select public.save_sales_invoice(null,$1::jsonb) as j", [JSON.stringify({ customer: "GL Test Client", currency: "USD", fxRate: 129, vatApplicable: false, lines: [{ title: "Advisory", qty: 1, unitPrice: 1000 }] })]);
  inv = await j("select public.issue_sales_invoice($1) as j", [inv.uuid]);
  const si = await je(`sales_invoice:${inv.id}:issue`);
  ok(si && line(si, "1100")?.d === 129000 && line(si, "4000")?.c === 129000, "A2 issued invoice: Dr receivable / Cr revenue in KES", JSON.stringify(si?.lines));
  const rc = await j("select public.record_ar_receipt($1, 400, 'bank', current_date, 'TT-1', 130) as j", [inv.id]);
  ok(Number(rc.fx) === 400, "D3 USD receipt at 130 vs invoiced 129 → KES 400 FX gain", rc.fx);
  const rcl = (await c.query("select l.account_code a, l.debit::numeric d, l.credit::numeric c from public.journal_lines l join public.journal_entries e on e.id=l.journal_id where e.ref=$1", [rc.journal])).rows;
  ok(rcl.find((x) => x.a === "1000" && Number(x.d) === 52000) && rcl.find((x) => x.a === "1100" && Number(x.c) === 51600) && rcl.find((x) => x.a === "4900" && Number(x.c) === 400),
    "D3 receipt journal: Dr bank 52,000 / Cr receivable 51,600 / Cr FX 400", JSON.stringify(rcl));
  const rc2 = await j("select public.record_ar_receipt($1, 600, 'mpesa', current_date, 'MP-1', 128) as j", [inv.id]);
  const rcl2 = (await c.query("select l.account_code a, l.debit::numeric d, l.credit::numeric c from public.journal_lines l join public.journal_entries e on e.id=l.journal_id where e.ref=$1", [rc2.journal])).rows;
  ok(rcl2.find((x) => x.a === "1010" && Number(x.d) === 76800) && rcl2.find((x) => x.a === "4900" && Number(x.d) === 600) && rcl2.find((x) => x.a === "1100" && Number(x.c) === 77400),
    "D4 M-Pesa receipt lands in 1010; final payment at 128 clears the receivable with a KES 600 FX loss", JSON.stringify(rcl2));

  // ---------- A4 mappings are configuration ----------
  await as(third ?? md);
  await j("select public.gl_set_mapping('petty_cash','expense','5140') as j");
  await c.query("reset role");
  await c.query("insert into public.petty_cash_requests(ref, entity_id, item, amount, state) values ('PCR-GLT-2',$1,'Stationery',800,'approved')", [ke]);
  const pc2 = await je("petty_cash:PCR-GLT-2");
  ok(line(pc2, "5140")?.d === 800, "A4 re-mapping petty cash expense to 5140 changes the next posting (no code change)", JSON.stringify(pc2?.lines));

  // ---------- A8 manual journals ----------
  await as(editor);
  const mjLines = [{ account: "5140", debit: 7000 }, { account: "1000", credit: 7000 }];
  let mj = await j("select public.save_manual_journal(null,$1::jsonb) as j", [JSON.stringify({ memo: "Reclass office supplies", lines: mjLines })]);
  ok(mj.state === "draft" && /^MJ-/.test(mj.ref), "A8 manual journal saved as a draft (nothing posted yet)", mj.ref);
  await expectThrow(() => j("select public.submit_manual_journal($1) as j", [mj.id]), "A8 cannot submit without a supporting document", /supporting document/);
  mj = await j("select public.save_manual_journal($1,$2::jsonb) as j", [mj.id, JSON.stringify({ memo: "Reclass office supplies", lines: mjLines, attachments: ["gl/test-support.pdf"] })]);
  mj = await j("select public.submit_manual_journal($1) as j", [mj.id]);
  ok(mj.state === "submitted" && /Chief of Staff/.test(mj.bandLabel), "A8 KES 7,000 falls in the Chief of Staff band (IGN-FIN-001)", mj.bandLabel);
  await expectThrow(() => j("select public.approve_manual_journal($1) as j", [mj.id]), "A8 the preparer cannot approve their own journal", /someone else/);
  await as(md);
  mj = await j("select public.approve_manual_journal($1) as j", [mj.id]);
  ok(mj.state === "posted" && /^JE-/.test(mj.jeRef), "A8 MD approval posts it to the ledger", mj.jeRef);
  const mje = await je(`manual_journal:${mj.ref}`);
  ok(mje?.kind === "manual" && line(mje, "5140")?.d === 7000, "A8 posted as a manual journal entry", mje?.kind);

  await as(editor);
  await expectThrow(() => j("select public.save_manual_journal(null,$1::jsonb) as j", [JSON.stringify({ memo: "x", lines: [{ account: "1100", debit: 5 }, { account: "4000", credit: 5 }] })]),
    "A8 control account (receivables) blocked in a manual journal", /control account/);

  // big journal needs MD + a Board member
  await c.query("reset role");
  await c.query("update public.app_config set value = value || jsonb_build_object($1::text, 'board') where key='gl_approvers'", [third?.email ?? "nobody@x"]);
  await as(editor);
  let big = await j("select public.save_manual_journal(null,$1::jsonb) as j", [JSON.stringify({ memo: "Accrue audit fee", attachments: ["gl/audit.pdf"], lines: [{ account: "5000", debit: 600000 }, { account: "2050", credit: 600000 }] })]);
  big = await j("select public.submit_manual_journal($1) as j", [big.id]);
  ok(/Board/.test(big.bandLabel), "A8 KES 600,000 needs MD + one Board member", big.bandLabel);
  await as(md);
  big = await j("select public.approve_manual_journal($1) as j", [big.id]);
  ok(big.state === "submitted", "A8 MD alone is not enough — still awaiting the Board member", big.state);
  if (third) {
    await as(third);
    big = await j("select public.approve_manual_journal($1) as j", [big.id]);
    ok(big.state === "posted", "A8 Board member's approval completes it and posts", big.state);
  }

  // correction by reversal
  await as(editor);
  let rev = await j("select public.start_journal_reversal($1, null, 'Posted to the wrong account') as j", [mj.jeRef]);
  ok(rev.kind === "reversal" && rev.lines[0].credit === 7000, "A8 reversal starts as a draft with the lines flipped", JSON.stringify(rev.lines));
  rev = await j("select public.save_manual_journal($1,$2::jsonb) as j", [rev.id, JSON.stringify({ memo: "Posted to the wrong account", attachments: ["gl/why.pdf"] })]);
  rev = await j("select public.submit_manual_journal($1) as j", [rev.id]);
  await as(md);
  rev = await j("select public.approve_manual_journal($1) as j", [rev.id]);
  await c.query("reset role");
  const orig = await q1("select state, reversed_by from public.journal_entries where ref=$1", [mj.jeRef]);
  ok(rev.state === "posted" && orig.state === "reversed" && orig.reversed_by === rev.jeRef, "A8 approved reversal posts and marks the original reversed", `${orig.state} by ${orig.reversed_by}`);
  await as(editor);
  await expectThrow(() => j("select public.start_journal_reversal($1) as j", [si.ref]), "A8 module postings are corrected in their module, not reversed in the ledger", /correct it in that module/);

  // opening balances — one, then locked
  let op = await j("select public.save_manual_journal(null,$1::jsonb) as j", [JSON.stringify({ kind: "opening", memo: "Opening TB", attachments: ["gl/opening-tb.xlsx"],
    lines: [{ account: "1000", debit: 250000 }, { account: "1100", debit: 50000 }, { account: "3900", credit: 300000 }] })]);
  op = await j("select public.submit_manual_journal($1) as j", [op.id]);
  await as(md);
  op = await j("select public.approve_manual_journal($1) as j", [op.id]);
  const ope = await je(`manual_journal:${op.ref}`);
  ok(op.state === "posted" && ope.kind === "opening" && line(ope, "1100")?.d === 50000, "D2 opening journal posts (control accounts allowed for opening)", ope?.kind);
  await as(editor);
  let op2 = await j("select public.save_manual_journal(null,$1::jsonb) as j", [JSON.stringify({ kind: "opening", memo: "Again", attachments: ["x"], lines: [{ account: "1000", debit: 1 }, { account: "3900", credit: 1 }] })]);
  await expectThrow(() => j("select public.submit_manual_journal($1) as j", [op2.id]), "D2 a second opening journal is refused (locked)", /already posted and locked/);
  await expectThrow(() => j("select public.start_journal_reversal($1) as j", [ope.ref]), "D2 opening balances cannot be reversed", /locked/);

  // ---------- A5 reports ----------
  const tb = await j("select public.gl_trial_balance('0000-01', $1) as j", [period]);
  ok(Number(tb.totalDebit) === Number(tb.totalCredit), "A5 trial balance agrees", `${tb.totalDebit} = ${tb.totalCredit}`);
  const bs = await j("select public.gl_balance_sheet($1) as j", [period]);
  const bsDiff = Math.round((Number(bs.totalAssets) - Number(bs.totalLiabilities) - Number(bs.totalEquity)) * 100) / 100;
  ok(bsDiff === 0, "A5 balance sheet balances (assets = liabilities + equity incl. current earnings)", `${bs.totalAssets} vs ${bs.totalLiabilities} + ${bs.totalEquity}`);
  const pl = await j("select public.gl_income_statement('0000-01', $1) as j", [period]);
  ok(Math.abs(Number(pl.net) - Number(bs.currentEarnings)) < 0.005, "A5 P&L net = balance-sheet current earnings", `${pl.net} vs ${bs.currentEarnings}`);
  const ledger = await j("select public.gl_account_ledger('1150', $1, $1) as j", [period]);
  ok(ledger.lines.length >= 3 && Number(ledger.lines.at(-1).balance) === Number(ledger.opening) + ledger.lines.reduce((s, l) => s + Number(l.debit) - Number(l.credit), 0),
    "account ledger shows lines with a running balance", ledger.lines.length);

  // ---------- A6 project actuals ----------
  if (proj) {
    const pa = await j("select public.gl_project_actuals($1,$1) as j", [period]);
    const row = pa.find((r) => r.project === proj.name);
    ok(row && Number(row.expense) >= 3000 + 4500 + 7000, "A6 project actuals from ledger lines (petty cash + claim + advance spend)", row?.expense);
    const plp = await j("select public.gl_income_statement($1,$1,$2) as j", [period, proj.name]);
    ok(Number(plp.totalExpense) === Number(row?.expense), "A6 project P&L matches project actuals", plp.totalExpense);
  }

  // ---------- A7 period close ----------
  await as(third ?? md);
  await expectThrow(() => j("select public.gl_advance_period($1,'closed') as j", [period]), "A7 a period cannot jump straight to closed", /one step at a time/);
  await expectThrow(() => j("select public.gl_advance_period($1,'reconciled') as j", [period]), "A7 cannot mark reconciled while bank accounts are unreconciled", /not reconciled/);
  const chk = await j("select public.gl_period_checks($1) as j", [period]);
  for (const a of chk.accounts.filter((x) => x.active)) {
    await expectThrow(() => j("select public.gl_save_reconciliation($1,$2,$3) as j", [a.code, period, Number(a.ledger) + 1]),
      `reconciliation with a KES 1 difference needs an explanation (${a.code})`, /differs from the ledger/);
    const r = await j("select public.gl_save_reconciliation($1,$2,$3) as j", [a.code, period, Number(a.ledger)]);
    ok(r.state === "reconciled", `${a.code} ${a.name} reconciled to the statement`, r.ledger);
  }
  let pst = await j("select public.gl_advance_period($1,'reconciled') as j", [period]);
  ok(pst.state === "reconciled", "A7 period → Reconciled", pst.state);
  pst = await j("select public.gl_advance_period($1,'tb_agreed') as j", [period]);
  ok(pst.state === "tb_agreed", "A7 period → TB agreed", pst.state);
  await c.query("reset role");
  const earlier = (await c.query("select period from public.gl_periods where period < $1 and state not in ('closed','reported')", [period])).rows;
  for (const e of earlier) await c.query("update public.gl_periods set state='closed' where period=$1", [e.period]);
  await as(third ?? md);
  pst = await j("select public.gl_advance_period($1,'closed') as j", [period]);
  ok(pst.state === "closed", "A7 period → Closed", pst.state);
  await c.query("reset role");
  await expectThrow(() => c.query("insert into public.petty_cash_requests(ref, entity_id, item, amount, state) values ('PCR-GLT-3',$1,'Late',100,'approved')", [ke]),
    "A7 a closed period refuses new postings (the module action fails too)", /period is closed/);
  await as(editor);
  await expectThrow(() => j("select public.save_manual_journal(null,$1::jsonb) as j", [JSON.stringify({ memo: "late", date: today, lines: [] })]),
    "A7 a manual journal cannot be dated in a closed period", /closed/);

  await c.query("reset role");
  await c.query("rollback");
  console.log(`\n${failures} failing assertion(s)`);
  if (failures === 0) console.log("GL_TESTS_PASS");
  await c.end();
  process.exit(failures === 0 ? 0 : 1);
} catch (e) {
  console.error("ERR", e.message, e.where ?? "");
  try { await c.query("rollback"); await c.end(); } catch { /* ignore */ }
  process.exit(1);
}
