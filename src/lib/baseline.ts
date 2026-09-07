// IRENA – Taita Taveta A2CT baseline — the authoritative figures transcribed from
// the analyst deliverable "Baseline_Analysis_Companion_Workbook.xlsx" (Executive
// Dashboard, Derived Energy Consumption, Cross-Cutting Analysis sheets). Ported
// from the clean-cook-iq programme dashboard. These are static analysis outputs
// (electricity access %, fuel %, survey populations) that back the 409 surveyed
// institutions, so the IRENA Overview charts render without any DB dependency.

export type DatasetGroup = {
  key: string;
  title: string;
  records: number;
  primaryFuel: string;
  electricityAccess: string;
  keyPopulation: string;
};

export const DATASET_GROUPS: DatasetGroup[] = [
  { key: "learning", title: "Learning Institutions", records: 197,
    primaryFuel: "Firewood 90.4%", electricityAccess: "83.76%",
    keyPopulation: "59,913 students (mean 304)" },
  { key: "catering", title: "Catering Outlets (SMEs)", records: 195,
    primaryFuel: "Charcoal 58.46%", electricityAccess: "65.64%",
    keyPopulation: "195 businesses; 102 female-owned" },
  { key: "health", title: "Health Facilities", records: 12,
    primaryFuel: "LPG 66.67%", electricityAccess: "100.00%",
    keyPopulation: "533 beds across 12 facilities" },
  { key: "correctional", title: "Correctional Institutions", records: 5,
    primaryFuel: "Firewood 100%", electricityAccess: "100.00%",
    keyPopulation: "4,520 inmates (all 5 county prisons)" },
];

// Table 19 — estimated annual fuel & electricity consumption, by category.
export const ENERGY_BY_CATEGORY = [
  { category: "Learning Institutions", fuelTonnes: 2585.21, elecKwh: 717143.48 },
  { category: "Catering Outlets (SMEs)", fuelTonnes: 503.73, elecKwh: 163174.43 },
  { category: "Health Facilities", fuelTonnes: 72.19, elecKwh: 610695.65 },
  { category: "Correctional Institutions", fuelTonnes: 864.8, elecKwh: 269217.39 },
];
// Figure 8 — geographic distribution by sub-county across all 409 records.
export const GEO_DISTRIBUTION = [
  { subCounty: "Voi", records: 132 },
  { subCounty: "Taveta", records: 113 },
  { subCounty: "Mwatate", records: 92 },
  { subCounty: "Wundanyi", records: 65 },
  { subCounty: "Unspecified", records: 7 },
];

// Figure 4 — primary cooking fuel type by institutional category (% of category).
export const FUEL_MIX_BY_CATEGORY = [
  { category: "Learning Institutions", firewood: 90.36, charcoal: 3.05, lpg: 1.02, other: 5.58 },
  { category: "Catering Outlets (SMEs)", firewood: 22.05, charcoal: 58.46, lpg: 6.67, other: 12.82 },
  { category: "Health Facilities", firewood: 0, charcoal: 16.67, lpg: 66.67, other: 16.67 },
  { category: "Correctional Institutions", firewood: 100, charcoal: 0, lpg: 0, other: 0 },
];

// Figure 2 — electricity access rate by category (% electrified).
export const ELECTRICITY_ACCESS_BY_CATEGORY = [
  { category: "Learning Institutions", accessPct: 83.76 },
  { category: "Catering Outlets (SMEs)", accessPct: 65.64 },
  { category: "Health Facilities", accessPct: 100 },
  { category: "Correctional Institutions", accessPct: 100 },
];

export const BASELINE_META = {
  title: "IRENA – Taita Taveta",
  subtitle: "Institutional & Commercial Clean Cooking Market Strengthening Project",
  organisation: "Ignis Innovation Limited",
  reference: "IRENA Reference: PR/2026/00239 | PO/2026/00749",
  period: "Jan–Mar 2026",
  subCounties: "Voi, Taveta, Mwatate, Wundanyi",
  programme: "A2CT — Accelerating County Cooking Transitions",
  totalRecords: 409,
};

// Short axis labels — the full category names are too long under narrow columns.
export const ENERGY_SHORT: Record<string, string> = {
  "Learning Institutions": "Learning",
  "Catering Outlets (SMEs)": "Catering",
  "Health Facilities": "Health",
  "Correctional Institutions": "Correctional",
};

// Matches the IRENA – Taita Taveta project by name (tolerant of dash/spacing).
export function matchesIrena(name: string | null | undefined): boolean {
  if (!name) return false;
  const n = name.toLowerCase();
  return n.includes("irena");
}
