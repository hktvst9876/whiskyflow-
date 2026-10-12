import type { State, MenuItem } from "./types";
const uuid = (n: number) =>
  `00000000-0000-4000-8000-${n.toString().padStart(12, "0")}`;
const rows: [
  string,
  MenuItem["category"],
  number,
  number,
  number,
  boolean?,
  boolean?,
][] = [
  ["Chargrilled ribeye", "food", 38, 13, 24, true],
  ["Truffle mushroom pasta", "food", 24, 6.4, 32, true],
  ["Miso salmon bowl", "food", 26, 8, 28, true],
  ["Smash cheeseburger", "food", 22, 6, 35, true],
  ["Korean corn chips", "snack", 8, 1.2, 60],
  ["Crispy calamari", "snack", 16, 4.2, 30],
  ["Truffle fries", "snack", 12, 2.5, 45],
  ["Edamame", "snack", 7, 1.1, 50],
  ["Tiger draught", "beer", 12, 3.3, 80],
  ["Craft pale ale", "beer", 15, 4, 54],
  ["House lager", "beer", 10, 2.8, 70],
  ["Shiraz · glass", "wine", 14, 4, 42],
  ["Sauvignon blanc · glass", "wine", 14, 3.8, 38],
  ["Barossa Shiraz · bottle", "wine", 65, 20, 18, false, true],
  ["Marlborough Sauvignon · bottle", "wine", 62, 18, 16, false, true],
  ["Classic negroni", "cocktail", 20, 5, 30],
  ["Passionfruit spritz", "cocktail", 19, 4.5, 30],
  ["Yuzu soda", "zero_alcohol", 9, 1.5, 48],
  ["Ginger lime fizz", "zero_alcohol", 10, 1.8, 40],
  ["Sparkling mineral water", "zero_alcohol", 6, 1, 60],
];
export function seed(now = Date.now()): State {
  const ago = (min: number) => new Date(now - min * 60000).toISOString();
  const menu: MenuItem[] = rows.map((r, i) => ({
    id: uuid(i + 1),
    name: r[0],
    category: r[1],
    price: r[2],
    cost: r[3],
    stock: r[4],
    main: r[5] ?? false,
    bottle: r[6] ?? false,
    alcohol: ["wine", "beer", "cocktail"].includes(r[1]),
    age: ["wine", "beer", "cocktail"].includes(r[1]) ? 18 : 0,
    promotionEligible: true,
  }));
  const tables = Array.from({ length: 12 }, (_, i) => ({
    id: uuid(101 + i),
    name: `T${String(i + 1).padStart(2, "0")}`,
    seats: [2, 4, 4, 6][i % 4],
    zone: i < 8 ? "Main floor" : "Terrace",
  }));
  const sessions = tables
    .filter((_, i) => ![3, 9].includes(i))
    .map((t, i) => ({
      id: uuid(201 + i),
      tableId: t.id,
      startedAt: ago(12 + i * 7),
      ageVerified: ![1, 6].includes(i),
      intoxicated: false,
      blocked: false,
      offerReceived: false,
      control: i === 7,
      customerId: i === 4 ? uuid(401) : undefined,
    }));
  const offers: State["offers"] = [
    {
      id: uuid(301),
      name: "The perfect pairing",
      kind: "drink_pairing",
      itemId: menu[17].id,
      price: 7,
      quantity: 2,
      priority: 80,
      dailyCap: 30,
      duration: 12,
      enabled: true,
    },
    {
      id: uuid(302),
      name: "A little crunch",
      kind: "snack_addon",
      itemId: menu[4].id,
      price: 3.9,
      quantity: 1,
      priority: 90,
      dailyCap: 25,
      duration: 12,
      enabled: true,
    },
    {
      id: uuid(303),
      name: "Make it a bottle",
      kind: "bottle_tradeup",
      itemId: menu[13].id,
      price: 56,
      quantity: 1,
      priority: 70,
      dailyCap: 8,
      duration: 15,
      enabled: true,
    },
    {
      id: uuid(304),
      name: "Welcome back pairing",
      kind: "return_entitlement",
      itemId: menu[18].id,
      price: 7.5,
      quantity: 1,
      priority: 85,
      dailyCap: 12,
      duration: 12,
      enabled: true,
    },
    {
      id: uuid(305),
      name: "Something on the side",
      kind: "premium_upgrade",
      itemId: menu[6].id,
      price: 8,
      quantity: 1,
      priority: 65,
      dailyCap: 20,
      duration: 10,
      enabled: true,
    },
  ];
  const orders: State["orders"] = sessions.slice(0, 8).map((s, i) => ({
    id: uuid(501 + i),
    externalId: `seed-order-${i}`,
    sessionId: s.id,
    items:
      i === 0 || i === 3
        ? [{ menuItemId: menu[8].id, quantity: 2 }]
        : i === 2
          ? [
              { menuItemId: menu[0].id, quantity: 1 },
              { menuItemId: menu[11].id, quantity: 1 },
            ]
          : [{ menuItemId: menu[i % 4].id, quantity: 2 }],
    organic: true,
    discount: false,
    createdAt: ago(8 + i * 5),
    voided: false,
  }));
  const instances: State["instances"] = [0, 1, 2].map((i) => {
    const offer = offers[i === 0 ? 1 : i === 2 ? 2 : 0];
    sessions[i].offerReceived = true;
    return {
      id: uuid(601 + i),
      sessionId: sessions[i].id,
      offerId: offer.id,
      code: ["KP7X3N", "YZ4M8Q", "BN6R2C"][i],
      createdAt: ago(i === 0 ? 3 : i === 1 ? 6 : 17),
      expiresAt: new Date(
        now + (i === 0 ? 9 : i === 1 ? 6 : -2) * 60000,
      ).toISOString(),
      status: i === 2 ? "redeemed" : "active",
      qualifyingOrderIds: [orders[i].id],
      projectedProfit:
        (offer.price - menu.find((m) => m.id === offer.itemId)!.cost) *
        offer.quantity,
      score: 85 + i * 3,
      redeemedAt: i === 2 ? ago(5) : undefined,
    };
  });
  orders.push({
    id: uuid(510),
    externalId: `reward-${instances[2].id}`,
    sessionId: sessions[2].id,
    items: [{ menuItemId: menu[13].id, quantity: 1, unitPrice: 56 }],
    organic: false,
    discount: true,
    createdAt: ago(5),
    voided: false,
  });
  return {
    revision: 0,
    venue: {
      id: "11111111-1111-4111-8111-111111111111",
      name: "The Sunday Social",
      location: "Boat Quay, Singapore",
    },
    settings: {
      minProfit: 2.5,
      minMarginPercent: 30,
      minScore: 65,
      allocationProbability: 0.78,
      controlPercent: 15,
      paused: false,
    },
    menu,
    tables,
    sessions,
    orders,
    offers,
    instances,
    decisions: instances.map((x) => ({
      id: uuid(701 + instances.indexOf(x)),
      sessionId: x.sessionId,
      createdAt: x.createdAt,
      outcome: "shown",
      reasons: [
        "Organic order qualified",
        "Margin floor met",
        "Within daily allocation",
      ],
      score: x.score,
      offerId: x.offerId,
    })),
    customers: [
      {
        id: uuid(401),
        optedIn: true,
        preferences: ["zero_alcohol", "food"],
        entitlement: true,
      },
    ],
    history: [],
    audits: [
      {
        id: uuid(801),
        createdAt: ago(10),
        actor: "System",
        action: "Service opened",
        detail: "Demo service · 12 tables",
      },
    ],
    redemptions: [
      {
        id: uuid(901),
        instanceId: instances[2].id,
        sessionId: sessions[2].id,
        revenue: 56,
        profit: 36,
        discount: 9,
        createdAt: ago(5),
      },
    ],
  };
}
