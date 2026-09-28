// Browser E2E for (a) reconciling a travel advance against its planned lines and
// (b) the new Receivables invoicing flow (draft → issue → part/full payment → PDF).
// Runs against the dev server (http://localhost:5199) and the hosted DB, as brian55mwangi@gmail.com.
// Everything it creates is tagged "E2E-TEST" and DELETED at the end (advance, invoice,
// receipts, journals, eTIMS rows, audit rows, uploaded files) and the ADV / IGN-YYYY
// counters are put back, so production numbering is untouched.
import { readFileSync, writeFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";
import { chromium } from "playwright";
import { createClient } from "@supabase/supabase-js";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const url = readFileSync(resolve(root, ".claude/settings.local.json"), "utf8").match(/postgres(?:ql)?:\/\/[^"'\\\s]+/)[0];
const env = Object.fromEntries(readFileSync(resolve(root, ".env.local"), "utf8").split("\n").filter((l) => l.includes("=")).map((l) => [l.slice(0, l.indexOf("=")).trim(), l.slice(l.indexOf("=") + 1).trim().replace(/^"|"$/g, "")]));
const SB_URL = env.VITE_SUPABASE_URL || env.NEXT_PUBLIC_SUPABASE_URL || env.SUPABASE_URL;
const admin = createClient(SB_URL, env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });
const LOGIN = "brian55mwangi@gmail.com";   // an editor account (view-only lock allows edits)
const OUT = process.argv[2] || "/tmp";
const BASE = "http://localhost:5199";
const c = new pg.Client({ connectionString: url, ssl: { rejectUnauthorized: false } });

let failures = 0;
const ok = (cond, label, extra = "") => { console.log(`${cond ? "PASS" : "FAIL"} — ${label}${extra ? " :: " + extra : ""}`); if (!cond) failures++; };
const q1 = async (sql, a = []) => (await c.query(sql, a)).rows[0];
async function as(u) {
  await c.query("select set_config('request.jwt.claims', json_build_object('sub',$1::text,'email',$2::text,'role','authenticated')::text, false)", [u.auth_id, u.email]);
}
const year = new Date().getFullYear();
let advRef = null, invRef = null, invUuid = null;
const advBefore = Number((await (async () => { await c.connect(); return q1("select n from public.ref_counters where kind='ADV'"); })())?.n ?? 0);
const ignBefore = Number((await q1("select n from public.ref_counters where kind=$1", [`IGN-${year}`]))?.n ?? 0);

const browser = await chromium.launch({ headless: true });
const ctx = await browser.newContext({ viewport: { width: 1440, height: 1000 }, acceptDownloads: true });
const page = await ctx.newPage();
page.on("pageerror", (e) => console.log("  [pageerror]", String(e).slice(0, 200)));
page.on("dialog", (d) => d.accept());
const shot = (n) => page.screenshot({ path: `${OUT}/e2e-${n}.png`, fullPage: false });
const toasts = () => page.$$eval(".toast", (els) => els.map((e) => e.textContent.trim()).join(" | "));
const modal = ".modal-bg.show";

try {
  // ---------- setup: an issued advance with planned lines (holder = jwanjiku) ----------
  const holder = await q1("select id, auth_id, email from public.app_users where lower(email)=$1", [LOGIN]);
  const approvers = (await c.query("select id, auth_id, email from public.app_users where lower(email) in ('jwanjiku@ignis-innovation.com','dnderitu@ignis-innovation.com')")).rows;
  await c.query("begin");
  await as(holder);
  const adv = (await q1("select public.submit_travel_advance($1,null,$2::jsonb) as j", ["E2E-TEST Kitui trip",
    JSON.stringify([{ category: "transport", detail: "matatu", amount: 1500 }, { category: "accommodation", detail: "hotel", amount: 4000 }, { isPerDiem: true, perDiemDays: 2, perDiemRate: 1000 }])])).j;
  advRef = adv.id;
  // approve as whichever editor the request routed to (never the holder), then issue
  for (const ap of approvers) {
    if ((await q1("select state from public.travel_advances where ref=$1", [advRef])).state !== "pending") break;
    await as(ap);
    await c.query("savepoint d");
    try { await c.query("select public.decide_travel_advance($1,true,null)", [advRef]); await c.query("release savepoint d"); }
    catch { await c.query("rollback to savepoint d"); }
  }
  await as(approvers[0]);
  await c.query("select public.issue_travel_advance($1,'E2E')", [advRef]);
  await c.query("commit");
  await c.query("select set_config('request.jwt.claims', '', false)");
  console.log(`setup: ${advRef} issued (planned 7,500)\n`);

  // ---------- login: one-time admin-generated session (no email, password untouched) ----------
  const { data: link, error: le } = await admin.auth.admin.generateLink({ type: "magiclink", email: LOGIN });
  if (le) throw le;
  const anon = createClient(SB_URL, env.NEXT_PUBLIC_SUPABASE_ANON_KEY || env.VITE_SUPABASE_ANON_KEY, { auth: { persistSession: false } });
  const { data: ses, error: ve } = await anon.auth.verifyOtp({ token_hash: link.properties.hashed_token, type: "magiclink" });
  if (ve) throw ve;
  const storageKey = `sb-${new URL(SB_URL).hostname.split(".")[0]}-auth-token`;
  await page.goto(BASE);
  await page.evaluate(([k, v]) => localStorage.setItem(k, v), [storageKey, JSON.stringify(ses.session)]);
  await page.goto(BASE, { waitUntil: "networkidle" });
  await page.waitForSelector(".topbar", { timeout: 20000 });
  await page.waitForTimeout(3000);
  ok(true, `signed in as ${LOGIN}`);

  // ---------- A. reconcile against planned lines ----------
  await page.click(".nav-item.has-sub:has-text('Staff Portal')");
  await page.waitForTimeout(400);
  await page.locator(".subnav.open .subnav-item", { hasText: "Travel Advances" }).first().click();
  await page.waitForTimeout(800);
  await page.locator(`tr:has-text('E2E-TEST Kitui trip') button:has-text('Reconcile')`).click();
  await page.waitForSelector(modal);
  await page.waitForTimeout(400);
  await shot("1-reconcile-open");
  const txt = await page.locator(modal).innerText();
  ok(/matatu/.test(txt) && /hotel/.test(txt) && /Per diem/i.test(txt), "reconcile modal lists the planned items (no re-typing)", "");
  const spentInputs = page.locator(`${modal} input[placeholder='0']`);
  ok(await spentInputs.count() === 2, "a Spent field per planned (non per-diem) item", String(await spentInputs.count()));
  ok(await spentInputs.nth(0).inputValue() === "1500", "spent prefilled with the planned amount", await spentInputs.nth(0).inputValue());
  await spentInputs.nth(0).fill("1800");      // transport cost more
  await spentInputs.nth(1).fill("0");         // hotel not used
  await page.locator(`${modal} input[title='Days']`).fill("1");
  // attach a receipt to the transport line
  const receipt = `${OUT}/e2e-receipt.pdf`;
  writeFileSync(receipt, "%PDF-1.1\n1 0 obj<<>>endobj\ntrailer<<>>\n%%EOF\n");
  await page.locator(`${modal} input[type=file]`).first().setInputFiles(receipt);
  await page.waitForTimeout(2500);
  await page.click(`${modal} a:has-text('+ Add unplanned expense')`);
  const rows = page.locator(`${modal} input[placeholder='Detail (unplanned)']`);
  await rows.last().fill("E2E airtime");
  await page.locator(`${modal} select`).last().selectOption("airtime");
  await page.locator(`${modal} input[type=number][placeholder='0']`).last().fill("200");
  await page.waitForTimeout(300);
  const totals = await page.locator(modal).innerText();
  ok(/KES\s?3,000/.test(totals.replace(/ /g, " ")), "live spent total = 3,000", "");
  await shot("2-reconcile-filled");
  await page.click(`${modal} button:has-text('Submit reconciliation')`);
  await page.waitForTimeout(3000);
  console.log("  toast:", (await toasts()).slice(0, 160));
  const a2 = await q1("select state, spent_amount::numeric s, balance::numeric b from public.travel_advances where ref=$1", [advRef]);
  ok(a2.state === "reconciled" && Number(a2.s) === 3000 && Number(a2.b) === 4500, "DB: reconciled, spent 3000, balance 4500", JSON.stringify(a2));
  const links = (await c.query("select l.category, l.detail, l.amount::numeric a, l.planned_line_id is not null linked, cardinality(l.receipt_paths) r from public.travel_advance_lines l join public.travel_advances t on t.id=l.advance_id where t.ref=$1 and not l.is_estimate order by l.created_at", [advRef])).rows;
  ok(links.filter((l) => l.linked).length === 3, "DB: 3 actual lines linked to planned lines", JSON.stringify(links));
  ok(links.some((l) => l.category === "transport" && Number(l.a) === 1800 && l.r === 1), "DB: transport 1800 with its receipt", "");
  ok(links.some((l) => l.category === "accommodation" && Number(l.a) === 0 && l.linked), "DB: unused hotel recorded as 0", "");
  ok(links.some((l) => !l.linked && l.category === "airtime" && Number(l.a) === 200), "DB: unplanned airtime line", "");

  // Finance settle modal shows planned vs spent
  await page.click(".nav-item.has-sub:has-text('Finance')");
  await page.waitForTimeout(400);
  await page.locator(".subnav.open .subnav-item", { hasText: "Travel Advances" }).first().click();
  await page.waitForTimeout(800);
  await page.waitForTimeout(1500);
  const settleBtn = page.locator(`tr:has-text('E2E-TEST Kitui trip') button:has-text('Settle')`).first();
  if (await settleBtn.count()) {
    await settleBtn.click();
    await page.waitForSelector(modal);
    const st = await page.locator(modal).innerText();
    ok(/Planned/i.test(st) && /Variance/i.test(st) && /unplanned/i.test(st), "Finance settle modal shows planned vs spent per item", "");
    await shot("3-settle-variance");
    await page.click(`${modal} button:has-text('Cancel')`);
  } else ok(false, "settle button found for the reconciled advance");

  // ---------- B. invoicing ----------
  await page.locator(".subnav.open .subnav-item", { hasText: "Receivables" }).first().click();
  await page.waitForTimeout(800);
  await page.getByRole("button", { name: /new invoice/i }).first().click();
  await page.waitForSelector(modal);
  await page.waitForTimeout(800);
  const head = await page.locator(`${modal} .mh`).innerText();
  const expNext = `IGN-${year}-${String(ignBefore + 1).padStart(3, "0")}`;
  ok(head.includes(expNext), "form shows the next invoice number (auto, sequential)", expNext);
  ok(await page.locator(`${modal} input[placeholder="Leave blank if no LPO"]`).count() === 1, "PO / LPO field present and left blank (optional)", "");
  await page.fill(`${modal} input[placeholder^="Type the client"]`, "E2E-TEST Keystone Agribusiness Consultants Ltd");
  await page.fill(`${modal} textarea[placeholder^="e.g. P.O. Box"]`, "Nairobi, Kenya");
  await page.fill(`${modal} input[placeholder^="e.g. Elijah"]`, "Elijah Kang'ara");
  await page.locator(`${modal} select`).first().selectOption("USD");
  await page.waitForTimeout(200);
  await page.locator(`${modal} input[type=number][step='0.01']`).first().fill("129.5");
  await page.fill(`${modal} input[placeholder^="e.g. SF-TA"]`, "SF-TA-2026-001, Phase 3 financial modelling workstream (Solar Freeze Ltd investment readiness)");
  const addLine = () => page.click(`${modal} a:has-text('+ Add line item')`);
  const items = [["Integrated Financial Model (FINMOD v2.0 FINAL)", "Five-year integrated model built on the FY26 audited statements.", "1750"],
                 ["Go-To-Market Model (v0.7 FINAL)", "Scenario-aligned GTM workbook.", "1250"],
                 ["Investor Pitch Deck (Aurora Trust, Sep 2026)", "Fifteen-slide investor presentation.", "750"]];
  for (let i = 0; i < items.length; i++) {
    if (i > 0) await addLine();
    await page.locator(`${modal} input[placeholder^="e.g. Integrated"]`).nth(i).fill(items[i][0]);
    await page.locator(`${modal} textarea[placeholder="What was delivered"]`).nth(i).fill(items[i][1]);
    await page.locator(`${modal} input[placeholder="0.00"]`).nth(i).fill(items[i][2]);
  }
  await page.waitForTimeout(300);
  const mtxt = (await page.locator(modal).innerText()).replace(/ /g, " ");
  ok(/Total due\s*USD 3,750\.00/.test(mtxt), "live totals: USD 3,750.00, no VAT", "");
  const formDue = await q1("select to_char(public.ke_today() + 14, 'FMDD FMMonth YYYY') d");
  const vals = await page.$$eval(`${modal} input[readonly]`, (els) => els.map((e) => e.value));
  ok(vals.includes(formDue.d), "form due date matches the server's (Nairobi today + 14)", `${formDue.d} in [${vals.join(" | ")}]`);
  // turn VAT on and off to see the calc
  await page.locator(`${modal} input[type=checkbox]`).first().check();
  await page.waitForTimeout(200);
  ok(/Total due\s*USD 4,350\.00/.test((await page.locator(modal).innerText()).replace(/ /g, " ")), "VAT 16% toggled on → USD 4,350.00", "");
  await page.locator(`${modal} input[type=checkbox]`).first().uncheck();
  await shot("4-invoice-form");
  // preview opens a PDF tab
  const [pv] = await Promise.all([ctx.waitForEvent("page", { timeout: 15000 }).catch(() => null), page.click(`${modal} button:has-text('Preview PDF')`)]);
  ok(!!pv, "Preview PDF opens a new tab", "");
  if (pv) {
    // headless Chromium has no PDF viewer: the blob navigation surfaces as a download instead
    await pv.waitForTimeout(2500);
    const src = await pv.evaluate(() => document.querySelector("iframe")?.getAttribute("src") ?? "").catch(() => "");
    ok(/^blob:/.test(src), "preview tab embeds the generated PDF", src.slice(0, 40));
    await pv.close();
  }
  await page.click(`${modal} button:has-text('Save draft')`);
  await page.waitForTimeout(3000);
  const dr = await q1("select id, ref, state, total::numeric t, currency, fx_rate::numeric fx from public.sales_invoices where customer like 'E2E-TEST%' order by created_at desc limit 1");
  invUuid = dr?.id;
  ok(dr?.state === "draft" && dr.ref.startsWith("DRAFT-") && Number(dr.t) === 3750 && dr.currency === "USD", "DB: draft saved, unnumbered, USD 3750", JSON.stringify(dr));
  const row = () => page.locator(`tr:has-text('E2E-TEST Keystone')`).first();
  ok(/Draft/.test(await row().innerText()), "list shows the Draft pill", "");
  await row().locator("button:has-text('Issue')").click();
  await page.waitForTimeout(3000);
  const is = await q1("select ref, state, total_kes::numeric k, invoice_date::text d, due_date::text due from public.sales_invoices where id=$1", [invUuid]);
  invRef = is.ref;
  ok(is.state === "issued" && new RegExp(`^IGN-${year}-\\d{3}$`).test(is.ref), "issued with an IGN-YYYY-NNN number", is.ref);
  ok(Number(is.k) === 485625, "posted in KES at 129.5 (485,625)", is.k);
  await shot("5-issued");

  // part payment
  await row().locator("button:has-text('Record payment')").click();
  await page.waitForSelector(modal);
  await page.locator(`${modal} input[type=number]`).first().fill("1000");
  await page.fill(`${modal} input[placeholder^="e.g. bank TT"]`, "E2E-TT-1");
  await page.waitForTimeout(200);
  ok(/Partially paid/.test(await page.locator(modal).innerText()), "modal explains it will become Partially paid", "");
  await page.click(`${modal} button:has-text('Record payment')`);
  await page.waitForTimeout(3000);
  let ps = await q1("select state, amount_paid::numeric p from public.sales_invoices where id=$1", [invUuid]);
  ok(ps.state === "partially_paid" && Number(ps.p) === 1000, "DB: partially_paid, 1000 paid", JSON.stringify(ps));
  await page.waitForTimeout(2000);
  const rt = await row().innerText();
  ok(/Partially paid/i.test(rt) && /2,750\.00/.test(rt), "list: Partially paid, balance 2,750.00", rt.replace(/\s+/g, " "));
  await shot("6-part-paid");
  // download PDF while part-paid (shows BALANCE DUE)
  const [dl] = await Promise.all([page.waitForEvent("download", { timeout: 20000 }), row().locator("button:has-text('PDF')").click()]);
  const pdfPath = `${OUT}/${dl.suggestedFilename()}`;
  await dl.saveAs(pdfPath);
  ok(dl.suggestedFilename() === `Ignis_Invoice_${invRef}.pdf`, "PDF downloads as Ignis_Invoice_<no>.pdf", dl.suggestedFilename());
  console.log("  pdf saved:", pdfPath);
  // full payment
  await row().locator("button:has-text('Record payment')").click();
  await page.waitForSelector(modal);
  ok(await page.locator(`${modal} input[type=number]`).first().inputValue() === "2750", "payment defaults to the outstanding balance", "");
  await page.click(`${modal} button:has-text('Record payment')`);
  await page.waitForTimeout(3000);
  ps = await q1("select state, amount_paid::numeric p from public.sales_invoices where id=$1", [invUuid]);
  ok(ps.state === "paid" && Number(ps.p) === 3750, "DB: paid in full", JSON.stringify(ps));
  await row().locator("td").first().click();
  await page.waitForSelector(modal);
  const vt = await page.locator(modal).innerText();
  ok(/E2E-TT-1/.test(vt) && /Paid/.test(vt), "invoice view lists both payments", "");
  await shot("7-view-paid");
  await page.click(`${modal} button:has-text('Close')`);

  // settings tab
  await page.click(".nav-item:has-text('Settings')").catch(() => {});
  await page.waitForTimeout(600);
  await page.click(".set-nav button:has-text('Invoicing')").catch(() => {});
  await page.waitForTimeout(500);
  const sv = await page.locator(".set-panel.active").innerText().catch(() => "");
  ok(/1342100026/.test(sv) || (await page.locator(".set-panel.active input[value='1342100026']").count()) > 0, "Settings → Invoicing shows the USD account", "");
  await shot("8-settings");
} catch (e) {
  failures++;
  console.error("ERR", e.message);
  await shot("error").catch(() => {});
} finally {
  await browser.close();
  // ---------- cleanup (commits) ----------
  try {
    await c.query("select set_config('request.jwt.claims', '', false)");
    await c.query("begin");
    const paths = [];
    const advs = (await c.query("select ref from public.travel_advances where purpose like 'E2E-TEST%'")).rows.map((x) => x.ref);
    for (const ref of advs) {
      const r = await c.query("select unnest(l.receipt_paths) p from public.travel_advance_lines l join public.travel_advances t on t.id=l.advance_id where t.ref=$1", [ref]);
      paths.push(...r.rows.map((x) => x.p));
      const pids = (await c.query("select distinct project_id from public.project_expenses where description like 'Advance ' || $1 || ' %'", [ref])).rows.map((x) => x.project_id);
      await c.query("delete from public.project_expenses where description like 'Advance ' || $1 || ' %'", [ref]);
      for (const p of pids) if (p) await c.query("select public.recompute_project_money($1)", [p]);
      await c.query("delete from public.travel_advances where ref=$1", [ref]);
    }
    const invs = (await c.query("select id, ref from public.sales_invoices where customer like 'E2E-TEST%'")).rows;
    for (const i of invs) {
      await c.query("delete from public.etims_submissions where invoice_ref=$1", [i.ref]);
      await c.query("delete from public.journal_entries where source_ref=$1", [i.ref]);
      await c.query("delete from public.sales_invoices where id=$1", [i.id]);
    }
    // put counters back to the highest number still in use (audit rows stay — the log is append-only)
    await c.query("update public.ref_counters set n=(select coalesce(max(substring(ref from '[0-9]+$')::int),0) from public.travel_advances) where kind='ADV'");
    await c.query("update public.ref_counters set n=(select coalesce(max(substring(ref from '[0-9]+$')::int),0) from public.sales_invoices where ref like $1) where kind=$2", [`IGN-${year}-%`, `IGN-${year}`]);
    await c.query("commit");
    if (paths.length) await admin.storage.from("uploads").remove(paths);
    console.log(`\ncleanup: removed ${advs.length} advance(s), ${invs.length} invoice(s), ${paths.length} file(s); counters restored`);
  } catch (e) { console.error("CLEANUP ERR", e.message); await c.query("rollback").catch(() => {}); failures++; }
  await c.end();
  console.log(`\n${failures} failing assertion(s)`);
  if (failures === 0) console.log("E2E_PASS");
  process.exit(failures ? 1 : 0);
}
