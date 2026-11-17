import {
  Check,
  Gift,
  Lightbulb,
  Minus,
  PackageCheck,
  Plus,
  ReceiptText,
  Search,
  Sparkles,
  Tag,
  UserPlus,
  UserRound,
  Wine,
  X,
} from "lucide-react";
import { notFound } from "next/navigation";
import { formatMoney } from "@/core/money";
import { formatDate } from "@/core/time";
import { visitHeadline } from "@/flows/close-visit";
import { keepOptionsForVisit } from "@/flows/issue-anchor";
import { getUpsellForVisit } from "@/flows/redemption";
import { visitView, type AnchorCard } from "@/flows/visits";
import { listItems } from "@/modules/catalog/repo";
import { hasRole } from "@/modules/merchants/types";
import { verticalPreset } from "@/verticals";
import { withPageAuth } from "@/server/action";
import { ActionButton, ActionForm, SubmitButton } from "@/ui/action-form";
import { Alert } from "@/ui/alert";
import { AutoRefresh } from "@/ui/auto-refresh";
import { Badge, MetricNote } from "@/ui/badge";
import { Card } from "@/ui/card";
import { DescriptionList } from "@/ui/description-list";
import { Checkbox, Field, FieldGrid, Input, Select } from "@/ui/field";
import { Money, Percent } from "@/ui/money";
import { PageHeader } from "@/ui/page-header";
import { Progress } from "@/ui/progress";
import { QrCode } from "@/ui/qr-code";
import { Section } from "@/ui/section";
import {
  acceptOfferAction,
  addUpsellAction,
  applyPromoAction,
  attachCustomerAction,
  claimByPhoneAction,
  closeVisitAction,
  createCustomerAction,
  declineOfferAction,
  evaluateOfferAction,
  keepAction,
  quickAddAction,
  recordLevelAction,
  redeemAction,
  voidLineAction,
} from "../actions";

/** What each kind of bill line means, in the words staff use. */
const LINE_BADGE: Record<string, { label: string; tone: "accent" | "success" | "warning" | "info" } | undefined> = {
  anchor_upgrade: { label: "Return Anchor", tone: "accent" },
  anchor_redemption: { label: "From their wallet", tone: "success" },
  perk: { label: "Complimentary", tone: "info" },
  discount: { label: "Offer", tone: "warning" },
};

