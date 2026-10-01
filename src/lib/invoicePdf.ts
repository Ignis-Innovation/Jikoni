// Ignis invoice PDF — vector layout that reproduces the approved template
// (Ignis_Invoice_IGN-2026-SF-001): orange top rule, logo + INVOICE title, mint
// details panel, BILLED TO / FROM, green-header line table, green/orange TOTAL DUE
// bar, payment details panel, notes, footer. Brand fonts (Montserrat headings,
// Open Sans body) are embedded from /fonts. Self-contained (no app imports) so it
// can also run under Node for tests.
import { jsPDF } from "jspdf";

export interface InvoicePdfBank { account_name?: string; bank?: string; account_no?: string; branch?: string; swift?: string }
export interface InvoicePdfFrom { company?: string; signatory?: string; address?: string; email?: string; phone?: string }
export interface InvoicePdfData {
  number: string;                 // IGN-INV-YYYY-NNN (or DRAFT-xxxx)
  status: string;                 // draft | issued | partially_paid | paid | overdue | cancelled
  invoiceDate: string;            // ISO date
  dueDate: string | null;
  terms: number | null;           // days; null = no terms / due date (row omitted)
  customer: string; billToAddress?: string | null; billToContact?: string | null; billToEmail?: string | null;
  engagementRef?: string | null; poNumber?: string | null;
  currency: string;
  lines: { title: string; description: string; qty: number; unitPrice: number; amount: number }[];
  subtotal: number; vatApplicable: boolean; vatRate: number; vat: number; total: number; paid: number;
  vatInclusive?: boolean;         // line amounts already include VAT (subtotal = excl. VAT)
  notes?: string | null;
  paymentDetails: InvoicePdfBank | null;   // null → section omitted
  paymentNote?: string | null;              // "{no}" is replaced with the invoice number
  from: InvoicePdfFrom;
  termsConditions?: string | null;          // optional T&C section (product sales)
}

// Asset loader — the browser fetches from /public; tests pass a filesystem reader.
export type AssetLoader = (path: string) => Promise<ArrayBuffer>;
const browserLoader: AssetLoader = async (p) => {
  const r = await fetch(p);
  if (!r.ok) throw new Error(`Could not load ${p}`);
  return r.arrayBuffer();
};

const FONTS = [
  ["Montserrat", "bold", "/fonts/Montserrat-Bold.ttf"],
  ["Montserrat", "semibold", "/fonts/Montserrat-SemiBold.ttf"],
  ["OpenSans", "normal", "/fonts/OpenSans-Regular.ttf"],
  ["OpenSans", "semibold", "/fonts/OpenSans-SemiBold.ttf"],
] as const;
const LOGO = "/ignis-logo.png";

let cache: Promise<{ fonts: string[]; logo: Uint8Array | null }> | null = null;
function toB64(buf: ArrayBuffer): string {
  const bytes = new Uint8Array(buf); let bin = "";
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(bin);
}
function loadAssets(loader: AssetLoader) {
  if (!cache || loader !== browserLoader) {
    const p = (async () => {
      const fonts = await Promise.all(FONTS.map(([, , path]) => loader(path).then(toB64).catch(() => "")));
      const logo = await loader(LOGO).then((b) => new Uint8Array(b)).catch(() => null);
      return { fonts, logo };
    })();
    if (loader === browserLoader) cache = p;
    return p;
  }
  return cache;
}

// ---------- brand ----------
const ORANGE: [number, number, number] = [224, 123, 57];   // #E07B39
const GREEN: [number, number, number] = [26, 71, 49];      // #1A4731
const MINT: [number, number, number] = [234, 244, 238];    // #EAF4EE
const ZEBRA: [number, number, number] = [248, 249, 246];   // #F8F9F6
const RULE: [number, number, number] = [229, 231, 235];    // #E5E7EB
const INK: [number, number, number] = [55, 65, 70];
const MUTED: [number, number, number] = [120, 126, 134];

const money = (n: number) => (Math.round(n * 100) / 100).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const longDate = (iso: string | null) => {
  if (!iso) return "—";
  const d = new Date(String(iso).slice(0, 10) + "T00:00:00Z");
  return d.toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric", timeZone: "UTC" });
};
const termsText = (t: number) => t === 0 ? "Due on receipt" : `Net ${t} days`;

