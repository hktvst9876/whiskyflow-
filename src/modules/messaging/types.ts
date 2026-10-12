/** Messaging domain types. */

export type MessageDirection = "outbound" | "inbound";
export type MessageCategory = "utility" | "marketing" | "service_reply";
export type MessageStatus =
  | "scheduled"
  | "sending"
  | "sent"
  | "delivered"
  | "read"
  | "failed"
  | "suppressed"
  | "cancelled"
  | "received";

export const TEMPLATE_KEYS = [
  "anchor_confirmation",
  "anchor_reminder",
  "anchor_expiry_warning",
  "anchor_win_back",
  "bottle_low",
  "anchor_renewal",
  "redemption_receipt",
  "balance_reply",
  "opt_out_ack",
  "opt_in_ack",
  "campaign_offer",
] as const;
export type TemplateKey = (typeof TEMPLATE_KEYS)[number];

export type ButtonAction =
  | "view_balance"
  | "redeem"
  | "reserve"
  | "add_food"
  | "bring_friends"
  | "top_up"
  | "renew";

export interface MessageButton {
  action: ButtonAction;
  label: string;
  url: string;
}

export interface Message {
  id: string;
  merchantId: string;
  customerId: string | null;
  direction: MessageDirection;
  channel: "whatsapp";
  templateKey: TemplateKey | null;
  category: MessageCategory;
  toPhone: string | null;
  body: string;
  variables: Record<string, string>;
  buttons: MessageButton[];
  status: MessageStatus;
  scheduledFor: Date;
  sentAt: Date | null;
  provider: string | null;
  providerMessageId: string | null;
  error: string | null;
  suppressReason: string | null;
  dedupeKey: string | null;
  entitlementId: string | null;
  campaignId: string | null;
  offerExposureId: string | null;
  estCostCents: number;
  createdAt: Date;
  updatedAt: Date;
}

/** Facts the send-time policy needs about the recipient. */
export interface RecipientFacts {
  status: "active" | "anonymised";
  phoneE164: string | null;
  whatsappServiceOptIn: boolean;
  whatsappMarketingOptIn: boolean;
  optedOutAt: Date | null;
  lastVisitAt: Date | null;
  /** Marketing messages already sent in the last 7 / 30 days. */
  marketingSent7: number;
  marketingSent30: number;
}

export type SendDecision =
  | { action: "send" }
  | { action: "defer"; until: Date; reason: string }
  | { action: "suppress"; reason: string };
