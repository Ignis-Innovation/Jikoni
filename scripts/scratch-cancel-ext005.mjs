import { readFileSync } from "node:fs";
import pg from "pg";
const url = readFileSync("/home/brian/Desktop/jikoni/.claude/settings.local.json", "utf8").match(/postgres(?:ql)?:\/\/[^"'\\\s]+/)[0];
const c = new pg.Client({ connectionString: url, ssl: { rejectUnauthorized: false } });
await c.connect();
const [me] = (await c.query(`select auth_id from app_users where email='wanjiku@ignis.africa'`)).rows;
await c.query(`select set_config('request.jwt.claims', $1, false)`,
  [JSON.stringify({ email: "wanjiku@ignis.africa", sub: me.auth_id, role: "authenticated" })]);
const r = (await c.query(`select public.cancel_exit('EXT-005') as r`)).rows[0].r;
console.log("cancelled:", JSON.stringify(r));
const left = (await c.query(`select ref, person, state from staff_exits order by ref`)).rows;
console.table(left);
const [wf] = (await c.query(`select state from staff_files sf join app_users u on u.id=sf.app_user_id where u.email='wanjiku@ignis.africa'`)).rows;
console.log("wanjiku staff file:", wf.state);
await c.end();
