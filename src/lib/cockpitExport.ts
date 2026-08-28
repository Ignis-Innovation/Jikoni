// Weekly reports → the Q3 Cockpit workbook (true .xlsx, styling preserved).
//
// We load the real template shipped at /public/templates/Q3_2026_Cockpit.xlsx and
// only write cell VALUES into it — every style, merge, colour and the 39 conditional-
// formatting rules (which drive the RAG green/amber/red) survive the round-trip
// untouched. Each week's submissions are filed into that week's block on the
// "3. Weekly Run-Sheet": week 9's reports go into the WEEK 9 block, week 10 into
// WEEK 10, and so on — matching how the cockpit is kept by hand.
//
// The run-sheet models the five-person leadership cockpit (Dennis, Elizabeth, Wilson,
// Joan, Brian). App submissions are matched to those rows by first name; staff outside
// the five don't appear on the run-sheet (the on-screen HR view covers everyone).
//
// Security: exceljs writes a string value as a string-typed cell (t="s"/"str"), never
// a <f> formula, so a submission like "=cmd|..." is stored as literal text and is NOT
// evaluated on open (verified). We therefore keep content exact and never assign a
// {formula} object — see cellText().

import type { WeeklyReport } from "../store";
import { REPORT_TRACKS, ReportTrack, reportTrackLabel } from "../data";

const TEMPLATE_URL = "/templates/Q3_2026_Cockpit.xlsx";
const SHEET = "3. Weekly Run-Sheet";

// Run-sheet geometry (reverse-engineered + verified against the template):
// WEEK N header row = 4 + 14·(N-1); people rows = header + 7 … +11.
const QUARTER_W1 = Date.parse("2026-06-29T00:00:00Z"); // Monday of WEEK 1
const BLOCK_ROWS = 14;
const WEEK1_HEADER_ROW = 4;
const PERSON_ROW_OFFSET = 7; // first leadership row, relative to the WEEK header
const MAX_WEEK = 13;

// Person-row cells already wrap (wrapText:true) but the template pins every row to
// 31.5pt, so long report content gets clipped/squeezed. We grow each filled row to
// fit its wrapped content — columns keep their template widths, so the rest of the
// sheet is untouched. Widths (chars) mirror the template's run-sheet columns.
const COL_WIDTH: Record<string, number> = { C: 20, D: 18, E: 11, F: 22, G: 24, H: 18 };
const LINE_PT = 13;      // ~points per wrapped line at the sheet's ~9-10pt font
const MIN_ROW_H = 31.5;  // the template's default person-row height
const MAX_ROW_H = 340;   // cap so one huge cell can't blow up the page
// Wrapped-line count for a cell's text at its column width.
const linesFor = (text: string, col: string) => {
  const w = Math.max(6, COL_WIDTH[col] ?? 18);
  return String(text || "").split("\n").reduce((n, ln) => n + Math.max(1, Math.ceil(ln.length / w)), 0);
};
// Row height that fits the tallest cell across the columns we wrote.
const rowHeightFor = (vals: Record<string, string>) => {
  const lines = Math.max(1, ...Object.entries(vals).map(([col, v]) => linesFor(v, col)));
  return Math.min(MAX_ROW_H, Math.max(MIN_ROW_H, Math.round(lines * LINE_PT + 6)));
};

// The five fixed leadership rows, in the order they appear in every week block.
// `match` is tested (lower-cased) against the start of the report author's name.
const COCKPIT_PEOPLE = [
  { match: "dennis", driving: "Partnerships" },
  { match: "elizabeth", driving: "Revenue" },
  { match: "wilson", driving: "Programmes" },
  { match: "joan", driving: "Team" },
  { match: "brian", driving: "Team" },
] as const;

// Which run-sheet column each track answer feeds. Index = question order in
// REPORT_TRACKS. Columns: C This week's commitment · D Actual/progress ·
// F Blocker · G Next action → owner · H Ask. Answers that share a column are
// stacked (newline-joined), each prefixed with its question for readability.
const TRACK_COLMAP: Record<ReportTrack, ("C" | "D" | "F" | "G" | "H")[]> = {
  // shipped, blocked+why, uptime/incidents, next-week commitments, ask
  technology: ["D", "F", "D", "C", "H"],
  // revenue&pipeline, deals advanced, deal stalled >14d, one win, one ask
  pipeline: ["D", "D", "F", "D", "H"],
  // five CEO dashboard numbers
  leadership: ["D", "D", "D", "D", "D"],
};
// Which answer index carries the blocker (drives the RAG when a blocker is named).
const TRACK_BLOCKER_IDX: Record<ReportTrack, number> = { technology: 1, pipeline: 2, leadership: -1 };

// Guarantee a plain string primitive reaches exceljs (never a number/formula object).
const cellText = (v: unknown): string => (v == null ? "" : String(v)).trim();
const has = (v: string | null | undefined): boolean => !!v && !!v.trim();

// Defense-in-depth against spreadsheet formula injection. exceljs already stores
// these as string cells (t="s"), never <f> formulas, so "=cmd|..." is inert on open
// (verified) — but a downstream CSV re-export could re-interpret a leading =/+/@ as a
// formula, so we quote-prefix those. A leading "-" is left as-is: it's overwhelmingly
// prose/bullets, and a string cell can't execute it anyway.
const sheetSafe = (v: string | undefined): string | undefined =>
  v != null && /^[=+@]/.test(v) ? "'" + v : v;

