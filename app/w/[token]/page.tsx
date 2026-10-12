import type { Metadata } from "next";
import {
  CalendarClock,
  CheckCircle2,
  Gift,
  History,
  QrCode as QrIcon,
  ShieldCheck,
} from "lucide-react";
import { notFound } from "next/navigation";
import { env } from "@/config/env";
import { entitlementLabel } from "@/modules/anchors/labels";
import {
  listEntitlementsForCustomer,
  listEventsForEntitlements,
} from "@/modules/anchors/repo";
import {
  getCustomer,
  findWalletToken,
  touchWalletToken,
} from "@/modules/customers/repo";
import { loadMerchantContext } from "@/modules/merchants/repo";
import { getNow } from "@/server/clock";
import { getDb } from "@/server/db";
import { Badge } from "@/ui/badge";
import { BrandScope } from "@/ui/brand-scope";
import { Card } from "@/ui/card";
import { DescriptionList } from "@/ui/description-list";
import { Progress } from "@/ui/progress";
import { QrCode } from "@/ui/qr-code";

export const metadata: Metadata = {
  title: "My Return Anchors",
  robots: { index: false, follow: false },
  referrer: "no-referrer",
};

export default async function WalletPage({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const { token } = await params;
  const db = await getDb();
  const row = await findWalletToken(db, token);
  if (!row) notFound();
  const now = await getNow(db);
  const [merchant, customer, anchors] = await Promise.all([
    loadMerchantContext(db, row.merchantId),
    getCustomer(db, row.merchantId, row.customerId),
    listEntitlementsForCustomer(db, row.customerId),
  ]);
  await touchWalletToken(db, row.id, now);
  const active = anchors.filter((a) => a.status === "active");
  const events = await listEventsForEntitlements(
    db,
    anchors.map((a) => a.id),
  );
  const walletUrl = `${env().appUrl}/w/${token}`;
  return (
    <BrandScope
      color={merchant.merchant.brandColor}
      className="min-h-screen bg-brand-soft"
    >
      <main className="mx-auto max-w-2xl px-4 py-8 sm:py-12">
        <header className="text-center">
          <div className="mx-auto grid size-12 place-items-center rounded-2xl bg-brand text-brand-contrast">
            <Gift />
          </div>
          <p className="mt-3 text-sm font-semibold tracking-wide text-brand uppercase">
            {merchant.merchant.name}
          </p>
          <h1 className="mt-2 text-3xl font-semibold">
            {customer.displayName
              ? `${customer.displayName}’s wallet`
              : "Your wallet"}
          </h1>
          <p className="mt-2 text-ink-muted">
            What you own, what remains, and how to use it.
          </p>
        </header>
        <div className="mt-7 space-y-4">
          {active.map((a) => {
            const pct =
              a.unitType === "percent"
                ? a.quantityRemaining
                : (a.quantityRemaining / a.quantityInitial) * 100;
            return (
              <Card
                key={a.id}
                title={entitlementLabel(a)}
                description={a.termsSnapshot.coverageText}
                tone="accent"
                icon={<Gift />}
                actions={
                  <Badge tone="success" dot>
                    Active
                  </Badge>
                }
              >
                <Progress
                  value={pct}
                  label={a.displayName}
                  valueText={
                    a.unitType === "percent"
                      ? `${a.quantityRemaining}% remains`
                      : `${a.quantityRemaining} of ${a.quantityInitial} remains`
                  }
                />
                <DescriptionList
                  className="mt-5"
                  items={[
                    {
                      term: "Expires",
                      detail:
                        a.expiresAt?.toLocaleDateString(
                          merchant.merchant.locale,
                        ) ?? "No expiry",
                    },
                    {
                      term: "Use",
                      detail: a.termsSnapshot.redemption.requiresNewPurchase
                        ? "With a new purchase"
                        : "On an eligible visit",
                    },
                    {
                      term: "Upgrades",
                      detail: a.termsSnapshot.upgradeAllowed
                        ? "Pay the difference for eligible upgrades"
                        : "Not available",
                    },
                    {
                      term: "Transfer",
                      detail: a.transferable ? "Allowed" : "Not transferable",
                    },
                    {
                      term: "Refunds",
                      detail: a.termsSnapshot.refundPolicy.replaceAll("_", " "),
                    },
                  ]}
                />
              </Card>
            );
          })}
          {active.length === 0 && (
            <Card>
              <div className="py-6 text-center">
                <CheckCircle2 className="mx-auto size-9 text-success" />
                <h2 className="mt-3 font-semibold">
                  Nothing waiting right now
                </h2>
                <p className="mt-1 text-sm text-ink-muted">
                  Your used and expired items remain in the transparent history
                  below.
                </p>
              </div>
            </Card>
          )}
        </div>
        <div className="mt-6 grid gap-4 sm:grid-cols-2">
          <Card title="Show at the venue" icon={<QrIcon />}>
            <div className="text-center">
              <QrCode
                value={walletUrl}
                title="Wallet identification QR"
                size={150}
              />
              <p className="mt-2 font-mono text-lg font-semibold tracking-widest">
                {customer.redeemCode.slice(0, 4)}-{customer.redeemCode.slice(4)}
              </p>
            </div>
          </Card>
          <Card title="Trust and privacy" icon={<ShieldCheck />}>
            <p className="text-sm leading-6 text-ink-muted">
              This wallet displays tangible items rather than hiding value
              behind points. Expiry and use rules are shown before redemption.
              Your history is never displayed on a public table screen.
            </p>
          </Card>
        </div>
        <Card
          className="mt-4"
          title="Transaction history"
          description={`${events.length} auditable ledger events`}
          icon={<History />}
        >
          <div className="space-y-3">
            {events.slice(0, 12).map((e) => (
              <div
                key={e.id}
                className="flex items-center justify-between gap-3 text-sm"
              >
                <div>
                  <p className="font-medium capitalize">
                    {e.type.replaceAll("_", " ")}
                  </p>
                  <p className="text-xs text-ink-subtle">
                    <CalendarClock className="mr-1 inline size-3" />
                    {e.createdAt.toLocaleDateString(merchant.merchant.locale)}
                  </p>
                </div>
                <span className="font-mono text-ink-muted">
                  {e.quantityDelta > 0 ? "+" : ""}
                  {e.quantityDelta}
                </span>
              </div>
            ))}
          </div>
        </Card>
      </main>
    </BrandScope>
  );
}
