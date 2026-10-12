import {
  Clock3,
  Cpu,
  LockKeyhole,
  MessageCircle,
  ShieldCheck,
  WalletCards,
} from "lucide-react";
import { loadMerchantContext } from "@/modules/merchants/repo";
import { withAuth } from "@/server/action";
import { Badge } from "@/ui/badge";
import { Card } from "@/ui/card";
import { DescriptionList } from "@/ui/description-list";
import { Money, Percent } from "@/ui/money";
import { PageHeader } from "@/ui/page-header";
import { Section } from "@/ui/section";

export default async function SettingsPage() {
  const { auth, db } = await withAuth("manager");
  const { merchant, settings } = await loadMerchantContext(db, auth.merchantId);
  return (
    <>
      <PageHeader
        eyebrow={merchant.name}
        title="Merchant controls"
        description="These are the hard boundaries around automated decisions. The agent cannot bypass them, and every decision is recorded for audit."
        meta={
          <Badge tone="success" icon={<LockKeyhole />}>
            Manager controlled
          </Badge>
        }
      />
      <Section title="Profit and exposure guardrails">
        <div className="grid gap-4 lg:grid-cols-3">
          <Card title="Offer economics" icon={<ShieldCheck />} tone="accent">
            <DescriptionList
              layout="stacked"
              items={[
                {
                  term: "Minimum expected contribution",
                  detail: (
                    <Money
                      cents={settings.guardrails.minExpectedContributionCents}
                      format={merchant}
                    />
                  ),
                },
                {
                  term: "Minimum margin today",
                  detail: (
                    <Percent rate={settings.guardrails.minTodayMarginRate} />
                  ),
                },
                {
                  term: "Maximum implied discount",
                  detail: (
                    <Percent
                      rate={settings.guardrails.maxImpliedDiscountRate}
                    />
                  ),
                },
              ]}
            />
          </Card>
          <Card title="Customer frequency" icon={<Clock3 />}>
            <DescriptionList
              layout="stacked"
              items={[
                {
                  term: "Offer cooldown",
                  detail: `${settings.guardrails.offerCooldownDays} days`,
                },
                {
                  term: "Discount gap",
                  detail: `${settings.guardrails.discountMinGapDays} days`,
                },
                {
                  term: "Maximum active anchors",
                  detail: settings.guardrails.maxActiveAnchors,
                },
              ]}
            />
          </Card>
          <Card title="Merchant liability" icon={<WalletCards />}>
            <DescriptionList
              layout="stacked"
              items={[
                {
                  term: "Outstanding retail cap",
                  detail: (
                    <Money
                      cents={settings.guardrails.liabilityCapCents}
                      format={merchant}
                    />
                  ),
                },
                {
                  term: "Promo cost cap / customer",
                  detail: (
                    <Money
                      cents={settings.guardrails.promoCostCapCents}
                      format={merchant}
                    />
                  ),
                },
                {
                  term: "Default anchor validity",
                  detail: `${settings.anchors.defaultValidityDays} days`,
                },
              ]}
            />
          </Card>
        </div>
      </Section>
      <Section title="Agent policy">
        <Card title="Constrained decision engine" icon={<Cpu />}>
          <ol className="grid gap-3 text-sm md:grid-cols-2">
            <li className="rounded-lg bg-surface-muted p-3">
              <strong>1. Observe.</strong> Read the current organic basket,
              party size, approved menu economics and optional customer segment.
            </li>
            <li className="rounded-lg bg-surface-muted p-3">
              <strong>2. Generate.</strong> Build candidates only from
              merchant-approved Anchor programmes and price points.
            </li>
            <li className="rounded-lg bg-surface-muted p-3">
              <strong>3. Gate.</strong> Reject candidates below contribution or
              margin floors, in cooldown, over liability, stacked with promos,
              or outside business windows.
            </li>
            <li className="rounded-lg bg-surface-muted p-3">
              <strong>4. Rank.</strong> Score expected value using acceptance
              probability and expected next-visit gross profit. Choose one or NO
              OFFER.
            </li>
            <li className="rounded-lg bg-surface-muted p-3">
              <strong>5. Measure.</strong> Preserve a random holdout, lock the
              decision to the bill, and compare matured contribution.
            </li>
            <li className="rounded-lg bg-surface-muted p-3">
              <strong>6. Learn safely.</strong> Use measured uplift only after
              enough samples; rules and margin floors remain deterministic.
            </li>
          </ol>
        </Card>
      </Section>
      <Section title="Messaging">
        <Card title="WhatsApp retention engine" icon={<MessageCircle />}>
          <DescriptionList
            items={[
              {
                term: "Enabled",
                detail: settings.messaging.enabled ? "Yes" : "No",
              },
              {
                term: "Quiet hours",
                detail: `${settings.messaging.quietHoursStart}–${settings.messaging.quietHoursEnd}`,
              },
              {
                term: "Marketing frequency",
                detail: `${settings.messaging.maxMarketingPer7Days}/7 days · ${settings.messaging.maxMarketingPer30Days}/30 days`,
              },
              {
                term: "Win-back timing",
                detail: `${settings.messaging.winBackAfterDays} days`,
              },
            ]}
          />
        </Card>
      </Section>
    </>
  );
}
