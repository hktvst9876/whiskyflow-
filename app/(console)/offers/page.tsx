import { Gift, ShieldCheck, Sparkles } from "lucide-react";
import { DAY_MS } from "@/core/time";
import { listPrograms } from "@/modules/anchors/repo";
import { offerPerformance } from "@/modules/analytics/queries";
import { listDefinitions } from "@/modules/offers/repo";
import { withAuth } from "@/server/action";
import { Badge, MetricNote } from "@/ui/badge";
import { Card } from "@/ui/card";
import { Money, Percent } from "@/ui/money";
import { PageHeader } from "@/ui/page-header";
import { Section } from "@/ui/section";

export default async function OffersPage() {
  const { auth, db, now } = await withAuth("manager");
  const [programs, definitions, performance] = await Promise.all([
    listPrograms(db, auth.merchantId),
    listDefinitions(db, auth.merchantId),
    offerPerformance(
      db,
      auth.merchantId,
      new Date(now.getTime() - 30 * DAY_MS),
      now,
    ),
  ]);
  return (
    <>
      <PageHeader
        eyebrow={auth.merchant.name}
        title="Return Anchors and offers"
        description="Merchant-defined boundaries control what the engine may propose. The engine chooses among approved, profitable options and always allows NO OFFER."
      />
      <Section
        title="Anchor programmes"
        description="What the customer can own after leaving."
      >
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {programs.map((p) => (
            <Card
              key={p.id}
              title={p.name}
              description={`${p.validityDays} days · ${p.issueMode.replaceAll("_", " ")}`}
              icon={<Gift />}
              tone={p.status === "active" ? "accent" : "muted"}
            >
              <div className="flex flex-wrap gap-2">
                <Badge tone={p.status === "active" ? "success" : "neutral"}>
                  {p.status}
                </Badge>
                <Badge>
                  {p.unitsGranted}{" "}
                  {p.unitsGranted === 1 ? p.unitLabel : p.unitLabelPlural}
                </Badge>
              </div>
              <p className="mt-3 text-sm text-ink-muted">{p.terms}</p>
            </Card>
          ))}
        </div>
      </Section>
      <Section
        title="Next-visit offers"
        description="Low-cost add-ons, recognition and controlled incentives within guardrails."
      >
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {definitions.map((d) => (
            <Card
              key={d.id}
              title={d.name}
              description={d.offerType.replaceAll("_", " ")}
              icon={<Sparkles />}
            >
              <div className="flex gap-2">
                <Badge tone={d.status === "active" ? "success" : "neutral"}>
                  {d.status}
                </Badge>
                {d.isDiscount && <Badge tone="warning">Discount</Badge>}
              </div>
              <p className="mt-3 text-sm text-ink-muted">
                Estimated direct cost{" "}
                <Money cents={d.estCostCents} format={auth.merchant} />
              </p>
            </Card>
          ))}
        </div>
      </Section>
      <Section
        title="30-day performance"
        description="Contribution matters more than offer volume."
      >
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {performance.map((p) => (
            <Card
              key={p.key}
              title={p.name}
              description={`${p.shown} shown · ${p.redeemed} redeemed`}
              icon={<ShieldCheck />}
            >
              <div className="grid grid-cols-2 gap-3 text-sm">
                <div>
                  <p className="text-ink-subtle">Acceptance</p>
                  <p className="text-lg font-semibold">
                    <Percent rate={p.acceptanceRate} />
                  </p>
                </div>
                <div>
                  <p className="text-ink-subtle">Contribution</p>
                  <p className="text-lg font-semibold">
                    <Money
                      cents={p.contributionCents}
                      format={auth.merchant}
                      colored
                    />
                  </p>
                </div>
              </div>
              <MetricNote kind="attributed" className="mt-3" />
            </Card>
          ))}
          {performance.length === 0 && (
            <Card>
              <p className="text-sm text-ink-muted">
                Performance appears after offers are shown.
              </p>
            </Card>
          )}
        </div>
      </Section>
    </>
  );
}
