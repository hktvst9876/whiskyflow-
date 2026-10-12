/**
 * WhatsApp message templates. Copy talks about what the customer OWNS ("You still have
 * 1 Main Waiting"), never about credit. For the Meta provider each template must be
 * created and approved in WhatsApp Manager with the same name and variable order
 * (`metaName`, `variables`). Edit copy here; keep variables in sync with Meta.
 */
import type { ButtonAction, MessageCategory, TemplateKey } from "./types";

export interface TemplateDef {
  key: TemplateKey;
  category: MessageCategory;
  /** Approved template name in WhatsApp Manager. */
  metaName: string;
  /** Ordered variables as numbered placeholders {{1}}, {{2}}, … in the Meta template. */
  variables: string[];
  body: string;
  /** Buttons rendered as links; the Meta template defines URL buttons with a dynamic suffix. */
  buttons: { action: ButtonAction; label: string }[];
  /** Reminders are suppressed when the customer visited very recently. */
  isReminder: boolean;
}

export const TEMPLATES: Record<TemplateKey, TemplateDef> = {
  anchor_confirmation: {
    key: "anchor_confirmation",
    category: "utility",
    metaName: "anchor_confirmation_v1",
    variables: ["merchant", "label", "expiry"],
    body: "You have {{label}} at {{merchant}}. 🎉\nShow your wallet QR when you're back and we'll have it ready. Valid until {{expiry}}.",
    buttons: [{ action: "view_balance", label: "View balance" }],
    isReminder: false,
  },
  anchor_reminder: {
    key: "anchor_reminder",
    category: "marketing",
    metaName: "anchor_reminder_v1",
    variables: ["merchant", "label", "personal_line", "offer_line"],
    body: "You still have {{label}} at {{merchant}}.{{personal_line}}{{offer_line}}",
    buttons: [
      { action: "reserve", label: "Reserve a table" },
      { action: "view_balance", label: "View balance" },
    ],
    isReminder: true,
  },
  anchor_expiry_warning: {
    key: "anchor_expiry_warning",
    category: "utility",
    metaName: "anchor_expiry_warning_v1",
    variables: ["merchant", "label", "expiry"],
    body: "Heads up: your {{label}} at {{merchant}} is valid until {{expiry}}. We'd love to see you before then.",
    buttons: [
      { action: "reserve", label: "Reserve a table" },
      { action: "view_balance", label: "View balance" },
    ],
    isReminder: true,
  },
  anchor_win_back: {
    key: "anchor_win_back",
    category: "marketing",
    metaName: "anchor_win_back_v1",
    variables: ["merchant", "label", "perk_line"],
    body: "Your {{label}} is still waiting at {{merchant}}.{{perk_line}}",
    buttons: [
      { action: "reserve", label: "Reserve a table" },
      { action: "redeem", label: "How to redeem" },
    ],
    isReminder: true,
  },
  bottle_low: {
    key: "bottle_low",
    category: "marketing",
    metaName: "bottle_low_v1",
    variables: ["merchant", "item", "level"],
    body: "Your {{item}} at {{merchant}} is almost finished ({{level}}% left). Want us to have your next bottle ready?",
    buttons: [
      { action: "top_up", label: "Reserve next bottle" },
      { action: "view_balance", label: "View balance" },
    ],
    isReminder: false,
  },
  anchor_renewal: {
    key: "anchor_renewal",
    category: "marketing",
    metaName: "anchor_renewal_v1",
    variables: ["merchant", "label", "bonus_line"],
    body: "You have {{label}} at {{merchant}}. Renew your package on your next visit{{bonus_line}}.",
    buttons: [
      { action: "renew", label: "Renew" },
      { action: "view_balance", label: "View balance" },
    ],
    isReminder: false,
  },
  redemption_receipt: {
    key: "redemption_receipt",
    category: "utility",
    metaName: "redemption_receipt_v1",
    variables: ["merchant", "used", "remaining"],
    body: "Enjoy! You used {{used}} at {{merchant}}. Remaining: {{remaining}}.",
    buttons: [{ action: "view_balance", label: "View balance" }],
    isReminder: false,
  },
  balance_reply: {
    key: "balance_reply",
    category: "service_reply",
    metaName: "",
    variables: ["merchant", "balances"],
    body: "Here's what you have at {{merchant}}:\n{{balances}}",
    buttons: [{ action: "view_balance", label: "Open wallet" }],
    isReminder: false,
  },
  opt_out_ack: {
    key: "opt_out_ack",
    category: "service_reply",
    metaName: "",
    variables: ["merchant"],
    body: "Done — you won't get offers from {{merchant}} any more. Your balance is safe in your wallet. Reply START to opt back in.",
    buttons: [],
    isReminder: false,
  },
  opt_in_ack: {
    key: "opt_in_ack",
    category: "service_reply",
    metaName: "",
    variables: ["merchant"],
    body: "Welcome back! {{merchant}} will let you know about what's waiting for you. Reply STOP any time.",
    buttons: [],
    isReminder: false,
  },
  campaign_offer: {
    key: "campaign_offer",
    category: "marketing",
    metaName: "campaign_offer_v1",
    variables: ["merchant", "headline"],
    body: "{{merchant}}: {{headline}}",
    buttons: [
      { action: "reserve", label: "Reserve a table" },
      { action: "view_balance", label: "View balance" },
    ],
    isReminder: true,
  },
};

/** Replace {{name}} placeholders. Unknown placeholders render as empty strings. */
export function renderTemplate(body: string, variables: Record<string, string>): string {
  return body.replace(/\{\{(\w+)\}\}/g, (_, name: string) => variables[name] ?? "").trim();
}

/** Build button links. Every action lands on the customer's wallet with a hint. */
export function buildButtons(
  key: TemplateKey,
  walletUrl: string | null,
  bookingUrl: string | null,
): { action: ButtonAction; label: string; url: string }[] {
  if (!walletUrl) return [];
  return TEMPLATES[key].buttons.map((b) => ({
    ...b,
    url: b.action === "reserve" && bookingUrl ? bookingUrl : `${walletUrl}${b.action === "view_balance" ? "" : `?action=${b.action}`}`,
  }));
}
