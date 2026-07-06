// Drive the running app end-to-end against the hosted Supabase backend.
import { chromium } from "playwright";

const BASE = "http://localhost:5199";
const SHOT = (n) => `/tmp/jikoni-verify-${n}.png`;
const log = (...a) => console.log(...a);

const browser = await chromium.launch({ channel: "chrome", headless: true });
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
page.on("console", (m) => { if (m.type() === "error") log("  [console.error]", m.text().slice(0, 200)); });
page.on("pageerror", (e) => log("  [pageerror]", String(e).slice(0, 200)));

try {
  // 1 — login gate
  await page.goto(BASE, { waitUntil: "networkidle" });
  const gate = await page.getByText("Sign in — every action is recorded").isVisible().catch(() => false);
  log("1. login gate visible:", gate);
  await page.screenshot({ path: SHOT("1-login") });

  await page.getByPlaceholder("you@ignis.africa").fill("wanjiku@ignis.africa");
  await page.getByPlaceholder("••••••••").fill("Jikoni-2026!");
  await page.getByRole("button", { name: /sign in/i }).click();
  await page.waitForSelector(".topbar", { timeout: 15000 });
  await page.waitForTimeout(2500); // bootstrap round-trip
  log("1b. signed in, shell rendered");

  // 2 — My Week from DB
  const taskIds = await page.$$eval("#home .task .id", (els) => els.map((e) => e.textContent.trim()));
  log("2. My Week rows:", taskIds.length, "ids:", taskIds.join(","));
  await page.screenshot({ path: SHOT("2-home") });

  // 3 — requisition
  await page.click(".nav-item.has-sub:has-text('Procurement')");
  await page.waitForTimeout(400);
  await page.getByRole("button", { name: /new requisition/i }).first().click().catch(async () => {
    await page.click("text=New requisition");
  });
  await page.waitForSelector(".modal-bg.show", { timeout: 5000 });
  await page.locator(".modal-bg.show input.field").first().fill("Cooker spares — maintenance batch");
  await page.selectOption(".modal-bg.show select.field >> nth=0", "Operations");
  await page.fill(".modal-bg.show input[type=number]", "142000");
  await page.waitForTimeout(300);
  const routing = await page.locator(".modal-bg.show .reqbox").nth(1).textContent().catch(() => "");
  log("3a. routing preview:", routing.replace(/\s+/g, " ").slice(0, 90));
  await page.screenshot({ path: SHOT("3-reqmodal") });
  await page.getByRole("button", { name: /submit requisition/i }).click();
  await page.waitForTimeout(2000);
  const toast1 = await page.$$eval(".toast", (els) => els.map((e) => e.textContent.trim()).join(" | "));
  log("3b. toast:", toast1.slice(0, 140));
  const ref = (toast1.match(/PR-\d+/) || ["PR-?"])[0];
  // the live reqs list renders under the Requisitions sub-tab
  await page.click(".subnav-item:has-text('Requisitions')");
  await page.waitForTimeout(500);
  const reqRow = await page.$$eval("#procurement tr", (els, r) =>
    els.map((e) => e.textContent).filter((t) => t.includes(r)), ref);
  log(`3c. ${ref} row:`, JSON.stringify(reqRow).slice(0, 220));
  await page.screenshot({ path: SHOT("3b-req-submitted") });

  // 4 — approve + PO
  const row = page.locator(`tr:has-text('${ref}')`);
  await row.getByRole("button", { name: /^approve$/i }).click();
  await page.waitForTimeout(1500);
  log("4a. approved toast:", await page.$$eval(".toast", (els) => els.map((e) => e.textContent.trim()).join(" | ")).then(t => t.slice(0, 120)));
  const poBtn = row.getByRole("button", { name: /raise po/i });
  await poBtn.click();
  await page.waitForSelector(".modal-bg.show:has-text('Raise a purchase order')", { timeout: 5000 });
  await page.selectOption(".modal-bg.show select.field >> nth=0", "Nakuru Fabricators");
  await page.getByRole("button", { name: /issue po/i }).click();
  await page.waitForTimeout(2000);
  log("4b. PO toast:", await page.$$eval(".toast", (els) => els.map((e) => e.textContent.trim()).join(" | ")).then(t => t.slice(0, 140)));
  await page.screenshot({ path: SHOT("4-po") });

  // 5 — sales invoice (Finance → Receivables → + New invoice)
  await page.click(".nav-item.has-sub:has-text('Finance')");
  await page.waitForTimeout(400);
  await page.click(".subnav-item:has-text('Receivables')");
  await page.waitForTimeout(400);
  await page.click("a:has-text('+ New invoice')");
  await page.waitForTimeout(400);
  await page.locator(".modal-bg.show input.field").first().fill("Institutional cookers — batch 3");
  await page.fill(".modal-bg.show input[type=number]", "100000");
  await page.getByRole("button", { name: /issue invoice/i }).click();
  await page.waitForTimeout(2000);
  log("5. invoice toast:", await page.$$eval(".toast", (els) => els.map((e) => e.textContent.trim()).join(" | ")).then(t => t.slice(0, 140)));
  await page.screenshot({ path: SHOT("5-invoice") });

  // 6 — assign task from + button
  await page.click(".iconbtn[title='Add task']");
  await page.waitForSelector(".modal-bg.show:has-text('Assign a task')", { timeout: 5000 });
  await page.locator(".modal-bg.show input.field").first().fill("Verify DB wiring — demo task");
  await page.getByRole("button", { name: /assign task/i }).click();
  await page.waitForTimeout(2000);
  log("6a. task toast:", await page.$$eval(".toast", (els) => els.map((e) => e.textContent.trim()).join(" | ")).then(t => t.slice(0, 140)));
  await page.click(".nav-item:has-text('Home')");
  await page.waitForTimeout(600);
  const week = await page.$$eval("#home .task .txt", (els) => els.map((e) => e.textContent.trim().slice(0, 40)));
  log("6b. My Week first rows:", JSON.stringify(week.slice(0, 3)));
  await page.screenshot({ path: SHOT("6-task") });

  // 7 — probe: reload → state persists from DB (the real proof it's not local state)
  await page.reload({ waitUntil: "networkidle" });
  await page.waitForTimeout(2500);
  const persisted = await page.$$eval("#home .task .txt", (els) => els.map((e) => e.textContent.trim().slice(0, 40)));
  log("7. after reload, My Week[0]:", JSON.stringify(persisted[0]), "| rows:", persisted.length);
  await page.screenshot({ path: SHOT("7-reload") });
} finally {
  await browser.close();
}
