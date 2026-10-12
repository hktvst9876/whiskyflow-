import { FlaskConical, Info, TrendingUp } from "lucide-react";
import { DAY_MS } from "@/core/time";
import {
  attributionForPeriod,
  liftReport,
  offerPerformance,
} from "@/modules/analytics/queries";
import { loadMerchantContext } from "@/modules/merchants/repo";
import { withAuth } from "@/server/action";
import { Alert } from "@/ui/alert";
import { Badge, MetricNote } from "@/ui/badge";
import { Card } from "@/ui/card";
import { Money, Percent } from "@/ui/money";
import { PageHeader } from "@/ui/page-header";
import { Progress } from "@/ui/progress";
import { Section } from "@/ui/section";
import { Stat, StatGrid } from "@/ui/stat";

export default async function AnalyticsPage() {
  const { auth, db, now } = await withAuth("manager");
  const merchant = await loadMerchantContext(db, auth.merchantId);
  const from = new Date(now.getTime() - 30 * DAY_MS);
  const [a, lift, offers] = await Promise.all([
    attributionForPeriod(db, auth.merchantId, from, now),
    liftReport(db, merchant, now),
    offerPerformance(db, auth.merchantId, from, now),
  ]);
  const e =
    lift.estimate?.verdict === "insufficient_data" ? null : lift.estimate;
  return (
    <>
      <PageHeader
        eyebrow={auth.merchant.name}
        title="Incremental profitable CLV"
        description="Attribution explains what happened on anchor visits. Randomised holdouts answer the harder question: did Return Anchor cause more contribution than customers would have produced anyway?"
      />
      <Section
        title="30-day attributed activity"
        actions={<MetricNote kind="attributed" />}
      >
        <StatGrid columns={4}>
          <Stat
            label="Return-anchor redemptions"
            value={a.redemptions}
            sublabel={`${a.customersReturning} customers returning`}
          />
          <Stat
            label="Stored value redeemed"
            value={
              <Money
                cents={a.storedValueRedeemedCents}
                format={auth.merchant}
              />
            }
          />
          <Stat
            label="New cash during return visits"
            value={
              <Money
                cents={a.newCashDuringRedemptionsCents}
                format={auth.merchant}
              />
            }
          />
          <Stat
            label="Attributed contribution"
            value={
              <Money
                cents={a.attributedContributionCents}
                format={auth.merchant}
                colored
              />
            }
            tone={a.attributedContributionCents >= 0 ? "success" : "danger"}
          />
        </StatGrid>
      </Section>
      <Section
        title="Causal lift"
        description="The always-on checkout experiment holds back a small share of otherwise eligible offers."
      >
        <Card
          title="Treatment versus holdout"
          icon={<FlaskConical />}
          tone="accent"
          actions={<MetricNote kind="measured" />}
        >
          {!e ? (
            <>
              <Alert tone="info" title="Still gathering evidence">
                {lift.matured} assignments have matured. The model needs enough
                customers in both arms before reporting lift.
              </Alert>
              <Progress
                className="mt-4"
                label="Matured assignments"
                value={Math.min(
                  100,
                  (lift.matured /
                    Math.max(
                      1,
                      merchant.settings.dealEngine.minMeasuredSamplesPerArm * 2,
                    )) *
                    100,
                )}
                valueText={`${lift.matured} / ${merchant.settings.dealEngine.minMeasuredSamplesPerArm * 2}`}
              />
            </>
          ) : (
            <div className="grid gap-5 md:grid-cols-4">
              <div>
                <p className="text-sm text-ink-subtle">
                  Contribution lift / customer
                </p>
                <p className="mt-1 text-2xl font-semibold">
                  <Money
                    cents={e.diffCents}
                    format={auth.merchant}
                    signed
                    colored
                  />
                </p>
              </div>
              <div>
                <p className="text-sm text-ink-subtle">
                  90% confidence interval
                </p>
                <p className="mt-1 font-semibold">
                  <Money cents={e.ci90LowCents} format={auth.merchant} signed />{" "}
                  to{" "}
                  <Money
                    cents={e.ci90HighCents}
                    format={auth.merchant}
                    signed
                  />
                </p>
              </div>
              <div>
                <p className="text-sm text-ink-subtle">Return-rate lift</p>
                <p className="mt-1 text-2xl font-semibold">
                  <Percent rate={e.returnRateLift} digits={1} />
                </p>
              </div>
              <div>
                <p className="text-sm text-ink-subtle">Verdict</p>
                <Badge
                  className="mt-2"
                  tone={
                    e.verdict === "positive"
                      ? "success"
                      : e.verdict === "negative"
                        ? "danger"
                        : "warning"
                  }
                >
                  {e.verdict.replaceAll("_", " ")}
                </Badge>
              </div>
            </div>
          )}
        </Card>
      </Section>
      <Section title="How the money is built">
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
          <Card title="Gross profit from fresh spend">
            <p className="text-2xl font-semibold">
              <Money
                cents={a.grossProfitFromNewCashCents}
                format={auth.merchant}
              />
            </p>
          </Card>
          <Card title="New packages sold">
            <p className="text-2xl font-semibold">
              <Money cents={a.newPackagesSoldCents} format={auth.merchant} />
            </p>
          </Card>
          <Card title="Promotional cost">
            <p className="text-2xl font-semibold">
              <Money cents={a.promotionalCostCents} format={auth.merchant} />
            </p>
          </Card>
          <Card title="Offer groups tracked">
            <p className="text-2xl font-semibold">{offers.length}</p>
          </Card>
        </div>
        <Alert
          className="mt-4"
          tone="neutral"
          title="Why both views matter"
          icon={<Info />}
        >
          Redemption totals can be healthy even when customers would have
          returned anyway. The holdout protects the business from claiming that
          natural repeat behaviour was caused by the product.
        </Alert>
      </Section>
    </>
  );
}
