import { readFileSync } from "node:fs";
import pg from "pg";

const root = "/home/brian/Desktop/jikoni";
const raw = readFileSync(root + "/.claude/settings.local.json", "utf8");
const url = raw.match(/postgres(?:ql)?:\/\/[^"'\\\s]+/)[0];
const client = new pg.Client({ connectionString: url, ssl: { rejectUnauthorized: false } });
await client.connect();

const partners = await client.query("select count(*) from public.partners");
console.log("PARTNERS:", partners.rows[0].count);
const opps = await client.query("select count(*) from public.opportunities");
console.log("OPPORTUNITIES:", opps.rows[0].count);
const dd = await client.query("select category, count(*) from public.crm_dropdown_options group by category order by category");
console.log("DROPDOWNS:", dd.rows);
const rc = await client.query("select * from public.ref_counters where kind in ('ENG','DST')");
console.log("REF COUNTERS:", rc.rows);

await client.end();
