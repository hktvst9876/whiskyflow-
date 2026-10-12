import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";
import { compatibleAuth } from "@/lib/supabase-auth-compat";
export async function proxy(request: NextRequest) {
  let response = NextResponse.next({ request });
  if (
    !process.env.NEXT_PUBLIC_SUPABASE_URL ||
    process.env.TABLEPULSE_DEMO === "true"
  )
    return response;
  const client = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL,
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!,
    {
      ...(request.nextUrl.pathname === "/member" ||
      request.nextUrl.pathname.startsWith("/api/member")
        ? {
            cookieOptions: {
              name: "tablepulse-member-auth",
              httpOnly: true,
              sameSite: "lax" as const,
              secure: process.env.NODE_ENV === "production",
              path: "/",
            },
          }
        : {}),
      cookies: {
        getAll: () => request.cookies.getAll(),
        setAll: (cookies) => {
          cookies.forEach(({ name, value }) =>
            request.cookies.set(name, value),
          );
          response = NextResponse.next({ request });
          cookies.forEach(({ name, value, options }) =>
            response.cookies.set(name, value, options),
          );
        },
      },
    },
  );
  await compatibleAuth(client).auth.getUser();
  return response;
}
export const config = {
  matcher: [
    "/((?!_next/static|_next/image|favicon.svg|display|api/display).*)",
  ],
};
