import { defineConfig } from "drizzle-kit";
export default defineConfig({
  schema: "./db/schema/index.ts",
  out: "./db/migrations",
  dialect: "postgresql",
  dbCredentials: { url: (process.env.MIGRATION_DATABASE_URL ?? process.env.DATABASE_URL)! },
});
