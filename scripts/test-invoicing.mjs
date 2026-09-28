// Receivables invoicing test (mig 0085) — runs inside ONE transaction and rolls it
// back, so nothing persists. Proves:
//   * drafts carry no invoice number; issuing assigns IGN-YYYY-NNN, sequentially
//   * VAT only when applicable, at the chosen rate; due date = invoice date + terms
//   * USD invoices post the KES equivalent at the invoice rate; the TB balances
//   * part-payments → partially_paid with the right balance; overpay rejected; final → paid
//   * cancel reverses the journal; drafts can be deleted, issued invoices cannot be edited
//   * the legacy submit_sales_invoice / accept_proforma path still works
//   * a view-only account cannot create invoices
// Prints INVOICING_TESTS_PASS only if every assertion holds.
import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const url = readFileSync(resolve(root, ".claude/settings.local.json"), "utf8").match(/postgres(?:ql)?:\/\/[^"'\\\s]+/)[0];
const c = new pg.Client({ connectionString: url, ssl: { rejectUnauthorized: false } });

let failures = 0;
function ok(cond, label, extra = "") { console.log(`${cond ? "PASS" : "FAIL"} — ${label}${extra ? " :: " + extra : ""}`); if (!cond) failures++; }
async function as(u) {
  await c.query("reset role");
  await c.query("select set_config('request.jwt.claims', json_build_object('sub',$1::text,'email',$2::text,'role','authenticated')::text, true)", [u.auth_id, u.email]);
  await c.query("set local role authenticated");
}
async function expectThrow(fn, label) {
  await c.query("savepoint sp");
  try { await fn(); ok(false, label, "no exception raised"); await c.query("release savepoint sp"); }
  catch (e) { ok(true, label, e.message); await c.query("rollback to savepoint sp"); }
}
const q1 = async (sql, args = []) => (await c.query(sql, args)).rows[0];
const save = async (id, data) => (await q1("select public.save_sales_invoice($1,$2::jsonb) as j", [id, JSON.stringify(data)])).j;
const issue = async (id) => (await q1("select public.issue_sales_invoice($1) as j", [id])).j;
const pay = async (ref, amt, date = null, refno = null) =>
  (await q1("select public.record_ar_receipt($1,$2,'bank',coalesce($3::date,current_date),$4) as j", [ref, amt, date, refno])).j;
const jeLines = async (ref, type) => (await c.query(
  "select l.account_code, l.debit::numeric d, l.credit::numeric c from public.journal_entries e join public.journal_lines l on l.journal_id=e.id where e.source_ref=$1 and e.source_type=$2 order by l.account_code",
  [ref, type])).rows.map((r) => ({ a: r.account_code, d: Number(r.d), c: Number(r.c) }));

try {
  await c.connect();
  const editor = await q1("select id,auth_id,email from public.app_users where lower(email)='jwanjiku@ignis-innovation.com'");
  const viewer = await q1("select id,auth_id,email from public.app_users where auth_id is not null and lower(email) not in ('jwanjiku@ignis-innovation.com','dnderitu@ignis-innovation.com','brian55mwangi@gmail.com') limit 1");
  console.log(`editor=${editor.email} viewer=${viewer?.email}\n`);
  const year = new Date().getFullYear();

  await c.query("begin");
  await as(editor);

  // 1. draft — USD, no VAT, 3 lines (the template invoice)
  const tmpl = {
    customer: "Keystone Agribusiness Consultants Ltd", billToAddress: "Nairobi, Kenya", billToContact: "Elijah Kang'ara",
    currency: "USD", fxRate: 129.5, terms: 14, vatApplicable: false, engagementRef: "SF-TA-2026-001, Phase 3", poNumber: "PO-778",
    notes: "All three deliverables were issued on or before 24 September 2026.", includePaymentDetails: true,
    lines: [
      { title: "Integrated Financial Model", description: "Five-year model", qty: 1, unitPrice: 1750 },
      { title: "Go-To-Market Model", description: "GTM workbook", qty: 1, unitPrice: 1250 },
      { title: "Investor Pitch Deck", description: "Fifteen slides", qty: 1, unitPrice: 750 },
      { title: "", description: "", qty: 1, unitPrice: 0 },        // blank row is dropped
    ],
  };
  let d = await save(null, tmpl);
  ok(d.state === "draft" && d.id.startsWith("DRAFT-"), "draft saved without an invoice number", d.id);
  ok(d.lines.length === 3, "blank line dropped, 3 lines kept", d.lines.length);
  ok(Number(d.subtotal) === 3750 && Number(d.vat) === 0 && Number(d.total) === 3750, "no VAT when not applicable (3750)", `${d.subtotal}/${d.vat}/${d.total}`);
  const expDue = await q1("select (public.ke_today() + 14)::text d");
  ok(String(d.dueDate).slice(0, 10) === expDue.d, "due date = invoice date + 14", d.dueDate);

  // edit the draft: qty 2 on the deck
  tmpl.lines[2].qty = 2;
  d = await save(d.uuid, tmpl);
  ok(Number(d.total) === 4500, "editing a draft recomputes the total (4500)", d.total);
  tmpl.lines[2].qty = 1;
  d = await save(d.uuid, tmpl);

  // 2. issue → IGN-YYYY-NNN, KES journal
  const before = (await q1("select n from public.ref_counters where kind=$1", [`IGN-${year}`]))?.n ?? 0;
  let i1 = await issue(d.uuid);
  const expNo1 = `IGN-${year}-${String(before + 1).padStart(3, "0")}`;
  ok(i1.id === expNo1 && i1.state === "issued", "issue assigns the next IGN number", i1.id);
  ok(Number(i1.totalKes) === 3750 * 129.5, "USD total converted to KES at the invoice rate", i1.totalKes);
  await c.query("reset role");
  let je = await jeLines(i1.id, "sales_invoice");
  ok(je.length === 2 && je.find((l) => l.a === "1100")?.d === 485625 && je.find((l) => l.a === "4000")?.c === 485625,
    "journal Dr 1100 / Cr 4000 in KES, no VAT line", JSON.stringify(je));
  const et = await q1("select count(*)::int n from public.etims_submissions where invoice_ref=$1", [i1.id]);
  ok(et.n === 1, "eTIMS filing row created at issue", et.n);
  const pd = await q1("select payment_details from public.sales_invoices where ref=$1", [i1.id]);
  ok(pd.payment_details?.account_no === "1342100026", "USD bank account snapshotted onto the invoice", JSON.stringify(pd.payment_details));
  await as(editor);
  await expectThrow(() => save(d.uuid, tmpl), "an issued invoice cannot be edited");
  await expectThrow(() => issue(d.uuid), "an invoice cannot be issued twice");

  // 3. second invoice — KES with 16% VAT → next sequential number
  let k = await save(null, { customer: "Typed-in Client Ltd", currency: "KES", terms: 30, vatApplicable: true, vatRate: 16,
    lines: [{ title: "Training", qty: 2, unitPrice: 25000 }] });
  ok(Number(k.subtotal) === 50000 && Number(k.vat) === 8000 && Number(k.total) === 58000, "16% VAT computed (50000 + 8000)", `${k.subtotal}/${k.vat}/${k.total}`);
  let i2 = await issue(k.uuid);
  const noPo = await q1("select po_number from public.sales_invoices where id=$1", [k.uuid]);
  ok(noPo.po_number === null && i2.state === "issued", "PO number is optional — invoice without an LPO issues fine", JSON.stringify(noPo));
  const expNo2 = `IGN-${year}-${String(before + 2).padStart(3, "0")}`;
  ok(i2.id === expNo2, "second invoice gets the next number (sequential)", i2.id);
  await c.query("reset role");
  je = await jeLines(i2.id, "sales_invoice");
  ok(je.find((l) => l.a === "2100")?.c === 8000, "VAT credited to 2100", JSON.stringify(je));
  await as(editor);

  // 4. payments on the USD invoice: part, overpay, final
  await expectThrow(() => pay(i1.id, 5000), "overpayment (more than the balance) rejected");
  await expectThrow(() => pay(i1.id, 10, "2999-01-01"), "future-dated payment rejected");
  let p = await pay(i1.id, 1000, null, "KCB-TT-1");
  ok(p.state === "partially_paid" && Number(p.balance) === 2750, "part payment → partially_paid, balance 2750", `${p.state} ${p.balance}`);
  p = await pay(i1.id, 2750);
  ok(p.state === "paid" && Number(p.balance) === 0, "final payment → paid, balance 0", `${p.state} ${p.balance}`);
  await expectThrow(() => pay(i1.id, 1), "no payment on a fully paid invoice");
  await c.query("reset role");
  const rc = await q1("select count(*)::int n, sum(amount_kes)::numeric k from public.ar_receipts r join public.sales_invoices s on s.id=r.invoice_id where s.ref=$1", [i1.id]);
  ok(rc.n === 2 && Number(rc.k) === 485625, "receipts stored; KES receipts clear the receivable exactly", `${rc.n} / ${rc.k}`);
  await as(editor);

  // 5. overdue is derived from the due date (read model) — backdate and check
  await c.query("reset role");
  await c.query("update public.sales_invoices set due_date = current_date - 1 where ref=$1", [i2.id]);
  const od = await q1("select (state in ('issued','partially_paid') and due_date < current_date and total > amount_paid) as overdue from public.sales_invoices where ref=$1", [i2.id]);
  ok(od.overdue === true, "past-due unpaid invoice reads as overdue", "");
  await as(editor);

  // 6. cancel the KES invoice → reversing journal
  const cx = (await q1("select public.cancel_sales_invoice($1,'raised in error') as j", [k.uuid])).j;
  ok(cx.state === "cancelled", "unpaid invoice can be cancelled", cx.state);
  await c.query("reset role");
  je = await jeLines(i2.id, "sales_invoice");
  const net1100 = je.filter((l) => l.a === "1100").reduce((s, l) => s + l.d - l.c, 0);
  ok(net1100 === 0, "cancel reverses the receivable (1100 nets to 0)", JSON.stringify(je));
  await as(editor);

  // 7. drafts: validation + delete
  await expectThrow(() => save(null, { customer: "  ", lines: [] }), "client name required");
  await expectThrow(() => save(null, { customer: "X", currency: "USD", fxRate: 0, lines: [] }), "USD needs an exchange rate");
  const empty = await save(null, { customer: "Empty draft", lines: [] });
  await expectThrow(() => issue(empty.uuid), "cannot issue a draft with no priced lines");
  await q1("select public.delete_draft_invoice($1)", [empty.uuid]);
  const gone = await q1("select count(*)::int n from public.sales_invoices where id=$1", [empty.uuid]);
  ok(gone.n === 0, "draft deleted", gone.n);

  // 8. legacy path — accept_proforma → submit_sales_invoice wrapper
  const pf = (await q1("select public.create_proforma('Proforma Client',null,null,null,null,null,null,$1::jsonb) as j",
    [JSON.stringify([{ d: "Cookstoves", q: 2, p: 5000 }])])).j;
  const acc = (await q1("select public.accept_proforma($1) as j", [pf.ref])).j;
  ok(/^IGN-\d{4}-\d{3}$/.test(acc.invoice), "accept_proforma issues an IGN-numbered invoice", acc.invoice);
  const lg = await q1("select total, vat, state from public.sales_invoices where ref=$1", [acc.invoice]);
  ok(Number(lg.total) === 11600 && Number(lg.vat) === 1600 && lg.state === "issued", "legacy path keeps 16% VAT (10000 → 11600)", JSON.stringify(lg));

  // 9. trial balance still balances
  await c.query("reset role");
  const tb = await q1("select sum(debit)::numeric d, sum(credit)::numeric c from public.journal_lines");
  ok(Number(tb.d) === Number(tb.c), "trial balance balances", `${tb.d} vs ${tb.c}`);

  // 10. view-only account blocked
  if (viewer) { await as(viewer); await expectThrow(() => save(null, { customer: "Nope", lines: [] }), "view-only account cannot create invoices"); }

  await c.query("reset role");
  await c.query("rollback");
  console.log(`\n${failures} failing assertion(s)`);
  if (failures === 0) console.log("INVOICING_TESTS_PASS");
  await c.end();
  process.exit(failures === 0 ? 0 : 1);
} catch (e) {
  console.error("ERR", e.message);
  try { await c.query("rollback"); await c.end(); } catch { /* ignore */ }
  process.exit(1);
}
