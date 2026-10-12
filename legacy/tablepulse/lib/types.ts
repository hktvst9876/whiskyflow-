export type Category =
  "food" | "beer" | "wine" | "cocktail" | "zero_alcohol" | "snack";
export type Role = "platform_admin" | "manager" | "staff";
export interface MenuItem {
  id: string;
  name: string;
  category: Category;
  price: number;
  cost: number;
  stock: number;
  alcohol: boolean;
  age: number;
  promotionEligible: boolean;
  main?: boolean;
  bottle?: boolean;
}
export interface BasketItem {
  menuItemId: string;
  quantity: number;
  unitPrice?: number;
}
export interface Order {
  id: string;
  sessionId: string;
  externalId: string;
  items: BasketItem[];
  organic: boolean;
  discount: boolean;
  createdAt: string;
  voided: boolean;
}
export interface Table {
  id: string;
  name: string;
  seats: number;
  zone: string;
}
export interface Session {
  id: string;
  tableId: string;
  customerId?: string;
  customerVerified?: boolean;
  startedAt: string;
  closedAt?: string;
  ageVerified: boolean;
  intoxicated: boolean;
  blocked: boolean;
  offerReceived: boolean;
  rewardAttemptedAt?: string;
  membershipId?: string;
  control: boolean;
}
export type OfferKind =
  | "drink_pairing"
  | "snack_addon"
  | "bottle_tradeup"
  | "return_entitlement"
  | "premium_upgrade";
export interface Offer {
  id: string;
  name: string;
  kind: OfferKind;
  itemId: string;
  price: number;
  quantity: number;
  priority: number;
  dailyCap: number;
  duration: number;
  enabled: boolean;
  requiredItemIds?: string[];
}
export interface OfferInstance {
  id: string;
  sessionId: string;
  offerId: string;
  code: string;
  createdAt: string;
  expiresAt: string;
  status: "active" | "redeemed" | "cancelled";
  qualifyingOrderIds: string[];
  projectedProfit: number;
  score: number;
  redeemedAt?: string;
}
export interface Decision {
  id: string;
  sessionId: string;
  createdAt: string;
  outcome: "shown" | "withheld" | "control";
  reasons: string[];
  score?: number;
  offerId?: string;
  selectionSource?: "rules" | "ai";
  advisorRationale?: string;
}
export interface RewardHistory {
  customerId: string;
  offerId: string;
  createdAt: string;
  redeemedAt?: string;
}
export interface Customer {
  id: string;
  optedIn: boolean;
  preferences: Category[];
  entitlement: boolean;
  authUserId?: string;
  membershipId?: string;
  createdAt?: string;
  consentAt?: string;
  consentVersion?: string;
}
export interface MemberCheckin {
  id: string;
  sessionId: string;
  customerId: string;
  codeHash: string;
  expiresAt: string;
  attempts: number;
  consumedAt?: string;
}
export interface DemoOtp {
  id: string;
  subject: string;
  codeHash: string;
  createdAt: string;
  expiresAt: string;
  attempts: number;
  used: boolean;
}
export interface Audit {
  id: string;
  createdAt: string;
  actor: string;
  action: string;
  detail: string;
  sessionId?: string;
}
export interface Redemption {
  id: string;
  instanceId: string;
  sessionId: string;
  revenue: number;
  profit: number;
  discount: number;
  createdAt: string;
}
export interface Settings {
  minProfit: number;
  minMarginPercent: number;
  minScore: number;
  allocationProbability: number;
  controlPercent: number;
  paused: boolean;
}
export interface State {
  revision: number;
  venue: { id: string; name: string; location: string };
  settings: Settings;
  menu: MenuItem[];
  tables: Table[];
  sessions: Session[];
  orders: Order[];
  offers: Offer[];
  instances: OfferInstance[];
  decisions: Decision[];
  customers: Customer[];
  history: RewardHistory[];
  audits: Audit[];
  redemptions: Redemption[];
  memberCheckins?: MemberCheckin[];
  demoOtps?: DemoOtp[];
}
export interface Snapshot extends State {
  serverTime: number;
  mode: "demo" | "live";
  role: Role;
  displayTokens: Record<string, string>;
}
export const money = (n: number) => `S$${n.toFixed(2)}`;
export const profit = (item: MenuItem) => item.price - item.cost;
export const margin = (item: MenuItem) =>
  item.price ? (profit(item) / item.price) * 100 : 0;
