import "server-only";
import { createHmac, timingSafeEqual } from "node:crypto";
import { secret } from "../server/config";
import { eventSchema, type PosAdapter } from "./adapter";
export class SignedWebhookAdapter implements PosAdapter {
  provider = "tablepulse-canonical";
  verify(body: string, signature: string) {
    const expected = Buffer.from(
      createHmac("sha256", secret("TABLEPULSE_WEBHOOK_SECRET"))
        .update(body)
        .digest("hex"),
    );
    const supplied = Buffer.from(signature);
    return (
      supplied.length === expected.length && timingSafeEqual(supplied, expected)
    );
  }
  normalize(payload: unknown) {
    return eventSchema.parse(payload);
  }
}
