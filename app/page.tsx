import { redirect } from "next/navigation";
import { getAuth } from "@/modules/auth/session";

export default async function HomePage() {
  redirect((await getAuth()) ? "/dashboard" : "/login");
}
