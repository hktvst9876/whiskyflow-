import { NextRequest, NextResponse } from "next/server";
import { cookies } from "next/headers";
import { z } from "zod";
import { randomUUID } from "node:crypto";
import { authorize, HttpError } from "@/lib/server/auth";
import { snapshot } from "@/lib/server/snapshot";
import { readState, transact, resetDemo } from "@/lib/server/store";
import { demoMode } from "@/lib/server/config";
import { verifyDisplayToken } from "@/lib/server/tokens";
import { runCommand, ingestOrder } from "@/lib/server/commands";
import { SignedWebhookAdapter } from "@/lib/pos/webhook";
import { verifyIntegration } from "@/lib/server/integrations";
import { assertBrowserOrigin } from "@/lib/server/origin";
import { recommendForOrder } from "@/lib/server/offer-agent";
import { bill } from "@/lib/engine";
import {
  safetyReasons,
  incrementalProfit,
  incrementalMarginPercent,
} from "@/lib/engine";
export const dynamic = "force-dynamic";
const reply = (value: unknown, status = 200) =>
  NextResponse.json(value, {
    status,
    headers: { "Cache-Control": "no-store" },
  });
const fail = (e: unknown) =>
  reply(
    {
      error:
        e instanceof z.ZodError
          ? "Invalid input: " +
            e.issues.map((i) => i.path.join(".") + " " + i.message).join("; ")
          : e instanceof HttpError
            ? e.message
            : "The request could not be completed. Check server configuration.",
    },
    e instanceof z.ZodError ? 400 : e instanceof HttpError ? e.status : 500,
  );
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ path: string[] }> },
) {
  try {
    const route = (await params).path.join("/");
    if (route === "state") {
      const user = await authorize();
      return reply(await snapshot(user.role));
    }
    if (route === "display") {
      const id = verifyDisplayToken(
        request.nextUrl.searchParams.get("token") ?? "",
      );
      if (!id) throw new HttpError(404, "Screen session not found");
      const state = await readState(),
        session = state.sessions.find((s) => s.id === id && !s.closedAt);
      if (!session) throw new HttpError(410, "This table visit has ended");
      const instance = state.instances.find(
        (i) =>
          i.sessionId === id &&
          i.status === "active" &&
          new Date(i.expiresAt).getTime() > Date.now(),
      );
      const offer = instance
          ? state.offers.find((o) => o.id === instance.offerId)
          : null,
        item = offer ? state.menu.find((m) => m.id === offer.itemId) : null;
      const safe =
        offer &&
        item &&
        offer.enabled &&
        item.promotionEligible &&
        item.stock >= offer.quantity &&
        incrementalProfit(offer.price, item.cost, offer.quantity) >
          state.settings.minProfit &&
        incrementalMarginPercent(offer.price, item.cost) >=
          state.settings.minMarginPercent &&
        (!item.alcohol || (session.ageVerified && !session.intoxicated)) &&
        safetyReasons(state, session, Date.now(), true, !demoMode).length ===
          0 &&
        instance!.qualifyingOrderIds.every((id) =>
          state.orders.some((o) => o.id === id && !o.voided),
        );
      return reply({
        venue: state.venue.name,
        table: state.tables.find((t) => t.id === session.tableId)?.name,
        offer: safe
          ? {
              title: offer.name,
              item: item.name,
              price: offer.price,
              quantity: offer.quantity,
              alcohol: item.alcohol,
              code: instance!.code,
              expiresAt: instance!.expiresAt,
            }
          : null,
        highlights: state.menu
          .filter((m) => m.stock > 0 && !m.alcohol)
          .slice(0, 3)
          .map((m) => ({ name: m.name, price: m.price })),
        enrolled: !!state.customers.find(
          (c) => c.id === session.customerId && c.optedIn,
        ),
      });
    }
    if (route === "integrations/summary") {
      if (request.headers.has("x-tablepulse-signature"))
        verifyIntegration(request);
      else await authorize(["manager", "platform_admin"]);
      const s = await readState();
      const since =
        request.nextUrl.searchParams.get("since") ??
        new Date(Date.now() - 86400000).toISOString();
      if (!Number.isFinite(Date.parse(since)))
        throw new HttpError(400, "Invalid since timestamp");
      const rows = s.redemptions.filter(
        (r) => Date.parse(r.createdAt) >= Date.parse(since),
      );
      return reply({
        venue: s.venue.name,
        since,
        redemptions: rows.length,
        revenue: rows.reduce((n, r) => n + r.revenue, 0),
        estimatedProfit: rows.reduce((n, r) => n + r.profit, 0),
        discountCost: rows.reduce((n, r) => n + r.discount, 0),
        lowInventory: s.menu
          .filter((m) => m.stock < 10)
          .map((m) => ({ id: m.id, name: m.name, stock: m.stock })),
        suspicious: s.audits
          .filter(
            (a) =>
              a.action === "Redemption rejected" &&
              Date.parse(a.createdAt) >= Date.parse(since),
          )
          .map((a) => ({ id: a.id, createdAt: a.createdAt, detail: a.detail })),
      });
    }
    throw new HttpError(404, "Endpoint not found");
  } catch (e) {
    return fail(e);
  }
}
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ path: string[] }> },
) {
  try {
    if (Number(request.headers.get("content-length") ?? 0) > 65536)
      throw new HttpError(413, "Request too large");
    const route = (await params).path.join("/");
    if (route === "integrations/optout") {
      const raw = await request.text();
      if (raw.length > 65536) throw new HttpError(413, "Request too large");
      verifyIntegration(request, raw);
      const body = z.object({ customerId: z.uuid() }).parse(JSON.parse(raw));
      return reply(
        await runCommand(
          { action: "optout", customerId: body.customerId },
          "n8n synchronisation",
        ),
      );
    }
    if (route === "pos/events" || route === "offers/evaluate") {
      const raw = await request.text();
      if (raw.length > 65536) throw new HttpError(413, "Request too large");
      const timestamp = request.headers.get("x-tablepulse-timestamp") ?? "";
      if (
        !/^\d+$/.test(timestamp) ||
        Math.abs(Date.now() - Number(timestamp) * 1000) > 300000
      )
        throw new HttpError(401, "Webhook timestamp expired");
      const adapter = new SignedWebhookAdapter();
      if (
        !adapter.verify(
          `${timestamp}.${raw}`,
          request.headers.get("x-tablepulse-signature") ?? "",
        )
      )
        throw new HttpError(401, "Invalid webhook signature");
      const event = adapter.normalize(JSON.parse(raw));
      const advisor = await recommendForOrder(event);
      return reply(
        await transact((s) => {
          const result = ingestOrder(s, event, {
            recommendation: advisor.recommendation,
          });
          if (advisor.attempted && !("duplicate" in result && result.duplicate))
            s.audits.push({
              id: randomUUID(),
              createdAt: new Date().toISOString(),
              actor: "Offer advisor",
              action: "AI offer ranking",
              detail: advisor.detail,
              sessionId: event.sessionId,
            });
          return result;
        }),
      );
    }
    // Browser mutations must originate from this application.
    assertBrowserOrigin(request);
    const raw = await request.text();
    if (raw.length > 65536) throw new HttpError(413, "Request too large");
    const body = JSON.parse(raw);
    if (route === "enrol") {
      const input = z
          .object({
            token: z.string(),
            consent: z.literal(true),
            preferences: z
              .array(
                z.enum([
                  "food",
                  "beer",
                  "wine",
                  "cocktail",
                  "zero_alcohol",
                  "snack",
                ]),
              )
              .max(6),
          })
          .parse(body),
        id = verifyDisplayToken(input.token);
      if (!id) throw new HttpError(404, "Screen session not found");
      return reply(
        await transact((s) => {
          const session = s.sessions.find((x) => x.id === id && !x.closedAt);
          if (!session) throw new HttpError(410, "This visit has ended");
          const customer = s.customers.find((c) => c.id === session.customerId);
          if (customer?.authUserId)
            throw new HttpError(
              403,
              "Member preferences must be changed from the signed-in member account.",
            );
          if (customer) {
            customer.optedIn = true;
            customer.preferences = input.preferences;
          } else {
            const customerId = randomUUID();
            s.customers.push({
              id: customerId,
              optedIn: true,
              preferences: input.preferences,
              entitlement: false,
            });
            session.customerId = customerId;
          }
          s.audits.push({
            id: randomUUID(),
            createdAt: new Date().toISOString(),
            actor: "Customer",
            action: "Rewards consent granted",
            detail: session.customerId!,
          });
          return { ok: true };
        }),
      );
    }
    const user = await authorize();
    if (route === "demo/role") {
      if (!demoMode) throw new HttpError(404, "Not available");
      const { role } = z
        .object({ role: z.enum(["manager", "staff", "platform_admin"]) })
        .parse(body);
      (await cookies()).set("tablepulse-demo-role", role, {
        httpOnly: true,
        sameSite: "strict",
        secure: request.nextUrl.protocol === "https:",
        path: "/",
      });
      return reply({ ok: true });
    }
    if (route === "demo/reset") {
      await authorize(["manager", "platform_admin"]);
      return reply(await resetDemo());
    }
    if (route === "commands") {
      if (["settings", "offer", "stock", "optout"].includes(body.action))
        await authorize(["manager", "platform_admin"]);
      const result = await runCommand(body, user.actor);
      return reply(result, "ok" in result && !result.ok ? 409 : 200);
    }
    throw new HttpError(404, "Endpoint not found");
  } catch (e) {
    return fail(e);
  }
}
