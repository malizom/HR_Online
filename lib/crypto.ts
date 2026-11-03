/**
 * Application-layer encryption for class S fields (doc 01 §4 "Sensitive fields", doc 02 §1).
 * AES-256-GCM with a per-firm data key derived from the master key via HKDF.
 * Local/dev: master key from DATA_ENCRYPTION_KEY (base64, 32 bytes). Azure: unwrapped from Key Vault at startup (S0-5).
 * Format: [1 byte version][12 byte IV][16 byte tag][ciphertext]
 */
import crypto from "node:crypto";

const VERSION = 1;

function masterKey(): Buffer {
  const b64 = process.env.DATA_ENCRYPTION_KEY;
  if (!b64) throw new Error("DATA_ENCRYPTION_KEY is not set");
  const key = Buffer.from(b64, "base64");
  if (key.length !== 32) throw new Error("DATA_ENCRYPTION_KEY must be 32 bytes (base64)");
  return key;
}

function firmKey(firmId: string, purpose: "enc" | "mac"): Buffer {
  return Buffer.from(crypto.hkdfSync("sha256", masterKey(), Buffer.from(firmId), Buffer.from(`pp-${purpose}-v${VERSION}`), 32));
}

export function encrypt(firmId: string, plaintext: string): Buffer {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", firmKey(firmId, "enc"), iv);
  const ct = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  return Buffer.concat([Buffer.from([VERSION]), iv, cipher.getAuthTag(), ct]);
}

export function decrypt(firmId: string, blob: Buffer): string {
  if (blob[0] !== VERSION) throw new Error("Unsupported ciphertext version");
  const iv = blob.subarray(1, 13), tag = blob.subarray(13, 29), ct = blob.subarray(29);
  const d = crypto.createDecipheriv("aes-256-gcm", firmKey(firmId, "enc"), iv);
  d.setAuthTag(tag);
  return Buffer.concat([d.update(ct), d.final()]).toString("utf8");
}

/** Deterministic lookup hash (e.g. find a person by ID number) without storing the value in clear. */
export function lookupHash(firmId: string, value: string): Buffer {
  return crypto.createHmac("sha256", firmKey(firmId, "mac")).update(value.replace(/\s+/g, "").toUpperCase()).digest();
}

/** Hash for IPs and other telemetry identifiers — never stored raw. */
export const hashIdentifier = (v: string | null | undefined) =>
  v ? crypto.createHash("sha256").update(v).digest("hex").slice(0, 32) : null;
