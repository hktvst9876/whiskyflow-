import "server-only";
import { env } from "@/config/env";
import { consoleProvider } from "./console";
import { demoProvider } from "./demo";
import { createMetaProvider } from "./meta-cloud";
import type { WhatsAppProvider } from "./provider";

let cached: WhatsAppProvider | null = null;

/** The configured provider (WHATSAPP_PROVIDER). Tests and demos use `demo`. */
export function getWhatsAppProvider(): WhatsAppProvider {
  if (cached) return cached;
  const w = env().whatsapp;
  if (w.provider === "meta") {
    if (!w.phoneNumberId || !w.accessToken) {
      throw new Error("WHATSAPP_PROVIDER=meta needs WHATSAPP_PHONE_NUMBER_ID and WHATSAPP_ACCESS_TOKEN.");
    }
    cached = createMetaProvider({ phoneNumberId: w.phoneNumberId, accessToken: w.accessToken, apiVersion: w.apiVersion });
  } else {
    cached = w.provider === "console" ? consoleProvider : demoProvider;
  }
  return cached;
}

/** Tests can swap the provider. */
export function setWhatsAppProviderForTests(provider: WhatsAppProvider | null) {
  cached = provider;
}

export type { WhatsAppProvider, OutboundWhatsApp, SendResult } from "./provider";
