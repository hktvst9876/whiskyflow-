import "server-only";
import { waDigits } from "@/core/phone";
import type { OutboundWhatsApp, SendResult, WhatsAppProvider } from "./provider";

/**
 * WhatsApp Business Cloud API provider.
 * Business-initiated messages MUST use approved templates (utility/marketing). Free-form
 * text is only allowed as a reply within 24 hours of the customer's last message.
 * Template components: body parameters in order, plus URL buttons with a dynamic suffix
 * (configure each button URL in WhatsApp Manager as `https://your-app/w/{{1}}`).
 */
export function createMetaProvider(config: { phoneNumberId: string; accessToken: string; apiVersion: string }): WhatsAppProvider {
  const endpoint = `https://graph.facebook.com/${config.apiVersion}/${config.phoneNumberId}/messages`;
  return {
    name: "meta",
    async send(message: OutboundWhatsApp): Promise<SendResult> {
      const payload = message.template
        ? {
            messaging_product: "whatsapp",
            to: waDigits(message.to),
            type: "template",
            template: {
              name: message.template.name,
              language: { code: message.template.language },
              components: [
                {
                  type: "body",
                  parameters: message.template.parameters.map((text) => ({ type: "text", text: text || "-" })),
                },
                ...message.template.buttonUrlSuffixes.map((suffix, index) => ({
                  type: "button",
                  sub_type: "url",
                  index: String(index),
                  parameters: [{ type: "text", text: suffix }],
                })),
              ],
            },
          }
        : {
            messaging_product: "whatsapp",
            to: waDigits(message.to),
            type: "text",
            text: {
              preview_url: true,
              body: [message.body, ...message.buttons.map((b) => `${b.label}: ${b.url}`)].join("\n\n").slice(0, 4096),
            },
          };
      const response = await fetch(endpoint, {
        method: "POST",
        headers: { Authorization: `Bearer ${config.accessToken}`, "Content-Type": "application/json" },
        body: JSON.stringify(payload),
        signal: AbortSignal.timeout(15_000),
      });
      const json = (await response.json().catch(() => ({}))) as { messages?: { id: string }[]; error?: { message?: string; code?: number } };
      if (!response.ok || !json.messages?.[0]?.id) {
        throw new Error(`WhatsApp API ${response.status}: ${json.error?.message ?? "unknown error"}`);
      }
      return { providerMessageId: json.messages[0].id, status: "sent" };
    },
  };
}
