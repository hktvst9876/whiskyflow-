/**
 * Offer type registry. To add an offer type: create a file in this folder exporting an
 * `OfferKind`, add its key to OFFER_TYPE_KEYS in `../types.ts`, and register it here.
 */
import type { OfferTypeKey } from "../types";
import { bringAFriend } from "./bring-a-friend";
import { foodDrinkAttach, storedAddon } from "./bundles";
import { anchorUpgrade, newMenu, premiumUpgrade, priorityBooking } from "./non-cash";
import { offPeakPerk, renewalBonus, winBackPerk } from "./perks";
import type { OfferKind } from "./shared";

export const OFFER_KINDS: Record<OfferTypeKey, OfferKind> = {
  anchor_upgrade: anchorUpgrade as unknown as OfferKind,
  stored_addon: storedAddon as unknown as OfferKind,
  food_drink_attach: foodDrinkAttach as unknown as OfferKind,
  bring_a_friend: bringAFriend as unknown as OfferKind,
  new_menu: newMenu as unknown as OfferKind,
  off_peak_perk: offPeakPerk as unknown as OfferKind,
  premium_upgrade: premiumUpgrade as unknown as OfferKind,
  renewal_bonus: renewalBonus as unknown as OfferKind,
  win_back_perk: winBackPerk as unknown as OfferKind,
  priority_booking: priorityBooking as unknown as OfferKind,
};

export function offerKind(key: OfferTypeKey): OfferKind {
  return OFFER_KINDS[key];
}

export type { OfferKind, OfferLine, BillLine, OfferCopyContext } from "./shared";
