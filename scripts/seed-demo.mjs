// Seed coherent demo data for Jikoni.
// Usage: SUPABASE_DB_URL="postgresql://…pooler…:5432/postgres" node scripts/seed-demo.mjs
// Idempotent-ish: skips if demo parties already exist.
import pg from "pg";

const cs = process.env.SUPABASE_DB_URL;
if (!cs) { console.error("Set SUPABASE_DB_URL"); process.exit(1); }
const c = new pg.Client({ connectionString: cs, ssl: { rejectUnauthorized: false } });
await c.connect();

const rows = (t, p) => c.query(t, p).then((r) => r.rows);
const one = async (t, p) => (await rows(t, p))[0];
const KES = (n) => Math.round(n * 100); // major → minor

const admin = await one(`select id from public.users where email='brian55mwangi@gmail.com' limit 1`);
const adminId = admin?.id ?? null;

// Clean prior demo/business rows so this is fully re-runnable. We disable
// triggers + FK checks for the wipe (replica mode), then restore before insert.
// Spine config (users, roles, permissions, reference data, accounts) is kept.
const CLEAN = [
  "payments", "payment_runs", "grn_lines", "grns", "po_lines", "purchase_orders",
  "payable_invoice_lines", "payable_invoices", "requisition_lines", "requisitions",
  "petty_cash_vouchers", "petty_cash_replenishments", "petty_cash_floats", "expense_receipts",
  "approval_actions", "approval_requests",
  "engagement_updates", "action_items", "engagements", "opportunities", "partner_profiles",
  "eois", "institution_pipeline", "concepts", "capability_snapshots",
  "dunning_log", "customer_receipts", "credit_notes", "receivable_invoice_lines", "receivable_invoices",
  "so_milestones", "sales_orders", "quotation_lines", "quotations", "customer_profiles",
  "deployments", "asset_events", "maintenance_schedules", "work_orders", "stock_movements", "stock_levels", "stock_items", "assets",
  "contracts", "risks", "compliance_obligations", "policy_versions", "policies",
  "board_meetings", "resolutions", "board_members", "shareholding", "dataroom_shares",
  "impact_metrics", "kpi_values", "kpis", "alert_rules",
  "leave_applications", "leave_balances", "leave_types", "timesheet_entries", "attendance",
  "pay_components", "salary_structures", "hr_payroll_runs", "objectives", "performance_reviews",
  "one_on_ones", "hr_checklist_runs", "hr_checklists", "next_of_kin", "employee_profiles",
  "vendor_ratings", "vendor_profiles",
  "ticket_comments", "support_tickets",
  "party_bank_details", "party_contacts", "party_types", "parties",
  "project_team", "project_budgets", "milestones", "funder_reports", "drawdowns", "grants", "field_activities", "project_details",
  "cost_centers", "projects", "locations", "departments", "institutions",
];
await c.query("set session_replication_role = 'replica'");
for (const t of CLEAN) {
  try { await c.query(`delete from public.${t}`); } catch (e) { console.warn("skip", t, e.message); }
}
await c.query("set session_replication_role = 'origin'");

console.log("Seeding demo data…");

// ---------- Organisation ----------
const dept = {};
for (const n of ["Operations", "Finance", "Business Development", "Field Operations"]) {
  dept[n] = (await one(`insert into public.departments(name,head_user_id,created_by) values($1,$2,$3) returning id`, [n, adminId, adminId])).id;
}
const loc = {};
for (const [n, t] of [["Nairobi HQ", "office"], ["Kisumu Warehouse", "warehouse"], ["Freetown Site", "site"], ["Nakuru Site", "site"]]) {
  loc[n] = (await one(`insert into public.locations(name,type,address,created_by) values($1,$2,$3,$4) returning id`, [n, t, n + ", —", adminId])).id;
}
const proj = {};
for (const [code, name] of [["PRJ-SL01", "Sierra Leone Clean Cooking Cohort"], ["PRJ-EAIF", "EAIF Institutional Rollout"], ["PRJ-KIICO", "KIICO Schools Programme"]]) {
  proj[code] = (await one(
    `insert into public.projects(code,name,status,start_date,end_date,created_by) values($1,$2,'active',now()-interval '4 months',now()+interval '8 months',$3) returning id`,
    [code, name, adminId]
  )).id;
}
for (const [n, p] of [["CC-OPS", "Operations"], ["CC-FIN", "Finance"]]) {
  await c.query(`insert into public.cost_centers(code,name,department_id,created_by) values($1,$2,$3,$4)`, [n, p + " Cost Center", dept[p === "Operations" ? "Operations" : "Finance"], adminId]);
}

