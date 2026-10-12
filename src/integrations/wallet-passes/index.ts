import { WalletPassesNotEnabled, type WalletPassProvider } from "./provider";

/** Stubs (Phase 2). See provider.ts for what each needs. */
export const applePasses: WalletPassProvider = {
  kind: "apple",
  createPass: async () => {
    throw new WalletPassesNotEnabled("Apple");
  },
  updatePass: async () => {
    throw new WalletPassesNotEnabled("Apple");
  },
};

export const googlePasses: WalletPassProvider = {
  kind: "google",
  createPass: async () => {
    throw new WalletPassesNotEnabled("Google");
  },
  updatePass: async () => {
    throw new WalletPassesNotEnabled("Google");
  },
};

export type { WalletPassProvider, WalletPassInput } from "./provider";
