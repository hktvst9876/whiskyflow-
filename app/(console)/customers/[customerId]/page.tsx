import {
  Clock3,
  Gift,
  MessageCircle,
  ReceiptText,
  ShieldCheck,
} from "lucide-react";
import { notFound } from "next/navigation";
import { customerDetail } from "@/modules/analytics/queries";
import { loadMerchantContext } from "@/modules/merchants/repo";
import { withAuth } from "@/server/action";
import { Badge } from "@/ui/badge";
import { Card } from "@/ui/card";
import { DescriptionList } from "@/ui/description-list";
import { Money } from "@/ui/money";
import { PageHeader } from "@/ui/page-header";
import { Section } from "@/ui/section";
import { Stat, StatGrid } from "@/ui/stat";

export default async function CustomerPage({
  params,
}: {
  params: Promise<{ customerId: string }>;
}) {
  const { customerId } = await params;
  const { auth, db, now } = await withAuth("staff");
  const merchant = await loadMerchantContext(db, auth.merchantId);
  let detail;
  try {
    detail = await customerDetail(db, merchant, customerId, now);
  } catch {
    notFound();
  }
  const c = detail.customer;
  return (
    <>
      <PageHeader
        back={{ href: "/customers", label: "Customers" }}
        eyebrow={auth.merchant.name}
        title={c.displayName || detail.phoneMasked}
        description={`${detail.phoneMasked} · wallet code ${detail.redeemCode}`}
        meta={
          <>
            <Badge tone="accent">
              {c.segment?.replaceAll("_", " ") ?? "unsegmented"}
            </Badge>
            <Badge
              tone={
                c.returnBand === "high"
                  ? "success"
                  : c.returnBand === "at_risk"
                    ? "warning"
                    : "neutral"
              }
            >
              Return {c.returnBand?.replaceAll("_", " ") ?? "unknown"}
            </Badge>
          </>
        }
      />
      <StatGrid columns={4}>
        <Stat
          label="Return score"
          value={
            c.returnProbability === null
              ? "—"
              : `${Math.round(c.returnProbability * 100)}%`
          }
          icon={<Clock3 />}
        />
        <Stat label="Visits" value={c.visitCount} icon={<ReceiptText />} />
        <Stat
          label="Lifetime spend"
          value={<Money cents={c.totalSpendCents} format={auth.merchant} />}
        />
        <Stat
          label="Lifetime gross profit"
          value={<Money cents={c.totalGpCents} format={auth.merchant} />}
          tone="success"
        />
      </StatGrid>
      <Section title="Recommended next action">
        <Card tone="accent">
          <p className="font-semibold">{detail.nextAction.label}</p>
          <p className="mt-1 text-sm text-ink-muted">
            {detail.nextAction.detail}
          </p>
        </Card>
      </Section>
      <Section
        title="Return Anchors"
        description="Append-only ledger history makes balances auditable."
      >
        <div className="grid gap-4 md:grid-cols-2">
          {detail.anchors.map(
            ({ entitlement: e, label, remainingRetailCents, events }) => (
              <Card
                key={e.id}
                title={label}
                description={e.status.replaceAll("_", " ")}
                icon={<Gift />}
              >
                <DescriptionList
                  items={[
                    {
                      term: "Remaining retail",
                      detail: (
                        <Money
                          cents={remainingRetailCents}
                          format={auth.merchant}
                        />
                      ),
                    },
                    {
                      term: "Expires",
                      detail:
                        e.expiresAt?.toLocaleDateString(auth.merchant.locale) ??
                        "No expiry",
                    },
                    {
                      term: "Transfer",
                      detail: e.transferable ? "Allowed" : "Not allowed",
                    },
                    { term: "Ledger events", detail: events.length },
                  ]}
                />
              </Card>
            ),
          )}
          {detail.anchors.length === 0 && (
            <Card>
              <p className="text-sm text-ink-muted">No Return Anchors yet.</p>
            </Card>
          )}
        </div>
      </Section>
      <Section title="Trust and contact">
        <div className="grid gap-4 md:grid-cols-2">
          <Card title="Messaging" icon={<MessageCircle />}>
            <p className="text-sm text-ink-muted">
              Service messages: {c.whatsappServiceOptIn ? "consented" : "off"}
              <br />
              Marketing: {c.whatsappMarketingOptIn ? "consented" : "off"}
            </p>
          </Card>
          <Card title="Consent trail" icon={<ShieldCheck />}>
            <p className="text-sm text-ink-muted">
              {detail.consents.length} recorded consent events. The newest
              explicit choice controls each purpose.
            </p>
          </Card>
        </div>
      </Section>
    </>
  );
}
