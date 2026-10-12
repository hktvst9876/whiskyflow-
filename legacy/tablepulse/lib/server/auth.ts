import "server-only";
import { cookies } from "next/headers";
import type { Role } from "../types";
import { demoMode, venueId } from "./config";
import { authClient, adminClient } from "./supabase";
export class HttpError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}
export async function authorize(
  allowed: Role[] = ["platform_admin", "manager", "staff"],
) {
  if (demoMode) {
    const candidate =
      (await cookies()).get("tablepulse-demo-role")?.value ?? "manager";
    const role = (
      ["platform_admin", "manager", "staff"].includes(candidate)
        ? candidate
        : "manager"
    ) as Role;
    if (!allowed.includes(role))
      throw new HttpError(403, "Your role cannot perform this action");
    return { role, actor: "Demo user" };
  }
  const client = await authClient();
  const {
    data: { user },
    error,
  } = await client.auth.getUser();
  if (error || !user) throw new HttpError(401, "Please sign in");
  const { data } = await adminClient()
    .from("venue_users")
    .select("role")
    .eq("user_id", user.id)
    .eq("venue_id", venueId)
    .maybeSingle();
  if (!data || !allowed.includes(data.role))
    throw new HttpError(403, "Your role cannot perform this action");
  return { role: data.role as Role, actor: user.id };
}
