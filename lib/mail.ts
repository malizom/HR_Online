/**
 * Outbound mail (doc 01 §7 "Mail"). Per firm: Microsoft Graph sendMail from the firm's no-reply mailbox,
 * using the firm's own Entra app (client credentials, Mail.Send restricted by an Exchange access policy).
 * mail_mode "console" logs instead of sending (development, CI, firms not yet configured).
 */
import type { Firm } from "./tenancy";
import { getSecret } from "./secrets";

export interface MailMessage { to: string; subject: string; text: string }
export interface SendResult { providerMessageId: string | null }

const tokenCache = new Map<string, { token: string; exp: number }>();

async function graphToken(firm: Firm): Promise<string> {
  const hit = tokenCache.get(firm.id);
  if (hit && hit.exp > Date.now() + 60_000) return hit.token;
  const secret = firm.entraSecretRef ? await getSecret(firm.entraSecretRef) : null;
  if (!firm.entraTenantId || !firm.entraClientId || !secret) throw new Error("Firm mail is not configured (Entra app)");
  const res = await fetch(`https://login.microsoftonline.com/${firm.entraTenantId}/oauth2/v2.0/token`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: firm.entraClientId, client_secret: secret, grant_type: "client_credentials",
      scope: "https://graph.microsoft.com/.default",
    }),
  });
  if (!res.ok) throw new Error(`Graph token request failed: ${res.status}`);
  const j = await res.json() as { access_token: string; expires_in: number };
  tokenCache.set(firm.id, { token: j.access_token, exp: Date.now() + j.expires_in * 1000 });
  return j.access_token;
}

export async function sendMail(firm: Firm, msg: MailMessage): Promise<SendResult> {
  if (firm.mailMode === "console" || !firm.mailSender) {
    console.info(`[mail:${firm.slug}] to=${msg.to} subject=${JSON.stringify(msg.subject)}`);
    return { providerMessageId: null };
  }
  if (firm.mailMode === "graph") {
    const token = await graphToken(firm);
    const res = await fetch(`https://graph.microsoft.com/v1.0/users/${encodeURIComponent(firm.mailSender)}/sendMail`, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        message: { subject: msg.subject, body: { contentType: "Text", content: msg.text }, toRecipients: [{ emailAddress: { address: msg.to } }] },
        saveToSentItems: false,
      }),
    });
    if (res.status !== 202) throw new Error(`Graph sendMail failed: ${res.status} ${await res.text()}`);
    return { providerMessageId: res.headers.get("request-id") };
  }
  throw new Error(`Mail mode ${firm.mailMode} not implemented`); // ACS: provisioned only if a firm refuses Mail.Send
}
