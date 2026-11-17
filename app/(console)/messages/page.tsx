import { MessageCircle, Send, Smartphone } from "lucide-react";
import Link from "next/link";
import { env } from "@/config/env";
import { formatDate } from "@/core/time";
import { maskPhone } from "@/core/phone";
import { getCustomer, listCustomerRows } from "@/modules/customers/repo";
import { listMessages } from "@/modules/messaging/repo";
import type { Message, MessageStatus } from "@/modules/messaging/types";
import { withPageAuth } from "@/server/action";
import { ActionForm, SubmitButton } from "@/ui/action-form";
import { Badge } from "@/ui/badge";
import { Card } from "@/ui/card";
import { DataTable, type Column } from "@/ui/data-table";
import { Field, Input } from "@/ui/field";
import { Money } from "@/ui/money";
import { PageHeader } from "@/ui/page-header";
import { Section } from "@/ui/section";
import { SubNav } from "@/ui/sub-nav";
import { demoInboundAction } from "./actions";

const TONE: Record<MessageStatus, "success" | "warning" | "danger" | "neutral" | "info"> = {
  scheduled: "info",
  sending: "info",
  sent: "success",
  delivered: "success",
  read: "success",
  failed: "danger",
  suppressed: "warning",
  cancelled: "neutral",
  received: "neutral",
};

const FILTERS: Record<string, MessageStatus[] | undefined> = {
  all: undefined,
  scheduled: ["scheduled", "sending"],
  sent: ["sent", "delivered", "read"],
  held: ["suppressed", "failed", "cancelled"],
};

export default async function MessagesPage({
  searchParams,
}: {
  searchParams: Promise<{ show?: string; c?: string }>;
}) {
  const { show = "all", c } = await searchParams;
  const { auth, db } = await withPageAuth("manager");
  const when = (d: Date) => formatDate(d, { timeZone: auth.merchant.timezone, locale: auth.merchant.locale, withTime: true });
  const rows = await listMessages(db, auth.merchantId, { statuses: FILTERS[show], limit: 150 });
  const demo = env().demoMode;
  const people = demo ? (await listCustomerRows(db, auth.merchantId, { limit: 60 })).filter((p) => p.phoneE164) : [];
  const selected = demo && c ? await getCustomer(db, auth.merchantId, c).catch(() => null) : null;
  const thread = selected ? (await listMessages(db, auth.merchantId, { customerId: selected.id, limit: 40 })).filter((m) => m.status !== "cancelled").reverse() : [];
  const columns: Column<Message>[] = [
    { key: "when", header: "When", cell: (m) => <span className="whitespace-nowrap">{when(m.sentAt ?? m.scheduledFor)}</span> },
    { key: "to", header: "To", cell: (m) => (m.direction === "inbound" ? `From ${maskPhone(m.toPhone)}` : maskPhone(m.toPhone)), hideBelow: "md" },
    {
      key: "body",
      header: "Message",
      cell: (m) => (
        <div className="max-w-xl">
          <p className="whitespace-pre-line">{m.body}</p>
          <p className="mt-1 text-xs text-ink-subtle">
            {m.templateKey?.replaceAll("_", " ") ?? "customer text"} · {m.category.replaceAll("_", " ")}
            {m.suppressReason ? ` · not sent: ${m.suppressReason}` : ""}
            {m.error ? ` · error: ${m.error}` : ""}
          </p>
        </div>
      ),
    },
    { key: "status", header: "Status", cell: (m) => <Badge tone={TONE[m.status]}>{m.status}</Badge> },
    { key: "cost", header: "Cost", align: "right", hideBelow: "md", cell: (m) => (m.sentAt ? <Money cents={m.estCostCents} format={auth.merchant} compact={false} /> : "—") },
  ];
  return (
    <>
      <PageHeader
        eyebrow={auth.merchant.name}
        title="Messages"
        description="Every WhatsApp message the system planned, sent or held back, and why. Messages are about what the customer owns; consent, quiet hours and frequency caps are checked again at the moment of sending."
        meta={<Badge tone="accent" icon={<MessageCircle />}>Provider: {env().whatsapp.provider}</Badge>}
      />
      {demo && (
        <Section title="Demo phone" description="See the conversation as a customer would, and reply as them. Try STOP, START or “balance?”.">
          <div className="grid gap-4 lg:grid-cols-[18rem_1fr]">
            <Card title="Pick a customer" icon={<Smartphone />} bodyClassName="max-h-80 overflow-y-auto">
              <ul className="space-y-1 text-sm">
                {people.map((p) => (
                  <li key={p.id}>
                    <Link href={`/messages?c=${p.id}`} className={`block rounded-lg px-2 py-1.5 hover:bg-surface-sunken ${selected?.id === p.id ? "bg-accent-soft font-medium" : ""}`}>
                      {p.displayName ?? maskPhone(p.phoneE164)}
                    </Link>
                  </li>
                ))}
              </ul>
            </Card>
            <Card title={selected ? `${selected.displayName ?? "Customer"} · ${maskPhone(selected.phoneE164)}` : "No customer selected"} description={selected ? `Service messages ${selected.whatsappServiceOptIn ? "on" : "off"} · offers ${selected.whatsappMarketingOptIn ? "on" : "off"}` : "Choose someone on the left."}>
              {selected && (
                <>
                  <div className="max-h-96 space-y-2 overflow-y-auto rounded-xl bg-surface-sunken p-3">
                    {thread.map((m) => (
                      <div key={m.id} className={`max-w-[85%] rounded-xl px-3 py-2 text-sm shadow-card ${m.direction === "inbound" ? "ml-auto bg-accent-soft" : "bg-surface"} ${["sent", "delivered", "read", "received"].includes(m.status) ? "" : "opacity-60"}`}>
                        <p className="whitespace-pre-line">{m.body}</p>
                        {m.buttons.length > 0 && ["sent", "delivered", "read"].includes(m.status) && (
                          <div className="mt-2 flex flex-wrap gap-2">
                            {m.buttons.map((b) => (
                              <a key={b.action} href={b.url} target="_blank" rel="noreferrer" className="rounded-full border border-accent-line px-2.5 py-1 text-xs font-medium text-accent-ink">
                                {b.label}
                              </a>
                            ))}
                          </div>
                        )}
                        <p className="mt-1 text-[11px] text-ink-subtle">
                          {when(m.sentAt ?? m.scheduledFor)} · {m.status}
                          {m.suppressReason ? ` (${m.suppressReason})` : ""}
                        </p>
                      </div>
                    ))}
                    {thread.length === 0 && <p className="p-4 text-center text-sm text-ink-muted">No messages yet.</p>}
                  </div>
                  <ActionForm action={demoInboundAction.bind(null, selected.id)} resetOnSuccess className="mt-3 flex items-end gap-2">
                    <Field label="Reply as this customer" name="text" className="flex-1">
                      <Input name="text" placeholder="STOP, START or balance?" autoComplete="off" required />
                    </Field>
                    <SubmitButton icon={<Send />}>Send</SubmitButton>
                  </ActionForm>
                </>
              )}
            </Card>
          </div>
        </Section>
      )}
      <Section title="Outbox and inbox">
        <SubNav
          items={[
            { href: "/messages", label: "All" },
            { href: "/messages?show=scheduled", label: "Scheduled" },
            { href: "/messages?show=sent", label: "Sent" },
            { href: "/messages?show=held", label: "Not sent" },
          ]}
        />
        <DataTable rows={rows} columns={columns} rowKey={(m) => m.id} empty={<p className="p-8 text-center text-sm text-ink-muted">No messages here yet.</p>} />
      </Section>
    </>
  );
}
