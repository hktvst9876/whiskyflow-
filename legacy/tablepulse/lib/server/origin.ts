import "server-only";
import { HttpError } from "./auth";
import { demoMode } from "./config";
export function assertBrowserOrigin(request: Request) {
  const origin = request.headers.get("origin");
  const configured = process.env.NEXT_PUBLIC_APP_URL;
  // Next's internal URL can use localhost behind its dev server; Host preserves
  // the actual loopback address. Live hosting uses a fixed configured origin.
  if (!demoMode && !configured)
    throw new Error("NEXT_PUBLIC_APP_URL is required for live hosting");
  const expected = !demoMode
    ? new URL(configured!).origin
    : new URL(
        `${new URL(request.url).protocol}//${request.headers.get("host")}`,
      ).origin;
  if (!origin || origin !== expected)
    throw new HttpError(403, "Cross-origin request rejected");
}
