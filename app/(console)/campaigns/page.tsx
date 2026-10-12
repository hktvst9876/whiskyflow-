import { FlaskConical, MessageCircle, Send } from "lucide-react";
import { suggestedCampaigns } from "@/flows/campaigns";
import { campaignPerformance } from "@/modules/analytics/queries";
import { withAuth } from "@/server/action";
import { ActionForm, SubmitButton } from "@/ui/action-form";
import { Badge, MetricNote } from "@/ui/badge";
import { Card } from "@/ui/card";
import { Money, Percent } from "@/ui/money";
import { PageHeader } from "@/ui/page-header";
import { Section } from "@/ui/section";
import { launchCampaignAction } from "./actions";

export default async function CampaignsPage() {
  const { auth, db, ctx, now } = await withAuth("manager");
  const [suggestions, performance] = await Promise.all([
    suggestedCampaigns(db, ctx),
    campaignPerformance(db, auth.merchantId, now),
  ]);
  return (
    <>
      <PageHeader
        eyebrow={auth.merchant.name}
        title="Campaigns"
        description="Behaviour-triggered WhatsApp messages remind customers what they already own. Every campaign keeps a random holdout so response is not mistaken for lift."
        meta={
          <Badge tone="accent" icon={<MessageCircle />}>
            Consent and frequency caps enforced
          </Badge>
        }
      />
      <Section
        title="Suggested now"
        description="The system recommends a useful reason to return without rewarding customers for simply waiting."
      >
        <div className="grid gap-4 lg:grid-cols-2">
          {suggestions.map((s) => (
            <Card
              key={s.kind}
              title={s.name}
              description={`${s.audienceCount} eligible customers · ${s.segment.replaceAll("_", " ")}`}
              tone="accent"
              icon={<Send />}
            >
              <p className="text-sm text-ink-muted">{s.why}</p>
              {s.offerSummary && (
                <p className="mt-3 rounded-lg bg-white/70 p-3 text-sm font-medium">
                  {s.offerSummary}
                </p>
              )}
              <div className="mt-4 flex items-end justify-between gap-3">
                <div className="text-sm">
                  <p className="text-ink-subtle">Expected return</p>
                  <p className="font-semibold">
                    <Money
                      cents={s.expectedReturnCents}
                      format={auth.merchant}
                    />
                  </p>
                </div>
                <ActionForm action={launchCampaignAction.bind(null, s.kind)}>
                  <SubmitButton size="sm" pendingLabel="Launching…">
                    Launch with holdout
                  </SubmitButton>
                </ActionForm>
              </div>
            </Card>
          ))}
          {suggestions.length === 0 && (
            <Card>
              <p className="text-sm text-ink-muted">
                No audience currently passes the consent, timing and frequency
                rules.
              </p>
            </Card>
          )}
        </div>
      </Section>
      <Section
        title="Measured performance"
        description="Treatment and holdout customers are compared over the same time window."
      >
        <div className="grid gap-4 lg:grid-cols-2">
          {performance.map((p) => (
            <Card
              key={p.campaign.id}
              title={p.campaign.name}
              description={`${p.daysSinceLaunch} days since launch`}
              icon={<FlaskConical />}
            >
              <div className="grid grid-cols-3 gap-3 text-sm">
                <div>
                  <p className="text-ink-subtle">Treatment</p>
                  <p className="font-semibold">
                    {p.treatment.returned}/{p.treatment.n} returned
                  </p>
                </div>
                <div>
                  <p className="text-ink-subtle">Holdout</p>
                  <p className="font-semibold">
                    {p.holdout.returned}/{p.holdout.n} returned
                  </p>
                </div>
                <div>
                  <p className="text-ink-subtle">Return lift</p>
                  <p className="font-semibold">
                    <Percent rate={p.returnLift} digits={1} />
                  </p>
                </div>
              </div>
              <div className="mt-4 flex items-center justify-between border-t border-line pt-3">
                <MetricNote kind="measured" />
                <Money
                  cents={p.estimatedIncrementalGpCents}
                  format={auth.merchant}
                  colored
                />
              </div>
            </Card>
          ))}
          {performance.length === 0 && (
            <Card>
              <p className="text-sm text-ink-muted">
                Launch a campaign to begin measuring incremental return
                behaviour.
              </p>
            </Card>
          )}
        </div>
      </Section>
    </>
  );
}
