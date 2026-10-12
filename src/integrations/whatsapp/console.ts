import { randomToken } from "@/core/ids";
import { maskPhone } from "@/core/phone";
import type { WhatsAppProvider } from "./provider";

/** Logs messages instead of sending them (development without Meta credentials). */
export const consoleProvider: WhatsAppProvider = {
  name: "console",
  async send(message) {
    const id = `console.${randomToken(12)}`;
    console.log(`\n[whatsapp → ${maskPhone(message.to)}] (${message.category})\n${message.body}\n${message.buttons.map((b) => `  [${b.label}] ${b.url}`).join("\n")}\n`);
    return { providerMessageId: id, status: "sent" };
  },
};
