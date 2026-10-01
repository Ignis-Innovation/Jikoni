// Renders the template invoice (IGN-2026-SF-001 content; variants: kes-vat-part, long, goods-tc) through src/lib/invoicePdf.ts
// under Node, writes it to the path given (default ./invoice-sample.pdf) and checks
// the key text is present. Run: node --experimental-strip-types scripts/test-invoice-pdf.mjs out.pdf
import { readFileSync, writeFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { buildInvoicePdf } from "../src/lib/invoicePdf.ts";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const loader = async (p) => { const b = readFileSync(resolve(root, "public", p.replace(/^\//, ""))); return b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength); };
const variant = process.argv[3] || "template";

const TC = `1. All prices are inclusive of applicable VAT.
2. Delivery within 1–2 working days of order confirmation, subject to stock availability and delivery location.
3. Products carry a 1-year manufacturer's warranty, subject to the applicable warranty terms. This invoice serves as proof of purchase.
4. Goods remain the property of Ignis Innovation Limited until paid for in full.
5. Customers should report any damage, defects or incorrect items upon delivery. Returns and warranty claims are subject to applicable terms and conditions.
6. Any invoice discrepancies should be reported within 7 days of receipt.`;
const base = {
  number: "IGN-INV-2026-001", status: "issued", invoiceDate: "2026-09-28", dueDate: "2026-10-12", terms: 14,
  customer: "Keystone Agribusiness Consultants Ltd", billToAddress: "Nairobi, Kenya", billToContact: "Elijah Kang'ara",
  engagementRef: "SF-TA-2026-001, Phase 3 financial modelling workstream (Solar Freeze Ltd investment readiness)",
  currency: "USD",
  lines: [
    { title: "Integrated Financial Model (FINMOD v2.0 FINAL)", description: "Five-year integrated model built on the FY26 audited statements: scenario architecture, data request design and integration of Solar Freeze responses (15 Sep 2026), audit reconciliation workings, funding requirement derivation, raise justification, returns analysis, pitch reconciliation and executive dashboard, with a full change log.", qty: 1, unitPrice: 1750, amount: 1750 },
    { title: "Go-To-Market Model (v0.7 FINAL)", description: "Scenario-aligned GTM workbook: evidence-based market sizing (TAM, SAM, SOM with affordability screen), sector benchmarks, product-level builds for all four lines, fleet-actuals evidence base and twelve-month KPI targets.", qty: 1, unitPrice: 1250, amount: 1250 },
    { title: "Investor Pitch Deck (Aurora Trust, Sep 2026)", description: "Fifteen-slide investor presentation supporting the GBP 750,000 blended raise, rebuilt on audited figures with staged drawdown structure, milestone framework, use of funds and risk disclosure, in Solar Freeze brand.", qty: 1, unitPrice: 750, amount: 750 },
  ],
  subtotal: 3750, vatApplicable: false, vatRate: 0, vat: 0, total: 3750, paid: 0,
  notes: "All three deliverables were issued to Keystone on or before 24 September 2026 under the Phase 3 workstream of engagement SF-TA-2026-001. Amounts are exclusive of any applicable taxes. Payment is due within 14 days of the invoice date; late payment may attract interest at 1.5% per month.",
  paymentDetails: { account_name: "Ignis Innovation Ltd", bank: "KCB Bank Kenya", account_no: "1342100026", branch: "Sarit Centre" },
  paymentNote: "Mobile money by arrangement. Please quote invoice number {no} on payment.",
  from: { company: "Ignis Innovation Limited", address: "Nairobi, Kenya", email: "info@ignis-innovation.com", phone: "+254 724 326 256" },
};
const inv = variant === "kes-vat-part"
  ? { ...base, number: "IGN-INV-2026-002", currency: "KES", poNumber: "PO-4471", vatApplicable: true, vatRate: 16,
      lines: [{ title: "Training", description: "Cookstove operator training", qty: 2, unitPrice: 25000, amount: 50000 }],
      subtotal: 50000, vat: 8000, total: 58000, paid: 20000, status: "partially_paid",
      paymentDetails: { account_name: "Ignis Innovation Ltd", bank: "KCB Bank Kenya", account_no: "KES-ACCT-TEST", branch: "Sarit Centre" } }
  : variant === "long"
  ? { ...base, number: "IGN-INV-2026-003", lines: Array.from({ length: 14 }, (_, i) => ({ ...base.lines[i % 3] })), subtotal: 17500, total: 17500 }
  : variant === "goods-tc"
  ? { ...base, number: "IGN-INV-2026-004", currency: "KES", terms: null, dueDate: null, engagementRef: null,
      customer: "Mama Mboga Traders", billToAddress: "Kawangware, Nairobi", billToContact: "Grace Achieng",
      lines: [{ title: "Ignis cookstove (2-burner)", description: "Clean-cooking stove, includes installation", qty: 4, unitPrice: 6500, amount: 26000 }],
      vatApplicable: true, vatRate: 16, vatInclusive: true, subtotal: 22413.79, vat: 3586.21, total: 26000, notes: null,
      paymentDetails: { account_name: "Ignis Innovation Limited", bank: "KCB Bank Kenya", account_no: "1342100093", branch: "Sarit Centre" },
      termsConditions: TC }
  : base;

const doc = await buildInvoicePdf(inv, loader);
const out = process.argv[2] || "invoice-sample.pdf";
writeFileSync(out, Buffer.from(doc.output("arraybuffer")));
console.log(`wrote ${out} · ${doc.getNumberOfPages()} page(s)`);
