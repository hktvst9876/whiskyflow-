import { NextRequest, NextResponse } from "next/server";
import { authClient } from "@/lib/server/supabase";
import { demoMode } from "@/lib/server/config";
import { assertBrowserOrigin } from "@/lib/server/origin";
export async function POST(request: NextRequest) {
  try {
    assertBrowserOrigin(request);
  } catch {
    return NextResponse.json({ error: "Invalid origin" }, { status: 403 });
  }
  if (demoMode)
    return NextResponse.json(
      { error: "Use the demo role selector" },
      { status: 400 },
    );
  const { email, password, action } = await request.json();
  const client = await authClient();
  if (action === "logout") {
    await client.auth.signOut();
    return NextResponse.json({ ok: true });
  }
  if (
    typeof email !== "string" ||
    typeof password !== "string" ||
    email.length > 254 ||
    password.length > 256
  )
    return NextResponse.json({ error: "Invalid credentials" }, { status: 400 });
  const { error } = await client.auth.signInWithPassword({ email, password });
  return NextResponse.json(
    error
      ? { error: "Sign-in failed. Check your email and password." }
      : { ok: true },
    { status: error ? 401 : 200 },
  );
}
