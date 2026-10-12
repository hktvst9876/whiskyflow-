// n8n Code node: run once for all items. No libraries, secrets or database access.
const input = $input.first().json.body;
const uuid =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const record = (v) => v !== null && typeof v === "object" && !Array.isArray(v);
const invalid = (message) => [
  {
    json: {
      valid: false,
      statusCode: 400,
      response: {
        ok: false,
        error: { code: "INVALID_EVENT", message, retryable: false },
      },
    },
  },
];
if (!record(input)) return invalid("Send a JSON object as the request body.");
if (
  Object.keys(input).some(
    (k) =>
      !["externalId", "sessionId", "customerRef", "items", "discount"].includes(
        k,
      ),
  )
)
  return invalid(
    "Send canonical order fields only; do not include phone numbers or customer profiles.",
  );
if (
  typeof input.externalId !== "string" ||
  !input.externalId.trim() ||
  input.externalId.length > 128
)
  return invalid("A stable POS externalId of 1–128 characters is required.");
if (typeof input.sessionId !== "string" || !uuid.test(input.sessionId))
  return invalid("sessionId must be the current TablePulse visit UUID.");
// Never silently assume a discounted POS bill is organic.
if (typeof input.discount !== "boolean")
  return invalid("discount must explicitly be true or false.");
if (
  !Array.isArray(input.items) ||
  input.items.length < 1 ||
  input.items.length > 30
)
  return invalid("Send 1–30 order lines.");
if (
  input.items.some(
    (i) =>
      !record(i) ||
      Object.keys(i).some((k) => !["menuItemId", "quantity"].includes(k)) ||
      typeof i.menuItemId !== "string" ||
      !uuid.test(i.menuItemId) ||
      !Number.isInteger(i.quantity) ||
      i.quantity < 1 ||
      i.quantity > 50,
  )
)
  return invalid("Each line requires a menuItemId UUID and quantity of 1–50.");
if (
  input.customerRef !== undefined &&
  (typeof input.customerRef !== "string" ||
    input.customerRef.trim().length < 3 ||
    input.customerRef.length > 128)
)
  return invalid(
    "customerRef must be a verified POS loyalty reference, if provided.",
  );
const event = {
  externalId: input.externalId.trim(),
  sessionId: input.sessionId,
};
if (input.customerRef !== undefined)
  event.customerRef = input.customerRef.trim();
event.items = input.items.map((i) => ({
  menuItemId: i.menuItemId,
  quantity: i.quantity,
}));
event.discount = input.discount;
// Serialize once: Crypto and HTTP Request must use this identical string.
const rawBody = JSON.stringify(event);
const timestamp = String(Math.floor(Date.now() / 1000));
return [
  { json: { valid: true, externalId: event.externalId, rawBody, timestamp } },
];
