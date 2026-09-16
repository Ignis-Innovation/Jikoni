// Run a Vercel cron handler locally (they don't run under `npm run dev`).
// Loads .env.local, imports the handler, and calls it with a fake req/res.
//
// Usage:
//   node scripts/run-cron-local.mjs advance-reminder --dry            # who WOULD be chased (no send)
//   node scripts/run-cron-local.mjs advance-reminder --dry --days=0   # treat any issued advance as due
//   node scripts/run-cron-local.mjs advance-reminder --test=you@x.com # send ONE sample email
//   node scripts/run-cron-local.mjs advance-reminder --days=0         # REAL run: emails holders + bells
//   node scripts/run-cron-local.mjs bill-reminder --dry
//   node scripts/run-cron-local.mjs weekly-reminder --test=you@x.com
import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { pathToFileURL } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");

// minimal .env.local loader (KEY=VALUE, strips optional quotes)
for (const line of readFileSync(resolve(root, ".env.local"), "utf8").split("\n")) {
  const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/i);
  if (!m) continue;
  let v = m[2].trim();
  if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1);
  if (!(m[1] in process.env)) process.env[m[1]] = v;
}

const [name, ...flags] = process.argv.slice(2);
if (!name) { console.error("Usage: node scripts/run-cron-local.mjs <advance-reminder|bill-reminder|weekly-reminder> [--dry] [--test=email] [--days=N]"); process.exit(1); }

const dry = flags.includes("--dry");
const testFlag = flags.find((f) => f.startsWith("--test="));
const daysFlag = flags.find((f) => f.startsWith("--days="));
if (daysFlag) process.env.ADVANCE_CHASE_DAYS = daysFlag.split("=")[1];

const req = {
  headers: { authorization: `Bearer ${process.env.CRON_SECRET || ""}` },
  query: { ...(dry ? { dry: "1" } : {}), ...(testFlag ? { test: testFlag.split("=")[1] } : {}) },
};
const res = {
  status(code) { this._code = code; return this; },
  json(obj) { console.log(`HTTP ${this._code}\n` + JSON.stringify(obj, null, 2)); return this; },
};

const mod = await import(pathToFileURL(resolve(root, `api/${name}.js`)).href);
await mod.default(req, res);
