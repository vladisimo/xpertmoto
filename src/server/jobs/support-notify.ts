/**
 * Support ticket notification fan-out.
 *
 * Consumes "support-notify" queue jobs carrying a ticketId + event kind
 * and expands them into email / SMS / in-app deliveries per the channel
 * matrix. Every send writes a CommunicationLog row for audit.
 *
 * Urgency-path fallback: if Redis is unavailable the tRPC router calls
 * `dispatchSupportNotification` synchronously — same code path, just
 * inline.
 */

import type { Prisma, PrismaClient, NotificationChannel, SupportTicketStatus } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { sendEmail } from "@/lib/email";
import { sendSms } from "@/lib/sms";
import { logger } from "@/lib/logger";
import { getBranding } from "@/lib/branding";
import { evaluateNotificationGate } from "../services/notification-gate";
import { getQueue, registerWorker } from "./queue";
import { createElement } from "react";
import SupportTicketAssignedEmail from "../../../emails/support-ticket-assigned";
import SupportTicketUrgentEmail from "../../../emails/support-ticket-urgent";
import SupportTicketCustomerReplyEmail from "../../../emails/support-ticket-customer-reply";
import SupportTicketResolvedEmail from "../../../emails/support-ticket-resolved";

const QUEUE = "support-notify" as const;

export type SupportNotifyEvent =
  | "ticket_created"
  | "ticket_assigned"
  | "ticket_customer_reply"
  | "ticket_resolved";

export type SupportNotifyJob = {
  ticketId: string;
  event: SupportNotifyEvent;
};

type TicketContext = Prisma.SupportTicketGetPayload<{
  include: {
    conversation: {
      include: { customer: true; booking: true };
    };
    depot: true;
    assignee: true;
    linkedBooking: true;
  };
}>;

async function loadTicket(p: PrismaClient, ticketId: string): Promise<TicketContext | null> {
  return p.supportTicket.findUnique({
    where: { id: ticketId },
    include: {
      conversation: {
        include: { customer: true, booking: true },
      },
      depot: true,
      assignee: true,
      linkedBooking: true,
    },
  });
}

function ticketPortalUrl(ticketId: string): string {
  const base = process.env.AUTH_URL ?? "http://localhost:3000";
  return `${base}/staff/support/${ticketId}`;
}

function customerDashboardUrl(ticketId: string): string {
  const base = process.env.AUTH_URL ?? "http://localhost:3000";
  return `${base}/dashboard/support/${ticketId}`;
}

async function notifyUser(
  p: PrismaClient,
  userId: string,
  channels: NotificationChannel[],
  payload: {
    type:
      | "SUPPORT_TICKET_ASSIGNED"
      | "SUPPORT_TICKET_URGENT"
      | "SUPPORT_TICKET_CUSTOMER_REPLY"
      | "SUPPORT_TICKET_RESOLVED";
    title: string;
    body: string;
    emailSubject: string;
    emailReact: React.ReactElement;
    smsBody: string;
    data: Record<string, unknown>;
    templateKey: string;
  },
): Promise<void> {
  const user = await p.user.findUnique({ where: { id: userId } });
  if (!user) return;

  for (const channel of channels) {
    const gateDecision = await evaluateNotificationGate(channel);
    if (!gateDecision.send) {
      logger.info(
        { userId, type: payload.type, channel, reason: gateDecision.reason },
        "support notify: suppressed by admin gate",
      );
      await p.notification
        .create({
          data: {
            userId,
            type: payload.type,
            channel,
            title: payload.title,
            body: payload.body,
            data: {
              ...(payload.data as Record<string, unknown>),
              suppressedReason: gateDecision.reason,
            } as Prisma.JsonObject,
            status: "SUPPRESSED",
          },
        })
        .catch((err) => {
          logger.warn({ err: (err as Error)?.message }, "suppressed support notification insert failed");
        });
      continue;
    }
    if (channel === "IN_APP") {
      await p.notification.create({
        data: {
          userId,
          type: payload.type,
          channel,
          title: payload.title,
          body: payload.body,
          data: payload.data as Prisma.JsonObject,
          status: "SENT",
          sentAt: new Date(),
        },
      });
    } else if (channel === "EMAIL") {
      try {
        await sendEmail({
          to: user.email,
          subject: payload.emailSubject,
          react: payload.emailReact,
        });
        await p.communicationLog.create({
          data: {
            customerId: user.id,
            channel,
            direction: "OUTBOUND",
            type: payload.type,
            subject: payload.emailSubject,
            body: payload.body,
            templateUsed: payload.templateKey,
          },
        });
      } catch (err) {
        logger.error({ err, userId, type: payload.type }, "support notify email failed");
      }
    } else if (channel === "SMS") {
      if (!user.phone) continue;
      try {
        await sendSms({ to: user.phone, body: payload.smsBody });
        await p.communicationLog.create({
          data: {
            customerId: user.id,
            channel,
            direction: "OUTBOUND",
            type: payload.type,
            body: payload.smsBody,
            templateUsed: payload.templateKey,
          },
        });
      } catch (err) {
        logger.error({ err, userId, type: payload.type }, "support notify sms failed");
      }
    }
  }
}

