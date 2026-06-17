import type { Prisma, PrismaClient } from "@prisma/client";

type PrismaLike = Pick<PrismaClient, "booking"> | Prisma.TransactionClient;

/**
 * H-4: supersede a customer's prior in-progress `PENDING_PAYMENT` draft when
 * they (re)create a booking from the wizard. Each step-6 mount used to fire
 * `booking.create`, so a refresh / back-forward / cart change left a fresh
 * orphaned "Pending payment" row behind every time. The client now reuses a
 * persisted draft for an unchanged cart; this is the server-side backstop for
 * the cases where it can't (cart changed, two tabs, storage cleared) — it
 * cancels the previous draft so at most one lives per checkout.
 *
 * Mirrors the nightly `pending-payment-ttl` sweep's cancel exactly, INCLUDING
 * its critical guard: a draft carrying a SUCCEEDED `BOOKING_PAYMENT` was in
 * fact paid (the confirm step just never ran), and cancelling it would take
 * the customer's money and kill their booking. Those rows are left untouched
 * for `confirmBookingPayment` to recover.
 *
 * Best-effort + idempotent: a draft that doesn't exist, isn't owned by the
 * caller, isn't `PENDING_PAYMENT`, or was already paid is left untouched and
 * the function simply returns `false`. Stripe PaymentIntents are not cancelled
 * here — they auto-expire after 24h if never confirmed, matching the wizard's
 * existing abandon behaviour and the nightly sweep.
 *
 * @returns `true` when a draft was cancelled, `false` otherwise.
 */
export async function supersedePriorDraft(
  prisma: PrismaLike,
  args: { draftBookingId: string; customerId: string },
): Promise<boolean> {
  const draft = await prisma.booking.findUnique({
    where: { id: args.draftBookingId },
    select: {
      id: true,
      status: true,
      customerId: true,
      payments: {
        where: { type: "BOOKING_PAYMENT", status: "SUCCEEDED" },
        select: { id: true },
        take: 1,
      },
    },
  });

  if (!draft) return false;
  if (draft.customerId !== args.customerId) return false;
  if (draft.status !== "PENDING_PAYMENT") return false;
  // C1 guard (shared with pending-payment-ttl): never cancel a paid draft.
  if (draft.payments.length > 0) return false;

  await prisma.booking.update({
    where: { id: draft.id },
    data: {
      status: "CANCELLED",
      cancellationReason: "Auto-cancelled: replaced by an updated payment draft",
      statusLog: {
        create: {
          previousStatus: "PENDING_PAYMENT",
          newStatus: "CANCELLED",
          reason: "Superseded by a newer payment draft",
        },
      },
    },
  });
  return true;
}
