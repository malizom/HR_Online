// Creates the first HR administrator from ADMIN_NAME / ADMIN_EMAIL if not present.
import pg from "pg";
const email = (process.env.ADMIN_EMAIL || "").toLowerCase().trim();
const name = process.env.ADMIN_NAME || "HR Administrator";
if (!email) { console.error("Set ADMIN_EMAIL in .env"); process.exit(1); }
const client = new pg.Client({ connectionString: process.env.DATABASE_URL });
await client.connect();
const id = Date.now().toString(36) + Math.random().toString(16).slice(2, 18);
const r = await client.query(
  `insert into people (id, name, email, role) values ($1,$2,$3,'admin') on conflict (email) do nothing returning id`, [id, name, email]);
console.log(r.rowCount ? `Created admin ${name} <${email}>` : `Admin already exists: ${email}`);
await client.end();