export async function dispatchSupportNotification(
  job: SupportNotifyJob,
): Promise<void> {
  const t = await loadTicket(prisma, job.ticketId);
  if (!t) {
    logger.warn({ ticketId: job.ticketId }, "support notify: ticket missing");
    return;
  }

  if (job.event === "ticket_created" || job.event === "ticket_assigned") {
    await notifyOnTicketCreated(t);
  } else if (job.event === "ticket_customer_reply") {
    await notifyOnCustomerReply(t);
  } else if (job.event === "ticket_resolved") {
    await notifyOnResolved(t);
  }
}

async function notifyOnTicketCreated(t: TicketContext): Promise<void> {
  const customerName =
    t.conversation.customer?.firstName ?? t.conversation.guestName ?? "a customer";
  const ticketUrl = ticketPortalUrl(t.id);
  const { siteName } = await getBranding();

  // Assignee or fallback to any depot STAFF
  if (t.assigneeId) {
    const urgent = t.priority === "URGENT";
    await notifyUser(
      prisma,
      t.assigneeId,
      urgent ? ["SMS", "EMAIL", "IN_APP"] : ["EMAIL", "IN_APP"],
      {
        type: urgent ? "SUPPORT_TICKET_URGENT" : "SUPPORT_TICKET_ASSIGNED",
        title: urgent
          ? `URGENT: ${t.category} — ${t.ticketNumber}`
          : `Support ticket ${t.ticketNumber}`,
        body: `${customerName}: ${t.summary}`,
        emailSubject: urgent
          ? `URGENT — ${t.category} ${t.ticketNumber}`
          : `Support ticket assigned — ${t.ticketNumber}`,
        emailReact: createElement(
          urgent ? SupportTicketUrgentEmail : SupportTicketAssignedEmail,
          {
            ticketNumber: t.ticketNumber,
            category: t.category,
            priority: t.priority,
            customerName,
            summary: t.summary,
            description: t.description,
            depotName: t.depot?.name ?? "Unassigned",
            portalUrl: ticketUrl,
          },
        ),
        smsBody: urgent
          ? `URGENT ${siteName} ${t.category}: ${customerName} — ${t.summary}. Open ${ticketUrl}`
          : `${siteName} ${t.ticketNumber}: ${t.summary}. ${ticketUrl}`,
        data: { ticketId: t.id, ticketNumber: t.ticketNumber, category: t.category },
        templateKey: urgent ? "support_ticket_urgent_paging" : "support_ticket_assigned",
      },
    );
  }

  // On-call SMS page for URGENT
  if (t.priority === "URGENT") {
    const onCallUserId = t.depot?.onCallUserId ?? null;
    if (onCallUserId && onCallUserId !== t.assigneeId) {
      await notifyUser(prisma, onCallUserId, ["SMS", "EMAIL"], {
        type: "SUPPORT_TICKET_URGENT",
        title: `URGENT: ${t.category} — ${t.ticketNumber}`,
        body: `On-call page: ${customerName} — ${t.summary}`,
        emailSubject: `URGENT — on-call page ${t.ticketNumber}`,
        emailReact: createElement(SupportTicketUrgentEmail, {
          ticketNumber: t.ticketNumber,
          category: t.category,
          priority: t.priority,
          customerName,
          summary: t.summary,
          description: t.description,
          depotName: t.depot?.name ?? "Unassigned",
          portalUrl: ticketUrl,
        }),
        smsBody: `URGENT on-call: ${t.category} ${customerName}. ${t.summary}. ${ticketUrl}`,
        data: {
          ticketId: t.id,
          ticketNumber: t.ticketNumber,
          category: t.category,
          role: "onCall",
        },
        templateKey: "support_ticket_urgent_paging",
      });
    }
  }

  // PAYMENT fan-out to admin pool
  if (t.category === "PAYMENT") {
    const admins = await prisma.user.findMany({
      where: { role: { in: ["ADMIN", "SUPER_ADMIN"] }, status: "ACTIVE" },
      select: { id: true },
    });
    for (const a of admins) {
      await notifyUser(prisma, a.id, ["EMAIL", "IN_APP"], {
        type: "SUPPORT_TICKET_ASSIGNED",
        title: `Payment query — ${t.ticketNumber}`,
        body: `${customerName}: ${t.summary}`,
        emailSubject: `Payment support — ${t.ticketNumber}`,
        emailReact: createElement(SupportTicketAssignedEmail, {
          ticketNumber: t.ticketNumber,
          category: t.category,
          priority: t.priority,
          customerName,
          summary: t.summary,
          description: t.description,
          depotName: t.depot?.name ?? "Finance",
          portalUrl: `${process.env.AUTH_URL ?? "http://localhost:3000"}/staff/support/${t.id}`,
        }),
        smsBody: "",
        data: { ticketId: t.id, ticketNumber: t.ticketNumber, role: "adminPool" },
        templateKey: "support_ticket_assigned",
      });
    }
  }
}

