// Receivables invoicing test (mig 0085) — runs inside ONE transaction and rolls it
// back, so nothing persists. Proves:
//   * drafts carry no invoice number; issuing assigns IGN-INV-YYYY-NNN, sequentially
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
  if (process.argv.includes("--with-migrations")) {
    for (const f of process.argv.filter((a) => /^\d{4}_.*\.sql$/.test(a))) {
      await c.query(readFileSync(resolve(root, "supabase/migrations", f), "utf8")); console.log(`(applied ${f} inside the test transaction)`);
    }
  }
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

  // 2. issue → IGN-INV-YYYY-NNN, KES journal
  const before = (await q1("select n from public.ref_counters where kind=$1", [`IGN-INV-${year}`]))?.n ?? 0;
  let i1 = await issue(d.uuid);
  const expNo1 = `IGN-INV-${year}-${String(before + 1).padStart(3, "0")}`;
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
  const expNo2 = `IGN-INV-${year}-${String(before + 2).padStart(3, "0")}`;
  ok(i2.id === expNo2, "second invoice gets the next number (sequential)", i2.id);
  await c.query("reset role");
  je = await jeLines(i2.id, "sales_invoice");
  ok(je.find((l) => l.a === "2100")?.c === 8000, "VAT credited to 2100", JSON.stringify(je));
  await as(editor);

  // 3b. no due date + Terms & Conditions snapshot
  const nd = await save(null, { customer: "No Terms Client", currency: "KES", noDueDate: true, includeTerms: true,
    lines: [{ title: "Cookstoves", qty: 1, unitPrice: 1000 }] });
  ok(nd.terms === null && nd.dueDate === null, "no due date → terms and due date empty", `${nd.terms}/${nd.dueDate}`);
  const ndi = await issue(nd.uuid);
  const expNo3 = `IGN-INV-${year}-${String(before + 3).padStart(3, "0")}`;
  ok(ndi.id === expNo3 && ndi.dueDate === null, "invoice without a due date issues with the next number", `${ndi.id} ${ndi.dueDate}`);
  await c.query("reset role");
  const tcRow = await q1("select terms_conditions, include_terms from public.sales_invoices where id=$1", [nd.uuid]);
  ok(tcRow.include_terms === true && /Terms|VAT/.test(tcRow.terms_conditions || ""), "T&C text snapshotted when ticked", (tcRow.terms_conditions || "").slice(0, 40));
  const tcOff = await q1("select terms_conditions from public.sales_invoices where id=$1", [k.uuid]);
  ok(tcOff.terms_conditions === null, "no T&C on an invoice where it isn't ticked", tcOff.terms_conditions);
  await as(editor);

  // 3c. prices include VAT — VAT backed out of the price, total = the typed price
  const vi = await save(null, { customer: "Cookstove Buyer", currency: "KES", vatApplicable: true, vatRate: 16, vatInclusive: true,
    lines: [{ title: "Ignis cookstove", qty: 1, unitPrice: 6500 }] });
  ok(vi.vatInclusive === true && Number(vi.total) === 6500 && Number(vi.vat) === 896.55 && Number(vi.subtotal) === 5603.45,
    "VAT-inclusive: 6500 = 5603.45 + 896.55 VAT", `${vi.subtotal}/${vi.vat}/${vi.total}`);
  const vii = await issue(vi.uuid);
  await c.query("reset role");
  je = await jeLines(vii.id, "sales_invoice");
  ok(je.find((l) => l.a === "1100")?.d === 6500 && je.find((l) => l.a === "4000")?.c === 5603.45 && je.find((l) => l.a === "2100")?.c === 896.55,
    "VAT-inclusive journal: Dr 1100 6500 / Cr 4000 5603.45 / Cr 2100 896.55", JSON.stringify(je));
  await as(editor);
  const vo = await save(null, { customer: "X", currency: "KES", vatApplicable: false, vatInclusive: true, lines: [{ title: "a", qty: 1, unitPrice: 100 }] });
  ok(vo.vatInclusive === false && Number(vo.total) === 100, "'prices include VAT' is ignored when VAT doesn't apply", `${vo.vatInclusive} ${vo.total}`);
  await q1("select public.delete_draft_invoice($1)", [vo.uuid]);

  // 3d. numbering never skips: a failed issue doesn't use a number; a drifted counter can't cause a gap
  {
    await c.query("reset role");
    const lastNo = async () => (await q1("select coalesce(max(substring(ref from '(\\d+)$')::int),0) n from public.sales_invoices where ref like $1", [`IGN-INV-${year}-%`])).n;
    const before3 = await lastNo();
    await as(editor);
    const g1 = await save(null, { customer: "Gap Test", currency: "KES", lines: [{ title: "x", qty: 1, unitPrice: 100 }] });
    await c.query("reset role");
    await c.query("insert into public.gl_periods(entity_id, period, state) values ((select id from public.entities where code='KE'), to_char(public.ke_today(),'YYYY-MM'), 'closed') on conflict (entity_id, period) do update set state='closed'");
    await as(editor);
    await expectThrow(() => issue(g1.uuid), "issuing into a closed period fails", /closed/);
    await c.query("reset role");
    await c.query("update public.gl_periods set state='open' where period=to_char(public.ke_today(),'YYYY-MM')");
    ok(await lastNo() === before3, "…and that failed issue did not use up a number", before3);
    await c.query("update public.ref_counters set n = n + 7 where kind=$1", [`IGN-INV-${year}`]);   // simulate counter drift
    await as(editor);
    const g1i = await issue(g1.uuid);
    ok(g1i.id === `IGN-INV-${year}-${String(before3 + 1).padStart(3, "0")}`, "next invoice is exactly last + 1 even if the counter drifted", g1i.id);
  }

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
  ok(/^IGN-INV-\d{4}-\d{3}$/.test(acc.invoice), "accept_proforma issues an IGN-numbered invoice", acc.invoice);
  const lg = await q1("select total, vat, state from public.sales_invoices where ref=$1", [acc.invoice]);
  ok(Number(lg.total) === 11600 && Number(lg.vat) === 1600 && lg.state === "issued", "legacy path keeps 16% VAT (10000 → 11600)", JSON.stringify(lg));

  // 9. trial balance still balances
  await c.query("reset role");
  const tb = await q1("select sum(debit)::numeric d, sum(credit)::numeric c from public.journal_lines");
  ok(Number(tb.d) === Number(tb.c), "trial balance balances", `${tb.d} vs ${tb.c}`);

  // 10. any staff member drafts → sends for issuing; only an editor issues (mig 0092)
  if (viewer) {
    await as(viewer);
    let sd = await save(null, { customer: "Staff-drafted Client", currency: "KES", lines: [{ title: "Stoves", qty: 2, unitPrice: 6500 }] });
    ok(sd.state === "draft", "a non-editor can draft an invoice", sd.id);
    await expectThrow(() => issue(sd.uuid), "a non-editor cannot issue it", /view-only/);
    await as(editor);
    const edDraft = await save(null, { customer: "Editor's own draft", lines: [] });
    await as(viewer);
    await expectThrow(() => save(edDraft.uuid, { customer: "Hijack", lines: [] }), "a non-editor cannot edit someone else's draft", /only edit invoices you drafted/);
    await expectThrow(() => q1("select public.delete_draft_invoice($1)", [edDraft.uuid]), "…or delete it", /only delete invoices you drafted/);
    sd = (await q1("select public.submit_invoice_for_issue($1) as j", [sd.uuid])).j;
    const sub1 = await q1("select submitted_at is not null s from public.sales_invoices where id=$1", [sd.uuid]);
    ok(sub1.s, "draft sent for issuing");
    await expectThrow(() => save(sd.uuid, { customer: "Staff-drafted Client", lines: [{ title: "Stoves", qty: 3, unitPrice: 6500 }] }), "preparer can't edit while Finance has it", /with Finance/);
    await c.query("reset role");
    const nEd = await q1("select count(*)::int n from public.notifications where kind='invoice_to_issue' and link_ref=$1", [sd.id]);
    ok(nEd.n >= 1, "editors are notified", nEd.n);
    await as(editor);
    await q1("select public.return_invoice_draft($1, 'Add the LPO number') as j", [sd.uuid]);
    await as(viewer);
    sd = await save(sd.uuid, { customer: "Staff-drafted Client", poNumber: "LPO-9", lines: [{ title: "Stoves", qty: 2, unitPrice: 6500 }] });
    ok(sd.state === "draft", "returned draft can be edited by its preparer again");
    await q1("select public.submit_invoice_for_issue($1) as j", [sd.uuid]);
    await as(editor);
    const si2 = await issue(sd.uuid);
    ok(/^IGN-INV-/.test(si2.id), "editor issues the staff-drafted invoice", si2.id);
    await c.query("reset role");
    const nPrep = await q1("select count(*)::int n from public.notifications where kind='invoice_issued' and link_ref=$1 and recipient_email=lower($2)", [si2.id, viewer.email]);
    ok(nPrep.n === 1, "preparer is told it was issued", nPrep.n);
    await as(viewer);
    const dd = await save(null, { customer: "Scrap me", lines: [] });
    await q1("select public.delete_draft_invoice($1)", [dd.uuid]);
    ok(true, "preparer can delete their own draft");
  }

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
