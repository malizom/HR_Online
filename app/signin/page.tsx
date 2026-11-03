import { redirect } from "next/navigation";
import { currentFirm } from "@/lib/tenancy";
import { currentCtx } from "@/modules/identity/actor";
import { devLoginEnabled, hasEntra, signIn } from "@/modules/identity/auth";

export const dynamic = "force-dynamic";

export default async function SignIn({ searchParams }: { searchParams: Promise<{ error?: string }> }) {
  const firm = await currentFirm();
  if (firm && (await currentCtx())) redirect("/");
  const { error } = await searchParams;
  const entra = await hasEntra(firm);
  const dev = devLoginEnabled();

  return (
    <main className="signin">
      <div className="card">
        <div className="brand"><div>{(firm?.displayName ?? "People").split(" ")[0].toUpperCase()}<span>{firm ? "PEOPLE PORTAL" : ""}</span></div></div>
        <h1>People &amp; Leave</h1>
        {!firm ? <p>This address is not connected to a People portal.</p> : <>
          <p>Sign in with your {firm.displayName} Microsoft 365 account. Access is limited to staff listed by HR.</p>
          {error && <div role="alert" className="error">
            {error === "AccessDenied" ? "Your account isn't on the staff list yet. Ask HR to add your email." : "Sign-in failed. Please try again."}
          </div>}
          {entra && (
            <form action={async () => { "use server"; await signIn("microsoft-entra-id", { redirectTo: "/" }); }}>
              <button className="primary" type="submit">Continue with Microsoft 365</button>
            </form>
          )}
          {dev && (
            <form action={async (fd: FormData) => { "use server"; await signIn("dev", { email: String(fd.get("email") || ""), redirectTo: "/" }); }}>
              <label>Development sign-in (email on the staff list)
                <input name="email" type="email" required placeholder="you@firm.co.za" />
              </label>
              <button type="submit">Sign in (dev)</button>
            </form>
          )}
          {!entra && !dev && <p className="error">Sign-in is not configured for this firm yet. Contact support.</p>}
        </>}
        <p className="privacy">We process your personal information to manage your employment, onboarding and leave, as required by the BCEA and in line with POPIA. Only you and authorised HR staff can see your documents.</p>
        <footer>{firm?.displayName.toUpperCase() ?? "PEOPLE PORTAL"} <span>People first. Every step of the way.</span></footer>
      </div>
      <style>{`
        .signin{min-height:100vh;display:flex;align-items:center;justify-content:center;padding:24px;background:linear-gradient(105deg,#e9f1e9,#f6f7f9);}
        .signin .card{width:420px;max-width:100%;}
        .signin .brand{margin:0 0 24px;}
        .signin h1{font-size:24px;}
        .signin form{margin-top:18px;}
        .signin form button{width:100%;margin-top:10px;}
        .signin .privacy{font-size:10px;margin-top:22px;}
        .signin footer{margin-top:20px;}
      `}</style>
    </main>
  );
}
