const fs = require("node:fs");
const { seed } = require("../lib/seed.ts");
const state = seed();
const q = (value) =>
  value === undefined || value === null
    ? "null"
    : `'${String(value).replaceAll("'", "''")}'`;
const json = (value) => `${q(JSON.stringify(value))}::jsonb`;
const lines = [
  "-- Generated demo service. Re-run pnpm seed:generate to refresh timestamps.",
  "begin;",
];
function insert(table, columns, values) {
  lines.push(
    `insert into public.${table} (${columns.join(",")}) values (${values.join(",")}) on conflict do nothing;`,
  );
}
const venue = q(state.venue.id);
insert(
  "venues",
  ["id", "name", "location", "settings"],
  [venue, q(state.venue.name), q(state.venue.location), json(state.settings)],
);
for (const c of state.customers) {
  insert("customers", ["id", "venue_id", "data"], [q(c.id), venue, json(c)]);
  insert(
    "customer_consents",
    ["customer_id", "venue_id", "granted", "granted_at"],
    [q(c.id), venue, String(c.optedIn), "now()"],
  );
}
for (const t of state.tables)
  insert("tables", ["id", "venue_id", "data"], [q(t.id), venue, json(t)]);
for (const s of state.sessions)
  insert(
    "table_sessions",
    ["id", "venue_id", "table_id", "customer_id", "data"],
    [q(s.id), venue, q(s.tableId), q(s.customerId), json(s)],
  );
for (const m of state.menu) {
  insert("menu_items", ["id", "venue_id", "data"], [q(m.id), venue, json(m)]);
  insert(
    "menu_item_costs",
    ["menu_item_id", "venue_id", "item_cost"],
    [q(m.id), venue, String(m.cost)],
  );
  insert(
    "inventory_availability",
    ["menu_item_id", "venue_id", "units"],
    [q(m.id), venue, String(m.stock)],
  );
}
for (const o of state.orders) {
  insert(
    "orders",
    ["id", "venue_id", "session_id", "external_id", "data"],
    [q(o.id), venue, q(o.sessionId), q(o.externalId), json(o)],
  );
  o.items.forEach((i, position) =>
    insert(
      "order_items",
      [
        "order_id",
        "position",
        "venue_id",
        "menu_item_id",
        "quantity",
        "unit_price",
      ],
      [
        q(o.id),
        String(position),
        venue,
        q(i.menuItemId),
        String(i.quantity),
        String(
          i.unitPrice ?? state.menu.find((m) => m.id === i.menuItemId).price,
        ),
      ],
    ),
  );
}
for (const o of state.offers) {
  insert(
    "offers",
    ["id", "venue_id", "menu_item_id", "data"],
    [q(o.id), venue, q(o.itemId), json(o)],
  );
  insert(
    "offer_rules",
    ["offer_id", "venue_id", "rule_type", "constraints"],
    [
      q(o.id),
      venue,
      q(o.kind),
      json({ duration: o.duration, quantity: o.quantity }),
    ],
  );
}
for (const i of state.instances)
  insert(
    "offer_instances",
    [
      "id",
      "venue_id",
      "session_id",
      "offer_id",
      "data",
      "status",
      "created_at",
      "expires_at",
    ],
    [
      q(i.id),
      venue,
      q(i.sessionId),
      q(i.offerId),
      json(i),
      q(i.status),
      q(i.createdAt),
      q(i.expiresAt),
    ],
  );
for (const d of state.decisions)
  insert(
    "offer_eligibility_logs",
    [
      "id",
      "venue_id",
      "session_id",
      "outcome",
      "reasons",
      "data",
      "created_at",
    ],
    [
      q(d.id),
      venue,
      q(d.sessionId),
      q(d.outcome),
      json(d.reasons),
      json(d),
      q(d.createdAt),
    ],
  );
for (const r of state.redemptions)
  insert(
    "offer_redemptions",
    [
      "id",
      "venue_id",
      "instance_id",
      "session_id",
      "revenue",
      "estimated_profit",
      "discount_cost",
      "data",
      "created_at",
    ],
    [
      q(r.id),
      venue,
      q(r.instanceId),
      q(r.sessionId),
      String(r.revenue),
      String(r.profit),
      String(r.discount),
      json(r),
      q(r.createdAt),
    ],
  );
for (const a of state.audits)
  insert(
    "audit_logs",
    ["id", "venue_id", "actor", "action", "detail", "data", "created_at"],
    [
      q(a.id),
      venue,
      q(a.actor),
      q(a.action),
      q(a.detail),
      json(a),
      q(a.createdAt),
    ],
  );
lines.push("commit;");
fs.writeFileSync("supabase/seed.sql", lines.join("\n") + "\n");
console.log(
  `Seed generated: ${state.menu.length} items, ${state.tables.length} tables.`,
);
