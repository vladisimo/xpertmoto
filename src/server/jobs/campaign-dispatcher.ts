import { htmlToText } from "@/lib/email";
import { logger } from "@/lib/logger";
import { prisma } from "@/lib/prisma";
import { categoryForType } from "@/server/services/consent";
import { sendNotification } from "@/server/services/notification-sender";
import {
  buildSegmentWhere,
} from "@/server/services/segment-evaluator";
import { segmentFiltersSchema } from "@/lib/validators/segment";

import { getQueue, registerWorker } from "./queue";

const QUEUE = "campaign-dispatcher" as const;

/**
 * Every 5 minutes. Picks up SCHEDULED campaigns whose scheduledFor has
 * passed, resolves their audience, sends one notification per recipient
 * per channel, and writes per-recipient CampaignRecipient rows linking to
 * the CommunicationLog that sendNotification produces.
 */
export async function runCampaignDispatcher(): Promise<number> {
  const now = new Date();
  const due = await prisma.campaign.findMany({
    where: {
      status: "SCHEDULED",
      scheduledFor: { lte: now },
    },
    include: {
      template: true,
      segment: true,
    },
    take: 10,
  });

  let totalDispatched = 0;

  for (const campaign of due) {
    try {
      await prisma.campaign.update({
        where: { id: campaign.id },
        data: { status: "SENDING" },
      });

      const recipientIds = await resolveRecipients(campaign);

      let sentCount = 0;
      let failedCount = 0;
      const channels = campaign.channels.length > 0
        ? campaign.channels
        : campaign.template?.channels ?? ["EMAIL"];
      const subject = campaign.subject ?? campaign.template?.subject ?? "";
      const plainBody = campaign.bodyOverride ?? campaign.template?.bodyTemplate ?? "";
      const format = campaign.template?.format ?? "PLAIN_TEXT";
      // Prefer the dedicated HTML email body when the template provides
      // one (covers multi-channel templates with both an HTML email
      // design AND a short SMS body). Fall back to the single-body case
      // when `format === HTML`. Non-email channels always use the plain
      // body.
      const emailHtml =
        campaign.template?.emailBodyHtml ??
        (format === "HTML" ? plainBody : undefined);
      const emailText = emailHtml ? htmlToText(emailHtml) : plainBody;
      const type = campaign.template?.type ?? "CUSTOM";
      const category = campaign.template?.category ?? categoryForType(type);

      for (const customerId of recipientIds) {
        try {
          const res = await sendNotification({
            userId: customerId,
            type,
            category,
            channels,
            subject,
            title: subject,
            body: channels.includes("EMAIL") && emailHtml ? emailText : plainBody,
            html: emailHtml,
            templateKey: campaign.template?.key,
            campaignId: campaign.id,
            sentById: campaign.createdById ?? undefined,
          });
          const ok = res.results.some((r) => r.status === "SENT");
          const primaryChannel = channels[0] ?? "EMAIL";
          await prisma.campaignRecipient.upsert({
            where: {
              campaignId_customerId_channel: {
                campaignId: campaign.id,
                customerId,
                channel: primaryChannel,
              },
            },
            create: {
              campaignId: campaign.id,
              customerId,
              channel: primaryChannel,
              status: ok ? "SENT" : "FAILED",
              communicationLogId: res.logIds[0] ?? null,
              errorMessage: ok
                ? null
                : res.results.map((r) => r.reason).filter(Boolean).join(", "),
            },
            update: {
              status: ok ? "SENT" : "FAILED",
              communicationLogId: res.logIds[0] ?? null,
              errorMessage: ok
                ? null
                : res.results.map((r) => r.reason).filter(Boolean).join(", "),
            },
          });
          if (ok) sentCount++;
          else failedCount++;
        } catch (err) {
          failedCount++;
          logger.warn(
            { err: err instanceof Error ? err.message : String(err), campaignId: campaign.id, customerId },
            "campaign recipient send failed",
          );
        }
      }

      await prisma.campaign.update({
        where: { id: campaign.id },
        data: {
          status: failedCount === recipientIds.length && recipientIds.length > 0 ? "FAILED" : "SENT",
          sentAt: new Date(),
          stats: {
            attempted: recipientIds.length,
            sent: sentCount,
            failed: failedCount,
          },
        },
      });

      totalDispatched += sentCount;
    } catch (err) {
      logger.error(
        { err: err instanceof Error ? err.message : String(err), campaignId: campaign.id },
        "campaign dispatch failed",
      );
      await prisma.campaign.update({
        where: { id: campaign.id },
        data: { status: "FAILED" },
      });
    }
  }

  return totalDispatched;
}

type CampaignWithRefs = Awaited<ReturnType<typeof prisma.campaign.findMany>>[number];

async function resolveRecipients(campaign: CampaignWithRefs): Promise<string[]> {
  const ids = new Set<string>();
  for (const id of campaign.manualRecipientIds) ids.add(id);

  if (campaign.segmentId) {
    const segment = await prisma.segment.findUnique({ where: { id: campaign.segmentId } });
    if (segment) {
      const parsed = segmentFiltersSchema.safeParse(segment.filters);
      if (parsed.success) {
        const users = await prisma.user.findMany({
          where: buildSegmentWhere(parsed.data),
          select: { id: true },
          take: 5000,
        });
        for (const u of users) ids.add(u.id);
      }
    }
  }

  return [...ids];
}

export function startCampaignDispatcherScheduler() {
  registerWorker(QUEUE, async () => runCampaignDispatcher());
  const q = getQueue(QUEUE);
  if (!q) return;
  q.add(
    "poll",
    {},
    { repeat: { every: 5 * 60 * 1000 }, jobId: "repeat-every-5min" },
  );
}
