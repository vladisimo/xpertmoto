import { render } from "@react-email/render";
import { createElement } from "react";

import { prisma } from "@/lib/prisma";
import { logger } from "@/lib/logger";
import { sendNotification } from "@/server/services/notification-sender";
import { getBranding } from "@/lib/branding";
import CartRecoveryEmail, {
  type CartRecoveryStage,
} from "../../../emails/cart-recovery";
import { getQueue, registerWorker } from "./queue";

const QUEUE = "cart-recovery" as const;

/**
 * Lever 6: abandoned-cart recovery with time-decay discount.
 *
 * Scans PENDING_PAYMENT / QUOTE bookings and emits one of three
 * recovery notifications before the pending-payment-ttl job eventually
 * cancels them at 24h. `recoveryStage` on Booking is monotonically
 * advanced so a given booking only receives each stage once.
 *
 * Stages:
 *   1. HOLD           — at +30m: "your scooter is still held, finish up"
 *   2. DISCOUNT       — at +2h:  10% off code valid for 1 hour
 *   3. LAST_CHANCE    — at +12h: release-soon nudge
 *
 * Scheduler runs every 15 minutes; a booking can only advance one
 * stage per run so stages are naturally spaced.
 */

export const CART_RECOVERY_STAGE_MINUTES: Record<number, number> = {
  1: 30,
  2: 120,
  3: 720,
};

export const CART_RECOVERY_DISCOUNT_PCT = 10;
export const CART_RECOVERY_DISCOUNT_WINDOW_MINUTES = 60;

export type CartRecoveryResult = {
  scanned: number;
  stage1: number;
  stage2: number;
  stage3: number;
  failed: number;
};

const STAGE_TYPE_MAP: Record<
  number,
  { type: Parameters<typeof sendNotification>[0]["type"]; stage: CartRecoveryStage }
> = {
  1: { type: "CART_RECOVERY_HOLD", stage: "HOLD" },
  2: { type: "CART_RECOVERY_DISCOUNT", stage: "DISCOUNT" },
  3: { type: "CART_RECOVERY_LAST_CHANCE", stage: "LAST_CHANCE" },
};

export async function runCartRecovery(
  now: Date = new Date(),
): Promise<CartRecoveryResult> {
  const counters: CartRecoveryResult = { scanned: 0, stage1: 0, stage2: 0, stage3: 0, failed: 0 };

  // Oldest eligible bookings first — any single run advances at most one
  // stage per booking. Find bookings whose recoveryStage < 3 and whose
  // createdAt is older than the next stage's threshold.
  const cutoffStage1 = new Date(now.getTime() - CART_RECOVERY_STAGE_MINUTES[1]! * 60 * 1000);

  const candidates = await prisma.booking.findMany({
    where: {
      status: { in: ["PENDING_PAYMENT", "QUOTE"] },
      createdAt: { lt: cutoffStage1 },
      recoveryStage: { lt: 3 },
    },
    include: {
      customer: true,
      category: true,
      pickupDepot: true,
    },
    orderBy: { createdAt: "asc" },
    take: 200,
  });

  counters.scanned = candidates.length;

  for (const booking of candidates) {
    const ageMin = (now.getTime() - booking.createdAt.getTime()) / (60 * 1000);
    const currentStage = booking.recoveryStage;
    const nextStage = currentStage + 1;
    if (nextStage > 3) continue;
    const threshold = CART_RECOVERY_STAGE_MINUTES[nextStage];
    if (!threshold || ageMin < threshold) continue;

    try {
      let discountCode: string | undefined;
      if (nextStage === 2) {
        discountCode = `COMEBACK-${booking.bookingReference.slice(-6).toUpperCase()}`;
        await prisma.discount.upsert({
          where: { code: discountCode },
          update: {},
          create: {
            code: discountCode,
            description: `Cart-recovery offer for booking ${booking.bookingReference}`,
            type: "PERCENTAGE",
            value: CART_RECOVERY_DISCOUNT_PCT,
            maxUses: 1,
            validFrom: now,
            validTo: new Date(
              now.getTime() + CART_RECOVERY_DISCOUNT_WINDOW_MINUTES * 60 * 1000,
            ),
            isActive: true,
            isAutoApply: false,
          },
        });
      }

      const { type, stage } = STAGE_TYPE_MAP[nextStage]!;
      const checkoutUrl =
        (process.env.APP_URL ?? "https://xpertmoto.com.au") +
        `/booking/resume/${booking.bookingReference}`;

      const html = await render(
        createElement(CartRecoveryEmail, {
          stage,
          customerName: booking.customer.firstName,
          bookingReference: booking.bookingReference,
          categoryName: booking.category.name,
          pickupDepotName: booking.pickupDepot.name,
          pickupDateTime: booking.pickupDateTime.toLocaleString("en-AU", {
            dateStyle: "medium",
            timeStyle: "short",
            timeZone: "Australia/Brisbane",
          }),
          totalAmount: `A$${Number(booking.totalAmount).toFixed(2)}`,
          checkoutUrl,
          discountCode,
          discountPercent: discountCode ? CART_RECOVERY_DISCOUNT_PCT : undefined,
        }),
      );

      const { siteName } = await getBranding();
      await sendNotification({
        userId: booking.customerId,
        type,
        channels: ["EMAIL"],
        subject: `${siteName} · ${stage === "LAST_CHANCE" ? "last chance — " : ""}finish your booking ${booking.bookingReference}`,
        title: `Finish booking ${booking.bookingReference}`,
        html,
        body: `Your ${siteName} booking ${booking.bookingReference} is waiting. Finish here: ${checkoutUrl}${discountCode ? ` — code ${discountCode} for ${CART_RECOVERY_DISCOUNT_PCT}% off.` : ""}`,
        bookingId: booking.id,
        data: {
          bookingReference: booking.bookingReference,
          stage,
          discountCode: discountCode ?? null,
        },
      });

      await prisma.booking.update({
        where: { id: booking.id },
        data: { recoveryStage: nextStage },
      });

      if (nextStage === 1) counters.stage1 += 1;
      else if (nextStage === 2) counters.stage2 += 1;
      else if (nextStage === 3) counters.stage3 += 1;
    } catch (err) {
      counters.failed += 1;
      logger.warn(
        {
          err: err instanceof Error ? err.message : String(err),
          bookingId: booking.id,
          ref: booking.bookingReference,
          stage: nextStage,
        },
        "cart-recovery: stage send failed",
      );
    }
  }

  logger.info(counters, "cart-recovery finished");
  return counters;
}

export function startCartRecoveryScheduler() {
  registerWorker(QUEUE, async () => runCartRecovery());
  const q = getQueue(QUEUE);
  if (!q) return;
  // Every 15 minutes. Only emits at most one stage per run per booking.
  q.add("every-15-min", {}, { repeat: { pattern: "*/15 * * * *" }, jobId: "repeat-15m" });
}