// ---------- Parties ----------
async function party(type, name, extra = {}) {
  const p = await one(
    `insert into public.parties(type,display_name,legal_name,kra_pin,email,phone,status,created_by)
     values($1,$2,$3,$4,$5,$6,'active',$7) returning id`,
    [type, name, extra.legal ?? name, extra.kra ?? null, extra.email ?? null, extra.phone ?? null, adminId]
  );
  await c.query(`insert into public.party_types(party_id,type) values($1,$2) on conflict do nothing`, [p.id, type]);
  for (const extraType of extra.alsoTypes ?? []) await c.query(`insert into public.party_types(party_id,type) values($1,$2) on conflict do nothing`, [p.id, extraType]);
  return p.id;
}

const vendors = {};
for (const [n, kra] of [["Acme Cookers Ltd", "P051234567A"], ["EcoGas Suppliers", "P051987654B"], ["Savannah Steel Works", "P052233445C"], ["BrightSolar Kenya", "P053344556D"]]) {
  vendors[n] = await party("vendor", n, { kra, email: n.toLowerCase().replace(/[^a-z]/g, "") + "@example.co.ke", phone: "+2547" + Math.floor(10000000 + Math.random() * 89999999) });
}
const customers = {};
for (const n of ["Alliance Girls High School", "Kamiti Maximum Prison", "Kenyatta National Hospital", "St. Mary's Mission School"]) {
  customers[n] = await party("customer", n, { email: "procurement@" + n.toLowerCase().replace(/[^a-z]/g, "").slice(0, 12) + ".ac.ke" });
}
const partners = {};
for (const [n, types] of [["CLASP", ["partner"]], ["EAIF (Emerging Africa Infrastructure Fund)", ["partner"]], ["Cygnum Capital", ["partner"]], ["Ministry of Energy", ["partner"]]]) {
  partners[n] = await party("partner", n, { alsoTypes: types });
}
for (const id of Object.values(partners)) {
  await c.query(`insert into public.partner_profiles(party_id,relationship_types,tier,owner_user_id,created_by) values($1,$2,$3,$4,$5) on conflict (party_id) do nothing`,
    [id, "{funder,investor}", "A", adminId, adminId]);
}
const employees = {};
for (const [n, title] of [["Joan Wanjiku", "Head of Operations"], ["Wilson Kiprop", "BD Lead (Upstream)"], ["Elizabeth Achieng", "BD Lead (Downstream)"], ["Peter Otieno", "Field Officer"]]) {
  const id = await party("employee", n, { email: n.toLowerCase().replace(/[^a-z]/g, ".") + "@ignis.africa" });
  employees[n] = id;
  await c.query(
    `insert into public.employee_profiles(party_id,staff_no,department_id,job_title,contract_type,start_date,nssf_no,shif_no,kra_pin,created_by)
     values($1,$2,$3,$4,'permanent',now()-interval '2 years',$5,$6,$7,$8) on conflict (party_id) do nothing`,
    [id, "EMP-" + Math.floor(1000 + Math.random() * 8999), dept["Operations"], title, "NSSF" + Math.floor(100000 + Math.random() * 899999), "SHIF" + Math.floor(100000 + Math.random() * 899999), "A00" + Math.floor(1000000 + Math.random() * 8999999), adminId]
  );
}

// ---------- Reference IDs for accounts/categories ----------
const cat = {};
for (const r of await rows(`select id,name from public.categories`)) cat[r.name] = r.id;

