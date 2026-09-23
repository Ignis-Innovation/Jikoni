// 0083 multi-receipt test (rolled back). Claim line + advance line + petty-cash request each
// hold several receipts; HR can add/remove; legacy single receiptPath still accepted.
// Prints MULTI_RECEIPTS_PASS.
import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const url = readFileSync(resolve(root, ".claude/settings.local.json"), "utf8").match(/postgres(?:ql)?:\/\/[^"'\\\s]+/)[0];
const c = new pg.Client({ connectionString: url, ssl: { rejectUnauthorized: false } });

let failures = 0;
const ok = (cond, label, extra = "") => { console.log(`${cond ? "PASS" : "FAIL"} — ${label}${extra ? " :: " + extra : ""}`); if (!cond) failures++; };
async function as(u) {
  await c.query("reset role");
  await c.query("select set_config('request.jwt.claims', json_build_object('sub',$1::text,'email',$2::text,'role','authenticated')::text, true)", [u.auth_id, u.email]);
  await c.query("set local role authenticated");
}
const q1 = async (sql, args) => (await c.query(sql, args)).rows[0].j;

try {
  await c.connect();
  const staff = (await c.query("select u.id,u.auth_id,u.email from public.app_users u where auth_id is not null and not exists(select 1 from public.user_permissions p where p.email=lower(u.email) and p.module='users' and p.level>=3) limit 1")).rows[0];
  const hr = (await c.query("select u.id,u.auth_id,u.email from public.app_users u join public.user_permissions p on p.email=lower(u.email) where u.auth_id is not null and ((p.module='users' and p.level>=3) or (p.module='hr' and p.level>=2)) and u.id<>$1 limit 1", [staff.id])).rows[0];
  const project = (await c.query("select name from public.projects limit 1")).rows[0].name;
  console.log(`staff=${staff.email} hr=${hr.email}\n`);
  await c.query("begin");

  // --- claim: file with 2 receipts on one line + a legacy single-path line
  await as(staff);
  let j = await q1("select public.submit_expense_claim($1,$2,$3::jsonb,$4) as j", ["Multi receipt test", project, JSON.stringify([
    { category: "transport", amount: 1000, receiptPaths: ["claims/a.jpg", "claims/b.pdf", "claims/a.jpg", " "] },
    { category: "meals", amount: 500, receiptPath: "claims/legacy.jpg" },
  ]), null]);
  const cref = j.id;
  const l1 = j.lines.find((l) => l.category === "transport"), l2 = j.lines.find((l) => l.category === "meals");
  ok(JSON.stringify(l1.receiptPaths) === '["claims/a.jpg","claims/b.pdf"]', "claim line stores several receipts (dedup, blanks dropped)", JSON.stringify(l1.receiptPaths));
  ok(JSON.stringify(l2.receiptPaths) === '["claims/legacy.jpg"]', "legacy receiptPath still accepted", JSON.stringify(l2.receiptPaths));

  await as(hr);
  j = await q1("select public.add_claim_line_receipts($1,$2) as j", [l1.id, ["claims/c.png", "claims/d.png"]]);
  ok(j.lines.find((l) => l.id === l1.id).receiptPaths.length === 4, "HR adds 2 more receipts to a claim line");
  j = await q1("select public.remove_claim_line_receipt($1,$2) as j", [l1.id, "claims/a.jpg"]);
  const after = j.lines.find((l) => l.id === l1.id);
  ok(after.receiptPaths.length === 3 && after.receiptPath === "claims/b.pdf", "HR removes one; legacy column follows first item", after.receiptPath);

  // --- advance: submit → approve → issue → reconcile with receipts; HR adds more
  await as(staff);
  j = await q1("select public.submit_travel_advance($1,$2,$3::jsonb) as j", ["Multi receipt adv", project, JSON.stringify([{ category: "transport", amount: 3000 }])]);
  const aref = j.id;
  await as(hr);
  await q1("select public.decide_travel_advance($1,true,null) as j", [aref]);
  await q1("select public.issue_travel_advance($1,$2) as j", [aref, "TEST"]);
  await as(staff);
  j = await q1("select public.reconcile_travel_advance($1,$2::jsonb) as j", [aref, JSON.stringify([{ category: "transport", amount: 2500, receiptPaths: ["advances/x.jpg", "advances/y.jpg"] }])]);
  const al = j.lines[0];
  ok(al.receiptPaths.length === 2, "reconcile line stores 2 receipts", JSON.stringify(al.receiptPaths));
  await as(hr);
  j = await q1("select public.add_advance_line_receipts($1,$2) as j", [al.id, ["advances/z.jpg"]]);
  ok(j.lines[0].receiptPaths.length === 3, "HR adds a receipt to a reconciled advance line");
  j = await q1("select public.remove_advance_line_receipt($1,$2) as j", [al.id, "advances/x.jpg"]);
  ok(j.lines[0].receiptPaths.length === 2, "HR removes one advance receipt");

  // --- petty cash: attach appends; remove drops one
  await as(staff);
  j = await q1("select public.submit_petty_cash_request($1,$2,$3,$4,$5) as j", ["Multi receipt petty", 900, null, null, null]);
  const pref = j.id;
  await as(hr);
  const dec = await q1("select public.decide_petty_cash_request($1,true,null) as j", [pref]);
  if (dec.state !== "approved") { await q1("select public.decide_petty_cash_request($1,true,null) as j", [pref]); }
  for (const p of ["petty-cash/1.jpg", "petty-cash/2.jpg", "petty-cash/3.jpg"]) j = await q1("select public.attach_petty_cash_invoice($1,$2) as j", [pref, p]);
  ok(j.invoicePaths.length === 3, "HR attaches 3 invoices to one petty-cash request (append, not overwrite)", JSON.stringify(j.invoicePaths));
  j = await q1("select public.remove_petty_cash_invoice($1,$2) as j", [pref, "petty-cash/2.jpg"]);
  ok(JSON.stringify(j.invoicePaths) === '["petty-cash/1.jpg","petty-cash/3.jpg"]', "remove drops only that one invoice", JSON.stringify(j.invoicePaths));
} catch (e) {
  failures++; console.log("ERROR", e.message);
} finally {
  await c.query("rollback").catch(() => {});
  await c.end();
}
console.log(failures ? `\nMULTI_RECEIPTS_FAIL (${failures})` : "\nMULTI_RECEIPTS_PASS");
process.exit(failures ? 1 : 0);
