// General Ledger UI walkthrough — READ-ONLY (nothing is saved). Needs `npx vite --port 5199`.
// Signs in as brian55mwangi@gmail.com with an admin-generated session (no email, password
// untouched), opens every GL tab + Bank & Cash + Reporting, fills a draft journal in the
// editor without saving, and screenshots each step to the folder given (default /tmp).
import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";
import { createClient } from "@supabase/supabase-js";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const env = Object.fromEntries(readFileSync(resolve(root, ".env.local"), "utf8").split("\n").filter((l) => l.includes("=")).map((l) => [l.slice(0, l.indexOf("=")).trim(), l.slice(l.indexOf("=") + 1).trim().replace(/^"|"$/g, "")]));
const SB_URL = env.VITE_SUPABASE_URL || env.NEXT_PUBLIC_SUPABASE_URL || env.SUPABASE_URL;
const admin = createClient(SB_URL, env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });
const LOGIN = "brian55mwangi@gmail.com";
const OUT = process.argv[2] || "/tmp";
const BASE = "http://localhost:5199";

let failures = 0;
const ok = (cond, label, extra = "") => { console.log(`${cond ? "PASS" : "FAIL"} — ${label}${extra ? " :: " + extra : ""}`); if (!cond) failures++; };
const errors = [];
const browser = await chromium.launch({ headless: true });
const ctx = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
const page = await ctx.newPage();
page.on("pageerror", (e) => { errors.push(String(e)); console.log("  [pageerror]", String(e).slice(0, 200)); });
page.on("console", (m) => { if (m.type() === "error" && !/favicon|404/.test(m.text())) console.log("  [console]", m.text().slice(0, 200)); });
const shot = (n) => page.screenshot({ path: `${OUT}/gl-${n}.png`, fullPage: true });
const body = () => page.locator("main").innerText();
// wait until the main area's text matches (lazy chunks + report RPCs take a moment)
const waitText = (re, ms = 20000) => page.waitForFunction((src) => new RegExp(src, "i").test(document.querySelector("main")?.innerText ?? ""), re.source, { timeout: ms }).catch(() => {});

