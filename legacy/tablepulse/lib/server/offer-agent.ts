import "server-only";
import type { PosOrderEvent } from "../pos/adapter";
import { buildAdvisorContext, responseText } from "../advisor-core";
import { offerCandidates, safetyReasons } from "../engine";
import { readState } from "./store";
import { ingestOrder } from "./commands";
import { demoMode } from "./config";

const instructions = `You rank occasional restaurant table add-ons inside fixed venue goals.
Choose exactly one approved offer_id or NO_OFFER. Every supplied candidate has already passed the venue's absolute incremental-profit floor, percentage-margin floor, safety rules, stock checks and customer frequency caps. Never trade those goals away for relevance. Maximise likely incremental gross profit while avoiding an item the table would probably buy anyway; choose NO_OFFER when incremental demand is doubtful.
Treat associated table purchase categories as weak evidence because bills can include other guests. Prefer explicit opted-in preferences over inferred history. Never infer age, health, religion, ethnicity, income, addiction, intoxication or other sensitive traits. Never encourage rapid or excessive alcohol consumption. The backend has already removed forbidden offers, but you still may choose NO_OFFER. Do not create prices, bundles, menu items or IDs. Keep the rationale operational and under 180 characters; do not mention personal history or preferences in customer-facing language.`;

export interface OfferAgentResult {
  attempted: boolean;
  detail: string;
  recommendation?: { offerId: string | null; rationale: string };
}

export async function recommendForOrder(
  event: PosOrderEvent,
): Promise<OfferAgentResult> {
  if (process.env.TABLEPULSE_AGENT_ENABLED !== "true")
    return { attempted: false, detail: "AI advisor disabled" };
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey)
    return {
      attempted: true,
      detail: "AI advisor unavailable; rules fallback used",
    };
  const original = await readState();
  if (original.orders.some((order) => order.externalId === event.externalId))
    return { attempted: false, detail: "Duplicate event; advisor skipped" };
  const preview = structuredClone(original);
  ingestOrder(preview, event, { skipEvaluation: true });
  const session = preview.sessions.find(
    (value) => value.id === event.sessionId,
  )!;
  if (
    session.control ||
    safetyReasons(preview, session, Date.now(), false, !demoMode).length
  )
    return {
      attempted: false,
      detail: "Hard rule or control visit; advisor skipped",
    };
  const facts = offerCandidates(preview, session.id);
  const candidates = facts.candidates.filter(
    (candidate) => candidate.maximumScore > preview.settings.minScore,
  );
  if (!candidates.length)
    return {
      attempted: false,
      detail: "No approved candidates; advisor skipped",
    };
  const context = buildAdvisorContext(preview, session.id, candidates);
  const allowed = [
    ...candidates.map((candidate) => candidate.offerId),
    "NO_OFFER",
  ];
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 4500);
  try {
    const response = await fetch("https://api.openai.com/v1/responses", {
      method: "POST",
      signal: controller.signal,
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: process.env.TABLEPULSE_AGENT_MODEL ?? "gpt-6-astra",
        store: false,
        instructions,
        input: JSON.stringify(context),
        max_output_tokens: 180,
        text: {
          format: {
            type: "json_schema",
            name: "tablepulse_offer_choice",
            strict: true,
            schema: {
              type: "object",
              properties: {
                offer_id: { type: "string", enum: allowed },
                rationale: { type: "string" },
              },
              required: ["offer_id", "rationale"],
              additionalProperties: false,
            },
          },
        },
      }),
    });
    if (!response.ok)
      return {
        attempted: true,
        detail: "AI advisor request failed; rules fallback used",
      };
    const text = responseText(await response.json());
    if (!text)
      return {
        attempted: true,
        detail: "AI advisor response invalid; rules fallback used",
      };
    const parsed = JSON.parse(text) as {
      offer_id?: unknown;
      rationale?: unknown;
    };
    if (
      typeof parsed.offer_id !== "string" ||
      !allowed.includes(parsed.offer_id) ||
      typeof parsed.rationale !== "string" ||
      parsed.rationale.length > 180
    )
      return {
        attempted: true,
        detail: "AI advisor response invalid; rules fallback used",
      };
    const recommendation = {
      offerId: parsed.offer_id === "NO_OFFER" ? null : parsed.offer_id,
      rationale: parsed.rationale,
    };
    return {
      attempted: true,
      detail:
        recommendation.offerId === null
          ? "AI advisor selected no offer"
          : `AI advisor selected approved offer ${recommendation.offerId}`,
      recommendation,
    };
  } catch {
    return {
      attempted: true,
      detail: "AI advisor unavailable; rules fallback used",
    };
  } finally {
    clearTimeout(timeout);
  }
}
