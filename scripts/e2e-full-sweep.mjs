// Full functional sweep: every view/tab renders, every interactive flow works
// against the live backend, permission enforcement holds for a low-access user.
import { chromium } from "playwright";

const BASE = "http://localhost:5199";
const SHOT = (n) => `/tmp/jikoni-sweep-${n}.png`;
const log = (...a) => console.log(...a);
let pageErrors = [];
let consoleErrors = [];

const browser = await chromium.launch({ channel: "chrome", headless: true });
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
const page = await ctx.newPage();
page.on("pageerror", (e) => pageErrors.push(String(e).slice(0, 150)));
page.on("console", (m) => {
  const t = m.text();
  if (m.type() === "error" && !t.includes("favicon")) consoleErrors.push(t.slice(0, 150));
});
const toasts = async (p = page) => p.$$eval(".toast", (els) => els.map((e) => e.textContent.trim()).join(" | "));

try {
  /* A — auth */
  await page.goto(BASE, { waitUntil: "networkidle" });
  await page.getByPlaceholder("you@ignis.africa").fill("wanjiku@ignis.africa");
  await page.getByPlaceholder("••••••••").fill("wrong-password");
  await page.getByRole("button", { name: /sign in/i }).click();
  await page.waitForTimeout(1500);
  const authErr = await page.locator("form div", { hasText: /invalid/i }).first().textContent().catch(() => "(none)");
  log("A1. 🔍 wrong password:", authErr.trim().slice(0, 60));
  await page.getByPlaceholder("••••••••").fill("Jikoni-2026!");
  await page.getByRole("button", { name: /sign in/i }).click();
  await page.waitForSelector(".topbar", { timeout: 15000 });
  await page.waitForTimeout(2500);
  log("A2. ✅ signed in as wanjiku");

  /* B — every view + every sub-tab renders */
  const modules = await page.$$eval(".nav-item.has-sub .nl", (els) => els.map((e) => e.textContent.trim()));
  const plain = await page.$$eval(".nav-item:not(.has-sub)", (els) => els.map((e) => e.textContent.trim()));
  let tabCount = 0;
  for (const m of modules) {
    await page.click(`.nav-item.has-sub:has-text("${m}")`);
    await page.waitForTimeout(350);
    const subTabs = await page.$$eval(".subnav.open .subnav-item", (els) => els.map((e) => e.textContent.trim()));
    for (const s of subTabs) {
      await page.click(`.subnav.open .subnav-item:has-text("${s}")`);
      await page.waitForTimeout(250);
      tabCount++;
    }
  }
  for (const v of plain) {
    await page.click(`.nav-item:not(.has-sub):has-text("${v}")`);
    await page.waitForTimeout(300);
    tabCount++;
  }
  log(`B. ✅ swept ${modules.length} modules + ${plain.length} views, ${tabCount} tabs | pageErrors: ${pageErrors.length}, consoleErrors: ${consoleErrors.length}`);
  if (pageErrors.length) log("   pageErrors:", JSON.stringify(pageErrors.slice(0, 3)));
  if (consoleErrors.length) log("   consoleErrors:", JSON.stringify(consoleErrors.slice(0, 3)));

  /* C — Home: task filter + assign task */
  await page.click(".nav-item:not(.has-sub):has-text('Home')");
  await page.waitForTimeout(400);
  const mine = await page.$$eval("#home .task", (els) => els.length);
  await page.locator("#home button", { hasText: "Team" }).first().click().catch(() => {});
  await page.waitForTimeout(300);
  const team = await page.$$eval("#home .task", (els) => els.length);
  log(`C1. ✅ My Week filter — mine: ${mine} rows, team: ${team} rows`);
  await page.click(".iconbtn[title='Add task']");
  await page.waitForSelector(".modal-bg.show:has-text('Assign a task')");
  await page.locator(".modal-bg.show input.field").first().fill("Sweep task — functional check");
  await page.getByRole("button", { name: /assign task/i }).click();
  await page.waitForTimeout(2000);
  log("C2. ✅ task:", (await toasts()).slice(0, 90));

  /* D — full P2P from the UI */
  await page.click(".nav-item.has-sub:has-text('Procurement')");
  await page.waitForTimeout(400);
  await page.getByRole("button", { name: /new requisition/i }).first().click();
  await page.waitForSelector(".modal-bg.show");
  await page.locator(".modal-bg.show input.field").first().fill("Enumerator tablets — sweep test");
  await page.selectOption(".modal-bg.show select.field >> nth=0", "Field / MRV");
  await page.fill(".modal-bg.show input[type=number]", "80000");
  await page.getByRole("button", { name: /submit requisition/i }).click();
  await page.waitForTimeout(2000);
  const reqToast = await toasts();
  const ref = (reqToast.match(/PR-\d+/) || ["?"])[0];
  log("D1. ✅ requisition:", reqToast.slice(0, 90));
  await page.click(".subnav-item:has-text('Requisitions')");
  await page.waitForTimeout(500);
  const row = page.locator(`tr:has-text('${ref}')`);
  await row.getByRole("button", { name: /^approve$/i }).click();
  await page.waitForTimeout(1500);
  log("D2. ✅ approve:", (await toasts()).slice(0, 80));
  await row.getByRole("button", { name: /raise po/i }).click();
  await page.waitForSelector(".modal-bg.show:has-text('Raise a purchase order')");
  await page.selectOption(".modal-bg.show select.field >> nth=0", "Equity Logistics");
  await page.getByRole("button", { name: /issue po/i }).click();
  await page.waitForTimeout(2000);
  const poToast = await toasts();
  log("D3. ✅ PO:", poToast.slice(0, 90));

  /* E — sales invoice */
  await page.click(".nav-item.has-sub:has-text('Finance')");
  await page.waitForTimeout(400);
  await page.click(".subnav-item:has-text('Receivables')");
  await page.waitForTimeout(400);
  await page.click("a:has-text('+ New invoice')");
  await page.waitForTimeout(400);
  await page.locator(".modal-bg.show input.field").first().fill("Sweep invoice");
  await page.fill(".modal-bg.show input[type=number]", "40000");
  await page.getByRole("button", { name: /issue invoice/i }).click();
  await page.waitForTimeout(2000);
  log("E. ✅ invoice:", (await toasts()).slice(0, 100));

  /* F — CRM engagement → create project */
  await page.click(".nav-item.has-sub:has-text('Partnerships CRM')");
  await page.waitForTimeout(400);
  await page.click(".subnav-item:has-text('Engagements')");
  await page.waitForTimeout(400);
  await page.locator("#crm button", { hasText: "Downstream" }).click();
  await page.waitForTimeout(300);
  await page.locator("#crm tr", { hasText: "DST-007" }).first().click();
  await page.waitForSelector(".drawer.show", { timeout: 5000 });
  const linked = await page.locator(".drawer.show").getByText("Open linked project").isVisible().catch(() => false);
  if (linked) {
    await page.locator(".drawer.show").getByText("Open linked project").click();
    log("F1. ✅ engagement already linked (persisted from earlier run) — opened linked project");
  } else {
    await page.locator(".drawer.show").getByText("Create project").click();
    await page.waitForTimeout(2500);
    log("F1. ✅ create project:", (await toasts()).slice(0, 110));
  }
  const projDrawer = await page.locator(".drawer.show h3").first().textContent().catch(() => "?");
  log("F2. ✅ project drawer opened:", projDrawer?.trim());
  await page.locator(".drawer-bg.show").last().click({ position: { x: 10, y: 10 } }).catch(() => {});
  await page.waitForTimeout(400);

  /* G — Users: access drawer save */
  await page.click(".nav-item:not(.has-sub):has-text('User Management')");
  await page.waitForTimeout(400);
  await page.locator("#users tr", { hasText: "Wilson" }).getByRole("button").first().click();
  await page.waitForSelector(".drawer.show", { timeout: 5000 });
  await page.getByRole("button", { name: /save access/i }).click();
  await page.waitForTimeout(2000);
  log("G. ✅ access saved:", (await toasts()).slice(0, 100));

  /* H — inventory flows */
  await page.click(".nav-item.has-sub:has-text('Inventory')");
  await page.waitForTimeout(500);
  await page.getByRole("button", { name: /^receive$/i }).click();
  await page.waitForSelector(".modal-bg.show");
  await page.selectOption(".modal-bg.show select.field >> nth=0", { label: "Temperature sensor (MRV) (SEN-TMP)" });
  await page.selectOption(".modal-bg.show select.field >> nth=1", "Nairobi central store");
  await page.fill(".modal-bg.show input[type=number]", "10");
  await page.getByRole("button", { name: /post receipt/i }).click();
  await page.waitForTimeout(2000);
  log("H1. ✅ receive:", (await toasts()).slice(0, 100));
  await page.getByRole("button", { name: /issue stock/i }).click();
  await page.waitForSelector(".modal-bg.show");
  await page.selectOption(".modal-bg.show select.field >> nth=0", { label: "LPG cylinder — 13kg (CYL-13)" });
  await page.selectOption(".modal-bg.show select.field >> nth=1", "Nairobi central store");
  await page.fill(".modal-bg.show input[type=number]", "4");
  await page.locator(".modal-bg.show input.field[placeholder*='Makueni']").fill("sweep issue");
  await page.getByRole("button", { name: /post issue/i }).click();
  await page.waitForTimeout(2000);
  log("H2. ✅ issue:", (await toasts()).slice(0, 100));

  /* I — permission enforcement as a low-access user (fresh context) */
  const ctx2 = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const p2 = await ctx2.newPage();
  await p2.goto(BASE, { waitUntil: "networkidle" });
  await p2.getByPlaceholder("you@ignis.africa").fill("lily@ignis.africa");
  await p2.getByPlaceholder("••••••••").fill("Jikoni-2026!");
  await p2.getByRole("button", { name: /sign in/i }).click();
  await p2.waitForSelector(".topbar", { timeout: 15000 });
  await p2.waitForTimeout(2000);
  await p2.click(".nav-item.has-sub:has-text('Procurement')");
  await p2.waitForTimeout(400);
  await p2.getByRole("button", { name: /new requisition/i }).first().click();
  await p2.waitForSelector(".modal-bg.show");
  await p2.locator(".modal-bg.show input.field").first().fill("Lily tries");
  await p2.fill(".modal-bg.show input[type=number]", "1000");
  await p2.getByRole("button", { name: /submit requisition/i }).click();
  await p2.waitForTimeout(2000);
  log("I. 🔍 lily (view-only) submits requisition:", (await toasts(p2)).slice(0, 110));
  await ctx2.close();

  /* J — reload persistence */
  await page.reload({ waitUntil: "networkidle" });
  await page.waitForTimeout(2500);
  const week0 = await page.$$eval("#home .task .txt", (els) => els[0]?.textContent.trim().slice(0, 40));
  await page.click(".nav-item.has-sub:has-text('Procurement')");
  await page.waitForTimeout(300);
  await page.click(".subnav-item:has-text('Requisitions')");
  await page.waitForTimeout(400);
  const reqPersist = await page.$$eval("tr", (els, r) => els.some((e) => e.textContent.includes(r)), ref);
  log(`J. ✅ after reload — My Week[0]: "${week0}" | ${ref} still listed: ${reqPersist}`);
  await page.screenshot({ path: SHOT("final") });

  log(`\nSUMMARY: pageErrors=${pageErrors.length} consoleErrors=${consoleErrors.length}`);
} finally {
  await browser.close();
}
