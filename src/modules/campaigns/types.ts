/** Campaign domain types. */

import type { Arm } from "../experiments/types";
import type { Segment } from "../scoring/types";

export type CampaignKind = "anchor_reminder" | "win_back" | "bring_a_friend" | "new_menu" | "vip_recognition" | "renewal";
export type CampaignStatus = "draft" | "scheduled" | "sending" | "completed" | "cancelled";

export interface Campaign {
  id: string;
  merchantId: string;
  kind: CampaignKind;
  name: string;
  segment: Segment | "anchor_holders" | "all";
  offerDefinitionId: string | null;
  status: CampaignStatus;
  holdoutRate: number;
  audienceCount: number;
  expectedCostCents: number;
  expectedReturnCents: number;
  scheduledFor: Date | null;
  createdBy: string | null;
  createdAt: Date;
}

export interface CampaignRecipient {
  campaignId: string;
  customerId: string;
  arm: Arm;
  messageId: string | null;
}

/** A suggested campaign computed from current segments (not yet stored). */
export interface CampaignSuggestion {
  kind: CampaignKind;
  name: string;
  segment: Campaign["segment"];
  why: string;
  audienceCount: number;
  offerDefinitionId: string | null;
  offerSummary: string;
  isDiscount: boolean;
  expectedCostCents: number;
  expectedReturnCents: number;
}
