import { randomToken } from "@/core/ids";
import type { WhatsAppProvider } from "./provider";

/** Demo provider: nothing leaves the machine; the console shows messages in a demo phone. */
export const demoProvider: WhatsAppProvider = {
  name: "demo",
  async send() {
    return { providerMessageId: `demo.${randomToken(12)}`, status: "delivered" };
  },
};
