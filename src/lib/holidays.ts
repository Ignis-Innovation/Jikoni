// Kenyan public holidays. Static reference data — no DB/RLS needed.
// NOTE: Islamic holidays (Idd-ul-Fitr, Idd-ul-Azha) are moon-sighting dependent,
// so their dates here are the widely-published estimates and may shift by a day.
// Shared by the Calendar page and the holiday-greeting email sender.

export type Holiday = { date: string; name: string }; // date is ISO "YYYY-MM-DD"

export const HOLIDAYS: Holiday[] = [
  { date: "2026-01-01", name: "New Year's Day" },
  { date: "2026-03-20", name: "Idd-ul-Fitr" },
  { date: "2026-04-03", name: "Good Friday" },
  { date: "2026-04-06", name: "Easter Monday" },
  { date: "2026-05-01", name: "Labour Day" },
  { date: "2026-05-27", name: "Idd-ul-Azha" },
  { date: "2026-06-01", name: "Madaraka Day" },
  { date: "2026-10-10", name: "Mazingira Day" },
  { date: "2026-10-20", name: "Mashujaa Day" },
  { date: "2026-12-12", name: "Jamhuri Day" },
  { date: "2026-12-25", name: "Christmas Day" },
  { date: "2026-12-26", name: "Boxing Day" },
];

const BY_DATE = new Map(HOLIDAYS.map((h) => [h.date, h]));

/** Format a Date as a local "YYYY-MM-DD" key (avoids UTC off-by-one). */
export function isoDate(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

/** Returns the holiday on the given date (Date or "YYYY-MM-DD"), or undefined. */
export function holidayOn(date: Date | string): Holiday | undefined {
  const key = typeof date === "string" ? date : isoDate(date);
  return BY_DATE.get(key);
}

export function isHoliday(date: Date | string): boolean {
  return holidayOn(date) !== undefined;
}

/**
 * Count working days between two ISO dates (inclusive), excluding weekends
 * (Sat/Sun) and public holidays. Used to size a leave request. Returns 0 if the
 * range is invalid (end before start).
 */
export function workingDaysBetween(startIso: string, endIso: string): number {
  if (!startIso || !endIso) return 0;
  const start = new Date(startIso + "T00:00:00");
  const end = new Date(endIso + "T00:00:00");
  if (end < start) return 0;
  let count = 0;
  for (const d = new Date(start); d <= end; d.setDate(d.getDate() + 1)) {
    const dow = d.getDay();
    if (dow === 0 || dow === 6) continue; // weekend
    if (isHoliday(isoDate(d))) continue; // public holiday
    count++;
  }
  return count;
}
