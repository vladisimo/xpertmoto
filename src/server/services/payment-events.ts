import type { Prisma, PaymentStatus, PaymentEventType } from "@prisma/client";
import * as Sentry from "@sentry/nextjs";

import { logger } from "@/lib/logger";

/**
 * G9 — PaymentEvent append-only writer.
 *
 * Every code path that creates or mutates a Payment row must call this so
 * the event log stays complete. Tolerates being called with either the
 * top-level prisma client or a `tx` from `$transaction`; in both cases the
 * write lands in the same transactional scope as the surrounding work.
 *
 * Failure to write a PaymentEvent row should NOT abort the business
 * operation — the function throws only on unrecoverable errors and
 * callers can pass `swallow: true` to explicitly opt out of rethrow.
 * Swallowed failures still log + reach Sentry: a silent PaymentEvent gap
 * breaks reconciliation with no operator signal.
 */

type PrismaLike = {
  paymentEvent: {
    create: (args: {
      data: Prisma.PaymentEventUncheckedCreateInput;
    }) => Promise<unknown>;
  };
};

export type PaymentEventInput = {
  paymentId: string;
  eventType: PaymentEventType;
  previousStatus?: PaymentStatus | null;
  newStatus?: PaymentStatus | null;
  amountDelta?: number | null;
  source: string;
  stripeEventId?: string | null;
  actorUserId?: string | null;
  data?: Record<string, unknown>;
};

export async function writePaymentEvent(
  client: PrismaLike,
  input: PaymentEventInput,
  options: { swallow?: boolean } = {},
): Promise<void> {
  try {
    await client.paymentEvent.create({
      data: {
        paymentId: input.paymentId,
        eventType: input.eventType,
        previousStatus: input.previousStatus ?? null,
        newStatus: input.newStatus ?? null,
        amountDelta: input.amountDelta ?? null,
        source: input.source,
        stripeEventId: input.stripeEventId ?? null,
        actorUserId: input.actorUserId ?? null,
        data: (input.data ?? {}) as Prisma.InputJsonValue,
      },
    });
  } catch (err) {
    if (options.swallow) {
      logger.error(
        {
          err: err instanceof Error ? err.message : String(err),
          paymentId: input.paymentId,
          eventType: input.eventType,
          source: input.source,
        },
        "paymentEvent write failed (swallowed)",
      );
      Sentry.captureException(err, {
        tags: { service: "payment-events", eventType: input.eventType },
        extra: { paymentId: input.paymentId, source: input.source },
      });
      return;
    }
    throw err;
  }
}
