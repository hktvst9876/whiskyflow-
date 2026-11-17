import { redirect } from "next/navigation";
import { getAuth } from "@/modules/auth/session";
import { homeFor } from "@/server/action";

export default async function HomePage() {
  const auth = await getAuth();
  redirect(auth ? homeFor(auth.role) : "/login");
}
