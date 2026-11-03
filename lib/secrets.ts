/**
 * Secret lookup by name (doc 01 §5 "Identity to resources", §6 "Secrets and config").
 * Azure: Key Vault via the app's managed identity (KEY_VAULT_URL set).
 * Local/CI: environment variable with the secret name upper-cased, dashes -> underscores
 *   e.g. "firm-demo-entra-secret" -> FIRM_DEMO_ENTRA_SECRET.
 */
import { DefaultAzureCredential } from "@azure/identity";
import { SecretClient } from "@azure/keyvault-secrets";

let client: SecretClient | null = null;
const cache = new Map<string, { value: string; at: number }>();
const TTL_MS = 5 * 60_000;

export async function getSecret(name: string): Promise<string | null> {
  const hit = cache.get(name);
  if (hit && Date.now() - hit.at < TTL_MS) return hit.value;

  let value: string | null = null;
  if (process.env.KEY_VAULT_URL) {
    client ??= new SecretClient(process.env.KEY_VAULT_URL, new DefaultAzureCredential());
    try { value = (await client.getSecret(name)).value ?? null; } catch { value = null; }
  } else {
    value = process.env[name.toUpperCase().replace(/[^A-Z0-9]/g, "_")] ?? null;
  }
  if (value) cache.set(name, { value, at: Date.now() });
  return value;
}
