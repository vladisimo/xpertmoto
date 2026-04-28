"use client";

import { use, useState } from "react";
import Link from "next/link";
import { trpc } from "@/lib/trpc/client";
import { PageHeader } from "@/components/layout/page-header";
import { PageSection, PageShell } from "@/components/layout/page-section";
import { StatusBadge } from "@/components/ui/status-badge";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { formatDistanceToNow } from "date-fns";

export default function StaffSupportTicketDetail(props: {
  params: Promise<{ id: string }>;
}) {
  const { id } = use(props.params);
  const utils = trpc.useUtils();
  const { data: ticket, isLoading } = trpc.support.ticketDetail.useQuery({ id });
  const staff = trpc.support.listDepotStaff.useQuery({ depotId: ticket?.depotId ?? undefined });
  const addReply = trpc.support.addReply.useMutation({
    onSuccess: () => utils.support.ticketDetail.invalidate({ id }),
  });
  const assign = trpc.support.assignTicket.useMutation({
    onSuccess: () => utils.support.ticketDetail.invalidate({ id }),
  });
  const setStatus = trpc.support.setStatus.useMutation({
    onSuccess: () => {
      utils.support.ticketDetail.invalidate({ id });
      utils.support.listTickets.invalidate();
    },
  });
  const setPriority = trpc.support.setPriority.useMutation({
    onSuccess: () => utils.support.ticketDetail.invalidate({ id }),
  });
  const createIncident = trpc.support.createLinkedIncident.useMutation({
    onSuccess: () => utils.support.ticketDetail.invalidate({ id }),
  });
  const escalate = trpc.support.escalateToAdmin.useMutation({
    onSuccess: () => utils.support.ticketDetail.invalidate({ id }),
  });

  const [reply, setReply] = useState("");
  const [internalNote, setInternalNote] = useState("");

  if (isLoading) {
    return (
      <PageShell>
        <p className="text-muted-foreground">Loading ticket…</p>
      </PageShell>
    );
  }
  if (!ticket) {
    return (
      <PageShell>
        <p className="text-muted-foreground">Ticket not found.</p>
      </PageShell>
    );
  }

  const customerName = ticket.customer
    ? `${ticket.customer.firstName} ${ticket.customer.lastName}`
    : (ticket.conversation.customer
        ? `${ticket.conversation.customer.firstName} ${ticket.conversation.customer.lastName}`
        : "Guest");

  return (
    <PageShell>
      <PageHeader
        eyebrow="Support ticket"
        breadcrumbs={[
          { label: "Support", href: "/staff/support" },
          { label: ticket.ticketNumber },
        ]}
        title={ticket.summary}
        description={
          <span className="flex flex-wrap items-center gap-2">
            <span className="font-mono">{ticket.ticketNumber}</span>
            <span className="text-border">·</span>
            <StatusBadge status={ticket.category} />
            <StatusBadge status={ticket.priority} />
            <StatusBadge status={ticket.status} />
          </span>
        }
        actions={
          <Link href="/staff/support" className="text-sm text-muted-foreground hover:text-foreground">
            ← Back
          </Link>
        }
      />

      <div className="grid gap-6 lg:grid-cols-[2fr_1fr]">
        <PageSection title="Conversation" flush>
          <div className="space-y-3">
            {ticket.conversation.messages.map((m) => (
              <div
                key={m.id}
                className={
                  m.senderRole === "CUSTOMER"
                    ? "ml-6 rounded-md border bg-muted p-3"
                    : m.senderRole === "STAFF"
                      ? "mr-6 rounded-md border border-primary/40 bg-primary/5 p-3"
                      : m.senderRole === "AI"
                        ? "mr-6 rounded-md border border-accent/40 bg-accent/5 p-3"
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

          <div className="border-t pt-4 space-y-3">
            <textarea
              value={reply}
              onChange={(e) => setReply(e.target.value)}
              placeholder="Reply to the customer…"
              rows={3}
              className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            />
            <div className="flex items-center justify-between">
              <p className="text-xs text-muted-foreground">
                Replies are emailed to the customer.
              </p>
              <Button
                size="sm"
                disabled={!reply.trim() || addReply.isPending}
                onClick={async () => {
                  await addReply.mutateAsync({ id: ticket.id, body: reply });
                  setReply("");
                }}
              >
                Send reply
              </Button>
            </div>
          </div>

          <div className="border-t pt-4 space-y-3">
            <textarea
              value={internalNote}
              onChange={(e) => setInternalNote(e.target.value)}
              placeholder="Internal note (not visible to customer)…"
              rows={2}
              className="w-full rounded-md border border-input bg-muted px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            />
            <div className="flex items-center justify-end">
              <Button
                size="sm"
                variant="secondary"
                disabled={!internalNote.trim() || addReply.isPending}
                onClick={async () => {
                  await addReply.mutateAsync({
                    id: ticket.id,
                    body: internalNote,
                    asInternalNote: true,
                  });
                  setInternalNote("");
                }}
              >
                Save note
              </Button>
            </div>

            {ticket.notes.length > 0 && (
              <ul className="space-y-2 text-sm">
                {ticket.notes.map((n) => (
                  <li key={n.id} className="rounded-md border border-dashed bg-muted/60 p-2">
                    <p className="text-[11px] text-muted-foreground">
                      {n.user.firstName} {n.user.lastName} ·{" "}
                      {formatDistanceToNow(n.createdAt, { addSuffix: true })}
                    </p>
                    <p className="whitespace-pre-wrap">{n.body}</p>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </PageSection>

        <div className="space-y-4">
          <PageSection title="Customer">
            <p className="text-sm font-semibold">{customerName}</p>
            {ticket.customer?.email && (
              <p className="text-xs text-muted-foreground">{ticket.customer.email}</p>
            )}
            {ticket.customer?.phone && (
              <p className="text-xs text-muted-foreground">{ticket.customer.phone}</p>
            )}
            {ticket.linkedBooking && (
              <p className="mt-2 text-xs">
                Booking{" "}
                <Link
                  href={`/staff/bookings/${ticket.linkedBooking.id}`}
                  className="font-mono text-primary underline-offset-2 hover:underline"
                >
                  {ticket.linkedBooking.bookingReference}
                </Link>
              </p>
            )}
          </PageSection>

          <PageSection title="Assignment">
            <div className="space-y-2">
              <label className="text-xs uppercase tracking-wider text-muted-foreground">
                Assignee
              </label>
              <Select
                value={ticket.assigneeId ?? "UNASSIGNED"}
                onValueChange={(v) =>
                  v === "UNASSIGNED" ? undefined : assign.mutate({ id: ticket.id, assigneeId: v })
                }
              >
                <SelectTrigger>
                  <SelectValue placeholder="Pick someone" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="UNASSIGNED">Unassigned</SelectItem>
                  {(staff.data ?? []).map((u) => (
                    <SelectItem key={u.id} value={u.id}>
                      {u.firstName} {u.lastName} · {u.role}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2">
              <label className="text-xs uppercase tracking-wider text-muted-foreground">
                Priority
              </label>
              <Select
                value={ticket.priority}
                onValueChange={(v) =>
                  setPriority.mutate({
                    id: ticket.id,
                    priority: v as "LOW" | "NORMAL" | "HIGH" | "URGENT",
                  })
                }
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {["LOW", "NORMAL", "HIGH", "URGENT"].map((p) => (
                    <SelectItem key={p} value={p}>
                      {p}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </PageSection>

          <PageSection title="Actions">
            <div className="space-y-2">
              {ticket.linkedBooking && !ticket.linkedIncidentId && (
                <Button
                  variant="secondary"
                  size="sm"
                  className="w-full"
                  disabled={createIncident.isPending}
                  onClick={() =>
                    createIncident.mutate({ id: ticket.id, severity: "MINOR" })
                  }
                >
                  Create incident
                </Button>
              )}
              {ticket.linkedIncidentId && (
                <p className="text-xs text-muted-foreground">
                  Incident{" "}
                  <Link
                    href={`/staff/incidents/${ticket.linkedIncidentId}`}
                    className="font-mono text-primary underline-offset-2 hover:underline"
                  >
                    {ticket.linkedIncident?.incidentNumber}
                  </Link>{" "}
                  linked.
                </p>
              )}
              <Button
                variant="secondary"
                size="sm"
                className="w-full"
                onClick={() => {
                  const reason = window.prompt("Reason for escalating to admin:");
                  if (reason) escalate.mutate({ id: ticket.id, reason });
                }}
              >
                Escalate to admin
              </Button>
              {ticket.status !== "RESOLVED" && (
                <Button
                  size="sm"
                  className="w-full"
                  onClick={() => setStatus.mutate({ id: ticket.id, status: "RESOLVED" })}
                >
                  Mark resolved
                </Button>
              )}
              {ticket.status === "RESOLVED" && (
                <Button
                  size="sm"
                  variant="secondary"
                  className="w-full"
                  onClick={() => setStatus.mutate({ id: ticket.id, status: "CLOSED" })}
                >
                  Close ticket
                </Button>
              )}
            </div>
          </PageSection>

          {ticket.feedback.length > 0 && (
            <PageSection title="Customer feedback">
              <ul className="space-y-2 text-sm">
                {ticket.feedback.map((f) => (
                  <li key={f.id}>
                    <p className="font-medium">{f.kind}: {f.rating}/5</p>
                    {f.comment && (
                      <p className="text-xs text-muted-foreground">{f.comment}</p>
                    )}
                  </li>
                ))}
              </ul>
            </PageSection>
          )}
        </div>
      </div>
    </PageShell>
  );
}