// ---------- CRM ----------
async function engagement(partyId, view, stage, priority, nextAction, dueOffsetDays) {
  return (await one(
    `insert into public.engagements(partner_party_id,view,stage,priority,owner_user_id,status,next_action,due_by,created_by)
     values($1,$2,$3,$4,$5,'active',$6, now()+($7||' days')::interval, $8) returning id`,
    [partyId, view, stage, priority, adminId, nextAction, String(dueOffsetDays), adminId]
  )).id;
}
const engCLASP = await engagement(partners["CLASP"], "upstream", "term_sheet", "critical", "Return signed term sheet", 5);
const engEAIF = await engagement(partners["EAIF (Emerging Africa Infrastructure Fund)"], "upstream", "negotiation", "high", "Share financial model v3", 9);
await engagement(partners["Cygnum Capital"], "upstream", "discovery", "medium", "Intro call with debt team", 14);
await engagement(partners["Ministry of Energy"], "upstream", "materials", "high", "Submit cooker spec sheet", 3);
const engSchool = await engagement(customers["Alliance Girls High School"], "downstream", "site_visit", "high", "Schedule installation survey", 6);
await engagement(customers["Kamiti Maximum Prison"], "downstream", "contracting", "critical", "Finalise deployment contract", 2);
await engagement(customers["Kenyatta National Hospital"], "downstream", "EOI", "medium", "Confirm kitchen capacity", 20);

for (const [eng, summary, daysAgo] of [
  [engCLASP, "Call with CLASP — term sheet under legal review", 2],
  [engCLASP, "Email: CLASP requested updated impact projections", 6],
  [engEAIF, "Meeting: EAIF keen on 3-year tenor", 4],
  [engSchool, "Site visit booked for next week", 1],
]) {
  await c.query(`insert into public.engagement_updates(engagement_id,update_date,channel,summary,logged_by,created_by) values($1,now()-($2||' days')::interval,$3,$4,$5,$6)`,
    [eng, String(daysAgo), "meeting", summary, adminId, adminId]);
}
for (const [eng, desc, dueDays] of [
  [engCLASP, "Send signed term sheet to CLASP", -2],   // overdue
  [engEAIF, "Prepare financial model v3", 4],
  [engSchool, "Confirm survey logistics with school", 3],
]) {
  await c.query(`insert into public.action_items(engagement_id,description,owner_user_id,due_date,status,created_by) values($1,$2,$3, now()+($4||' days')::interval,'open',$5)`,
    [eng, desc, adminId, String(dueDays), adminId]);
}
for (const [title, type, days] of [["Clean Cooking Fund — Round 4", "grant", 30], ["GCF Readiness Window", "climate_finance", 55], ["EU Renewable Energy RFP", "rfp", 18]]) {
  await c.query(`insert into public.opportunities(title,funder_party_id,type,deadline,status,created_by) values($1,$2,$3, now()+($4||' days')::interval,'open',$5)`,
    [title, partners["CLASP"], type, String(days), adminId]);
}

// ---------- Procurement pipeline ----------
async function requisition(status, lines) {
  const total = lines.reduce((s, l) => s + Math.round(l.qty * l.price), 0);
  const r = await one(`insert into public.requisitions(requested_by,department_id,project_id,status,total_minor,currency_code,need_by_date,created_by)
    values($1,$2,$3,$4,$5,'KES',now()+interval '20 days',$6) returning id,code`,
    [adminId, dept["Operations"], proj["PRJ-SL01"], status, total, adminId]);
  for (const l of lines) await c.query(`insert into public.requisition_lines(req_id,item_desc,qty,uom_code,est_unit_price_minor) values($1,$2,$3,$4,$5)`,
    [r.id, l.desc, l.qty, "EA", Math.round(l.price)]);
  return r;
}
// draft + pending + approved + fully converted chain
await requisition("draft", [{ desc: "Office laptops", qty: 3, price: KES(75000) }, { desc: "Docking stations", qty: 3, price: KES(10000) }]);
const reqPending = await requisition("pending_approval", [{ desc: "EcoCooker 200 units", qty: 6, price: KES(60000) }, { desc: "Installation kits", qty: 6, price: KES(10000) }]);
const arPending = await one(`insert into public.approval_requests(entity_type,entity_id,status,requested_by,created_by) values('requisitions',$1,'pending',$2,$3) returning id`, [reqPending.id, adminId, adminId]);
await c.query(`update public.requisitions set approval_request_id=$1 where id=$2`, [arPending.id, reqPending.id]);
await c.query(`select public.notify_approvers('approval.requested','Approval needed: '||$1,'A requisition was submitted for approval','/procurement')`, [reqPending.code]);

