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
