import { redirect } from "next/navigation";
import { currentFirm } from "@/lib/tenancy";
import { currentCtx } from "@/modules/identity/actor";
import PeoplePortal from "@/components/PeoplePortal";

export const dynamic = "force-dynamic";

export default async function Home() {
  const firm = await currentFirm();
  if (!firm) return <NoWorkspace />;
  const ctx = await currentCtx();
  if (!ctx) redirect("/signin");
  return <PeoplePortal />;
}

function NoWorkspace() {
  return (
    <main className="signin"><div className="card"><h1>No workspace here</h1>
      <p>This address is not connected to a People portal. Check the link your HR team sent you.</p></div></main>
  );
}