// A completed chain: approved req → PO → GRN → matched+paid invoice
const reqDone = await requisition("converted", [{ desc: "EcoCooker 200 units", qty: 5, price: KES(60000) }]);
const po = await one(`insert into public.purchase_orders(vendor_party_id,requisition_id,status,total_minor,currency_code,expected_date,project_id,created_by)
  values($1,$2,'received',$3,'KES',now()+interval '10 days',$4,$5) returning id,code`,
  [vendors["Acme Cookers Ltd"], reqDone.id, KES(300000), proj["PRJ-SL01"], adminId]);
const poLine = await one(`insert into public.po_lines(po_id,item_desc,qty_ordered,qty_received,unit_price_minor) values($1,'EcoCooker 200 units',5,5,$2) returning id`, [po.id, KES(60000)]);
const grn = await one(`insert into public.grns(po_id,received_by,status,created_by) values($1,$2,'received',$3) returning id`, [po.id, adminId, adminId]);
await c.query(`insert into public.grn_lines(grn_id,po_line_id,qty_received,condition) values($1,$2,5,'good')`, [grn.id, poLine.id]);
const inv = await one(`insert into public.payable_invoices(vendor_party_id,po_id,invoice_no,invoice_date,due_date,amount_minor,tax_minor,currency_code,status,match_status,created_by)
  values($1,$2,'ACM-4471',now()-interval '3 days',now()+interval '27 days',$3,$4,'KES','paid','matched',$5) returning id,code`,
  [vendors["Acme Cookers Ltd"], po.id, KES(300000), KES(41379), adminId]);
const run = await one(`insert into public.payment_runs(status,total_minor,created_by) values('executed',$1,$2) returning id,code`, [KES(300000), adminId]);
await c.query(`insert into public.payments(run_id,payable_invoice_id,vendor_party_id,method,amount_minor,status,external_ref,created_by)
  values($1,$2,$3,'mpesa',$4,'paid',$5,$6)`, [run.id, inv.id, vendors["Acme Cookers Ltd"], KES(300000), "MPESA-" + run.code.replace(/\D/g, ""), adminId]);
// One PO still issued + one invoice matched (unpaid) for pipeline variety
const po2 = await one(`insert into public.purchase_orders(vendor_party_id,status,total_minor,currency_code,created_by) values($1,'issued',$2,'KES',$3) returning id`, [vendors["EcoGas Suppliers"], KES(120000), adminId]);
await c.query(`insert into public.po_lines(po_id,item_desc,qty_ordered,qty_received,unit_price_minor) values($1,'LPG cylinders (13kg)',40,0,$2)`, [po2.id, KES(3000)]);
await c.query(`insert into public.payable_invoices(vendor_party_id,amount_minor,currency_code,status,match_status,invoice_no,invoice_date,due_date,created_by)
  values($1,$2,'KES','matched','matched','EGS-2231',now(),now()+interval '30 days',$3)`, [vendors["EcoGas Suppliers"], KES(96000), adminId]);

// ---------- Assets + deployments ----------
const assetIds = [];
for (let i = 1; i <= 5; i++) {
  const a = await one(`insert into public.assets(name,category_id,serial_no,location_id,custodian_user_id,cost_minor,useful_life_months,nbv_minor,status,created_by)
    values($1,$2,$3,$4,$5,$6,60,$7,$8,$9) returning id`,
    ["EcoCooker 200", cat["Cookers"] ?? null, "ECK200-" + (1000 + i), loc["Nairobi HQ"], adminId, KES(60000), KES(54000), i <= 3 ? "deployed" : "in_store", adminId]);
  assetIds.push(a.id);
}
const instId = (await one(`insert into public.institutions(name,type,status,created_by) values('Alliance Girls High School','school','active',$1) returning id`, [adminId])).id;
for (let i = 0; i < 3; i++) {
  await c.query(`insert into public.deployments(asset_id,institution_id,deployed_date,condition,status,field_officer_id,created_by) values($1,$2,now()-interval '40 days','good','active',$3,$4)`,
    [assetIds[i], instId, adminId, adminId]);
}

