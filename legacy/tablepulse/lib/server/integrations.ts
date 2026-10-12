import "server-only";
import { SignedWebhookAdapter } from "../pos/webhook";
import { HttpError } from "./auth";
export function verifyIntegration(request: Request, body = "") {
  const timestamp = request.headers.get("x-tablepulse-timestamp") ?? "";
  if (
    !/^\d+$/.test(timestamp) ||
    Math.abs(Date.now() - Number(timestamp) * 1000) > 300000
  )
    throw new HttpError(401, "Webhook timestamp expired");
  if (
    !new SignedWebhookAdapter().verify(
      `${timestamp}.${body}`,
      request.headers.get("x-tablepulse-signature") ?? "",
    )
  )
    throw new HttpError(401, "Invalid webhook signature");
}
