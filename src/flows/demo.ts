import "server-only";
import { logger } from "@/core/logger";
import { localParts, zonedDateTime } from "@/core/time";
import type { Db } from "@/server/db";
import { listEntitlements, listPrograms } from "@/modules/anchors/repo";
import { createUser } from "@/modules/auth/service";
import { findUserByEmail, insertMembership } from "@/modules/auth/repo";
import { listItems } from "@/modules/catalog/repo";
import type { CatalogItem } from "@/modules/catalog/types";
import { merchants } from "@/modules/merchants/schema";
import type { Merchant } from "@/modules/merchants/types";
import { DEMO_VERTICALS, verticalPreset } from "@/verticals";
import type { Actor } from "@/modules/anchors/service";
import { launchCampaign } from "./campaigns";
import { claimByToken } from "./claim-anchor";
import { closeVisit } from "./close-visit";
import { evaluateCheckoutOffer } from "./checkout-offer";
import type { FlowContext } from "./context";
import { acceptOffer, declineOffer, keepStoredPurchase } from "./issue-anchor";
import { createMerchantFromPreset } from "./onboarding";
import { addUpsell, getUpsellForVisit, recordBottleLevel, redeemEntitlement } from "./redemption";
import { runSchedulerTick } from "./scheduler";
import { addItem, applyCustomerPromo, openVisit, visitView } from "./visits";

/**
 * Demo data: four showcase merchants (restaurant, bar, beer pub, spa) with ~6 weeks of
 * SIMULATED customers driven through the real flows on a simulated clock — offers,
 * claims, WhatsApp reminders, redemptions, upsells, campaigns and the holdout. Nothing
 * here is real customer data; the console labels it "Demo data".
 *
 * The simulation gives anchor holders a higher chance to come back. That is an
 * assumption of the demo, NOT evidence: the holdout report on demo data only shows how
 * the measurement works. Real lift must come from a real pilot.
 */

export const DEMO_PASSWORD = "demo1234";
export const DEMO_ACCOUNTS = {
  owner: { email: "owner@demo.returnanchor.app", name: "Demo Owner" },
  staff: { email: "staff@demo.returnanchor.app", name: "Demo Staff" },
} as const;

