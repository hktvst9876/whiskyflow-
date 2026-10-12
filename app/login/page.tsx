import type { Metadata } from "next";
import { redirect } from "next/navigation";
import {
  Anchor,
  ArrowRight,
  ChartNoAxesCombined,
  ShieldCheck,
} from "lucide-react";
import { loginAction } from "../actions";
import { getAuth } from "@/modules/auth/session";
import { DEMO_ACCOUNTS, DEMO_PASSWORD } from "@/flows/demo";
import { seedStatus } from "@/server/seed-status";
import { ActionForm, SubmitButton } from "@/ui/action-form";
import { Alert } from "@/ui/alert";
import { Field, Input } from "@/ui/field";
import { Progress } from "@/ui/progress";

export const metadata: Metadata = { title: "Sign in" };

export default async function LoginPage() {
  if (await getAuth()) redirect("/dashboard");
  const seed = seedStatus();
  return (
    <main className="min-h-screen lg:grid lg:grid-cols-[1.05fr_0.95fr]">
      <section className="relative hidden overflow-hidden bg-ink p-12 text-white lg:flex lg:flex-col lg:justify-between">
        <div className="absolute inset-0 bg-[radial-gradient(circle_at_25%_20%,rgba(20,184,166,0.24),transparent_32%),radial-gradient(circle_at_80%_75%,rgba(56,189,248,0.14),transparent_34%)]" />
        <div className="relative flex items-center gap-3 text-lg font-semibold">
          <span className="grid size-10 place-items-center rounded-xl bg-accent">
            <Anchor />
          </span>{" "}
          Return Anchor
        </div>
        <div className="relative max-w-xl">
          <p className="text-sm font-semibold tracking-[0.18em] text-teal-300 uppercase">
            Retention, measured properly
          </p>
          <h1 className="mt-5 text-5xl font-semibold leading-[1.08] tracking-tight">
            Give customers something worth coming back for.
          </h1>
          <p className="mt-6 max-w-lg text-lg leading-8 text-slate-300">
            Turn today’s purchase into unfinished ownership, then measure
            whether it creates profitable repeat visits.
          </p>
          <div className="mt-10 grid gap-4 sm:grid-cols-3">
            {[
              [ShieldCheck, "Margin protected"],
              [ChartNoAxesCombined, "Holdout measured"],
              [Anchor, "Owned, not points"],
            ].map(([Icon, label]) => {
              const Glyph = Icon as typeof Anchor;
              return (
                <div
                  key={String(label)}
                  className="rounded-xl border border-white/10 bg-white/5 p-4"
                >
                  <Glyph className="size-5 text-teal-300" />
                  <p className="mt-3 text-sm font-medium">{String(label)}</p>
                </div>
              );
            })}
          </div>
        </div>
        <p className="relative text-xs text-slate-400">
          Designed to optimise incremental profitable customer lifetime value.
        </p>
      </section>

      <section className="flex min-h-screen items-center justify-center p-6 sm:p-10">
        <div className="w-full max-w-md">
          <div className="mb-8 lg:hidden">
            <span className="inline-flex items-center gap-2 text-lg font-semibold">
              <Anchor className="size-6 text-accent" /> Return Anchor
            </span>
          </div>
          <h2 className="text-3xl font-semibold tracking-tight">
            Welcome back
          </h2>
          <p className="mt-2 text-ink-muted">
            Sign in to see today’s return opportunities.
          </p>

          {seed.state === "running" && (
            <Alert className="mt-6" title="Preparing the demo">
              <Progress
                className="mt-2"
                value={seed.progress * 100}
                valueText={`${Math.round(seed.progress * 100)}%`}
              />
            </Alert>
          )}
          {seed.state === "error" && (
            <Alert
              className="mt-6"
              tone="danger"
              title="Demo setup needs attention"
            >
              {seed.message}
            </Alert>
          )}

          <ActionForm action={loginAction} className="mt-8 space-y-5">
            <Field label="Email" name="email" required>
              <Input
                name="email"
                type="email"
                autoComplete="email"
                defaultValue={DEMO_ACCOUNTS.owner.email}
                required
              />
            </Field>
            <Field label="Password" name="password" required>
              <Input
                name="password"
                type="password"
                autoComplete="current-password"
                defaultValue={DEMO_PASSWORD}
                required
              />
            </Field>
            <SubmitButton
              fullWidth
              size="lg"
              pendingLabel="Signing in…"
              iconRight={<ArrowRight />}
            >
              Sign in
            </SubmitButton>
          </ActionForm>

          <div className="mt-6 rounded-xl border border-line bg-surface-muted p-4 text-sm text-ink-muted">
            <p className="font-semibold text-ink">Demo account</p>
            <p className="mt-1">{DEMO_ACCOUNTS.owner.email}</p>
            <p>Password: {DEMO_PASSWORD}</p>
          </div>
        </div>
      </section>
    </main>
  );
}
