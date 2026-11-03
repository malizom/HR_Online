/**
 * Document storage (doc 01 §8 "Documents"). One container per firm; path <personId>/<docId>.<ext>.
 * STORAGE_DRIVER=azure uses Blob Storage with the managed identity (AZURE_STORAGE_ACCOUNT_URL);
 * otherwise files go to UPLOAD_DIR (development and CI only).
 */
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import crypto from "node:crypto";
import { DefaultAzureCredential } from "@azure/identity";
import { BlobServiceClient } from "@azure/storage-blob";

export const ALLOWED_MIME = new Set(["application/pdf", "image/jpeg", "image/png"]);
export const MAX_BYTES = 10 * 1024 * 1024;
const EXT: Record<string, string> = { "application/pdf": "pdf", "image/jpeg": "jpg", "image/png": "png" };

const containerFor = (firmId: string) => `firm-${firmId}`;

let blob: BlobServiceClient | null = null;
const azure = () => (blob ??= new BlobServiceClient(process.env.AZURE_STORAGE_ACCOUNT_URL!, new DefaultAzureCredential()));
const useAzure = () => process.env.STORAGE_DRIVER === "azure";
const localRoot = () => path.resolve(process.env.UPLOAD_DIR || "./uploads");

export interface Stored { blobPath: string; sha256: string; size: number; mime: string }

export async function putDocument(firmId: string, personId: string, file: File): Promise<Stored> {
  if (!ALLOWED_MIME.has(file.type)) throw new UserError("Only PDF, JPG or PNG files are accepted.");
  if (file.size > MAX_BYTES) throw new UserError("Files must be 10 MB or smaller.");
  const bytes = Buffer.from(await file.arrayBuffer());
  const sha256 = crypto.createHash("sha256").update(bytes).digest("hex");
  const blobPath = `${personId}/${crypto.randomUUID()}.${EXT[file.type]}`;
  await putBytes(firmId, blobPath, bytes, file.type);
  return { blobPath, sha256, size: file.size, mime: file.type };
}

export async function putBytes(firmId: string, blobPath: string, bytes: Buffer, mime: string) {
  if (useAzure()) {
    const c = azure().getContainerClient(containerFor(firmId));
    await c.createIfNotExists();
    await c.getBlockBlobClient(blobPath).uploadData(bytes, { blobHTTPHeaders: { blobContentType: mime } });
  } else {
    const abs = path.join(localRoot(), containerFor(firmId), blobPath);
    await mkdir(path.dirname(abs), { recursive: true });
    await writeFile(abs, bytes);
  }
}

export async function getBytes(firmId: string, blobPath: string): Promise<Buffer> {
  if (blobPath.includes("..")) throw new Error("Invalid path");
  if (useAzure()) return azure().getContainerClient(containerFor(firmId)).getBlockBlobClient(blobPath).downloadToBuffer();
  return readFile(path.join(localRoot(), containerFor(firmId), blobPath));
}

/** An error whose message is safe to show the user. */
export class UserError extends Error {
  constructor(message: string, public status = 400) { super(message); }
}
