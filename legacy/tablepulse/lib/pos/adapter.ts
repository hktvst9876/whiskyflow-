import { z } from "zod";
export const eventSchema = z.object({
  externalId: z.string().min(1).max(128),
  sessionId: z.uuid(),
  customerRef: z.string().trim().min(3).max(128).optional(),
  items: z
    .array(
      z.object({
        menuItemId: z.uuid(),
        quantity: z.number().int().min(1).max(50),
      }),
    )
    .min(1)
    .max(30),
  discount: z.boolean().default(false),
});
export type PosOrderEvent = z.infer<typeof eventSchema>;
export interface PosAdapter {
  provider: string;
  verify(rawBody: string, signature: string): boolean;
  normalize(payload: unknown): PosOrderEvent;
}
export class MockPosAdapter implements PosAdapter {
  provider = "mock";
  verify() {
    return true;
  }
  normalize(payload: unknown) {
    return eventSchema.parse(payload);
  }
}
