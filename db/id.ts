import { randomBytes } from "node:crypto";
/** Compact, sortable-ish id: time prefix + random suffix. */
export const createId = () => Date.now().toString(36) + randomBytes(8).toString("hex");
