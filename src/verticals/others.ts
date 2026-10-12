/**
 * Smaller presets for cafés, salons, fitness and car care. Same engine, same loop:
 * entitlement → reminder → visit → add-on → redemption → renewal.
 */
import type { VerticalPreset } from "./types";

export const cafe: VerticalPreset = {
  key: "cafe",
  label: "Café",
  description: "Coffee cards that live in the wallet: \"4 Coffees Remaining\".",
  categories: [
    { key: "coffee", label: "Coffee", unitLabel: "Coffee", unitLabelPlural: "Coffees" },
    { key: "pastry", label: "Pastries", unitLabel: "Pastry", unitLabelPlural: "Pastries" },
    { key: "brunch", label: "Brunch", unitLabel: "Plate", unitLabelPlural: "Plates" },
  ],
  items: [
    { key: "flat-white", name: "Flat White", category: "coffee", price: 6, cost: 1.2, anchorable: true },
    { key: "latte", name: "Latte", category: "coffee", price: 6.5, cost: 1.3, anchorable: true },
    { key: "croissant", name: "Butter Croissant", category: "pastry", price: 5, cost: 1.2 },
    { key: "banana-bread", name: "Banana Bread", category: "pastry", price: 5.5, cost: 1.1 },
    { key: "eggs", name: "Eggs Benedict", category: "brunch", price: 19, cost: 5.5, tags: ["companion"] },
  ],
  programs: [
    {
      name: "Coffee card — keep 2 coffees",
      issueMode: "upgrade_offer",
      unitType: "item",
      unitLabel: "Coffee",
      unitLabelPlural: "Coffees",
      unitsGranted: 2,
      coverage: { kind: "category", category: "coffee", maxCoveredPrice: 6.5 },
      trigger: { requiredCategoryCounts: { coffee: 2 } },
      pricing: { minPriceRate: 0.4, maxPriceRate: 0.7 },
      validityDays: 30,
      redemption: {},
      transferable: true,
      refundPolicy: "none",
      upgradeAllowed: false,
      terms: "Two coffees on future visits within 30 days.",
    },
  ],
  offers: [{ offerType: "stored_addon", name: "Add a croissant for $4", config: { itemKeys: ["croissant"], bundlePrice: 4 } }],
  complements: { coffee: { pastry: 0.9, brunch: 0.5, coffee: 0.4 }, "*": { pastry: 0.6, coffee: 0.6 } },
  settings: { messaging: { reminderMinDays: 2, reminderMaxDays: 7, sendHour: 8, quietHoursEnd: "07:30" } },
};

export const salon: VerticalPreset = {
  key: "salon",
  label: "Salon",
  description: "Haircut + colour today, \"1 Treatment Waiting\" for next time.",
  categories: [
    { key: "haircut", label: "Haircuts", unitLabel: "Haircut", unitLabelPlural: "Haircuts" },
    { key: "colour", label: "Colour", unitLabel: "Colour", unitLabelPlural: "Colours" },
    { key: "treatment", label: "Treatments", unitLabel: "Treatment", unitLabelPlural: "Treatments" },
    { key: "retail", label: "Retail", unitLabel: "Product", unitLabelPlural: "Products" },
  ],
  items: [
    { key: "cut", name: "Cut & blow-dry", category: "haircut", kind: "service", price: 68, cost: 22 },
    { key: "colour", name: "Full colour", category: "colour", kind: "service", price: 140, cost: 45 },
    { key: "treatment", name: "Bond repair treatment", category: "treatment", kind: "service", price: 60, cost: 14, anchorable: true },
    { key: "mask", name: "Repair mask (retail)", category: "retail", price: 38, cost: 14 },
  ],
  programs: [
    {
      name: "Colour care — keep 1 treatment",
      issueMode: "upgrade_offer",
      unitType: "session",
      unitLabel: "Treatment",
      unitLabelPlural: "Treatments",
      unitsGranted: 1,
      coverage: { kind: "items", itemKeys: ["treatment"] },
      trigger: { requiredCategoryCounts: { colour: 1 } },
      pricing: { minPriceRate: 0.35, maxPriceRate: 0.6 },
      validityDays: 75,
      redemption: {},
      transferable: false,
      refundPolicy: "unused_within_14_days",
      upgradeAllowed: false,
      terms: "One bond repair treatment within 75 days.",
    },
  ],
  offers: [{ offerType: "off_peak_perk", name: "Weekday: complimentary mask sample", config: { perkItemKey: "mask" } }],
  complements: { treatment: { haircut: 0.9, retail: 0.6, colour: 0.4 }, "*": { treatment: 0.6, retail: 0.5 } },
  settings: { messaging: { reminderFraction: 0.8, reminderMaxDays: 28 } },
};

