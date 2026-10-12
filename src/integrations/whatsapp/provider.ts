/**
 * WhatsApp provider interface. Business code calls `getWhatsAppProvider()` and never
 * imports a concrete provider.
 *
 * - demo:    stores the message as delivered (shown in the console's demo phone).
 * - console: logs to stdout (local development without Meta).
 * - meta:    WhatsApp Business Cloud API (template messages + free-form service replies).
 */
import type { MessageButton, MessageCategory } from "@/modules/messaging/types";

export interface OutboundWhatsApp {
  to: string;
  category: MessageCategory;
  /** Rendered text (used by demo/console and for free-form service replies). */
  body: string;
  /** Approved template name and ordered parameters (Meta, business-initiated). */
  template: { name: string; language: string; parameters: string[]; buttonUrlSuffixes: string[] } | null;
  buttons: MessageButton[];
}

export interface SendResult {
  providerMessageId: string;
  /** Final status known at send time (demo delivers immediately). */
  status: "sent" | "delivered";
}

export interface WhatsAppProvider {
  readonly name: "demo" | "console" | "meta";
  send(message: OutboundWhatsApp): Promise<SendResult>;
}
