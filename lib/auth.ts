import NextAuth, { type NextAuthConfig } from "next-auth";
import MicrosoftEntraID from "next-auth/providers/microsoft-entra-id";
import Credentials from "next-auth/providers/credentials";
import { db, schema } from "./db";
import { eq } from "drizzle-orm";

const findByEmail = (email: string) =>
  db.query.people.findFirst({ where: eq(schema.people.email, email.toLowerCase()) });

/**
 * Sign-in policy (replaces ChatGPT's "grant site access"):
 * a user may sign in only if an active Person row exists with their email.
 * Roles come from the Person table, never from the identity provider.
 */
const providers: NextAuthConfig["providers"] = [];

if (process.env.AUTH_MICROSOFT_ENTRA_ID_ID) {
  providers.push(
    MicrosoftEntraID({
      clientId: process.env.AUTH_MICROSOFT_ENTRA_ID_ID,
      clientSecret: process.env.AUTH_MICROSOFT_ENTRA_ID_SECRET,
      issuer: process.env.AUTH_MICROSOFT_ENTRA_ID_ISSUER,
    })
  );
}

if (process.env.DEV_LOGIN === "true" && process.env.NODE_ENV !== "production") {
  providers.push(
    Credentials({
      name: "Development sign-in",
      credentials: { email: { label: "Email", type: "email" } },
      async authorize(creds) {
        const email = String(creds?.email || "").toLowerCase().trim();
        const person = await findByEmail(email);
        if (!person || !person.active) return null;
        return { id: person.id, email: person.email, name: person.name };
      },
    })
  );
}

export const { handlers, auth, signIn, signOut } = NextAuth({
  providers,
  session: { strategy: "jwt", maxAge: 60 * 60 * 8 }, // 8h; sliding
  pages: { signIn: "/signin" },
  callbacks: {
    async signIn({ user }) {
      const email = user.email?.toLowerCase();
      if (!email) return false;
      const person = await findByEmail(email);
      return !!person && person.active;
    },
    async jwt({ token }) {
      if (token.email) {
        const p = await findByEmail(token.email);
        if (p) { token.personId = p.id; token.role = p.role; }
      }
      return token;
    },
    async session({ session, token }) {
      (session as any).personId = token.personId;
      (session as any).role = token.role;
      return session;
    },
  },
});

/** Resolve the signed-in Person or null. */
export async function currentPerson() {
  const session = await auth();
  const email = session?.user?.email?.toLowerCase();
  if (!email) return null;
  const person = await findByEmail(email);
  return person && person.active ? person : null;
}