export const fitness: VerticalPreset = {
  key: "fitness",
  label: "Fitness",
  description: "Class packs: \"3 Classes Remaining\".",
  categories: [
    { key: "class", label: "Classes", unitLabel: "Class", unitLabelPlural: "Classes" },
    { key: "pt", label: "Personal training", unitLabel: "Session", unitLabelPlural: "Sessions" },
    { key: "shop", label: "Shop", unitLabel: "Item", unitLabelPlural: "Items" },
  ],
  items: [
    { key: "drop-in", name: "Drop-in class", category: "class", kind: "service", price: 35, cost: 8, anchorable: true },
    { key: "pt", name: "Personal training (60 min)", category: "pt", kind: "service", price: 110, cost: 45 },
    { key: "shake", name: "Protein shake", category: "shop", price: 9, cost: 2.5 },
  ],
  programs: [
    {
      name: "Starter pack — keep 3 classes",
      issueMode: "upgrade_offer",
      unitType: "session",
      unitLabel: "Class",
      unitLabelPlural: "Classes",
      unitsGranted: 3,
      coverage: { kind: "items", itemKeys: ["drop-in"] },
      trigger: { requiredCategoryCounts: { class: 1 } },
      pricing: { minPriceRate: 0.5, maxPriceRate: 0.75 },
      validityDays: 45,
      redemption: {},
      transferable: false,
      refundPolicy: "unused_within_14_days",
      upgradeAllowed: false,
      terms: "Three classes within 45 days.",
    },
  ],
  offers: [{ offerType: "renewal_bonus", name: "Renew: free protein shake", config: { perkItemKey: "shake" } }],
  complements: { class: { shop: 0.7, pt: 0.4, class: 0.5 }, "*": { shop: 0.5 } },
  settings: { messaging: { reminderMinDays: 3, reminderMaxDays: 7, sendHour: 7, quietHoursEnd: "06:30" } },
};

export const carCare: VerticalPreset = {
  key: "car_care",
  label: "Car care",
  description: "Detail today, \"1 Car Wash Remaining\" for next month.",
  categories: [
    { key: "wash", label: "Washes", unitLabel: "Car Wash", unitLabelPlural: "Car Washes" },
    { key: "detail", label: "Detailing", unitLabel: "Detail", unitLabelPlural: "Details" },
    { key: "addon", label: "Add-ons", unitLabel: "Add-on", unitLabelPlural: "Add-ons" },
  ],
  items: [
    { key: "wash", name: "Express wash", category: "wash", kind: "service", price: 25, cost: 7, anchorable: true },
    { key: "detail", name: "Full detail", category: "detail", kind: "service", price: 180, cost: 60 },
    { key: "wax", name: "Ceramic spray wax", category: "addon", kind: "service", price: 30, cost: 6, tags: ["addon"] },
  ],
  programs: [
    {
      name: "Detail + keep 1 wash",
      issueMode: "upgrade_offer",
      unitType: "session",
      unitLabel: "Car Wash",
      unitLabelPlural: "Car Washes",
      unitsGranted: 1,
      coverage: { kind: "items", itemKeys: ["wash"] },
      trigger: { requiredCategoryCounts: { detail: 1 } },
      pricing: { minPriceRate: 0.4, maxPriceRate: 0.6 },
      validityDays: 60,
      redemption: {},
      transferable: true,
      refundPolicy: "none",
      upgradeAllowed: false,
      terms: "One express wash within 60 days.",
    },
  ],
  offers: [{ offerType: "off_peak_perk", name: "Weekday: complimentary spray wax", config: { perkItemKey: "wax" } }],
  complements: { wash: { addon: 0.9, detail: 0.4 }, "*": { addon: 0.6 } },
  settings: { messaging: { reminderFraction: 0.8, reminderMaxDays: 28 } },
};