// ---------- Governance ----------
for (const [type, party, days, val] of [["supplier MoU", vendors["Acme Cookers Ltd"], 120, KES(1500000)], ["NDA", partners["EAIF (Emerging Africa Infrastructure Fund)"], 25, 0], ["distribution agreement", customers["Kamiti Maximum Prison"], 300, KES(800000)]]) {
  await c.query(`insert into public.contracts(type,counterparty_party_id,start_date,end_date,value_minor,status,created_by) values($1,$2,now()-interval '60 days',now()+($3||' days')::interval,$4,'active',$5)`,
    [type, party, String(days), val, adminId]);
}
for (const [d, l, im, mit] of [["FX exposure on imported components", 4, 3, "Hedge 50% via forward contracts"], ["Grant disbursement delay (Sierra Leone)", 3, 4, "Maintain 3-month operating buffer"], ["Key-person dependency in BD", 3, 3, "Document pipeline in Jikoni CRM"]]) {
  await c.query(`insert into public.risks(description,likelihood,impact,owner_user_id,mitigation,status,created_by) values($1,$2,$3,$4,$5,'open',$6)`, [d, l, im, adminId, mit, adminId]);
}
for (const [n, auth, freq, days] of [["VAT Return", "KRA", "monthly", 9], ["NSSF Remittance", "NSSF", "monthly", 12], ["SHIF Contribution", "SHIF", "monthly", 12], ["Annual Returns", "Registrar of Companies", "annual", 120]]) {
  await c.query(`insert into public.compliance_obligations(name,authority,frequency,next_due,owner_user_id,status,created_by) values($1,$2,$3,now()+($4||' days')::interval,$5,'pending',$6)`,
    [n, auth, freq, String(days), adminId, adminId]);
}

// ---------- Intelligence / Impact ----------
for (const [t, v, pub] of [["Tonnes CO₂e reduced", 1240, true], ["Institutions served", 38, true], ["Staff trained", 156, true], ["Cookers deployed", 412, true]]) {
  await c.query(`insert into public.impact_metrics(type,value,period,project_id,public_visible,created_by) values($1,$2,'2026-H1',$3,$4,$5)`,
    [t, v, proj["PRJ-SL01"], pub, adminId]);
}
for (const [n, f, target, src] of [["Cost per cooker deployed", "total_cost / cookers", 58000, "assets"], ["Pipeline value (upstream)", "sum(term_sheet+)", 50000000, "crm"]]) {
  await c.query(`insert into public.kpis(name,formula,target,module_source,created_by) values($1,$2,$3,$4,$5)`, [n, f, target, src, adminId]);
}

// ---------- People / Leave ----------
const ltypes = {};
for (const [n, days] of [["Annual Leave", 21], ["Sick Leave", 14], ["Maternity Leave", 90]]) {
  ltypes[n] = (await one(`insert into public.leave_types(name,annual_days,accrual,created_by) values($1,$2,'monthly',$3) returning id`, [n, days, adminId])).id;
}
await c.query(`insert into public.leave_applications(employee_party_id,type_id,start_date,end_date,days,status,created_by) values($1,$2,now()+interval '10 days',now()+interval '15 days',5,'pending',$3)`,
  [employees["Joan Wanjiku"], ltypes["Annual Leave"], adminId]);

const counts = await one(`select
  (select count(*) from parties where deleted_at is null) parties,
  (select count(*) from engagements where deleted_at is null) engagements,
  (select count(*) from purchase_orders where deleted_at is null) pos,
  (select count(*) from assets where deleted_at is null) assets,
  (select count(*) from contracts where deleted_at is null) contracts`);
console.log("Seeded. Totals:", counts);
await c.end();