// ISO Monday (YYYY-MM-DD) → quarter week number, or null if outside the quarter.
function weekNumberOf(weekStart: string): number | null {
  const t = Date.parse(weekStart + "T00:00:00Z");
  if (Number.isNaN(t)) return null;
  const days = Math.round((t - QUARTER_W1) / 86400000);
  if (days < 0 || days % 7 !== 0) return null; // not a quarter-aligned Monday
  const n = days / 7 + 1;
  return n >= 1 && n <= MAX_WEEK ? n : null;
}

type CellMap = { C?: string; D?: string; F?: string; G?: string; H?: string; rag: "Green" | "Amber" | "Red" };

// Map one submitted report onto the run-sheet columns.
function rowFromReport(r: WeeklyReport): CellMap {
  const stack: Record<"C" | "D" | "F" | "G" | "H", string[]> = { C: [], D: [], F: [], G: [], H: [] };
  let blocker = false;

  if (r.answers && r.answers.length && r.track && r.track in REPORT_TRACKS) {
    const track = r.track as ReportTrack;
    const cols = TRACK_COLMAP[track];
    const blockerIdx = TRACK_BLOCKER_IDX[track];
    r.answers.forEach((a, i) => {
      const col = cols[i] ?? "D";
      const ans = cellText(a.a);
      if (!ans) return;
      // Single-purpose columns (F/C/H) take the bare answer; the multi-line
      // Actual column (D) keeps the question label so five lines stay legible.
      stack[col].push(col === "D" ? `${cellText(a.q)}: ${ans}` : ans);
      if (i === blockerIdx) blocker = true;
    });
  } else {
    // Legacy free-text report.
    if (has(r.did)) stack.D.push(cellText(r.did));
    if (has(r.blockers)) { stack.F.push(cellText(r.blockers)); blocker = true; }
    if (has(r.nextWeek)) stack.G.push(cellText(r.nextWeek));
  }

  const join = (k: keyof typeof stack) => (stack[k].length ? stack[k].join("\n") : undefined);
  return { C: join("C"), D: join("D"), F: join("F"), G: join("G"), H: join("H"), rag: blocker ? "Amber" : "Green" };
}

export type CockpitExportResult = { weeksFilled: number[]; skippedAuthored: number[] };

/**
 * Build and download the cockpit workbook for the given reports.
 * Only weeks whose people block is still blank in the template are filled, so the
 * hand-authored history (weeks 1–8) is never clobbered.
 */
export async function exportCockpit(reports: WeeklyReport[]): Promise<CockpitExportResult> {
  const ExcelJS = (await import("exceljs")).default;

  const res = await fetch(TEMPLATE_URL);
  if (!res.ok) throw new Error(`Could not load the cockpit template (${res.status})`);
  const buf = await res.arrayBuffer();

  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(buf);
  const ws = wb.getWorksheet(SHEET);
  if (!ws) throw new Error(`Template is missing the "${SHEET}" sheet`);

  // Group reports by quarter week number (ignoring anything outside the quarter).
  const byWeek = new Map<number, WeeklyReport[]>();
  for (const r of reports) {
    const n = weekNumberOf(r.weekStart);
    if (n == null) continue;
    const list = byWeek.get(n) ?? [];
    list.push(r);
    byWeek.set(n, list);
  }

  const weeksFilled: number[] = [];
  const skippedAuthored: number[] = [];

  for (const [n, weekReports] of [...byWeek.entries()].sort((a, b) => a[0] - b[0])) {
    const headerRow = WEEK1_HEADER_ROW + BLOCK_ROWS * (n - 1);
    const firstPersonRow = headerRow + PERSON_ROW_OFFSET;

    // Protect authored history: skip any block that already has content we didn't write.
    const authored = COCKPIT_PEOPLE.some((_, i) => {
      const row = firstPersonRow + i;
      return has(cellText(ws.getCell(`C${row}`).value)) || has(cellText(ws.getCell(`D${row}`).value));
    });
    if (authored) { skippedAuthored.push(n); continue; }

    COCKPIT_PEOPLE.forEach((person, i) => {
      const row = firstPersonRow + i;
      const report = weekReports.find((r) => cellText(r.author).toLowerCase().startsWith(person.match));
      const vals: Record<string, string> = {};
      const set = (col: string, val: string | undefined) => {
        if (val === undefined) return;
        ws.getCell(`${col}${row}`).value = val; // keeps the cell's existing wrapText style
        vals[col] = val ?? "";
      };

      if (report) {
        const m = rowFromReport(report);
        set("C", sheetSafe(m.C) ?? "");
        set("D", sheetSafe(m.D) ?? "");
        set("E", m.rag); // fixed vocabulary (Green/Amber/Red) — drives conditional formatting
        set("F", sheetSafe(m.F) ?? "");
        set("G", sheetSafe(m.G) ?? "");
        set("H", sheetSafe(m.H) ?? "");
      } else {
        // Same convention the template itself uses for a missing report.
        set("D", "NO REPORT SUBMITTED");
        set("E", "Red");
      }
      // Grow the row so the wrapped content isn't squeezed.
      ws.getRow(row).height = rowHeightFor(vals);
    });
    weeksFilled.push(n);
  }

  const out = await wb.xlsx.writeBuffer();
  const blob = new Blob([out], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" });
  const url = URL.createObjectURL(blob);
  const label = weeksFilled.length ? `w${weeksFilled[weeksFilled.length - 1]}` : "current";
  const a = document.createElement("a");
  a.href = url;
  a.download = `Q3_2026_Cockpit_${label}.xlsx`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);

  return { weeksFilled, skippedAuthored };
}

// Small helper so callers can label the current-week track column consistently.
export { reportTrackLabel };