export default async function VisitPage({
  params,
}: {
  params: Promise<{ visitId: string }>;
}) {
  const { visitId } = await params;
  const { auth, db, ctx } = await withPageAuth("staff");
  let view;
  try {
    view = await visitView(db, ctx, visitId);
  } catch {
    notFound();
  }
  const open = view.visit.status === "open";
  const manager = hasRole(auth.role, "manager");
  const format = auth.merchant;
  const money = (cents: number, signed = false) =>
    formatMoney(cents, { currency: format.currency, locale: format.locale, compact: true, signed });
  const [items, keepOptions, upsell] = await Promise.all([
    open ? listItems(db, auth.merchantId, { activeOnly: true }) : [],
    open ? keepOptionsForVisit(db, ctx, visitId) : [],
    open && view.totals.isRedemptionVisit ? getUpsellForVisit(db, ctx, visitId, 4) : [],
  ]);
  const categoryLabel = new Map(
    verticalPreset(auth.merchant.vertical).categories.map((c) => [c.key, c.label]),
  );
  const menu = new Map<string, typeof items>();
  for (const item of items) menu.set(item.category, [...(menu.get(item.category) ?? []), item]);

  const offer = view.checkout;
  const exposure = offer?.exposure;
  const candidate = offer?.candidate;
  const offerLive =
    offer?.decision.outcome === "offered" && candidate && exposure?.status === "shown";
  const hasRegularLines = view.lines.some((l) => l.lineType === "regular");
  const redeemable = view.anchors.filter((a) => a.status === "active");

  return (
    <>
      <PageHeader
        back={{ href: "/pos", label: "All open bills" }}
        eyebrow={auth.merchant.name}
        title={view.visit.label || "Walk-in bill"}
        description={`Party of ${view.visit.partySize} · ${open ? "Open bill" : "Closed"}`}
        meta={
          view.customer ? (
            <>
              <Badge tone="success" icon={<UserRound />}>
                {view.customer.name || view.customer.phoneMasked}
              </Badge>
              {manager && view.customer.score !== null && (
                <Badge tone="neutral">Return score {view.customer.score}%</Badge>
              )}
            </>
          ) : (
            <Badge tone="warning">Guest not identified</Badge>
          )
        }
      />

      {!open && (
        <Card tone="accent" className="mb-6" title="Bill closed" icon={<ReceiptText />}>
          <p className="text-lg font-semibold">{visitHeadline(view.totals, format)}</p>
          <DescriptionList
            className="mt-4"
            items={[
              { term: "New cash (fresh purchases)", detail: money(view.totals.newCashRevenueCents) },
              { term: "Gross profit on new cash", detail: money(view.totals.newCashGpCents) },
              { term: "Return Anchor sold today", detail: money(view.totals.anchorUpgradeRevenueCents) },
              { term: "Cost of what they redeemed", detail: money(view.totals.redemptionCostCents) },
              { term: "Perks and offers given", detail: money(view.totals.perkCostCents + view.totals.discountCents) },
              { term: "Total paid", detail: <strong>{money(view.totals.revenueCents)}</strong> },
            ]}
          />
        </Card>
      )}

      <div className="grid gap-6 xl:grid-cols-[minmax(0,1.35fr)_minmax(20rem,.65fr)]">
        <div>
          {open && (
            <Card title="Add to bill" description="One tap adds one" icon={<Plus />}>
              <div className="space-y-4">
                {[...menu.entries()].map(([category, list]) => (
                  <div key={category}>
                    <p className="mb-2 text-xs font-semibold tracking-wide text-ink-subtle uppercase">
                      {categoryLabel.get(category) ?? category.replaceAll("_", " ")}
                    </p>
                    <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
                      {list.map((item) => (
                        <ActionButton
                          key={item.id}
                          action={quickAddAction.bind(null, visitId, item.id)}
                          variant="secondary"
                          className="h-auto min-h-12 justify-between gap-2 py-2 text-left"
                        >
                          <span className="min-w-0 truncate">{item.name}</span>
                          <span className="shrink-0 text-ink-subtle">{money(item.priceCents)}</span>
                        </ActionButton>
                      ))}
                    </div>
                  </div>
                ))}
                {items.length === 0 && (
                  <p className="text-sm text-ink-muted">
                    The menu is empty. A manager can add items under Controls → Menu.
                  </p>
                )}
              </div>
            </Card>
          )}

          <Section title="Bill">
            <Card padding="none">
              <div className="divide-y divide-line">
                {view.lines.map((line) => {
                  const badge = LINE_BADGE[line.lineType];
                  return (
                    <div key={line.id} className="flex items-center gap-3 px-5 py-3">
                      <div className="min-w-0 flex-1">
                        <p className="font-medium">
                          {line.quantity} × {line.name}
                        </p>
                        {badge && (
                          <Badge tone={badge.tone} size="sm" className="mt-1">
                            {badge.label}
                          </Badge>
                        )}
                      </div>
                      <Money cents={line.unitPriceCents * line.quantity} format={format} />
                      {open && (
                        <ActionButton
                          action={voidLineAction.bind(null, visitId, line.id)}
                          variant="ghost"
                          size="sm"
                          confirm={
                            line.lineType === "anchor_redemption"
                              ? "Remove this? The units go back into the guest's wallet."
                              : line.lineType === "anchor_upgrade"
                                ? "Remove this? The Return Anchor will be cancelled."
                                : "Remove this line?"
                          }
                        >
                          <Minus className="size-4" />
                          <span className="sr-only">Remove {line.name}</span>
                        </ActionButton>
                      )}
                    </div>
                  );
                })}
                {view.lines.length === 0 && (
                  <p className="px-5 py-10 text-center text-sm text-ink-muted">
                    Add what the guest ordered first.
                  </p>
                )}
              </div>
              <div className="border-t border-line-strong bg-surface-muted px-5 py-4">
                {manager && (
                  <div className="flex justify-between text-sm text-ink-muted">
                    <span>Gross profit</span>
                    <Money cents={view.totals.gpCents} format={format} />
                  </div>
                )}
                <div className="mt-2 flex justify-between text-lg font-semibold">
                  <span>Total</span>
                  <Money cents={view.totals.revenueCents} format={format} />
                </div>
              </div>
            </Card>
          </Section>

          {open && (
            <Section
              title="Guest"
              description="Scan or type their wallet code, or look them up by phone. Needed to redeem; optional for a first purchase."
            >
              {view.customer ? (
                <Card tone="accent">
                  <p className="font-semibold">
                    {view.customer.name || view.customer.phoneMasked}
                  </p>
                  <p className="mt-1 text-sm text-ink-muted">
                    Wallet code {view.customer.redeemCode} · {view.customer.visitCount} visit
                    {view.customer.visitCount === 1 ? "" : "s"} before today
                  </p>
                </Card>
              ) : (
                <div className="grid gap-4 md:grid-cols-2">
                  <Card title="Returning guest" icon={<Search />}>
                    <ActionForm
                      action={attachCustomerAction.bind(null, visitId)}
                      className="space-y-3"
                    >
                      <Field
                        label="Wallet code or phone"
                        name="query"
                        hint="e.g. ABCD-2345 or 9123 4567"
                      >
                        <Input name="query" required autoComplete="off" />
                      </Field>
                      <SubmitButton variant="secondary" fullWidth icon={<Search />}>
                        Find guest
                      </SubmitButton>
                    </ActionForm>
                  </Card>
                  <Card title="New guest" icon={<UserPlus />}>
                    <ActionForm
                      action={createCustomerAction.bind(null, visitId)}
                      className="space-y-3"
                    >
                      <FieldGrid columns={2}>
                        <Field label="Mobile" name="phone">
                          <Input name="phone" type="tel" required autoComplete="off" />
                        </Field>
                        <Field label="First name" name="name" optional>
                          <Input name="name" autoComplete="off" />
                        </Field>
                      </FieldGrid>
                      <SubmitButton variant="secondary" fullWidth icon={<UserPlus />}>
                        Add to bill
                      </SubmitButton>
                    </ActionForm>
                  </Card>
                </div>
              )}
            </Section>
          )}

          {redeemable.length > 0 && (
            <Section
              title="What they already own"
              description="Redeem this first. It is the reason they came back."
            >
              <div className="grid gap-3 sm:grid-cols-2">
                {redeemable.map((a) => (
                  <AnchorPanel
                    key={a.id}
                    anchor={a}
                    visitId={visitId}
                    open={open}
                    money={money}
                    expires={
                      a.expiresAt
                        ? `Valid until ${formatDate(a.expiresAt, { timeZone: format.timezone, locale: format.locale })}`
                        : "No expiry"
                    }
                  />
                ))}
              </div>
            </Section>
          )}

          {open && view.promos.length > 0 && (
            <Section
              title="Offers this guest was sent"
              description="From WhatsApp. One per bill; it cannot be combined with another offer."
            >
              <div className="grid gap-3 sm:grid-cols-2">
                {view.promos.map((p) => (
                  <Card key={p.exposureId} title={p.name} icon={<Tag />}>
                    {p.line && <p className="mb-3 text-sm text-ink-muted">{p.line.trim()}</p>}
                    <ActionButton
                      action={applyPromoAction.bind(null, visitId, p.exposureId)}
                      variant="secondary"
                      fullWidth
                    >
                      Apply to this bill
                    </ActionButton>
                  </Card>
                ))}
              </div>
            </Section>
          )}

          {open && upsell.length > 0 && (
            <Section
              title="Suggest these now"
              description="What they own brought them in. Fresh orders are where today's profit comes from."
            >
              <div className="grid gap-3 sm:grid-cols-2">
                {upsell.map((u) => (
                  <Card key={u.itemId ?? u.offerDefinitionId} icon={<Lightbulb />} title={u.name}>
                    <p className="text-sm text-ink-muted">“{u.script}”</p>
                    <div className="mt-3 flex items-center justify-between gap-3">
                      <span className="text-sm font-semibold">{money(u.priceCents)}</span>
                      <ActionButton
                        action={addUpsellAction.bind(null, visitId, u.itemId, u.offerDefinitionId)}
                        size="sm"
                        icon={<Plus />}
                      >
                        Add
                      </ActionButton>
                    </div>
                    {manager && (
                      <p className="mt-2 text-xs text-ink-subtle">
                        Gross profit {money(u.gpCents)} · about {Math.round(u.pAttach * 100)}% say yes
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
            title="Return Anchor offer"
            description="One decision per bill. It cannot be re-rolled."
            icon={<Sparkles />}
            tone="accent"
          >
            {!offer && (
              <>
                <p className="text-sm text-ink-muted">
                  Before taking payment, check whether this bill qualifies for something
                  the guest can keep for next time.
                </p>
                <ActionButton
                  action={evaluateOfferAction.bind(null, visitId)}
                  className="mt-4"
                  fullWidth
                  size="lg"
                  disabled={!hasRegularLines || !open}
                >
                  Check for an offer
                </ActionButton>
              </>
            )}
            {offerLive && candidate && exposure && (
              <>
                <p className="text-xl font-semibold">{candidate.pitch.staff}</p>
                <p className="mt-2 text-sm text-ink-muted">Say: “{candidate.pitch.script}”</p>
                <p className="mt-2 text-sm text-ink-muted">
                  Covers {candidate.pitch.coverage}.
                </p>
                <div className="mt-4 grid grid-cols-2 gap-2">
                  <ActionButton
                    action={acceptOfferAction.bind(null, visitId, exposure.id)}
                    icon={<Check />}
                    size="lg"
                  >
                    Guest said yes
                  </ActionButton>
                  <ActionButton
                    action={declineOfferAction.bind(null, visitId, exposure.id)}
                    variant="secondary"
                    icon={<X />}
                    size="lg"
                  >
                    No thanks
                  </ActionButton>
                </div>
                {manager && (
                  <details className="mt-4 rounded-lg bg-white/70 p-3 text-sm">
                    <summary className="cursor-pointer font-medium">Why this offer</summary>
                    <DescriptionList
                      className="mt-3"
                      items={[
                        { term: "Guest pays today", detail: money(candidate.priceCents, true) },
                        { term: "Menu value kept", detail: money(candidate.coveredRetailCents) },
                        { term: "Our cost when redeemed", detail: money(candidate.coveredCostCents) },
                        { term: "Margin on today's bill", detail: <Percent rate={candidate.todayMarginRate} /> },
                        {
                          term: "Chance they return",
                          detail: (
                            <>
                              <Percent rate={candidate.p0} /> → <Percent rate={candidate.p1} />
                            </>
                          ),
                        },
                        { term: "Chance they accept", detail: <Percent rate={candidate.pAccept} /> },
                        {
                          term: "Expected extra contribution",
                          detail: <strong>{money(candidate.deltaECents, true)}</strong>,
                        },
                      ]}
                    />
                    <MetricNote kind="estimate" className="mt-3" />
                    <p className="mt-2 text-xs text-ink-subtle">
                      {candidate.upliftSource === "measured"
                        ? "Return lift taken from this business's own holdout results."
                        : "Return lift is an assumption until the holdout has enough customers."}
                    </p>
                  </details>
                )}
              </>
            )}
            {offer && !offerLive && (
              <>
                {exposure?.status === "accepted" ? (
                  <Alert tone="success" title="Offer accepted">
                    {candidate?.pitch.label} was added to the bill.
                  </Alert>
                ) : exposure?.status === "declined" ? (
                  <Alert tone="neutral" title="Guest declined">
                    Nothing more to offer on this bill.
                  </Alert>
                ) : (
                  // Staff see the same neutral line whatever the reason, so guests in the
                  // measurement group are not pitched by hand (which would spoil the test).
                  <Alert tone="neutral" title="No offer for this bill">
                    Take payment as usual.
                  </Alert>
                )}
                {manager && offer.reason && (
                  <p className="mt-3 text-xs text-ink-subtle">Manager note: {offer.reason}</p>
                )}
              </>
            )}
          </Card>

          {view.pendingClaims.map((claim) => (
            <Card
              key={claim.entitlementId}
              title="Guest scans this to claim"
              description={claim.label}
              icon={<Gift />}
            >
              <div className="text-center">
                <QrCode value={claim.claimUrl} title={`Claim ${claim.label}`} size={200} />
                <p className="mt-3 text-sm text-ink-muted">
                  They enter their mobile number. No app, no password.
                </p>
              </div>
              <details className="mt-4 border-t border-line pt-3">
                <summary className="cursor-pointer text-sm font-medium">
                  Claim by phone instead
                </summary>
                <ActionForm
                  action={claimByPhoneAction.bind(null, visitId, claim.entitlementId)}
                  className="mt-3 space-y-3"
                >
                  <FieldGrid columns={2}>
                    <Field label="Mobile" name="phone">
                      <Input name="phone" type="tel" required autoComplete="off" />
                    </Field>
                    <Field label="First name" name="name" optional>
                      <Input name="name" autoComplete="off" />
                    </Field>
                  </FieldGrid>
                  <Checkbox
                    name="consentRead"
                    label="I read this to the guest and they agreed"
                    description="“We'll send you WhatsApp messages about what you own here: a confirmation, your balance and a reminder before it expires. Reply STOP any time.”"
                  />
                  <Checkbox
                    name="marketingOptIn"
                    label="They also want occasional offers"
                    description="Leave unticked unless the guest says yes."
                  />
                  <SubmitButton variant="secondary" fullWidth>
                    Claim for the guest
                  </SubmitButton>
                </ActionForm>
              </details>
              {open ? null : <AutoRefresh intervalMs={5000} />}
            </Card>
          ))}

          {open &&
            keepOptions.map((k) => (
              <Card
                key={`${k.lineId}-${k.programId}`}
                title={`Keep the rest of the ${k.lineName}`}
                description={k.programName}
                icon={k.unitType === "percent" ? <Wine /> : <PackageCheck />}
              >
                <ActionForm
                  action={keepAction.bind(null, visitId, k.lineId, k.programId)}
                  className="space-y-3"
                >
                  <FieldGrid columns={2}>
                    <Field
                      label={k.unitType === "percent" ? "Level left (%)" : `${k.unitLabelPlural} left`}
                      name="quantity"
                    >
                      <Input
                        name="quantity"
                        type="number"
                        min={1}
                        max={k.max}
                        defaultValue={k.unitType === "percent" ? 50 : Math.max(1, k.max - 1)}
                        required
                      />
                    </Field>
                    <Field label="Where it is kept" name="storageLocation" optional>
                      <Input name="storageLocation" placeholder="Shelf B3" autoComplete="off" />
                    </Field>
                  </FieldGrid>
                  <SubmitButton variant="secondary" fullWidth>
                    Keep for next visit
                  </SubmitButton>
                </ActionForm>
              </Card>
            ))}

          {open && (
            <Card title="Take payment" description="Closes the bill">
              <ActionButton
                action={closeVisitAction.bind(null, visitId)}
                fullWidth
                size="lg"
                disabled={view.lines.length === 0}
                confirm="Close this bill?"
              >
                Close bill · {money(view.totals.revenueCents)}
              </ActionButton>
              {!offer && hasRegularLines && (
                <p className="mt-3 text-xs text-ink-subtle">
                  Tip: check for an offer first. An unanswered offer simply expires when the
                  bill closes.
                </p>
              )}
            </Card>
          )}
        </div>
      </div>
    </>
  );
}

/** One thing the guest owns: redeem units, or record a bottle's new level. */
function AnchorPanel({
  anchor: a,
  visitId,
  open,
  money,
  expires,
}: {
  anchor: AnchorCard;
  visitId: string;
  open: boolean;
  money: (cents: number, signed?: boolean) => string;
  expires: string;
}) {
  const perVisit = Math.min(a.quantityRemaining, a.maxUnitsPerVisit ?? a.quantityRemaining);
  return (
    <Card
      title={a.label}
      description={[expires, a.storageLocation ? `Kept at ${a.storageLocation}` : null]
        .filter(Boolean)
        .join(" · ")}
      tone={a.redeemable ? "accent" : "muted"}
      icon={a.unitType === "percent" ? <Wine /> : <Gift />}
    >
      {a.unitType === "percent" && (
        <Progress className="mb-3" value={a.quantityRemaining} valueText={`${a.quantityRemaining}% left`} />
      )}
      {!a.redeemable && <p className="text-sm text-ink-muted">{a.blockedReason}</p>}
      {a.redeemable && open && a.unitType === "percent" && (
        <ActionForm
          action={recordLevelAction.bind(null, visitId, a.id)}
          className="flex items-end gap-2"
        >
          <Field label="Level after pouring (%)" name="percent" className="flex-1">
            <Input
              name="percent"
              type="number"
              min={0}
              max={Math.max(0, a.quantityRemaining - 1)}
              defaultValue={Math.max(0, a.quantityRemaining - 20)}
              required
            />
          </Field>
          <SubmitButton>Record</SubmitButton>
        </ActionForm>
      )}
      {a.redeemable && open && a.unitType !== "percent" && (
        <ActionForm action={redeemAction.bind(null, visitId, a.id)} className="space-y-3">
          {a.choices.length > 0 && (
            <Field label="What are they having?" name="itemId">
              <Select
                name="itemId"
                required
                placeholder="Choose"
                options={a.choices.map((c) => ({
                  value: c.itemId,
                  label: c.extraCents > 0 ? `${c.name} (${money(c.extraCents, true)} to upgrade)` : c.name,
                }))}
              />
            </Field>
          )}
          {perVisit > 1 && (
            <Field label="How many?" name="quantity">
              <Input name="quantity" type="number" min={1} max={perVisit} defaultValue={1} />
            </Field>
          )}
          <SubmitButton fullWidth icon={<Check />}>
            Redeem
          </SubmitButton>
        </ActionForm>
      )}
    </Card>
  );
}
