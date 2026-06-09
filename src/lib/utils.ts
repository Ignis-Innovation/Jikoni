import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

/** Format integer minor units + currency into a display string. */
export function formatMoney(minor: number | null | undefined, currency = "KES") {
  if (minor == null) return "—";
  return new Intl.NumberFormat("en-KE", { style: "currency", currency }).format(minor / 100);
}

export function formatDate(d: string | Date | null | undefined) {
  if (!d) return "—";
  return new Intl.DateTimeFormat("en-GB", { dateStyle: "medium" }).format(new Date(d));
}

export type Tone = "zinc" | "green" | "red" | "amber" | "blue";

/** Map a status/stage string to a semantic badge tone so the same value reads
 * the same colour everywhere (active = green, overdue = red, pending = amber…). */
export function statusTone(value: unknown): Tone {
  const v = String(value ?? "").toLowerCase().trim();
  if (!v) return "zinc";
  if (/(active|done|paid|won|accepted|approved|resolved|closed_won|deployed|filed|complete|completed|received)/.test(v))
    return "green";
  if (/(overdue|expired|lost|rejected|declined|terminated|cancelled|failed|urgent|critical|disposed)/.test(v))
    return "red";
  if (/(pending|draft|open|review|submitted|sent|in_progress|in progress|mitigating|partially|pursuing|high|maintenance)/.test(v))
    return "amber";
  if (/(issued|converted|upstream|downstream|new|normal|medium)/.test(v)) return "blue";
  return "zinc";
}
