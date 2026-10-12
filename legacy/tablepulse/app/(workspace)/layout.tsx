import { redirect } from "next/navigation";
import { authorize } from "@/lib/server/auth";
import { snapshot } from "@/lib/server/snapshot";
import { WorkspaceShell } from "@/components/workspace";
export const dynamic = "force-dynamic";
export default async function Layout({
  children,
}: {
  children: React.ReactNode;
}) {
  let user;
  try {
    user = await authorize();
  } catch {
    redirect("/login");
  }
  return (
    <WorkspaceShell initial={await snapshot(user.role)}>
      {children}
    </WorkspaceShell>
  );
}
