/**
 * Sign-in (doc 01 §7, ADR-04). Each firm signs in with its OWN Entra app; the provider is built per request
 * from the firm resolved by host. A person may sign in only if an active people row with that email exists
 * in that firm. Roles come from the portal, never from Entra.
 */
import NextAuth, { type NextAuthConfig } from "next-auth";
import MicrosoftEntraID from "next-auth/providers/microsoft-entra-id";
import Credentials from "next-auth/providers/credentials";
import { headers } from "next/headers";
import { and, eq, isNull } from "drizzle-orm";
import { platformDb, schema, withFirm } from "@/lib/db";
import { firmByHost, type Firm } from "@/lib/tenancy";
import { getSecret } from "@/lib/secrets";
import { hashIdentifier } from "@/lib/crypto";

const devLoginEnabled = () => process.env.DEV_LOGIN === "true" && process.env.NODE_ENV !== "production";
/** Hosted demo tenants (env DEMO_FIRMS=demo). Persona sign-in works only there, and only for fictional @demo.test people. */
const isDemoFirm = (firm: Pick<Firm, "slug"> | null) =>
  !!firm && (process.env.DEMO_FIRMS ?? "").split(",").map(s => s.trim()).filter(Boolean).includes(firm.slug);
const DEMO_EMAIL = /@demo\.test$/i;

async function hostOf(req?: Request): Promise<string> {
  if (req) return req.headers.get("x-forwarded-host") || req.headers.get("host") || "";
  const h = await headers();
  return h.get("x-forwarded-host") || h.get("host") || "";
}

async function findActivePerson(firm: Firm, email: string) {
  return withFirm(firm.id, async tx => {
    const [p] = await tx.select().from(schema.people).where(and(
      eq(schema.people.workEmail, email.toLowerCase().trim()), eq(schema.people.status, "active"), isNull(schema.people.deactivatedAt)));
    return p ?? null;
  });
}

async function recordSignIn(firm: Firm | null, email: string | null, personId: string | null, outcome: string, req?: Request) {
  await platformDb.insert(schema.signIns).values({
    firmId: firm?.id ?? null, personId, email: email ? hashIdentifier(email.toLowerCase()) : null, outcome,
    ipHash: hashIdentifier(req?.headers.get("x-forwarded-for")?.split(",")[0]), userAgent: req?.headers.get("user-agent")?.slice(0, 200) ?? null,
  }).catch(() => {});
}

export const { handlers, auth, signIn, signOut } = NextAuth(async (req): Promise<NextAuthConfig> => {
  const firm = await firmByHost(await hostOf(req));
  const providers: NextAuthConfig["providers"] = [];

  if (firm?.entraTenantId && firm.entraClientId && firm.entraSecretRef) {
    const secret = await getSecret(firm.entraSecretRef);
    if (secret) providers.push(MicrosoftEntraID({
      clientId: firm.entraClientId, clientSecret: secret,
      issuer: `https://login.microsoftonline.com/${firm.entraTenantId}/v2.0`,
    }));
  }
  if (devLoginEnabled()) {
    providers.push(Credentials({
      id: "dev", name: "Development sign-in", credentials: { email: { label: "Email", type: "email" } },
      async authorize(creds) {
        if (!firm) return null;
        const p = await findActivePerson(firm, String(creds?.email || ""));
        return p ? { id: p.id, email: p.workEmail, name: `${p.firstName} ${p.lastName}` } : null;
      },
    }));
  }

  if (isDemoFirm(firm)) {
    providers.push(Credentials({
      id: "demo", name: "Demo persona", credentials: { email: { label: "Email", type: "email" }, code: { label: "Access code", type: "password" } },
      async authorize(creds) {
        const email = String(creds?.email || "");
        if (!firm || !DEMO_EMAIL.test(email)) return null;
        // A hosted demo shows real names (public team page), so it sits behind an access code shared with the prospect.
        const code = process.env.DEMO_ACCESS_CODE;
        if (code && String(creds?.code ?? "").trim() !== code) return null;
        const p = await findActivePerson(firm, email);
        return p ? { id: p.id, email: p.workEmail, name: `${p.firstName} ${p.lastName}` } : null;
      },
    }));
  }

  const idleMinutes = 30;
  return {
    providers,
    trustHost: true,
    session: { strategy: "jwt", maxAge: 60 * 60 * 8, updateAge: idleMinutes * 60 },
    pages: { signIn: "/signin", error: "/signin" },
    callbacks: {
      async signIn({ user, profile, account }) {
        const email = user.email?.toLowerCase();
        if (!firm || !email) { await recordSignIn(firm, email ?? null, null, "no_firm", req); return false; }
        const person = await findActivePerson(firm, email);
        if (!person) { await recordSignIn(firm, email, null, "not_on_staff_list", req); return false; }
        if (account?.provider === "demo" && !isDemoFirm(firm)) { await recordSignIn(firm, email, person.id, "demo_refused", req); return false; }
        // Bind the Entra object id on first sign-in; refuse a different identity using the same email later.
        const oid = account?.provider === "microsoft-entra-id" ? String((profile as any)?.oid ?? "") : "";
        if (oid) {
          if (person.entraObjectId && person.entraObjectId !== oid) { await recordSignIn(firm, email, person.id, "identity_mismatch", req); return false; }
          if (!person.entraObjectId) await withFirm(firm.id, tx => tx.update(schema.people).set({ entraObjectId: oid }).where(eq(schema.people.id, person.id)));
        }
        await recordSignIn(firm, email, person.id, "ok", req);
        return true;
      },
      async jwt({ token, user }) {
        if (user && firm) {
          const p = await findActivePerson(firm, String(user.email));
          if (p) { token.personId = p.id; token.firmId = firm.id; }
        }
        return token;
      },
      async session({ session, token }) {
        (session as any).personId = token.personId;
        (session as any).firmId = token.firmId;
        return session;
      },
    },
  };
});

export const hasEntra = async (firm: Firm | null) => !!(firm?.entraTenantId && firm.entraClientId && firm.entraSecretRef);
export { devLoginEnabled, isDemoFirm };

/** Personas offered on the demo sign-in page. */
export async function demoPersonas(firm: Firm) {
  if (!isDemoFirm(firm)) return [];
  return withFirm(firm.id, async tx => (await tx.select().from(schema.people).where(and(eq(schema.people.status, "active"), isNull(schema.people.deactivatedAt))))
    .filter(p => DEMO_EMAIL.test(p.workEmail) && p.onboardingStatus === "complete")
    .map(p => ({ email: p.workEmail, name: `${p.firstName} ${p.lastName}`, title: p.jobTitle ?? "", role: p.role })));
}
