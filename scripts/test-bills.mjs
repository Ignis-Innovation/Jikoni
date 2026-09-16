// Recurring-bills flow test (rolled back). Proves: only HR adds/requests; only a Super Admin
// pays/rejects; add → request → pay → re-request (recurring) → reject. Prints BILL_TESTS_PASS.
import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const url = readFileSync(resolve(root, ".claude/settings.local.json"), "utf8").match(/postgres(?:ql)?:\/\/[^"'\\\s]+/)[0];
const c = new pg.Client({ connectionString: url, ssl: { rejectUnauthorized: false } });

let failures = 0;
function ok(cond, label, extra = "") { console.log(`${cond ? "PASS" : "FAIL"} — ${label}${extra ? " :: " + extra : ""}`); if (!cond) failures++; }
async function as(u) {
  await c.query("reset role");
  await c.query("select set_config('request.jwt.claims', json_build_object('sub',$1::text,'email',$2::text,'role','authenticated')::text, true)", [u.auth_id, u.email]);
  await c.query("set local role authenticated");
}
async function expectThrow(fn, label) {
  await c.query("savepoint sp");
  try { await fn(); ok(false, label, "no exception raised"); await c.query("release savepoint sp"); }
  catch { ok(true, label); await c.query("rollback to savepoint sp"); }
}

try {
  await c.connect();
  const hrUser = (await c.query("select u.id,u.auth_id,u.email from public.app_users u join public.user_permissions p on p.email=lower(u.email) where u.auth_id is not null and p.module='hr' and p.level>=2 limit 1")).rows[0];
  const superUser = (await c.query("select u.id,u.auth_id,u.email from public.app_users u join public.user_permissions p on p.email=lower(u.email) where u.auth_id is not null and p.module='users' and p.level>=3 limit 1")).rows[0];
  const nonHr = (await c.query("select u.id,u.auth_id,u.email from public.app_users u where auth_id is not null and not exists(select 1 from public.user_permissions p where p.email=lower(u.email) and ((p.module='hr' and p.level>=2) or (p.module='users' and p.level>=3))) limit 1")).rows[0];
  console.log(`hr=${hrUser.email} super=${superUser.email} nonHr=${nonHr.email}\n`);

  await c.query("begin");

  // 1. a non-HR user cannot add a bill
  await as(nonHr);
  await expectThrow(() => c.query("select public.add_recurring_bill($1,$2,$3,$4,$5,$6)", ["Rent", "Landlord", "rent", 50000, 5, null]), "non-HR cannot add a bill");

  // 2. HR adds a bill
  await as(hrUser);
  let b = (await c.query("select public.add_recurring_bill($1,$2,$3,$4,$5,$6) as j", ["Office rent", "Landlord Ltd", "rent", 50000, 5, "Monthly"])).rows[0].j;
  const ref = b.id;
  ok(b.state === "active" && Number(b.amount) === 50000, "HR adds bill → active, 50000", `${ref} ${b.state}/${b.amount}`);

  // 3. HR edits while active
  b = (await c.query("select public.edit_recurring_bill($1,$2,$3,$4,$5,$6,$7) as j", [ref, "Office rent", "Landlord Ltd", "rent", 55000, 5, "Rent went up"])).rows[0].j;
  ok(Number(b.amount) === 55000, "HR edits an active bill", "amount=" + b.amount);

  // 4. HR requests payment → pending + super admins to email
  b = (await c.query("select public.request_bill_payment($1) as j", [ref])).rows[0].j;
  ok(b.state === "pending", "request payment → pending", b.state);
  ok(Array.isArray(b.approverEmails) && b.approverEmails.length > 0, "super admin(s) returned to email", "n=" + (b.approverEmails || []).length);

  // 5. HR cannot edit while pending
  await expectThrow(() => c.query("select public.edit_recurring_bill($1,$2,$3,$4,$5,$6,$7)", [ref, "x", null, null, 1, null, null]), "cannot edit a pending bill");

  // 6. a non-super cannot decide
  await as(nonHr);
  await expectThrow(() => c.query("select public.decide_bill_payment($1,true,$2,null)", [ref, "MPESA-1"]), "non-super cannot pay a bill");

  // 7. Super Admin pays
  await as(superUser);
  b = (await c.query("select public.decide_bill_payment($1,true,$2,null) as j", [ref, "MPESA-XYZ"])).rows[0].j;
  ok(b.state === "paid" && b.paymentRef === "MPESA-XYZ", "super admin pays → paid + ref", `${b.state}/${b.paymentRef}`);

  // 8. recurring — HR re-requests next month
  await as(hrUser);
  b = (await c.query("select public.request_bill_payment($1) as j", [ref])).rows[0].j;
  ok(b.state === "pending", "paid bill can be re-requested (recurring)", b.state);

  // 9. Super Admin rejects this time
  await as(superUser);
  b = (await c.query("select public.decide_bill_payment($1,false,null,$2) as j", [ref, "Use the other vendor"])).rows[0].j;
  ok(b.state === "rejected", "super admin can reject a request", b.state);

  await c.query("reset role");
  await c.query("rollback");
  console.log(`\n${failures} failing assertion(s)`);
  if (failures === 0) console.log("BILL_TESTS_PASS");
  await c.end();
  process.exit(failures === 0 ? 0 : 1);
} catch (e) {
  console.error("ERR", e.message);
  try { await c.query("rollback"); await c.end(); } catch { /* ignore */ }
  process.exit(1);
}
