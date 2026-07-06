// Drive the Inventory module + invite flow + regression, against the live backend.
import { chromium } from "playwright";

const BASE = "http://localhost:5199";
const SHOT = (n) => `/tmp/jikoni-v2-${n}.png`;
const log = (...a) => console.log(...a);

const browser = await chromium.launch({ channel: "chrome", headless: true });
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
page.on("pageerror", (e) => log("  [pageerror]", String(e).slice(0, 200)));

const toasts = async () => page.$$eval(".toast", (els) => els.map((e) => e.textContent.trim()).join(" | "));

try {
  await page.goto(BASE, { waitUntil: "networkidle" });
  await page.getByPlaceholder("you@ignis.africa").fill("wanjiku@ignis.africa");
  await page.getByPlaceholder("••••••••").fill("Jikoni-2026!");
  await page.getByRole("button", { name: /sign in/i }).click();
  await page.waitForSelector(".topbar", { timeout: 15000 });
  await page.waitForTimeout(2500);
  log("1. signed in");

  // 2 — Inventory module appears in nav and renders
  await page.click(".nav-item.has-sub:has-text('Inventory')");
  await page.waitForTimeout(600);
  const pulse = await page.$$eval("#inventory .stat", (els) => els.map((e) => e.textContent.replace(/\s+/g, " ").trim().slice(0, 40)));
  log("2. overview pulse:", JSON.stringify(pulse.slice(0, 3)));
  await page.screenshot({ path: SHOT("1-overview") });

  // 3 — items tab
  await page.click(".subnav-item:has-text('Stock Items')");
  await page.waitForTimeout(400);
  const rows = await page.$$eval("#inventory .tbl tbody tr", (els) => els.map((e) => e.textContent.replace(/\s+/g, " ").trim().slice(0, 70)));
  log("3. stock items:", rows.length, "rows | first:", rows[0]);
  await page.screenshot({ path: SHOT("2-items") });

  // 4 — probe: issue from a location with no stock → clean error
  await page.getByRole("button", { name: /issue stock/i }).click();
  await page.waitForSelector(".modal-bg.show");
  await page.selectOption(".modal-bg.show select.field >> nth=0", { label: "Cooker spares kit (SPR-KIT)" });
  await page.selectOption(".modal-bg.show select.field >> nth=1", "Kiambu site store");
  await page.fill(".modal-bg.show input[type=number]", "20");
  await page.fill(".modal-bg.show input.field[placeholder*='Makueni']", "wrong location probe");
  await page.getByRole("button", { name: /post issue/i }).click();
  await page.waitForTimeout(2000);
  log("4-probe. empty-location toast:", (await toasts()).slice(0, 140));

  // 4b — issue below reorder from the stocked store → auto-requisition
  await page.selectOption(".modal-bg.show select.field >> nth=1", "Nairobi central store");
  const warn = await page.locator(".modal-bg.show .reqbox").textContent();
  log("4a. modal preview:", warn.replace(/\s+/g, " ").slice(0, 130));
  await page.screenshot({ path: SHOT("3-issue-modal") });
  await page.getByRole("button", { name: /post issue/i }).click();
  await page.waitForTimeout(2500);
  log("4b. toast:", (await toasts()).slice(0, 160));
  const itemRow = await page.$$eval("#inventory .tbl tbody tr", (els) =>
    els.map((e) => e.textContent.replace(/\s+/g, " ")).filter((t) => t.includes("SPR-KIT")));
  log("4c. SPR-KIT row now:", itemRow[0]?.slice(0, 110));
  await page.screenshot({ path: SHOT("4-below-reorder") });

  // 5 — the auto-req landed in Procurement
  await page.click(".nav-item.has-sub:has-text('Procurement')");
  await page.waitForTimeout(400);
  await page.click(".subnav-item:has-text('Requisitions')");
  await page.waitForTimeout(500);
  const autoReq = await page.$$eval("#procurement tr", (els) =>
    els.map((e) => e.textContent.replace(/\s+/g, " ")).filter((t) => t.includes("Restock")));
  log("5. auto-requisition in Procurement:", autoReq[0]?.slice(0, 130));
  await page.screenshot({ path: SHOT("5-autoreq") });

  // 6 — dispatch
  await page.click(".nav-item.has-sub:has-text('Inventory')");
  await page.waitForTimeout(500);
  await page.getByRole("button", { name: /^dispatch$/i }).click();
  await page.waitForSelector(".modal-bg.show");
  await page.selectOption(".modal-bg.show select.field >> nth=0", { label: "Institutional cooker — 40L (CKR-40)" });
  await page.fill(".modal-bg.show input[type=number]", "2");
  await page.selectOption(".modal-bg.show select.field >> nth=1", "Makueni VTC rollout");
  await page.fill(".modal-bg.show input.field[placeholder*='cluster']", "Makueni VTC cluster");
  await page.getByRole("button", { name: /^dispatch$/i }).last().click();
  await page.waitForTimeout(2500);
  log("6. dispatch toast:", (await toasts()).slice(0, 140));
  await page.click(".subnav-item:has-text('Dispatches')");
  await page.waitForTimeout(400);
  const dsp = await page.$$eval("#inventory .task", (els) => els.map((e) => e.textContent.replace(/\s+/g, " ").slice(0, 90)));
  log("6b. dispatches list:", JSON.stringify(dsp.slice(0, 2)));
  await page.screenshot({ path: SHOT("6-dispatch") });

  // 7 — movements ledger + assets
  await page.click(".subnav-item:has-text('Movements')");
  await page.waitForTimeout(400);
  const movs = await page.$$eval("#inventory .tbl tbody tr", (els) => els.length);
  log("7a. movement ledger rows:", movs);
  await page.click(".subnav-item:has-text('Asset Register')");
  await page.waitForTimeout(400);
  const assets = await page.$$eval("#inventory .tbl tbody tr", (els) => els.map((e) => e.textContent.replace(/\s+/g, " ").slice(0, 80)));
  log("7b. assets:", assets.length, "| first:", assets[0]);
  await page.screenshot({ path: SHOT("7-assets") });

  // 8 — invite flow (Phase 5)
  await page.click(".nav-item:has-text('User Management')");
  await page.waitForTimeout(500);
  await page.getByRole("button", { name: /invite/i }).first().click();
  await page.waitForSelector(".modal-bg.show:has-text('Invite a member')");
  await page.fill(".modal-bg.show input.field >> nth=0", "Njeri Kamau");
  await page.fill(".modal-bg.show input.field >> nth=1", "njeri@ignis.africa");
  await page.selectOption(".modal-bg.show select.field", "fin");
  await page.getByRole("button", { name: /send invite/i }).click();
  await page.waitForTimeout(2500);
  log("8. invite toast:", (await toasts()).slice(0, 150));
  await page.screenshot({ path: SHOT("8-invite") });

  // 9 — probe: duplicate invite must fail cleanly
  await page.getByRole("button", { name: /invite/i }).first().click();
  await page.waitForSelector(".modal-bg.show:has-text('Invite a member')");
  await page.fill(".modal-bg.show input.field >> nth=0", "Njeri Again");
  await page.fill(".modal-bg.show input.field >> nth=1", "njeri@ignis.africa");
  await page.getByRole("button", { name: /send invite/i }).click();
  await page.waitForTimeout(2000);
  log("9. duplicate invite toast:", (await toasts()).slice(0, 150));
  await page.keyboard.press("Escape");
  await page.locator(".modal-bg.show").click({ position: { x: 5, y: 5 } }).catch(() => {});
  await page.waitForTimeout(400);

  // 10 — regression: requisition flow still works with enforcement ON
  await page.click(".nav-item.has-sub:has-text('Procurement')");
  await page.waitForTimeout(400);
  await page.getByRole("button", { name: /new requisition/i }).first().click();
  await page.waitForSelector(".modal-bg.show");
  await page.locator(".modal-bg.show input.field").first().fill("Regression check");
  await page.selectOption(".modal-bg.show select.field >> nth=0", "Admin");
  await page.fill(".modal-bg.show input[type=number]", "3000");
  await page.getByRole("button", { name: /submit requisition/i }).click();
  await page.waitForTimeout(2000);
  log("10. requisition (enforcement on):", (await toasts()).slice(0, 120));

  // 11 — reload persistence
  await page.reload({ waitUntil: "networkidle" });
  await page.waitForTimeout(2500);
  await page.click(".nav-item.has-sub:has-text('Inventory')");
  await page.waitForTimeout(500);
  const persist = await page.$$eval("#inventory .task", (els) => els.map((e) => e.textContent.replace(/\s+/g, " ").slice(0, 60)));
  log("11. after reload, needs-attention:", JSON.stringify(persist.slice(0, 2)));
  await page.screenshot({ path: SHOT("9-reload") });
} finally {
  await browser.close();
}
