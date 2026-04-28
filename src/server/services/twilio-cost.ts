/**
 * Recording + updating TwilioMessageLog rows. Writes are best-effort —
 * cost logging must never break the actual SMS send.
 */

import type { PrismaClient } from "@prisma/client";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { logger } from "@/lib/logger";
import { USD_AUD_RATE } from "@/lib/constants";

export type TwilioLogContext = {
  purpose?: string;
  customerId?: string;
  bookingId?: string;
};

export async function recordTwilioSend(
  sid: string,
  to: string,
  body: string,
  ctx: TwilioLogContext,
  initial?: { numSegments?: number | null; priceUsd?: string | null; status?: string | null },
): Promise<void> {
  try {
    const priceUsd =
      initial?.priceUsd && Number(initial.priceUsd) < 0
        ? Math.abs(Number(initial.priceUsd))
        : initial?.priceUsd
          ? Number(initial.priceUsd)
          : null;
    const priceAud = priceUsd !== null ? new Prisma.Decimal(priceUsd * USD_AUD_RATE) : null;

    await prisma.twilioMessageLog.create({
      data: {
        sid,
        to,
        body,
        status: initial?.status ?? "queued",
        ...(ctx.purpose ? { purpose: ctx.purpose } : {}),
        ...(ctx.customerId ? { customerId: ctx.customerId } : {}),
        ...(ctx.bookingId ? { bookingId: ctx.bookingId } : {}),
        ...(initial?.numSegments != null ? { numSegments: initial.numSegments } : {}),
        ...(priceAud ? { priceAud, priceCurrency: "USD_CONVERTED" } : {}),
      },
    });
  } catch (e) {
    logger.warn({ err: e, sid }, "recordTwilioSend: write failed");
  }
}

export async function updateTwilioStatus(
  db: PrismaClient,
  sid: string,
  patch: {
    status: string;
    numSegments?: number | null;
    priceUsd?: string | null;
    errorCode?: string | null;
    errorMessage?: string | null;
    deliveredAt?: Date | null;
  },
): Promise<void> {
  try {
    const priceUsd =
      patch.priceUsd && Number(patch.priceUsd) < 0
        ? Math.abs(Number(patch.priceUsd))
        : patch.priceUsd
          ? Number(patch.priceUsd)
          : null;
    const priceAud = priceUsd !== null ? new Prisma.Decimal(priceUsd * USD_AUD_RATE) : null;

    await db.twilioMessageLog.updateMany({
      where: { sid },
      data: {
        status: patch.status,
        ...(patch.numSegments != null ? { numSegments: patch.numSegments } : {}),
        ...(priceAud ? { priceAud, priceCurrency: "USD_CONVERTED" } : {}),
        ...(patch.errorCode ? { errorCode: patch.errorCode } : {}),
        ...(patch.errorMessage ? { errorMessage: patch.errorMessage } : {}),
        ...(patch.deliveredAt ? { deliveredAt: patch.deliveredAt } : {}),
      },
    });
  } catch (e) {
    logger.warn({ err: e, sid }, "updateTwilioStatus: write failed");
  }
}
