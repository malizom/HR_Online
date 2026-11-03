/**
 * PostgreSQL credentials. In Azure (PG_ENTRA_AUTH=true) the password is a short-lived Entra access token
 * for the managed identity; pg calls this function for every new connection. Otherwise the URL's password is used.
 */
import { DefaultAzureCredential } from "@azure/identity";

let cred: DefaultAzureCredential | null = null;

export function pgPassword(url?: string): string | (() => Promise<string>) | undefined {
  if (process.env.PG_ENTRA_AUTH === "true") {
    return async () => {
      cred ??= new DefaultAzureCredential({ managedIdentityClientId: process.env.AZURE_CLIENT_ID });
      return (await cred.getToken("https://ossrdbms-aad.database.windows.net/.default")).token;
    };
  }
  return url ? decodeURIComponent(new URL(url).password) || undefined : undefined;
}
