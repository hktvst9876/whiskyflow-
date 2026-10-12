import type { Metadata } from "next";
import { CheckCircle2, Gift, ShieldCheck } from "lucide-react";
import { notFound } from "next/navigation";
import { getClaimView } from "@/flows/claim-anchor";
import { getNow } from "@/server/clock";
import { getDb } from "@/server/db";
import { ActionForm, SubmitButton } from "@/ui/action-form";
import { Alert } from "@/ui/alert";
import { BrandScope } from "@/ui/brand-scope";
import { Card } from "@/ui/card";
import { DescriptionList } from "@/ui/description-list";
import { Checkbox, Field, Input } from "@/ui/field";
import { claimAction } from "./actions";

export const metadata: Metadata = {
  title: "Claim your Return Anchor",
  robots: { index: false, follow: false },
  referrer: "no-referrer",
};

export default async function ClaimPage({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const { token } = await params;
  const db = await getDb();
  const claim = await getClaimView(db, token, await getNow(db));
  if (!claim) notFound();
  return (
    <BrandScope
      color={claim.merchant.brandColor}
      className="min-h-screen bg-brand-soft px-4 py-8 sm:py-14"
    >
      <main className="mx-auto max-w-xl">
        <div className="mb-6 text-center">
          <div className="mx-auto grid size-12 place-items-center rounded-2xl bg-brand text-brand-contrast">
            <Gift />
          </div>
          <p className="mt-3 text-sm font-semibold tracking-wide text-brand uppercase">
            {claim.merchant.name}
          </p>
          <h1 className="mt-2 text-3xl font-semibold tracking-tight">
            {claim.headline.primary}
          </h1>
          <p className="mt-2 text-ink-muted">{claim.headline.secondary}</p>
        </div>
        {claim.expired ? (
          <Alert tone="danger" title="This claim link expired">
            Ask the venue team for help. Your purchase record is still in the
            merchant ledger.
          </Alert>
        ) : (
          <Card
            title="Put this in your wallet"
            description="No app or password required"
            tone="accent"
          >
            <div className="mb-5 rounded-xl border border-brand-line bg-white p-4">
              <p className="text-xs font-semibold tracking-wide text-ink-subtle uppercase">
                You own
              </p>
              <p className="mt-1 text-2xl font-semibold">{claim.label}</p>
              {claim.storageLocation && (
                <p className="mt-1 text-sm text-ink-muted">
                  Stored at {claim.storageLocation}
                </p>
              )}
            </div>
            <ActionForm
              action={claimAction.bind(null, token)}
              className="space-y-4"
            >
              <Field
                label="Mobile number"
                name="phone"
                hint="Used to find your wallet at the venue"
                required
              >
                <Input
                  name="phone"
                  type="tel"
                  autoComplete="tel"
                  placeholder="+65 9123 4567"
                  required
                />
              </Field>
              <Field label="Name" name="name" optional>
                <Input name="name" autoComplete="name" />
              </Field>
              <Checkbox
                name="serviceOptIn"
                defaultChecked
                label="Message me about what I own"
                description="Confirmations, balance updates and expiry notices."
              />
              <Checkbox
                name="marketingOptIn"
                label="Send me occasional offers"
                description="Optional. Unticked by default; you can opt out any time."
              />
              <SubmitButton
                fullWidth
                size="lg"
                pendingLabel="Claiming…"
                icon={<CheckCircle2 />}
              >
                Claim my {claim.label}
              </SubmitButton>
            </ActionForm>
          </Card>
        )}
        <Card className="mt-4" title="Clear terms" icon={<ShieldCheck />}>
          <DescriptionList
            items={claim.terms.map((t) => ({ term: t.label, detail: t.value }))}
          />
        </Card>
        <p className="mt-5 text-center text-xs text-ink-subtle">
          This is an item entitlement, not cash or loyalty points. The venue
          actively encourages redemption.
        </p>
      </main>
    </BrandScope>
  );
}
