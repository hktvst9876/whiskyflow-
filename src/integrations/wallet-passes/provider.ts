/**
 * Apple Wallet / Google Wallet passes — Phase 2.
 *
 * The MVP wallet is the web wallet (/w/[token]) linked from WhatsApp, which works on every
 * phone without an app. Native passes add lock-screen presence but need: an Apple Pass
 * Type ID certificate + signed .pkpass bundles and an update web service; a Google Wallet
 * issuer account + a service account to create Generic/Loyalty objects via JWT links.
 * The interface below is the seam; the MVP never calls it.
 */
export interface WalletPassInput {
  merchantName: string;
  brandColor: string;
  customerRedeemCode: string;
  /** Lines such as "1 Main Waiting", "Macallan 12 · 42% remaining". */
  balances: string[];
  walletUrl: string;
}

export interface WalletPassProvider {
  readonly kind: "apple" | "google";
  /** Returns a URL the customer taps to add the pass. */
  createPass(input: WalletPassInput): Promise<{ addUrl: string }>;
  /** Push updated balances to an existing pass. */
  updatePass(passId: string, input: WalletPassInput): Promise<void>;
}

export class WalletPassesNotEnabled extends Error {
  constructor(kind: string) {
    super(`${kind} Wallet passes are a Phase 2 feature. Customers use the web wallet link for now.`);
  }
}
