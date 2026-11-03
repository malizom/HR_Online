import { redirect } from "next/navigation";
import { auth, signIn } from "@/lib/auth";

export const dynamic = "force-dynamic";

export default async function SignIn({ searchParams }: { searchParams: Promise<{ error?: string }> }) {
  const session = await auth();
  if (session?.user) redirect("/");
  const { error } = await searchParams;
  const entra = !!process.env.AUTH_MICROSOFT_ENTRA_ID_ID;
  const dev = process.env.DEV_LOGIN === "true" && process.env.NODE_ENV !== "production";

  return (
    <main className="signin">
      <div className="card">
        <div className="brand"><div>MVR<span>ATTORNEYS</span></div></div>
        <h1>People &amp; Leave</h1>
        <p>Sign in with your MVR account. Access is limited to staff listed by HR.</p>
        {error && <div role="alert" className="error">
          {error === "AccessDenied" ? "Your account isn't on the staff list yet. Ask HR to add your email." : "Sign-in failed. Please try again."}
        </div>}
        {entra && (
          <form action={async () => { "use server"; await signIn("microsoft-entra-id", { redirectTo: "/" }); }}>
            <button className="primary" type="submit">Continue with Microsoft 365</button>
          </form>
        )}
        {dev && (
          <form action={async (fd: FormData) => { "use server"; await signIn("credentials", { email: String(fd.get("email") || ""), redirectTo: "/" }); }}>
            <label>Development sign-in (email on the staff list)
              <input name="email" type="email" required placeholder="you@mvrlaw.co.za" />
            </label>
            <button type="submit">Sign in (dev)</button>
          </form>
        )}
        {!entra && !dev && <p className="error">No sign-in method is configured. Set the Microsoft Entra ID variables in .env.</p>}
        <footer>MVR ATTORNEYS <span>People first. Every step of the way.</span></footer>
      </div>
      <style>{`
        .signin{min-height:100vh;display:flex;align-items:center;justify-content:center;padding:24px;background:linear-gradient(105deg,#e9f1e9,#f6f7f9);}
        .signin .card{width:420px;max-width:100%;}
        .signin .brand{margin:0 0 24px;}
        .signin h1{font-size:24px;}
        .signin form{margin-top:18px;}
        .signin form button{width:100%;margin-top:10px;}
        .signin label{margin-top:6px;}
        .signin footer{margin-top:28px;}
      `}</style>
    </main>
  );
}