export async function buildInvoicePdf(inv: InvoicePdfData, loader: AssetLoader = browserLoader): Promise<jsPDF> {
  const { fonts, logo } = await loadAssets(loader);
  const doc = new jsPDF({ unit: "pt", format: "a4" });
  const haveFonts = fonts.every(Boolean);
  if (haveFonts) {
    FONTS.forEach(([fam, style, path], i) => {
      const file = path.split("/").pop()!;
      doc.addFileToVFS(file, fonts[i]);
      doc.addFont(file, fam, style);
    });
  }
  const head = (style: "bold" | "semibold" = "bold") => haveFonts ? doc.setFont("Montserrat", style) : doc.setFont("helvetica", "bold");
  const body = (style: "normal" | "semibold" = "normal") => haveFonts ? doc.setFont("OpenSans", style) : doc.setFont("helvetica", style === "semibold" ? "bold" : "normal");
  const color = (c: [number, number, number]) => doc.setTextColor(c[0], c[1], c[2]);
  const fill = (c: [number, number, number]) => doc.setFillColor(c[0], c[1], c[2]);

  const W = 595.28, H = 841.89, L = 57, R = W - 57, CW = R - L;
  const BOTTOM = H - 50;               // keep clear of the footer
  const cur = inv.currency;
  const incl = inv.vatApplicable && !!inv.vatInclusive;
  const from = inv.from || {};

  // ---------- page chrome ----------
  const chrome = () => {
    fill(ORANGE); doc.rect(0, 0, W, 5, "F");
    body(); doc.setFontSize(7.5); color(MUTED);
    doc.text([from.company, from.address].filter(Boolean).join("  ·  "), L, H - 36);
    doc.text(inv.number, R, H - 36, { align: "right" });
  };
  const newPage = () => { doc.addPage(); chrome(); return 40; };
  chrome();

  // ---------- header ----------
  if (logo) doc.addImage(logo, "PNG", L, 53, 84, 84 * 178 / 281);
  head(); doc.setFontSize(22); color(ORANGE);
  doc.text("INVOICE", R, 72, { align: "right" });
  body(); doc.setFontSize(9.5); color(INK);
  doc.text(from.company || "", R, 86, { align: "right" });
  doc.setFontSize(8.5); color(MUTED);
  if (from.address) doc.text(from.address, R, 98, { align: "right" });
  const contact = [from.email, from.phone].filter(Boolean).join(" | ");
  if (contact) doc.text(contact, R, 110, { align: "right" });
  const stamp = inv.status === "draft" ? "DRAFT — NOT ISSUED" : inv.status === "cancelled" ? "CANCELLED" : inv.status === "paid" ? "PAID" : "";
  if (stamp) { head("semibold"); doc.setFontSize(8); color(inv.status === "paid" ? GREEN : MUTED); doc.text(stamp, R, 122, { align: "right" }); }

  // ---------- details panel ----------
  body(); doc.setFontSize(9.5);
  const rows: [string, string, string?, string?][] = [
    ["Invoice number", inv.number, "Invoice date", longDate(inv.invoiceDate)],
  ];
  if (inv.terms != null) rows.push(["Payment terms", termsText(inv.terms), "Due date", longDate(inv.dueDate)]);
  if (inv.poNumber) rows.push(["PO number", inv.poNumber]);
  const engLines = inv.engagementRef ? doc.splitTextToSize(inv.engagementRef, R - 12 - 150) as string[] : [];
  const panelTop = 128, rowH = 21, lh = 13;
  const lastBase = 15 + (rows.length - 1) * rowH + (engLines.length ? rowH + (engLines.length - 1) * lh : 0);
  const panelH = lastBase + 12;
  fill(MINT); doc.rect(L, panelTop, CW, panelH, "F");
  let y = panelTop + 15;
  for (const [l1, v1, l2, v2] of rows) {
    color(INK); doc.text(l1, L + 7, y); doc.text(v1, L + 93, y);
    if (l2) { doc.text(l2, L + 297, y); doc.text(v2 || "", L + 369, y); }
    y += rowH;
  }
  if (engLines.length) { doc.text("Engagement", L + 7, y); doc.text(engLines, L + 93, y, { lineHeightFactor: 1.35 }); }
  y = panelTop + panelH + 22;

  // ---------- billed to / from ----------
  const label = (t: string, x: number, yy: number) => { head(); doc.setFontSize(7.5); color(ORANGE); doc.text(t, x, yy); };
  label("BILLED TO", L, y); label("FROM", L + 240, y);
  body(); doc.setFontSize(9.5); color(INK);
  const billTo = [inv.customer, ...(inv.billToAddress || "").split(/\n/), inv.billToContact ? `Attn: ${inv.billToContact}` : "", inv.billToEmail || ""]
    .map((s) => s.trim()).filter(Boolean).flatMap((s) => doc.splitTextToSize(s, 225) as string[]);
  // FROM is the company only — no personal name (client request, Sept 2026)
  const fromBlock = [from.company, ...(from.address || "").split(/\n/)]
    .map((s) => (s || "").trim()).filter(Boolean).flatMap((s) => doc.splitTextToSize(s, 240) as string[]);
  doc.text(billTo, L, y + 20, { lineHeightFactor: 1.4 });
  doc.text(fromBlock, L + 240, y + 20, { lineHeightFactor: 1.4 });
  y = y + 20 + Math.max(billTo.length, fromBlock.length) * 13.3 + 10;

  // ---------- line items ----------
  const showQty = inv.lines.some((l) => l.qty !== 1);
  const X = { n: L + 7, del: L + 34, desc: L + 152, qty: R - 118, amt: R - 7 };
  const delW = X.desc - X.del - 10;
  const descW = (showQty ? X.qty - 80 : R - 88) - X.desc;   // leave room for right-aligned "qty × unit"
  const tableHead = () => {
    fill(GREEN); doc.rect(L, y, CW, 22, "F");
    head("semibold"); doc.setFontSize(8.5); doc.setTextColor(255, 255, 255);
    doc.text("#", X.n, y + 14.5); doc.text("Deliverable", X.del, y + 14.5); doc.text("Description", X.desc, y + 14.5);
    if (showQty) doc.text("Qty × Unit", X.qty, y + 14.5, { align: "right" });
    doc.text(`Amount (${cur})`, X.amt, y + 14.5, { align: "right" });
    y += 22;
  };
  tableHead();
  body(); doc.setFontSize(9);
  inv.lines.forEach((ln, i) => {
    body(); doc.setFontSize(8.6);
    const d1 = doc.splitTextToSize(ln.title || "", delW) as string[];
    const d2 = doc.splitTextToSize(ln.description || "", descW) as string[];
    const h = Math.max(d1.length, d2.length, 1) * 11.6 + 14;
    if (y + h > BOTTOM) { y = newPage(); tableHead(); body(); doc.setFontSize(8.6); }
    if (i % 2 === 1) { fill(ZEBRA); doc.rect(L, y, CW, h, "F"); }
    color(INK);
    doc.text(String(i + 1), X.n, y + 15);
    doc.text(d1, X.del, y + 15, { lineHeightFactor: 1.35 });
    doc.text(d2, X.desc, y + 15, { lineHeightFactor: 1.35 });
    if (showQty) { color(MUTED); doc.text(`${ln.qty} × ${money(ln.unitPrice)}`, X.qty, y + 15, { align: "right" }); color(INK); }
    doc.text(money(ln.amount), X.amt, y + 15, { align: "right" });
    y += h;
    doc.setDrawColor(RULE[0], RULE[1], RULE[2]); doc.setLineWidth(0.6); doc.line(L, y, R, y);
  });

  // ---------- totals ----------
  const balance = Math.max(0, inv.total - inv.paid);
  const sub: [string, string][] = [];
  if (inv.vatApplicable || inv.paid > 0) sub.push([incl ? "Subtotal (excl. VAT)" : "Subtotal", `${cur} ${money(inv.subtotal)}`]);
  if (inv.vatApplicable) sub.push([incl ? `VAT (${inv.vatRate}%) included` : `VAT (${inv.vatRate}%)`, `${cur} ${money(inv.vat)}`]);
  if (inv.paid > 0) { sub.push(["Invoice total", `${cur} ${money(inv.total)}`]); sub.push(["Less: paid", `− ${cur} ${money(inv.paid)}`]); }
  if (y + 18 + sub.length * 16 + 34 > BOTTOM) y = newPage();
  y += 12;
  body(); doc.setFontSize(9.5);
  for (const [k, v] of sub) { color(MUTED); doc.text(k, R - 112, y + 4, { align: "right" }); color(INK); doc.text(v, X.amt, y + 4, { align: "right" }); y += 16; }
  if (sub.length) y += 4; else y += 6;
  const barH = 34, split = L + 240;
  fill(GREEN); doc.rect(L, y, split - L, barH, "F");
  fill(ORANGE); doc.rect(split, y, R - split, barH, "F");
  head(); doc.setTextColor(255, 255, 255);
  doc.setFontSize(12); doc.text(inv.paid > 0 ? "BALANCE DUE" : "TOTAL DUE", L + 10, y + 22);
  doc.setFontSize(14); doc.text(`${cur} ${money(inv.paid > 0 ? balance : inv.total)}`, R - 10, y + 22.5, { align: "right" });
  y += barH + 20;

  // ---------- payment details ----------
  const b = inv.paymentDetails;
  if (b && (b.account_no || b.bank)) {
    const bankRows: [string, string, string, string][] = [
      ["Account name", b.account_name || "", "Bank", b.bank || ""],
      [`Account no. (${cur})`, b.account_no || "", "Branch", b.branch || ""],
    ];
    if (b.swift) bankRows.push(["SWIFT", b.swift, "", ""]);
    const need = 16 + bankRows.length * 19 + 14 + 30;
    if (y + need > BOTTOM) y = newPage();
    label("PAYMENT DETAILS", L, y);
    y += 10;
    fill(MINT); doc.rect(L, y, CW, bankRows.length * 19 + 10, "F");
    body(); doc.setFontSize(9.5); color(INK);
    let by = y + 17;
    for (const [a, av, c, cv] of bankRows) {
      doc.text(a, L + 7, by); doc.text(av, L + 104, by);
      if (c) { doc.text(c, L + 248, by); doc.text(cv, L + 306, by); }
      by += 19;
    }
    y += bankRows.length * 19 + 10 + 18;
  }
  if (inv.paymentNote) {
    body(); doc.setFontSize(9.5); color(INK);
    const pn = doc.splitTextToSize(inv.paymentNote.replace(/\{no\}/g, inv.number), CW) as string[];
    if (y + pn.length * 13 > BOTTOM) y = newPage();
    doc.text(pn, L, y, { lineHeightFactor: 1.4 });
    y += pn.length * 13.3 + 14;
  }

  // ---------- notes ----------
  if (inv.notes && inv.notes.trim()) {
    body(); doc.setFontSize(9.5);
    const nt = doc.splitTextToSize(inv.notes.trim(), CW) as string[];
    if (y + 16 + nt.length * 13.3 > BOTTOM) y = newPage();
    label("NOTES", L, y);
    body(); doc.setFontSize(9.5); color(INK);
    doc.text(nt, L, y + 17, { lineHeightFactor: 1.4 });
    y += 17 + nt.length * 13.3 + 8;
  }

  // ---------- terms & conditions (optional) ----------
  if (inv.termsConditions && inv.termsConditions.trim()) {
    body(); doc.setFontSize(8.3);
    const tc = inv.termsConditions.trim().split(/\n/).flatMap((s) => doc.splitTextToSize(s.trim(), CW) as string[]);
    const tlh = 11.6;
    if (y + 16 + tc.length * tlh > BOTTOM) y = newPage();
    label("TERMS & CONDITIONS", L, y);
    body(); doc.setFontSize(8.3); color(MUTED);
    doc.text(tc, L, y + 15, { lineHeightFactor: 1.4 });
    y += 15 + tc.length * tlh + 8;
  }

  // ---------- sign-off ----------
  if (y + 10 > BOTTOM) y = newPage();
  head("semibold"); doc.setFontSize(10.5); color(GREEN);
  doc.text("Thank you for your business.", L, y + 8);

  doc.setProperties({ title: `Ignis Invoice ${inv.number}`, author: from.company || "Ignis Innovation Limited", subject: `Invoice ${inv.number} — ${inv.customer}` });
  return doc;
}

export const invoiceFileName = (no: string) => `Ignis_Invoice_${no}.pdf`;

export async function downloadInvoicePdf(inv: InvoicePdfData) {
  const doc = await buildInvoicePdf(inv);
  doc.save(invoiceFileName(inv.number));
}

export async function previewInvoicePdf(inv: InvoicePdfData) {
  // open the tab synchronously (popup blockers), then embed the generated blob in it
  const win = window.open("", "_blank");
  const doc = await buildInvoicePdf(inv);
  const url = URL.createObjectURL(doc.output("blob"));
  if (!win) { window.open(url, "_blank"); return; }
  const title = `Invoice ${inv.number}`.replace(/[<>&"]/g, "");
  win.document.write(`<!doctype html><html><head><title>${title}</title><style>html,body{margin:0;height:100%;background:#525659}iframe{border:0;width:100%;height:100%}</style></head><body><iframe src="${url}" title="${title}"></iframe></body></html>`);
  win.document.close();
}
