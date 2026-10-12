import { Search, Users } from "lucide-react";
import { customerList, type CustomerRow } from "@/modules/analytics/queries";
import { loadMerchantContext } from "@/modules/merchants/repo";
import { withAuth } from "@/server/action";
import { Badge } from "@/ui/badge";
import { DataTable, type Column } from "@/ui/data-table";
import { Input, Select } from "@/ui/field";
import { Money } from "@/ui/money";
import { PageHeader } from "@/ui/page-header";

export default async function CustomersPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; segment?: string }>;
}) {
  const filters = await searchParams;
  const { auth, db, now } = await withAuth("staff");
  const merchant = await loadMerchantContext(db, auth.merchantId);
  const rows = await customerList(db, merchant, now, {
    search: filters.q || null,
    segment: (filters.segment as never) || null,
  });
  const columns: Column<CustomerRow>[] = [
    {
      key: "customer",
      header: "Customer",
      cell: (r) => (
        <div>
          <p>{r.name}</p>
          <p className="mt-0.5 text-xs text-ink-subtle">
            {r.phoneMasked} · {r.redeemCode}
          </p>
        </div>
      ),
    },
    {
      key: "anchor",
      header: "Waiting",
      cell: (r) =>
        r.anchors.length ? (
          <div className="space-y-1">
            {r.anchors.slice(0, 2).map((a) => (
              <Badge key={a} tone="accent">
                {a}
              </Badge>
            ))}
          </div>
        ) : (
          <span className="text-ink-subtle">None</span>
        ),
    },
    {
      key: "score",
      header: "Return score",
      cell: (r) => (
        <Badge
          tone={
            r.returnBand === "high"
              ? "success"
              : r.returnBand === "at_risk"
                ? "warning"
                : "neutral"
          }
        >
          {r.score ?? "—"}%
        </Badge>
      ),
      align: "center",
    },
    {
      key: "last",
      header: "Last visit",
      cell: (r) =>
        r.lastVisitAt?.toLocaleDateString(auth.merchant.locale) ?? "Never",
      hideBelow: "md",
    },
    {
      key: "ltv",
      header: "Lifetime spend",
      cell: (r) => (
        <Money cents={r.lifetimeSpendCents} format={auth.merchant} />
      ),
      align: "right",
      hideBelow: "sm",
    },
    {
      key: "next",
      header: "Next action",
      cell: (r) => (
        <div>
          <p className="font-medium">{r.nextAction.label}</p>
          <p className="max-w-xs text-xs text-ink-subtle">
            {r.nextAction.detail}
          </p>
        </div>
      ),
      hideBelow: "lg",
    },
  ];
  return (
    <>
      <PageHeader
        eyebrow={auth.merchant.name}
        title="Customers"
        description="Use owned value, visit behaviour and measured response to decide the next useful action. Purchase history stays inside the staff console."
        meta={
          <Badge tone="accent" icon={<Users />}>
            {rows.length} customers
          </Badge>
        }
      />
      <form className="mb-4 flex flex-col gap-3 rounded-xl border border-line bg-surface p-3 shadow-card sm:flex-row">
        <div className="relative flex-1">
          <Search className="absolute top-1/2 left-3 size-4 -translate-y-1/2 text-ink-subtle" />
          <Input
            name="q"
            defaultValue={filters.q}
            placeholder="Search name or phone"
            className="pl-9"
          />
        </div>
        <Select
          name="segment"
          defaultValue={filters.segment ?? ""}
          className="sm:w-52"
        >
          <option value="">All segments</option>
          <option value="likely_regular">Likely regular</option>
          <option value="persuadable">Persuadable</option>
          <option value="at_risk">At risk</option>
          <option value="high_value">High value</option>
          <option value="price_sensitive">Price sensitive</option>
        </Select>
        <button className="h-10 rounded-lg bg-accent px-4 text-sm font-medium text-white">
          Apply
        </button>
      </form>
      <DataTable
        rows={rows}
        columns={columns}
        rowKey={(r) => r.id}
        rowHref={(r) => `/customers/${r.id}`}
        empty={
          <div className="p-12 text-center">
            <Users className="mx-auto size-8 text-ink-subtle" />
            <p className="mt-3 font-medium">No matching customers</p>
          </div>
        }
      />
    </>
  );
}
