import { mkdir, writeFile, readFile, stat } from "node:fs/promises";
import path from "node:path";
import crypto from "node:crypto";

const ROOT = path.resolve(process.env.UPLOAD_DIR || "./uploads");
const ALLOWED = new Set(["application/pdf", "image/jpeg", "image/png"]);
export const MAX_BYTES = 10 * 1024 * 1024;

export async function saveUpload(file: File, ownerId: string) {
  if (!ALLOWED.has(file.type)) throw new Error("Only PDF, JPG or PNG files are accepted.");
  if (file.size > MAX_BYTES) throw new Error("Files must be 10 MB or smaller.");
  const ext = file.type === "application/pdf" ? "pdf" : file.type === "image/png" ? "png" : "jpg";
  const rel = path.join(ownerId, `${Date.now()}-${crypto.randomBytes(6).toString("hex")}.${ext}`);
  await mkdir(path.dirname(path.join(ROOT, rel)), { recursive: true });
  await writeFile(path.join(ROOT, rel), Buffer.from(await file.arrayBuffer()));
  return rel;
}

export async function readUpload(rel: string) {
  const abs = path.join(ROOT, rel);
  if (!abs.startsWith(ROOT)) throw new Error("Invalid path");
  await stat(abs);
  return readFile(abs);
}
