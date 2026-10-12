import "server-only";
import { cookies } from "next/headers";
import { randomUUID, randomInt } from "node:crypto";
import { z } from "zod";
import { demoMode, secret, venueId } from "./config";
import { authClient, adminClient } from "./supabase";
import { HttpError } from "./auth";
import { readState, transact } from "./store";
import {
  normalizePhone,
  digest,
  matchesDigest,
  ensureMember,
} from "../member-core";
import { verifyDisplayToken } from "./tokens";
import { bill } from "../basket";
import type { State } from "../types";

const key = () => secret("TABLEPULSE_CUSTOMER_SECRET");
const signKey = () => secret("TABLEPULSE_TOKEN_SECRET");
const categories = z.enum([
  "food",
  "beer",
  "wine",
  "cocktail",
  "zero_alcohol",
  "snack",
]);
export const memberInput = z.discriminatedUnion("action", [
  z.object({
    action: z.literal("request_otp"),
    phone: z.string().max(30),
    captchaToken: z.string().max(4096).optional(),
  }),
  z.object({
    action: z.literal("verify_otp"),
    phone: z.string().max(30),
    code: z.string().regex(/^\d{6}$/),
    challengeId: z.uuid().optional(),
  }),
  z.object({
    action: z.literal("preferences"),
    optedIn: z.boolean(),
    preferences: z.array(categories).max(6),
  }),
  z.object({ action: z.literal("checkin"), token: z.string().max(512) }),
  z.object({ action: z.literal("checkin_status"), token: z.string().max(512) }),
  z.object({ action: z.literal("logout") }),
]);
const phoneValue = (raw: string) => {
  try {
    return normalizePhone(raw);
  } catch (e) {
    throw new HttpError(400, (e as Error).message);
  }
};
async function budget(scope: string, window: number, limit: number) {
  const { data, error } = await adminClient().rpc("tablepulse_auth_allow", {
    p_venue: venueId,
    p_scope: scope,
    p_window: window,
    p_limit: limit,
  });
  if (error)
    throw new HttpError(
      503,
      "Member sign-in is not configured yet. Please ask the venue.",
    );
  if (!data)
    throw new HttpError(429, "Too many attempts. Please try again later.");
}
async function demoSubject() {
  const value = (await cookies()).get("tablepulse-demo-member")?.value;
  if (!value) return null;
  const [subject, expiry, signature] = value.split(".");
  if (
    !subject ||
    !expiry ||
    !signature ||
    Number(expiry) <= Date.now() ||
    !matchesDigest(signKey(), `demo-member:${subject}:${expiry}`, signature)
  )
    return null;
  return subject;
}
export async function memberSubject() {
  if (demoMode) return demoSubject();
  const client = await authClient(true);
  const {
    data: { user },
    error,
  } = await client.auth.getUser();
  if (error || !user || !user.phone || !user.phone_confirmed_at) return null;
  return user.id;
}
export async function memberView() {
  const subject = await memberSubject(),
    s = await readState();
  const customer = subject
    ? s.customers.find((c) => c.authUserId === subject)
    : undefined;
  if (!customer)
    return {
      mode: demoMode ? "demo" : "live",
      member: null,
      venue: s.venue.name,
    };
  const visits = s.sessions.filter(
    (v) => v.customerId === customer.id && v.customerVerified,
  );
  return {
    mode: demoMode ? "demo" : "live",
    venue: s.venue.name,
    member: {
      membershipId: customer.membershipId,
      optedIn: customer.optedIn,
      preferences: customer.preferences,
      createdAt: customer.createdAt,
    },
    visits: visits
      .slice()
      .sort((a, b) => Date.parse(b.startedAt) - Date.parse(a.startedAt))
      .slice(0, 10)
      .map((v) => ({
        table: s.tables.find((t) => t.id === v.tableId)?.name,
        startedAt: v.startedAt,
        closed: !!v.closedAt,
        billTotal: bill(s, v.id),
      })),
    rewardsUsed: s.history.filter(
      (h) => h.customerId === customer.id && h.redeemedAt,
    ).length,
  };
}
function memberIn(s: State, subject: string) {
  const customer = s.customers.find((c) => c.authUserId === subject);
  if (!customer) throw new HttpError(401, "Please verify your phone again.");
  return customer;
}
export async function memberCommand(raw: unknown) {
  const input = memberInput.parse(raw);
  if (input.action === "request_otp") {
    const phone = phoneValue(input.phone),
      subject = digest(key(), `demo-phone:${phone}`);
    if (demoMode) {
      return transact((s) => {
        s.demoOtps = (s.demoOtps ?? []).filter(
          (c) => Date.now() - Date.parse(c.createdAt) < 3600000,
        );
        const recent = s.demoOtps.filter((c) => c.subject === subject);
        if (
          recent.some((c) => Date.now() - Date.parse(c.createdAt) < 60000) ||
          recent.length >= 5 ||
          s.demoOtps.length >= 60
        )
          throw new HttpError(
            429,
            "Please wait before requesting another demo code.",
          );
        const id = randomUUID(),
          code = String(randomInt(100000, 1000000));
        s.demoOtps.push({
          id,
          subject,
          codeHash: digest(key(), `otp:${id}:${code}`),
          createdAt: new Date().toISOString(),
          expiresAt: new Date(Date.now() + 300000).toISOString(),
          attempts: 0,
          used: false,
        });
        return { ok: true, mode: "demo", challengeId: id, demoCode: code };
      });
    }
    if (process.env.TABLEPULSE_PHONE_LOGIN_ENABLED !== "true")
      throw new HttpError(503, "Customer SMS sign-in is not enabled yet.");
    if (!process.env.NEXT_PUBLIC_HCAPTCHA_SITE_KEY || !input.captchaToken)
      throw new HttpError(
        400,
        "Complete the security check before requesting a code.",
      );
    const hashed = digest(key(), `sms-phone:${phone}`);
    await budget("sms-hour-total", 3600, 60);
    await budget(`sms-minute:${hashed}`, 60, 1);
    await budget(`sms-hour:${hashed}`, 3600, 5);
    const client = await authClient(true);
    const { error } = await client.auth.signInWithOtp({
      phone,
      options: { shouldCreateUser: true, captchaToken: input.captchaToken },
    });
    if (error)
      throw new HttpError(
        error.status === 429 ? 429 : 400,
        "A code could not be sent. Please wait and try again, or ask the venue.",
      );
    return { ok: true, mode: "live" };
  }
  if (input.action === "verify_otp") {
    const phone = phoneValue(input.phone);
    let subject: string;
    if (demoMode) {
      const expected = digest(key(), `demo-phone:${phone}`);
      const result = await transact((s) => {
        const challenge = s.demoOtps?.find(
          (c) => c.id === input.challengeId && c.subject === expected,
        );
        if (
          !challenge ||
          challenge.used ||
          challenge.attempts >= 5 ||
          Date.parse(challenge.expiresAt) <= Date.now()
        )
          return { ok: false };
        challenge.attempts++;
        if (
          !matchesDigest(
            key(),
            `otp:${challenge.id}:${input.code}`,
            challenge.codeHash,
          )
        )
          return { ok: false };
        challenge.used = true;
        ensureMember(s, expected);
        return { ok: true };
      });
      if (!result.ok)
        throw new HttpError(
          400,
          "Code is invalid or expired. Request a new code when available.",
        );
      subject = expected;
      const expiry = String(Date.now() + 86400000);
      (await cookies()).set(
        "tablepulse-demo-member",
        `${subject}.${expiry}.${digest(signKey(), `demo-member:${subject}:${expiry}`)}`,
        {
          httpOnly: true,
          sameSite: "strict",
          secure: process.env.NODE_ENV === "production",
          path: "/",
          maxAge: 86400,
        },
      );
    } else {
      await budget(`verify:${digest(key(), phone)}`, 600, 10);
      const client = await authClient(true);
      const { data, error } = await client.auth.verifyOtp({
        phone,
        token: input.code,
        type: "sms",
      });
      if (error || !data.user?.phone_confirmed_at)
        throw new HttpError(400, "Code is invalid or expired.");
      subject = data.user.id;
      await transact((s) => {
        ensureMember(s, subject);
      });
    }
    return { ok: true };
  }
  if (input.action === "logout") {
    if (demoMode) (await cookies()).delete("tablepulse-demo-member");
    else await (await authClient(true)).auth.signOut({ scope: "local" });
    return { ok: true };
  }
  const subject = await memberSubject();
  if (!subject)
    throw new HttpError(401, "Please sign in to your member account.");
  return transact((s) => {
    const customer = memberIn(s, subject);
    if (input.action === "preferences") {
      customer.optedIn = input.optedIn;
      customer.preferences = input.optedIn
        ? Array.from(new Set(input.preferences))
        : [];
      customer.consentAt = new Date().toISOString();
      customer.consentVersion = "member-personalisation-v1";
      if (!input.optedIn) customer.entitlement = false;
      s.audits.push({
        id: randomUUID(),
        createdAt: customer.consentAt,
        actor: "Member",
        action: input.optedIn
          ? "Member personalisation granted"
          : "Member personalisation withdrawn",
        detail: customer.id,
      });
      return { ok: true };
    }
    const sessionId = verifyDisplayToken(input.token);
    const session = s.sessions.find((v) => v.id === sessionId && !v.closedAt);
    if (!session)
      throw new HttpError(
        410,
        "This table visit has ended. Scan the current table QR.",
      );
    if (input.action === "checkin_status")
      return {
        ok: true,
        confirmed:
          !!session.customerVerified && session.customerId === customer.id,
        table: s.tables.find((t) => t.id === session.tableId)?.name,
      };
    if (session.customerVerified && session.customerId !== customer.id)
      throw new HttpError(
        409,
        "This visit already has a verified customer. Please ask your server.",
      );
    if (session.customerVerified && session.customerId === customer.id)
      return {
        ok: true,
        confirmed: true,
        table: s.tables.find((t) => t.id === session.tableId)?.name,
      };
    s.memberCheckins = (s.memberCheckins ?? []).filter(
      (c) => Date.parse(c.expiresAt) > Date.now() - 86400000,
    );
    const recent = s.memberCheckins.filter(
      (c) =>
        c.customerId === customer.id && Date.parse(c.expiresAt) > Date.now(),
    );
    if (recent.length >= 3)
      throw new HttpError(
        429,
        "You already have recent check-in requests. Please wait five minutes or ask your server.",
      );
    const id = randomUUID(),
      code = String(randomInt(100000, 1000000)),
      expiresAt = new Date(Date.now() + 300000).toISOString();
    s.memberCheckins.push({
      id,
      customerId: customer.id,
      sessionId: session.id,
      codeHash: digest(key(), `checkin:${id}:${code}`),
      expiresAt,
      attempts: 0,
    });
    return {
      ok: true,
      checkinCode: code,
      expiresAt,
      table: s.tables.find((t) => t.id === session.tableId)?.name,
    };
  });
}
