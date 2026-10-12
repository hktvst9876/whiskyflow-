import { Clock3, Plus, ReceiptText, Users } from "lucide-react";
import { listOpenVisits } from "@/flows/visits";
import { withAuth } from "@/server/action";
import { ActionForm, SubmitButton } from "@/ui/action-form";
import { Badge } from "@/ui/badge";
import { Card } from "@/ui/card";
import { DataTable, type Column } from "@/ui/data-table";
import { Field, FieldGrid, Input } from "@/ui/field";
import { Money } from "@/ui/money";
import { PageHeader } from "@/ui/page-header";
import { openVisitAction } from "./actions";

type Row = Awaited<ReturnType<typeof listOpenVisits>>[number];

export default async function PosPage() {
  const { auth, db, ctx } = await withAuth("staff");
  const rows = await listOpenVisits(db, ctx);
  const columns: Column<Row>[] = [
    {
      key: "bill",
      header: "Bill",
      cell: (r) => (
        <div>
          <p>{r.visit.label || "Walk-in"}</p>
          <p className="mt-0.5 text-xs text-ink-subtle">
            {r.visit.id.slice(0, 8)}
          </p>
        </div>
      ),
    },
    {
      key: "party",
      header: "Party",
      cell: (r) => (
        <span className="inline-flex items-center gap-1.5">
          <Users className="size-4 text-ink-subtle" />
          {r.visit.partySize}
        </span>
      ),
    },
    {
      key: "customer",
      header: "Customer",
      cell: (r) =>
        r.customerName ?? (
          <span className="text-ink-subtle">Not identified</span>
        ),
      hideBelow: "sm",
    },
    {
      key: "opened",
      header: "Opened",
      cell: (r) => (
        <span className="inline-flex items-center gap-1.5">
          <Clock3 className="size-4 text-ink-subtle" />
          {r.visit.openedAt.toLocaleTimeString(auth.merchant.locale, {
            hour: "2-digit",
            minute: "2-digit",
          })}
        </span>
      ),
      hideBelow: "md",
    },
    {
      key: "total",
      header: "Total",
      cell: (r) => (
        <Money cents={r.totals.revenueCents} format={auth.merchant} />
      ),
      align: "right",
    },
  ];
  return (
    <>
      <PageHeader
        eyebrow={auth.merchant.name}
        title="Till"
        description="Build the bill, identify the customer when useful, and evaluate one profitable Return Anchor before checkout."
        meta={<Badge tone="accent">{rows.length} open bills</Badge>}
      />
      <div className="grid gap-6 xl:grid-cols-[22rem_1fr]">
        <Card
          title="Open a bill"
          description="Use a table number or walk-in label"
          icon={<Plus />}
        >
          <ActionForm action={openVisitAction} className="space-y-4">
            <FieldGrid columns={2}>
              <Field label="Table / label" name="label">
                <Input name="label" placeholder="Table 12" />
              </Field>
              <Field label="Party size" name="partySize" required>
                <Input
                  name="partySize"
                  type="number"
                  min={1}
                  max={50}
                  defaultValue={2}
                  required
                />
              </Field>
            </FieldGrid>
            <SubmitButton
              fullWidth
              pendingLabel="Opening…"
              icon={<ReceiptText />}
            >
              Open bill
            </SubmitButton>
          </ActionForm>
        </Card>
        <div>
          <h2 className="mb-3 text-base font-semibold">Open bills</h2>
          <DataTable
            rows={rows}
            columns={columns}
            rowKey={(r) => r.visit.id}
            rowHref={(r) => `/pos/${r.visit.id}`}
            empty={
              <div className="p-10 text-center">
                <ReceiptText className="mx-auto size-8 text-ink-subtle" />
                <p className="mt-3 font-medium">No open bills</p>
                <p className="mt-1 text-sm text-ink-muted">
                  Open one to run the complete checkout flow.
                </p>
              </div>
            }
          />
        </div>
      </div>
    </>
  );
}
