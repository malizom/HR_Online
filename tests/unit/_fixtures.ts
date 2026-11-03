// Test fixtures created with the owner connection (bypasses RLS) so tests can set up any tenant.
import pg from "pg";
import crypto from "node:crypto";

export async function ownerClient() {
  const c = new pg.Client({ connectionString: process.env.MIGRATION_DATABASE_URL });
  await c.connect();
  return c;
}

export async function makeFirm(c: pg.Client, label: string) {
  const slug = `${label}-${crypto.randomBytes(4).toString("hex")}`;
  const { rows: [firm] } = await c.query(
    `insert into firms (slug, legal_name, display_name, status) values ($1,$2,$2,'active') returning id, slug`, [slug, label]);
  await c.query(`insert into firm_domains (firm_id, host, is_primary) values ($1, $2, true)`, [firm.id, `${slug}.test`]);
  const { rows: [person] } = await c.query(
    `insert into people (firm_id, first_name, last_name, work_email, role) values ($1,'Pat',$2,$3,'admin') returning id`,
    [firm.id, label, `pat@${slug}.test`]);
  return { id: firm.id as string, slug: firm.slug as string, host: `${slug}.test`, personId: person.id as string };
}
