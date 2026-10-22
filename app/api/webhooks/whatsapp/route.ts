import { env } from "@/config/env";
import { processMetaWebhook } from "@/flows/whatsapp-webhook";
import { verifyMetaSignature } from "@/integrations/whatsapp/signature";
import { verifySubscription } from "@/integrations/whatsapp/webhook";
import { errorResponse } from "@/server/action";
import { getNow } from "@/server/clock";
import { getDb } from "@/server/db";

/** Meta calls this once when the webhook URL is saved in the app dashboard. */
export async function GET(request: Request) {
  const challenge = verifySubscription(
    new URL(request.url).searchParams,
    env().whatsapp.verifyToken,
  );
  if (challenge === null) return new Response("Forbidden", { status: 403 });
  return new Response(challenge, {
    status: 200,
    headers: { "content-type": "text/plain" },
  });
}

/** Customer messages (STOP, START, balance questions) and delivery receipts. */
export async function POST(request: Request) {
  try {
    const appSecret = env().whatsapp.appSecret;
    if (!appSecret)
      return Response.json(
        { error: "WHATSAPP_APP_SECRET is not configured", code: "not_configured" },
        { status: 503 },
      );
    const raw = await request.text();
    if (
      !verifyMetaSignature(raw, request.headers.get("x-hub-signature-256"), appSecret)
    )
      return Response.json(
        { error: "Invalid signature", code: "unauthorized" },
        { status: 401 },
      );
    let body: unknown;
    try {
      body = JSON.parse(raw);
    } catch {
      return Response.json(
        { error: "Invalid JSON", code: "validation_error" },
        { status: 400 },
      );
    }
    const db = await getDb();
    return Response.json(await processMetaWebhook(db, body, await getNow(db)));
  } catch (error) {
    return errorResponse(error);
  }
}
