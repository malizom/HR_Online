import { redirect } from "next/navigation";
import { currentPerson } from "@/lib/auth";
import PeoplePortal from "@/components/PeoplePortal";

export const dynamic = "force-dynamic";

export default async function Home() {
  const me = await currentPerson();
  if (!me) redirect("/signin");
  return <PeoplePortal />;
}
