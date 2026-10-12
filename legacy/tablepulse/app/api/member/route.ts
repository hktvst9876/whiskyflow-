import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { memberCommand, memberView } from "@/lib/server/members";
import { assertBrowserOrigin } from "@/lib/server/origin";
import { HttpError } from "@/lib/server/auth";
export const dynamic = "force-dynamic";
const reply = (data: unknown, status = 200) =>
  NextResponse.json(data, {
    status,
    headers: { "Cache-Control": "no-store", "Referrer-Policy": "no-referrer" },
  });
function fail(e: unknown) {
  return reply(
    {
      error:
        e instanceof HttpError
          ? e.message
          : e instanceof z.ZodError
            ? "Please check the form and try again."
            : "Member service is unavailable. Please ask the venue.",
    },
    e instanceof HttpError ? e.status : e instanceof z.ZodError ? 400 : 503,
  );
}
export async function GET() {
  try {
    return reply(await memberView());
  } catch (e) {
    return fail(e);
  }
}
export async function POST(request: NextRequest) {
  try {
    assertBrowserOrigin(request);
    if (Number(request.headers.get("content-length") ?? 0) > 8192)
      throw new HttpError(413, "Request too large");
    const raw = await request.text();
    if (raw.length > 8192) throw new HttpError(413, "Request too large");
    let input: unknown;
    try {
      input = JSON.parse(raw);
    } catch {
      throw new HttpError(400, "Invalid JSON");
    }
    return reply(await memberCommand(input));
  } catch (e) {
    return fail(e);
  }
}
