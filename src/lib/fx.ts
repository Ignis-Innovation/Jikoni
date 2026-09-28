// Live USD → KES exchange rate. The whole system stores money in KES (the base
// currency); this lets the UI accept a USD budget and show USD views at the
// *current* rate. Fetched once via our own /api/fx-rate (the CSP blocks calling the
// FX provider from the browser; the direct call is kept for local vite dev) and
// cached for the session. Falls back to a recent rate if both calls fail.
import { useEffect, useState } from "react";

export const FALLBACK_USD_KES = 129.5; // recent rate, used only if the live fetch fails

let cached: number | null = null;
let inflight: Promise<number> | null = null;

export function getUsdKesRate(): Promise<number> {
  if (cached != null) return Promise.resolve(cached);
  if (!inflight) {
    const ok = (k: unknown) => typeof k === "number" && k > 0 ? k : null;
    inflight = fetch("/api/fx-rate").then((r) => r.json()).then((j) => ok(j?.rate))
      .catch(() => null)
      .then((k) => k ?? fetch("https://open.er-api.com/v6/latest/USD").then((r) => r.json()).then((j) => ok(j?.rates?.KES)).catch(() => null))
      .then((k) => { cached = k ?? FALLBACK_USD_KES; return cached; });
  }
  return inflight;
}

// React hook: returns the current USD→KES rate, or null while it's still loading.
export function useUsdKesRate(): number | null {
  const [rate, setRate] = useState<number | null>(cached);
  useEffect(() => {
    let on = true;
    getUsdKesRate().then((r) => { if (on) setRate(r); });
    return () => { on = false; };
  }, []);
  return rate;
}
