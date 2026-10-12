import {
  Check,
  Gift,
  Minus,
  ReceiptText,
  Search,
  Sparkles,
  UserRound,
  X,
} from "lucide-react";
import { notFound } from "next/navigation";
import { listItems } from "@/modules/catalog/repo";
import { visitView } from "@/flows/visits";
import { withAuth } from "@/server/action";
import { ActionButton, ActionForm, SubmitButton } from "@/ui/action-form";
import { Alert } from "@/ui/alert";
import { Badge } from "@/ui/badge";
import { Card } from "@/ui/card";
import { Field, FieldGrid, Input, Select } from "@/ui/field";
import { Money, Percent } from "@/ui/money";
import { PageHeader } from "@/ui/page-header";
import { QrCode } from "@/ui/qr-code";
import { Section } from "@/ui/section";
import {
  acceptOfferAction,
  addItemAction,
  attachCustomerAction,
  closeVisitAction,
  declineOfferAction,
  evaluateOfferAction,
  redeemAction,
  voidLineAction,
} from "../actions";

export default async function VisitPage({
  params,
}: {
  params: Promise<{ visitId: string }>;
}) {
  const { visitId } = await params;
  const { auth, db, ctx } = await withAuth("staff");
  let view;
  try {
    view = await visitView(db, ctx, visitId);
  } catch {
    notFound();
  }
  const items = await listItems(db, auth.merchantId, { activeOnly: true });
  const liveLines = view.lines.filter((l) => !l.voidedAt);
  const offer = view.checkout;
  const exposure = offer?.exposure;
  const candidate = offer?.candidate;
  return (
    <>
      <PageHeader
        back={{ href: "/pos", label: "All open bills" }}
        eyebrow={auth.merchant.name}
        title={view.visit.label || "Walk-in bill"}
        description={`Party of ${view.visit.partySize} · ${view.visit.status === "open" ? "Open bill" : "Closed"}`}
        meta={
          view.customer ? (
            <>
              <Badge tone="success" icon={<UserRound />}>
                {view.customer.name || view.customer.phoneMasked}
              </Badge>
              <Badge tone="neutral">
                Return score {view.customer.score ?? "—"}%
              </Badge>
            </>
          ) : (
            <Badge tone="warning">Anonymous customer</Badge>
          )
        }
      />

      <div className="grid gap-6 xl:grid-cols-[minmax(0,1.35fr)_minmax(20rem,.65fr)]">
        <div>
          {view.visit.status === "open" && (
            <Card title="Add to bill" icon={<ReceiptText />}>
              <ActionForm
                action={addItemAction.bind(null, visitId)}
                successMessage="Item added"
                resetOnSuccess
                className="flex flex-col gap-3 sm:flex-row sm:items-end"
              >
                <Field label="Menu item" name="itemId" className="flex-1">
                  <Select
                    name="itemId"
                    required
                    placeholder="Choose an item"
                    options={items.map((i) => ({
                      value: i.id,
                      label: `${i.name} — ${(i.priceCents / 100).toFixed(2)}`,
                    }))}
                  />
                </Field>
                <Field label="Qty" name="quantity" className="w-full sm:w-24">
                  <Input
                    name="quantity"
                    type="number"
                    min={1}
                    max={20}
                    defaultValue={1}
                  />
                </Field>
                <SubmitButton>Add</SubmitButton>
              </ActionForm>
            </Card>
          )}

          <Section title="Bill">
            <Card padding="none">
              <div className="divide-y divide-line">
                {liveLines.map((line) => (
                  <div
                    key={line.id}
                    className="flex items-center gap-3 px-5 py-3"
                  >
                    <div className="min-w-0 flex-1">
                      <p className="font-medium">
                        {line.quantity} × {line.name}
                      </p>
                      <p className="text-xs text-ink-subtle capitalize">
                        {line.lineType.replaceAll("_", " ")}
                      </p>
                    </div>
                    <Money
                      cents={line.unitPriceCents * line.quantity}
                      format={auth.merchant}
                    />
                    {view.visit.status === "open" && (
                      <ActionButton
                        action={voidLineAction.bind(null, visitId, line.id)}
                        variant="ghost"
                        size="sm"
                        confirm="Remove this line?"
                      >
                        <Minus className="size-4" />
                        <span className="sr-only">Remove</span>
                      </ActionButton>
                    )}
                  </div>
                ))}
                {liveLines.length === 0 && (
                  <p className="px-5 py-10 text-center text-sm text-ink-muted">
                    Add the customer’s organic order first.
                  </p>
                )}
              </div>
              <div className="border-t border-line-strong bg-surface-muted px-5 py-4">
                <div className="flex justify-between text-sm text-ink-muted">
                  <span>Gross profit</span>
                  <Money cents={view.totals.gpCents} format={auth.merchant} />
                </div>
                <div className="mt-2 flex justify-between text-lg font-semibold">
                  <span>Total</span>
                  <Money
                    cents={view.totals.revenueCents}
                    format={auth.merchant}
                  />
                </div>
              </div>
            </Card>
          </Section>

          {view.visit.status === "open" && (
            <Section
              title="Customer"
              description="Optional at first purchase; required to put an Anchor into their wallet."
            >
              {view.customer ? (
                <Card tone="accent">
                  <p className="font-semibold">
                    {view.customer.name || view.customer.phoneMasked}
                  </p>
                  <p className="mt-1 text-sm text-ink-muted">
                    Wallet code {view.customer.redeemCode} ·{" "}
                    {view.customer.visitCount} visits
                  </p>
                </Card>
              ) : (
                <Card>
                  <ActionForm
                    action={attachCustomerAction.bind(null, visitId)}
                    className="flex flex-col gap-3 sm:flex-row sm:items-end"
                  >
                    <Field
                      label="Phone or wallet code"
                      name="query"
                      className="flex-1"
                      hint="Example: +65 9123 4567 or ABCD-2345"
                    >
                      <Input name="query" required />
                    </Field>
                    <SubmitButton variant="secondary" icon={<Search />}>
                      Find customer
                    </SubmitButton>
                  </ActionForm>
                </Card>
              )}
            </Section>
          )}

          {view.customer && view.anchors.length > 0 && (
            <Section
              title="Value they already own"
              description="Redeem first, then recommend fresh add-ons."
            >
              <div className="grid gap-3 sm:grid-cols-2">
                {view.anchors.map((a) => (
                  <Card
                    key={a.id}
                    title={a.label}
                    description={
                      a.expiresAt
                        ? `Expires ${a.expiresAt.toLocaleDateString(auth.merchant.locale)}`
                        : "No expiry"
                    }
                    tone={a.redeemable ? "accent" : "muted"}
                  >
                    {a.redeemable ? (
                      <ActionButton
                        action={redeemAction.bind(null, visitId, a.id)}
                        fullWidth
                        icon={<Check />}
                      >
                        Redeem one
                      </ActionButton>
                    ) : (
                      <p className="text-sm text-ink-muted">
                        {a.blockedReason}
                      </p>
                    )}
                  </Card>
                ))}
              </div>
            </Section>
          )}
        </div>

        <div className="space-y-6">
          <Card
            title="Decision engine"
            description="One stored decision per bill — never rerolled"
            icon={<Sparkles />}
            tone="accent"
          >
            {!offer && (
              <>
                <p className="text-sm text-ink-muted">
                  After an organic order, evaluate whether a profitable
                  unfinished entitlement should be offered.
                </p>
                <ActionButton
                  action={evaluateOfferAction.bind(null, visitId)}
                  className="mt-4"
                  fullWidth
                  disabled={
                    liveLines.length === 0 || view.visit.status !== "open"
                  }
                >
                  Evaluate this bill
                </ActionButton>
              </>
            )}
            {offer &&
              offer.decision.outcome === "offered" &&
              candidate &&
              exposure &&
              exposure.status === "shown" && (
                <>
                  <Badge tone="success">Eligible and profitable</Badge>
                  <p className="mt-4 text-xl font-semibold">
                    {candidate.pitch.staff}
                  </p>
                  <p className="mt-2 text-sm text-ink-muted">
                    Say: “{candidate.pitch.script}”
                  </p>
                  <div className="mt-4 grid grid-cols-2 gap-3 rounded-lg bg-white/70 p-3 text-sm">
                    <div>
                      <p className="text-ink-subtle">Expected contribution</p>
                      <p className="font-semibold">
                        <Money
                          cents={candidate.deltaECents}
                          format={auth.merchant}
                          signed
                        />
                      </p>
                    </div>
                    <div>
                      <p className="text-ink-subtle">Today’s margin</p>
                      <p className="font-semibold">
                        <Percent rate={candidate.todayMarginRate} />
                      </p>
                    </div>
                  </div>
                  <div className="mt-4 grid grid-cols-2 gap-2">
                    <ActionButton
                      action={acceptOfferAction.bind(
                        null,
                        visitId,
                        exposure.id,
                      )}
                      icon={<Check />}
                    >
                      Accepted
                    </ActionButton>
                    <ActionButton
                      action={declineOfferAction.bind(
                        null,
                        visitId,
                        exposure.id,
                      )}
                      variant="secondary"
                      icon={<X />}
                    >
                      Declined
                    </ActionButton>
                  </div>
                </>
              )}
            {offer &&
              (offer.decision.outcome !== "offered" ||
                exposure?.status !== "shown") && (
                <Alert
                  tone={
                    offer.decision.outcome === "holdout" ? "info" : "neutral"
                  }
                  title={
                    offer.decision.outcome === "holdout"
                      ? "Measurement holdout"
                      : "Decision recorded"
                  }
                >
                  {offer.reason ||
                    `Offer ${exposure?.status ?? offer.decision.outcome}.`}
                </Alert>
              )}
          </Card>

          {view.pendingClaims.map((claim) => (
            <Card
              key={claim.entitlementId}
              title="Customer claim QR"
              description={claim.label}
              icon={<Gift />}
            >
              <div className="text-center">
                <QrCode
                  value={claim.claimUrl}
                  title={`Claim ${claim.label}`}
                  size={180}
                />
                <p className="mt-3 text-sm text-ink-muted">
                  Customer scans and enters their phone. No app needed.
                </p>
              </div>
            </Card>
          ))}

          {view.visit.status === "open" && (
            <Card
              title="Finish checkout"
              description="Closes the bill and updates attribution"
            >
              <ActionButton
                action={closeVisitAction.bind(null, visitId)}
                fullWidth
                size="lg"
                variant="primary"
                disabled={liveLines.length === 0}
                confirm="Close this bill?"
              >
                Close bill
              </ActionButton>
            </Card>
          )}
        </div>
      </div>
    </>
  );
}
