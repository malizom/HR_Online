// Shared column helpers. See design doc 02 §1 (conventions).
import { timestamp, uuid } from "drizzle-orm/pg-core";

export const id = () => uuid("id").primaryKey().defaultRandom();

/** Every tenant table carries firm_id; RLS policies key on it. */
export const firmId = () => uuid("firm_id").notNull();

export const stamps = {
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  createdBy: uuid("created_by"),
};

/** Append-only tables carry only created_at. */
export const createdOnly = {
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
};
