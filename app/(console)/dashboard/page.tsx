import {
  ArrowRight,
  Clock3,
  FlaskConical,
  Gift,
  MessageCircle,
  ReceiptText,
  Sparkles,
  Users,
} from "lucide-react";
import { DAY_MS } from "@/core/time";
import {
  attributionForPeriod,
  liftReport,
  revenueOpportunities,
  todayOverview,
} from "@/modules/analytics/queries";
import { loadMerchantContext } from "@/modules/merchants/repo";
import { merchantVisitBaseline } from "@/modules/visits/repo";
import { withAuth } from "@/server/action";
import { Badge, MetricNote } from "@/ui/badge";
import { LinkButton } from "@/ui/button";
import { Card } from "@/ui/card";
import { Money } from "@/ui/money";
import { PageHeader } from "@/ui/page-header";
import { Section } from "@/ui/section";
import { Stat, StatGrid } from "@/ui/stat";

export default async function DashboardPage() {
  const { auth, db, now } = await withAuth("staff");
  const merchant = await loadMerchantContext(db, auth.merchantId);
  const from = new Date(now.getTime() - 30 * DAY_MS);
  const [today, attribution, lift, baseline] = await Promise.all([
    todayOverview(db, merchant, now),
    attributionForPeriod(db, auth.merchantId, from, now),
    liftReport(db, merchant, now),
    merchantVisitBaseline(
      db,
      auth.merchantId,
      new Date(now.getTime() - 90 * DAY_MS),
      now,
    ),
  ]);
  const opportunities = await revenueOpportunities(
    db,
    merchant,
    baseline.avgGpCents,
  );
  const measured =
    lift.estimate?.verdict === "insufficient_data" ? null : lift.estimate;

  return (
    <>
      <PageHeader
        eyebrow={auth.merchant.name}
        title="Retention, measured in profit"
        description="Create unfinished customer value, bring people back, and measure whether the intervention increased contribution versus a holdout group."
        actions={
          <LinkButton href="/pos" icon={<ReceiptText />}>
            Open the till
          </LinkButton>
        }
        meta={
          <>
            <Badge tone="accent" icon={<Sparkles />}>
              Demo data
            </Badge>
            <Badge tone="neutral">
              Clock: {now.toLocaleDateString(auth.merchant.locale)}
            </Badge>
          </>
        }
      />

      <StatGrid columns={4}>
        <Stat
          label="Customers with value waiting"
          value={today.withAnchors.customers}
          sublabel={`${today.withAnchors.anchors} active Return Anchors`}
          icon={<Gift />}
          href="/customers"
        />
        <Stat
          label="New cash on return visits"
          value={
            <Money
              cents={attribution.newCashDuringRedemptionsCents}
              format={auth.merchant}
            />
          }
          sublabel={`${attribution.redemptions} redemptions in 30 days`}
          note={<MetricNote kind="attributed" />}
          tone="success"
        />
        <Stat
          label="Attributed contribution"
          value={
            <Money
              cents={attribution.attributedContributionCents}
              format={auth.merchant}
              colored
            />
          }
          sublabel="After anchor, perk and message costs"
          note={<MetricNote kind="attributed" />}
        />
        <Stat
          label="Measured contribution lift"
          value={
            measured ? (
              <Money
                cents={measured.diffCents}
                format={auth.merchant}
                signed
                colored
              />
            ) : (
              "Gathering data"
            )
          }
          sublabel={
            measured
              ? `${lift.matured} matured assignments`
              : `${lift.assignedTreatment + lift.assignedHoldout} assigned · ${lift.horizonDays}-day horizon`
          }
          note={<MetricNote kind="measured" />}
          icon={<FlaskConical />}
        />
      </StatGrid>

      <Section
        title="Today"
        description="People and operational moments that deserve attention now."
      >
        <div className="grid gap-4 lg:grid-cols-3">
          <Card
            title="Likely to return"
            description="Based on visit rhythm and active value"
            icon={<Users />}
          >
            <div className="space-y-3">
              {today.likelyToReturn.slice(0, 5).map((c) => (
                <div
                  key={c.id}
                  className="flex items-center justify-between gap-3"
                >
                  <div>
                    <p className="font-medium">{c.name}</p>
                    <p className="text-sm text-ink-muted">
                      {c.anchors[0] ?? "Regular visit pattern"}
                    </p>
                  </div>
                  <Badge tone={c.returnBand === "high" ? "success" : "neutral"}>
                    {c.score ?? "—"}%
                  </Badge>
                </div>
              ))}
              {today.likelyToReturn.length === 0 && (
                <p className="text-sm text-ink-muted">
                  No customers are due today yet.
                </p>
              )}
            </div>
          </Card>
          <Card
            title="Expiring soon"
            description="Encourage redemption, without escalating discounts"
            icon={<Clock3 />}
          >
            <div className="space-y-3">
              {today.expiringSoon.slice(0, 5).map((c) => (
                <div key={`${c.id}-${c.label}`}>
                  <p className="font-medium">{c.name}</p>
                  <p className="text-sm text-ink-muted">
                    {c.label} ·{" "}
                    {c.expiresAt.toLocaleDateString(auth.merchant.locale)}
                  </p>
                </div>
              ))}
              {today.expiringSoon.length === 0 && (
                <p className="text-sm text-ink-muted">
                  Nothing reaches its warning window today.
                </p>
              )}
            </div>
          </Card>
          <Card
            title="Operations"
            description="Claims, open bills and messages"
            icon={<MessageCircle />}
          >
            <dl className="space-y-3 text-sm">
              <div className="flex justify-between">
                <dt className="text-ink-muted">Open bills</dt>
                <dd className="font-semibold">{today.openBills}</dd>
              </div>
              <div className="flex justify-between">
                <dt className="text-ink-muted">Unclaimed anchors</dt>
                <dd className="font-semibold">{today.pendingClaims}</dd>
              </div>
              <div className="flex justify-between">
                <dt className="text-ink-muted">Messages sent today</dt>
                <dd className="font-semibold">{today.messagesToday.sent}</dd>
              </div>
              <div className="flex justify-between">
                <dt className="text-ink-muted">Messages scheduled</dt>
                <dd className="font-semibold">
                  {today.messagesToday.scheduled}
                </dd>
              </div>
            </dl>
          </Card>
        </div>
      </Section>

      <Section
        title="Revenue opportunities"
        description="The anchor creates the visit. Fresh purchases create the profit."
        actions={
          <LinkButton
            href="/campaigns"
            variant="secondary"
            size="sm"
            iconRight={<ArrowRight />}
          >
            Campaigns
          </LinkButton>
        }
      >
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
          {opportunities.map((o) => (
            <Card
              key={o.kind}
              title={o.title}
              description={`${o.customers.length} customers`}
              tone="accent"
            >
              <p className="text-sm text-ink-muted">{o.why}</p>
              <p className="mt-4 text-xs font-medium text-ink-subtle uppercase">
                Expected GP at 25% response
              </p>
              <p className="mt-1 text-xl font-semibold">
                <Money cents={o.expectedGpCents} format={auth.merchant} />
              </p>
            </Card>
          ))}
          {opportunities.length === 0 && (
            <Card className="md:col-span-2 xl:col-span-4">
              <p className="text-sm text-ink-muted">
                Opportunities appear as customers accumulate active anchors.
              </p>
            </Card>
          )}
        </div>
      </Section>
    </>
  );
}