/** Small deterministic PRNG so every seed produces the same demo. */
function mulberry32(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

interface SimCustomer {
  phone: string;
  name: string;
  /** Baseline chance of visiting on any given day. */
  dailyRate: number;
  customerId: string | null;
}

const FIRST_NAMES = ["Mei", "Arjun", "Siti", "Daniel", "Hui Min", "Ravi", "Aisha", "Marcus", "Priya", "Wei Jie", "Nur", "Ethan", "Grace", "Farid", "Chloe", "Kumar", "Li Ting", "Ben", "Zara", "Jun"];

export interface SeedOptions {
  now: Date;
  days?: number;
  /** Multiplies the presets' visits per day. */
  scale?: number;
  seed?: number;
  /** Called after each simulated day (0-1). */
  onProgress?: (fraction: number) => void;
}

export interface SeedSummary {
  merchants: { name: string; slug: string; visits: number; anchors: number; redemptions: number }[];
  ms: number;
}

export async function demoSeeded(db: Db): Promise<boolean> {
  const rows = await db.select({ id: merchants.id }).from(merchants).limit(1);
  return rows.length > 0;
}

async function ensureUser(db: Db, account: { email: string; name: string }) {
  return (await findUserByEmail(db, account.email)) ?? (await createUser(db, { ...account, password: DEMO_PASSWORD }));
}

function pick<T>(rand: () => number, list: readonly T[]): T {
  return list[Math.floor(rand() * list.length)]!;
}

/** A local time on the simulated day (lunch/dinner/evening depending on the vertical). */
function visitTime(day: Date, merchant: Merchant, rand: () => number): Date {
  const p = localParts(day, merchant.timezone);
  const windows: Record<string, [number, number][]> = {
    restaurant: [[12, 14], [18, 21]],
    bar: [[19, 23]],
    beer_pub: [[17, 22]],
    spa: [[11, 19]],
  };
  const w = pick(rand, windows[merchant.vertical] ?? [[11, 20]]);
  const hour = w[0] + Math.floor(rand() * (w[1] - w[0]));
  return zonedDateTime({ year: p.year, month: p.month, day: p.day, hour, minute: Math.floor(rand() * 60) }, merchant.timezone);
}

interface SimState {
  merchant: Merchant;
  rand: () => number;
  catalog: CatalogItem[];
  programs: Awaited<ReturnType<typeof listPrograms>>;
  population: SimCustomer[];
  stats: { visits: number; anchors: number; redemptions: number };
}

async function simState(db: Db, merchant: Merchant, options: { seed: number; scale: number }): Promise<SimState> {
  const demo = verticalPreset(merchant.vertical).demo!;
  const rand = mulberry32(options.seed + merchant.vertical.length * 101);
  return {
    merchant,
    rand,
    catalog: (await listItems(db, merchant.id)).filter((i) => i.active),
    programs: await listPrograms(db, merchant.id, { status: "active" }),
    population: Array.from({ length: Math.round(demo.visitsPerDay * options.scale * 9) }, (_, i) => ({
      phone: `+658${String(1000000 + Math.floor(rand() * 8999999)).padStart(7, "0")}`,
      name: `${pick(rand, FIRST_NAMES)} ${String.fromCharCode(65 + (i % 26))}.`,
      dailyRate: 0.012 + rand() * 0.05,
      customerId: null,
    })),
    stats: { visits: 0, anchors: 0, redemptions: 0 },
  };
}

async function simulateDay(db: Db, state: SimState, staffActor: Actor, scale: number, dayStart: Date): Promise<void> {
  const { merchant, rand, catalog, programs, population, stats } = state;
  const demo = verticalPreset(merchant.vertical).demo!;
  const byCategory = (cat: string) => catalog.filter((i) => i.category === cat);
  const weekday = localParts(dayStart, merchant.timezone).weekday;
  const busy = weekday === 5 || weekday === 6 ? 1.4 : weekday === 1 ? 0.7 : 1;
  const target = Math.max(1, Math.round(demo.visitsPerDay * scale * busy * (0.7 + rand() * 0.6)));
  const times = Array.from({ length: target }, () => visitTime(dayStart, merchant, rand)).sort((a, b) => a.getTime() - b.getTime());
  const holders = new Set(
    (await listEntitlements(db, merchant.id, { statuses: ["active"], limit: 5000 })).map((e) => e.customerId).filter((id): id is string => Boolean(id)),
  );
  const visitedToday = new Set<string>();

  for (const now of times) {
    const ctx: FlowContext = { merchantId: merchant.id, actor: staffActor, now };
    // Who walks in? Known customers holding an anchor come back more often — the effect
    // the product is meant to create. Simulated here; measured for real by the holdout.
    const known = population.filter((c) => c.customerId && !visitedToday.has(c.customerId));
    let guest: SimCustomer | null = null;
    for (const c of known) {
      const p = (c.dailyRate * (holders.has(c.customerId!) ? 3 : 1) * 9) / (target + 4);
      if (rand() < p) {
        guest = c;
        break;
      }
    }
    if (guest?.customerId) visitedToday.add(guest.customerId);
    const partySize = pick(rand, demo.partySizes);
    const visit = await openVisit(db, ctx, { partySize, label: `T${1 + Math.floor(rand() * 20)}`, customerId: guest?.customerId ?? null });
    stats.visits++;

    // Redeem what they own first (staff scanned the wallet QR).
    let redeemedCategory: string | null = null;
    if (guest?.customerId) {
      const view = await visitView(db, ctx, visit.id);
      for (const a of view.anchors.filter((x) => x.redeemable)) {
        try {
          if (a.unitType === "percent") {
            const next = Math.max(0, a.quantityRemaining - (15 + Math.floor(rand() * 35)));
            await recordBottleLevel(db, ctx, { visitId: visit.id, entitlementId: a.id, percent: next });
          } else {
            const items = a.coveredCategory
              ? byCategory(a.coveredCategory).filter((i) => !a.maxCoveredPriceCents || i.priceCents <= a.maxCoveredPriceCents)
              : [];
            await redeemEntitlement(db, ctx, { visitId: visit.id, entitlementId: a.id, quantity: 1, itemId: items.length ? pick(rand, items).id : null });
          }
          redeemedCategory = a.coveredCategory;
          stats.redemptions++;
        } catch {
          // Restrictions (off-peak only, etc.) — the guest just orders normally.
        }
      }
      const promo = view.promos[0];
      if (promo && rand() < 0.5) await applyCustomerPromo(db, ctx, visit.id, promo.exposureId).catch(() => undefined);
    }

    // The order, built from the vertical's typical basket.
    for (const row of demo.basket) {
      const qty = Math.round(row.perGuest * partySize * (0.6 + rand() * 0.8) - (redeemedCategory === row.category ? 1 : 0));
      const choices = byCategory(row.category);
      for (let q = 0; q < qty && choices.length; q++) await addItem(db, ctx, visit.id, pick(rand, choices).id, 1);
    }
    // Occasional bottle / bucket / package purchases that get kept.
    const keepProgram = programs.find((p) => p.issueMode === "stored_purchase");
    const keepItems = catalog.filter(
      (i) =>
        (merchant.vertical === "bar" && i.category === "spirit_bottle") ||
        (merchant.vertical === "beer_pub" && i.category === "bucket") ||
        (merchant.vertical === "spa" && i.category === "package"),
    );
    let keptLineId: string | null = null;
    if (keepProgram && keepItems.length && rand() < (merchant.vertical === "bar" ? 0.18 : 0.08)) {
      keptLineId = (await addItem(db, ctx, visit.id, pick(rand, keepItems).id, 1)).id;
    }
    if (redeemedCategory) {
      const ups = await getUpsellForVisit(db, ctx, visit.id, 3);
      if (ups[0] && rand() < 0.55) {
        await addUpsell(db, ctx, { visitId: visit.id, itemId: ups[0].itemId, offerDefinitionId: ups[0].offerDefinitionId }).catch(() => undefined);
      }
    }
    if ((await visitView(db, ctx, visit.id)).lines.filter((l) => l.lineType === "regular").length === 0) {
      await addItem(db, ctx, visit.id, pick(rand, catalog.filter((i) => i.priceCents > 0)).id, 1);
    }

    // Checkout: the deal engine's offer, the guest's answer, the QR claim.
    const tokens: string[] = [];
    const offer = await evaluateCheckoutOffer(db, ctx, visit.id);
    if (offer?.exposure && offer.candidate) {
      if (rand() < Math.min(0.85, offer.candidate.pAccept * 2.2)) {
        const issued = await acceptOffer(db, ctx, offer.exposure.id);
        stats.anchors++;
        if (issued.claimToken) tokens.push(issued.claimToken);
      } else {
        await declineOffer(db, ctx, offer.exposure.id);
      }
    }
    if (keptLineId && keepProgram) {
      const quantity = keepProgram.unitType === "percent" ? 40 + Math.floor(rand() * 45) : keepProgram.unitsGranted - 1 - Math.floor(rand() * 2);
      if (quantity > 0) {
        const issued = await keepStoredPurchase(db, ctx, {
          visitId: visit.id,
          lineId: keptLineId,
          programId: keepProgram.id,
          quantity,
          storageLocation: keepProgram.unitType === "percent" ? `Shelf ${String.fromCharCode(65 + Math.floor(rand() * 4))}${1 + Math.floor(rand() * 9)}` : null,
        }).catch(() => null);
        if (issued) {
          stats.anchors++;
          if (issued.claimToken) tokens.push(issued.claimToken);
        }
      }
    }
    try {
      await closeVisit(db, ctx, visit.id);
    } catch {
      // e.g. a redemption that needs a new purchase — add one and close.
      await addItem(db, ctx, visit.id, pick(rand, catalog.filter((i) => i.priceCents > 0)).id, 1);
      await closeVisit(db, ctx, visit.id);
    }
    // Most guests scan the QR at the table; walk-ins become known customers here.
    for (const token of tokens) {
      if (rand() > 0.8) continue;
      const who = guest ?? population.find((c) => !c.customerId) ?? null;
      if (!who) continue;
      try {
        const claimed = await claimByToken(db, token, {
          phone: who.phone,
          name: who.name,
          serviceOptIn: true,
          marketingOptIn: rand() < 0.7,
          clientKey: `demo-${merchant.id}-${Math.floor(rand() * 1e6)}`,
          now: new Date(now.getTime() + 5 * 60_000),
        });
        who.customerId = claimed.customerId;
      } catch (error) {
        logger.debug("Demo claim skipped", { error: String(error) });
      }
    }
  }
}

/** Seed the demo merchants and simulate history up to `now`. Idempotent: skips when seeded. */
export async function seedDemo(db: Db, options: SeedOptions): Promise<SeedSummary | null> {
  const started = Date.now();
  if (await demoSeeded(db)) return null;
  const days = options.days ?? 42;
  const scale = options.scale ?? 0.6;
  const seed = options.seed ?? 20261012;
  const start = new Date(options.now.getTime() - days * 86_400_000);

  const owner = await ensureUser(db, DEMO_ACCOUNTS.owner);
  const staff = await ensureUser(db, DEMO_ACCOUNTS.staff);
  const created: Merchant[] = [];
  for (const vertical of DEMO_VERTICALS) {
    const demo = verticalPreset(vertical).demo!;
    const merchant = await createMerchantFromPreset(db, {
      name: demo.merchantName,
      slug: demo.slug,
      vertical,
      brandColor: demo.brandColor,
      ownerUserId: owner.id,
      // A shorter horizon so the demo's holdout report has matured customers to show.
      settings: { experiment: { horizonDays: 21 }, business: { bookingUrl: demo.bookingUrl ?? "" } },
      now: start,
    });
    await insertMembership(db, { userId: staff.id, merchantId: merchant.id, role: "staff" });
    created.push(merchant);
  }

  const summary: SeedSummary = { merchants: [], ms: 0 };
  const staffActor: Actor = { type: "staff", id: staff.id };
  const states = await Promise.all(created.map((m) => simState(db, m, { seed, scale })));
  // Simulate day by day across merchants so the scheduler sees one shared clock.
  for (let day = 0; day < days; day++) {
    const dayStart = new Date(start.getTime() + day * 86_400_000);
    for (const state of states) await simulateDay(db, state, staffActor, scale, dayStart);
    options.onProgress?.((day + 1) / days);
    // Morning and send-hour ticks: reminders, expiries, rescoring, fraud scan.
    await runSchedulerTick(db, new Date(dayStart.getTime() + 2 * 3_600_000));
    await runSchedulerTick(db, new Date(dayStart.getTime() + 9 * 3_600_000));
    if (day === days - 12) {
      for (const merchant of created) {
        const ctx: FlowContext = { merchantId: merchant.id, actor: { type: "user", id: owner.id }, now: new Date(dayStart.getTime() + 3 * 3_600_000) };
        await launchCampaign(db, ctx, "win_back").catch(() => undefined);
        await launchCampaign(db, ctx, "bring_a_friend").catch(() => undefined);
      }
    }
  }
  await runSchedulerTick(db, options.now);
  summary.merchants = states.map((st) => ({ name: st.merchant.name, slug: st.merchant.slug, ...st.stats }));
  summary.ms = Date.now() - started;
  return summary;
}

