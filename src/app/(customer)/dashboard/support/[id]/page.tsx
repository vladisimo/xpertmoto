"use client";

import { use } from "react";
import Link from "next/link";
import { trpc } from "@/lib/trpc/client";
import { PageHeader } from "@/components/layout/page-header";
import { PageSection, PageShell } from "@/components/layout/page-section";
import { StatusBadge } from "@/components/ui/status-badge";
import { formatDistanceToNow } from "date-fns";

export default function CustomerSupportTicketDetail(props: {
  params: Promise<{ id: string }>;
}) {
  const { id } = use(props.params);
  const { data, isLoading } = trpc.support.myTicketDetail.useQuery({ id });

  if (isLoading) {
    return (
      <PageShell>
        <p className="text-muted-foreground">Loading ticket…</p>
      </PageShell>
    );
  }
  if (!data) {
    return (
      <PageShell>
        <p className="text-muted-foreground">Ticket not found.</p>
      </PageShell>
    );
  }

  return (
    <PageShell>
      <PageHeader
        eyebrow="Support ticket"
        breadcrumbs={[
          { label: "Support", href: "/dashboard/support" },
          { label: data.ticketNumber },
        ]}
        title={data.summary}
        description={
          <span className="flex flex-wrap items-center gap-2">
            <span className="font-mono">{data.ticketNumber}</span>
            <StatusBadge status={data.category} />
            <StatusBadge status={data.status} />
          </span>
        }
        actions={
          <Link
            href="/dashboard/support"
            className="text-sm text-muted-foreground hover:text-foreground"
          >
            ← Back
          </Link>
        }
      />

      <PageSection title="Conversation">
        <div className="space-y-3">
          {data.conversation.messages.map((m) => (
            <div
              key={m.id}
              className={
                m.senderRole === "CUSTOMER"
                  ? "ml-4 rounded-md border bg-muted p-3 sm:ml-8"
                  : m.senderRole === "STAFF"
                    ? "mr-4 rounded-md border border-primary/40 bg-primary/5 p-3 sm:mr-8"
                    : m.senderRole === "AI"
                      ? "mr-4 rounded-md border border-accent/40 bg-accent/5 p-3 sm:mr-8"
                      : "rounded-md border border-dashed p-3 text-xs text-muted-foreground"
              }
            >
              <p className="mb-1 text-[11px] uppercase tracking-wider text-muted-foreground">
                {m.senderRole} · {formatDistanceToNow(m.createdAt, { addSuffix: true })}
              </p>
              <p className="whitespace-pre-wrap text-sm">{m.body}</p>
            </div>
          ))}
        </div>
      </PageSection>
    </PageShell>
  );
}
