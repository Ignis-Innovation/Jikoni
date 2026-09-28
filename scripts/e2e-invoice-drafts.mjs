// Staff invoice drafting (mig 0092) — READ-ONLY UI check (nothing is saved). Needs `npx vite --port 5199`.
// Signs in as a non-editor staff account (admin-generated session; no email, password untouched),
// opens Staff Portal → Invoices and the invoice form, and checks the non-editor sees
// "Send for issuing" (not "Issue invoice"). Screenshots to the folder given (default /tmp).
import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";
import { createClient } from "@supabase/supabase-js";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const env = Object.fromEntries(readFileSync(resolve(root, ".env.local"), "utf8").split("\n").filter((l) => l.includes("=")).map((l) => [l.slice(0, l.indexOf("=")).trim(), l.slice(l.indexOf("=") + 1).trim().replace(/^"|"$/g, "")]));
const SB_URL = env.VITE_SUPABASE_URL || env.NEXT_PUBLIC_SUPABASE_URL || env.SUPABASE_URL;
const admin = createClient(SB_URL, env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });
const LOGIN = process.argv[3] || "wmungai@ignis-innovation.com";   // a NON-editor staff account
const OUT = process.argv[2] || "/tmp";
const BASE = "http://localhost:5199";

let failures = 0;
const ok = (cond, label, extra = "") => { console.log(`${cond ? "PASS" : "FAIL"} — ${label}${extra ? " :: " + extra : ""}`); if (!cond) failures++; };
const errors = [];
const browser = await chromium.launch({ headless: true });
const page = await (await browser.newContext({ viewport: { width: 1440, height: 1000 } })).newPage();
page.on("pageerror", (e) => { errors.push(String(e)); console.log("  [pageerror]", String(e).slice(0, 200)); });
const shot = (n) => page.screenshot({ path: `${OUT}/inv-${n}.png`, fullPage: true });
const waitText = (re, ms = 20000) => page.waitForFunction((src) => new RegExp(src, "i").test(document.body.innerText), re.source, { timeout: ms }).catch(() => {});
try {
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
  await page.waitForTimeout(2500);
  ok(true, `signed in as ${LOGIN}`);
  await page.click(".nav-item.has-sub:has-text('Staff Portal')");
  await page.waitForTimeout(400);
  await page.locator(".subnav.open .subnav-item", { hasText: "Invoices" }).first().click();
  await waitText(/My invoices/);
  ok(/My invoices/.test(await page.locator("main").innerText()), "Staff Portal → Invoices tab is there for a non-editor");
  await shot("1-staff-invoices");
  await page.locator("main button", { hasText: "New invoice" }).first().click();
  await page.waitForSelector(".modal-bg.show");
  const m = page.locator(".modal-bg.show");
  const t = await m.innerText();
  ok(/Send for issuing/i.test(t) && !/Issue invoice/i.test(t), "non-editor sees Send for issuing, not Issue invoice");
  await m.locator("input[placeholder^='Type the client']").fill("Test Client (not saved)");
  await m.locator("input[placeholder='e.g. Integrated Financial Model']").fill("Cookstoves");
  await m.locator("input[placeholder='0.00']").first().fill("6500");
  await page.waitForTimeout(300);
  ok(/6,500\.00/.test(await m.innerText()), "totals update as they type");
  await shot("2-staff-invoice-form");
  await m.locator("button", { hasText: "Cancel" }).click();
  ok(errors.length === 0, "no page errors", errors.join(" | ").slice(0, 300));
} catch (e) { console.error("ERR", e.message); await shot("error").catch(() => {}); failures++; }
await browser.close();
console.log(`\n${failures} failing check(s)`);
if (failures === 0) console.log("INV_DRAFT_E2E_PASS");
process.exit(failures ? 1 : 0);
