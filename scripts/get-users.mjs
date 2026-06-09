import pg from "pg";
import fs from "fs";

const { Client } = pg;

let dbUrl = process.env.SUPABASE_DB_URL;
if (!dbUrl && fs.existsSync(".claude/settings.local.json")) {
  try {
    const { supabaseDbUrl } = JSON.parse(fs.readFileSync(".claude/settings.local.json", "utf8"));
    dbUrl = supabaseDbUrl;
  } catch (e) {
    console.error("Failed to read .claude/settings.local.json");
  }
}

if (!dbUrl) {
  console.error("SUPABASE_DB_URL not set");
  process.exit(1);
}

const client = new Client({ connectionString: dbUrl });

try {
  await client.connect();
  
  const result = await client.query(`
    SELECT id, email, raw_user_meta_data->>'full_name' as full_name, raw_user_meta_data->>'role' as role, created_at
    FROM auth.users
    WHERE deleted_at IS NULL
    ORDER BY created_at ASC
  `);
  
  console.log("\n✓ Test Users Preserved:\n");
  result.rows.forEach((user, i) => {
    console.log(`${i + 1}. Email: ${user.email}`);
    console.log(`   Name: ${user.full_name || "N/A"}`);
    console.log(`   Role: ${user.role || "N/A"}`);
    console.log(`   Created: ${user.created_at.toISOString().split('T')[0]}`);
    console.log();
  });
} catch (err) {
  console.error("Error:", err);
} finally {
  await client.end();
}