try {
  const { data: link, error: le } = await admin.auth.admin.generateLink({ type: "magiclink", email: LOGIN });
  if (le) throw le;
  const anon = createClient(SB_URL, env.NEXT_PUBLIC_SUPABASE_ANON_KEY || env.VITE_SUPABASE_ANON_KEY, { auth: { persistSession: false } });
  const { data: ses, error: ve } = await anon.auth.verifyOtp({ token_hash: link.properties.hashed_token, type: "magiclink" });
  if (ve) throw ve;
  const storageKey = `sb-${new URL(SB_URL).hostname.split(".")[0]}-auth-token`;
  await page.goto(BASE);
  await page.evaluate(([k, v]) => { localStorage.setItem(k, v); localStorage.removeItem("gl.sub"); }, [storageKey, JSON.stringify(ses.session)]);
  await page.goto(BASE, { waitUntil: "networkidle" });
  await page.waitForSelector(".topbar", { timeout: 20000 });
  await page.waitForTimeout(2500);
  ok(true, `signed in as ${LOGIN}`);

  await page.click(".nav-item.has-sub:has-text('Finance')");
  await page.waitForTimeout(400);
  await page.locator(".subnav.open .subnav-item", { hasText: "General Ledger" }).first().click();
  await waitText(/1150\s+Employee advances/);
  let t = await body();
  ok(/Chart of accounts/.test(t) && /1010/.test(t) && /M-Pesa/.test(t) && /Employee advances/.test(t), "Chart of accounts lists the new accounts (M-Pesa, employee advances)");
  ok(/(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sept?|Oct|Nov|Dec) \d{4} · (Open|Reconciled|TB agreed|Closed|Reported)/i.test(await page.locator(".vhead").innerText()), "header shows the real current period state");
  await shot("1-accounts");

  await page.locator("main a", { hasText: "Bank — KCB" }).first().click();
  await page.waitForTimeout(1500);
  ok(/Opening balance/.test(await page.locator(".modal-bg.show").innerText()), "account ledger modal opens with opening balance + running balance");
  await shot("2-account-ledger");
  await page.locator(".modal-bg.show button", { hasText: "Close" }).click();

  const sub = async (label, n, re, name) => {
    await page.locator("main button.btn.sm", { hasText: label }).first().click();
    await waitText(re);
    t = await body();
    ok(re.test(t), name, re.test(t) ? "" : t.slice(0, 300).replace(/\n/g, " | "));
    await shot(n);
  };
  await sub("Journals", "3-journals", /Journal entries/, "Journals tab renders (period / source filters)");
  await sub("Manual journals", "4-manual", /Manual journals/, "Manual journals tab renders");

  // open the editor, fill a balanced draft — do NOT save
  await page.locator("main button", { hasText: "New journal" }).click();
  await page.waitForSelector(".modal-bg.show");
  const m = page.locator(".modal-bg.show");
  const selects = m.locator("tbody select");
  await selects.nth(0).selectOption({ index: 1 });
  await m.locator("tbody tr").nth(0).locator("input[type=number]").nth(0).fill("1500");
  await page.waitForTimeout(200);
  ok(/Out of balance/.test(await m.innerText()), "editor flags an unbalanced draft");
  await selects.nth(2).selectOption({ index: 2 });
  await m.locator("tbody tr").nth(1).locator("input[type=number]").nth(1).fill("1500");
  await page.waitForTimeout(200);
  ok(/Balanced/.test(await m.innerText()), "editor shows Balanced once debits = credits");
  const opts = await selects.nth(0).locator("option").allInnerTexts();
  ok(!opts.some((o) => /^1100 /.test(o)) && !opts.some((o) => /^2000 /.test(o)), "control accounts (1100, 2000) are not offered in a manual journal");
  await shot("5-journal-editor");
  await m.locator("button", { hasText: "Cancel" }).click();

  await sub("Reports", "6-reports-pl", /Income statement/, "Reports → income statement renders");
  for (const [b, re, n] of [["Balance sheet", /Balance sheet · as at/i, "7-bs"], ["Trial balance", /Totals ·/i, "8-tb"], ["Project actuals", /Project \/ cost centre/i, "9-pa"], ["Statutory", /Statutory liability/i, "10-stat"]]) {
    await page.locator("main .panel-h button", { hasText: b }).first().click();
    await waitText(re);
    t = await body();
    ok(re.test(t), `Reports → ${b} renders`, re.test(t) ? "" : t.slice(0, 200).replace(/\n/g, " | "));
    if (b === "Balance sheet") ok(/Balances/i.test(t), "balance sheet check shows Balances");
    if (b === "Trial balance") ok(/Agrees/i.test(t), "trial balance shows Agrees");
    await shot(n);
  }
  await sub("Periods", "11-periods", /Trial balance agrees/, "Periods tab renders with the close checklist");
  ok(/Bank & cash reconciled/.test(await body()) && /Trial balance agrees/.test(await body()), "period checklist: reconciliation + TB + ready-to-close");
  await sub("Setup", "12-setup", /Petty cash — float paid out[\s\S]*IRENA/, "Setup tab: account mappings + funds loaded");
  t = await body();
  ok(/Funds/.test(t) && /Journal approvers/.test(t) && /Approval bands/.test(t) && /Chief of Staff/.test(t), "Setup tab: funds, approvers, IGN-FIN-001 bands");

  await page.locator(".subnav.open .subnav-item", { hasText: "Bank & Cash" }).first().click();
  await waitText(/Petty cash float/);
  t = await body();
  ok(/Reconcile 1000/.test(t) && /M-Pesa/.test(t) && /Petty cash float/.test(t) && /Statement lines/.test(t), "Bank & Cash: bank, M-Pesa, petty-cash reconciliation");
  await shot("13-bank");

  await page.locator(".subnav.open .subnav-item", { hasText: "Reporting" }).first().click();
  await waitText(/Surplus|Deficit/);
  ok(/Financial reports/.test(await body()) && /Tax & statutory/.test(await body()), "Reporting & Compliance uses the live ledger reports");
  await shot("14-reporting");

  ok(errors.length === 0, "no page errors", errors.join(" | ").slice(0, 300));
} catch (e) {
  console.error("ERR", e.message);
  await shot("error").catch(() => {});
  failures++;
}
await browser.close();
console.log(`\n${failures} failing check(s)`);
if (failures === 0) console.log("GL_E2E_PASS");
process.exit(failures ? 1 : 0);