async function notifyOnCustomerReply(t: TicketContext): Promise<void> {
  // The newer sender flipped to STAFF → customer notification.
  const last = await prisma.supportMessage.findFirst({
    where: { conversationId: t.conversationId },
    orderBy: { createdAt: "desc" },
  });
  if (!last || last.senderRole !== "STAFF") return;
  const customer = t.conversation.customer;
  if (!customer) return;
  const { siteName } = await getBranding();
  await notifyUser(prisma, customer.id, ["EMAIL", "IN_APP"], {
    type: "SUPPORT_TICKET_CUSTOMER_REPLY",
    title: `Reply on ticket ${t.ticketNumber}`,
    body: last.body.slice(0, 280),
    emailSubject: `${siteName} support — reply on ${t.ticketNumber}`,
    emailReact: createElement(SupportTicketCustomerReplyEmail, {
      ticketNumber: t.ticketNumber,
      customerName: customer.firstName,
      replyBody: last.body,
      portalUrl: customerDashboardUrl(t.id),
    }),
    smsBody: `${siteName} support replied on ${t.ticketNumber}. View: ${customerDashboardUrl(t.id)}`,
    data: { ticketId: t.id },
    templateKey: "support_ticket_customer_reply",
  });
}

async function notifyOnResolved(t: TicketContext): Promise<void> {
  const customer = t.conversation.customer;
  if (!customer) return;
  const { siteName } = await getBranding();
  await notifyUser(prisma, customer.id, ["EMAIL", "IN_APP"], {
    type: "SUPPORT_TICKET_RESOLVED",
    title: `Ticket ${t.ticketNumber} resolved`,
    body: `We've closed out your ${t.category} ticket.`,
    emailSubject: `Your ${siteName} support ticket is resolved (${t.ticketNumber})`,
    emailReact: createElement(SupportTicketResolvedEmail, {
      ticketNumber: t.ticketNumber,
      customerName: customer.firstName,
      summary: t.summary,
      feedbackUrl: `${customerDashboardUrl(t.id)}?feedback=1`,
      siteName,
    }),
    smsBody: "",
    data: { ticketId: t.id },
    templateKey: "support_ticket_resolved",
  });
}

/**
 * Enqueue a ticket notification — no-ops gracefully if Redis isn't
 * configured, in which case the caller falls back to a synchronous
 * `dispatchSupportNotification` for URGENT items.
 */
export async function enqueueSupportNotify(
  job: SupportNotifyJob,
  opts: { priorityJob?: boolean } = {},
): Promise<"queued" | "synced" | "skipped"> {
  const q = getQueue(QUEUE);
  if (q) {
    await q.add(job.event, job, { priority: opts.priorityJob ? 1 : undefined });
    return "queued";
  }
  try {
    await dispatchSupportNotification(job);
    return "synced";
  } catch (err) {
    logger.error({ err, job }, "inline support dispatch failed");
    return "skipped";
  }
}

export function startSupportNotifyWorker(): void {
  registerWorker<SupportNotifyJob>(QUEUE, async (job) => {
    await dispatchSupportNotification(job.data);
  });
}

/** Exported for use in tickets.resolveTicket / ticket status enum filters. */
export const PENDING_STATUSES: SupportTicketStatus[] = [
  "OPEN",
  "ASSIGNED",
  "PENDING_CUSTOMER",
];
