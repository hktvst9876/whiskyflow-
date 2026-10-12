// n8n HTTP Request includes status + body. No eligibility decisions are made here.
const result = $input.first().json;
const externalId = $("Validate order").first().json.externalId;
const status = Number(result.statusCode);
const body = result.body;
const output = (statusCode, response) => [{ json: { statusCode, response } }];
const failure = (statusCode, code, message, retryable) =>
  output(statusCode, {
    ok: false,
    externalId,
    error: { code, message, retryable },
  });
if (!Number.isInteger(status) || status < 200 || status > 599)
  return failure(
    502,
    "INVALID_BACKEND_RESPONSE",
    "TablePulse returned an unexpected response.",
    true,
  );
if (status >= 400) {
  if (status === 429)
    return failure(
      429,
      "BACKEND_BUSY",
      "Retry later using the same externalId and order.",
      true,
    );
  if (status >= 500)
    return failure(
      503,
      "BACKEND_UNAVAILABLE",
      "Retry later using the same externalId and order.",
      true,
    );
  if (status === 401 || status === 403)
    return failure(
      502,
      "INTEGRATION_CONFIGURATION",
      "The TablePulse integration needs operator attention.",
      false,
    );
  return failure(
    status,
    "ORDER_REJECTED",
    "The order was rejected. Check visit, item mapping, stock and externalId conflicts.",
    false,
  );
}
if (status !== 200 || !body || body.ok !== true)
  return failure(
    502,
    "INVALID_BACKEND_RESPONSE",
    "TablePulse did not confirm the order.",
    true,
  );
if (body.duplicate === true)
  return output(200, {
    ok: true,
    externalId,
    outcome: "duplicate",
    orderId: body.orderId,
  });
const decision = body.decision;
if (
  !decision ||
  !["shown", "withheld", "control"].includes(decision.outcome) ||
  typeof decision.id !== "string" ||
  !Array.isArray(decision.reasons) ||
  decision.reasons.some((v) => typeof v !== "string") ||
  (decision.outcome === "shown" && typeof decision.offerId !== "string")
)
  return failure(
    502,
    "INVALID_BACKEND_RESPONSE",
    "TablePulse did not return a valid decision.",
    true,
  );
return output(200, {
  ok: true,
  externalId,
  orderId: body.orderId,
  outcome: decision.outcome,
  decisionId: decision.id,
  ...(decision.offerId ? { offerId: decision.offerId } : {}),
  ...(typeof decision.score === "number" ? { score: decision.score } : {}),
  ...(["rules", "ai"].includes(decision.selectionSource)
    ? { selectionSource: decision.selectionSource }
    : {}),
  ...(decision.selectionSource === "ai" &&
  typeof decision.advisorRationale === "string"
    ? { advisorRationale: decision.advisorRationale.slice(0, 180) }
    : {}),
  reasons: decision.reasons,
});
