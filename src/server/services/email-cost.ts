/**
 * Writes + updates for EmailSendLog. Best-effort — cost logging must
 * never break the actual email send.
 */

import type { PrismaClient } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { logger } from "@/lib/logger";

export type EmailLogContext = {
  purpose?: string;
  customerId?: string;
  bookingId?: string;
};

export async function recordEmailSend(args: {
  provider: "resend" | "smtp" | "console";
  providerMessageId?: string | null;
  toEmail: string;
  fromEmail: string;
  subject: string;
  status: "queued" | "sent" | "failed";
  errorMessage?: string | null;
  ctx: EmailLogContext;
}): Promise<void> {
  try {
    await prisma.emailSendLog.create({
      data: {
        provider: args.provider,
        toEmail: args.toEmail,
        fromEmail: args.fromEmail,
        subject: args.subject,
        status: args.status,
        ...(args.providerMessageId ? { providerMessageId: args.providerMessageId } : {}),
        ...(args.errorMessage ? { errorMessage: args.errorMessage } : {}),
        ...(args.ctx.purpose ? { purpose: args.ctx.purpose } : {}),
        ...(args.ctx.customerId ? { customerId: args.ctx.customerId } : {}),
        ...(args.ctx.bookingId ? { bookingId: args.ctx.bookingId } : {}),
      },
    });
  } catch (e) {
    logger.warn({ err: e }, "recordEmailSend: write failed");
  }
}

export async function updateEmailStatus(
  db: PrismaClient,
  providerMessageId: string,
  patch: {
    status?: string;
    deliveredAt?: Date | null;
    bouncedAt?: Date | null;
    openedAt?: Date | null;
    errorMessage?: string | null;
  },
): Promise<void> {
  try {
    await db.emailSendLog.updateMany({
      where: { providerMessageId },
      data: {
        ...(patch.status ? { status: patch.status } : {}),
        ...(patch.deliveredAt ? { deliveredAt: patch.deliveredAt } : {}),
        ...(patch.bouncedAt ? { bouncedAt: patch.bouncedAt } : {}),
        ...(patch.openedAt ? { openedAt: patch.openedAt } : {}),
        ...(patch.errorMessage ? { errorMessage: patch.errorMessage } : {}),
      },
    });
  } catch (e) {
    logger.warn({ err: e, providerMessageId }, "updateEmailStatus: write failed");
  }
}
