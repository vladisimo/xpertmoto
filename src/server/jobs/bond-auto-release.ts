import { render } from "@react-email/render";
import { createElement } from "react";

import { prisma } from "@/lib/prisma";
import { formatCurrency } from "@/lib/utils";
import { getSetting, SETTING_DEFAULTS } from "@/lib/settings";
import { sendNotification } from "@/server/services/notification-sender";
import { trackServer } from "@/lib/analytics";
import { SERVER_EVENTS } from "@/lib/analytics/server-event-names";
import BondReleased from "../../../emails/bond-released";
import { getQueue, monitorCron, registerWorker } from "./queue";

const QUEUE = "bond-auto-release" as const;

/**
 * Daily at 02:00. Release bond holds that are older than 14 days and
 * haven't been captured — business rule 3 from CLAUDE.md.
 *
 * Guards (a bond that should be captured must never be written off):
 *   - `balanceDue > 0` or an un-captured CONFIRMED / QUOTE_PENDING damage
 *     charge → SKIP and alert a manager once per bond per day. Capture is a
 *     human decision (auto-capturing a possibly-disputed balance invites
 *     chargebacks); the moment the balance clears, the next nightly run
 *     releases as normal.
 *   - The Stripe PI is actually cancelled BEFORE the ledger flips RELEASED —
 *     with the rolling re-hold job keeping auths alive, "it expired on its
 *     own" no longer holds.
 */
export async function runBondAutoRelease(): Promise<number> {
  const autoReleaseDays = await getSetting(
    "payment.bondReleaseDays",
    SETTING_DEFAULTS["payment.bondReleaseDays"],
  );
  const cutoff = new Date(Date.now() - autoReleaseDays * 24 * 60 * 60 * 1000);

  const candidates = await prisma.bondLedger.findMany({
    where: {
      status: "HELD",
      updatedAt: { lt: cutoff },
      booking: { status: { in: ["COMPLETED", "RETURNED"] } },
    },
    include: {
      booking: {
        include: { customer: true, pickupDepot: { select: { slug: true } } },
      },
    },
  });

  let released = 0;
  for (const bond of candidates) {
    // Release gate: unpaid balance or an unresolved damage charge means the
    // bond may still need capturing — a human call, not a nightly write-off.
    const openDamage = await prisma.damageCharge.count({
      where: {
        returnAssessment: { bookingId: bond.bookingId },
        OR: [
          { resolution: "QUOTE_PENDING", status: { in: ["PROVISIONAL", "CONFIRMED"] } },
          { status: "CONFIRMED", capturedPaymentId: null },
        ],
      },
    });
    // Area 3 guard: an OPEN customer-liable incident (theft, damage claim)
    // is a live claim on the bond — never release under it. RESOLVED/CLOSED
    // incidents have finished their money story (the charge path captures
    // and terminalises the ledger itself).
    const openIncidents = await prisma.incident.count({
      where: {
        bookingId: bond.bookingId,
        customerLiable: true,
        deletedAt: null,
        status: { notIn: ["RESOLVED", "CLOSED"] },
      },
    });
    const balanceDue = Number(bond.booking.balanceDue);
    if (balanceDue > 0.009 || openDamage > 0 || openIncidents > 0) {
      if (openIncidents > 0) {
        const { logger } = await import("@/lib/logger");
        logger.info(
          {
            bondLedgerId: bond.id,
            bookingId: bond.bookingId,
            openIncidents,
          },
          "bond-auto-release: release blocked — open customer-liable incident(s) on the booking",
        );
      }
      await alertReleaseBlockedOnce(bond.id, {
        bookingId: bond.bookingId,
        bookingReference: bond.booking.bookingReference,
        balanceDue,
        openDamage,
        openIncidents,
        heldAud: Number(bond.heldAmount),
      });
      continue;
    }

    // Retire the hold at Stripe first. A cancel failure on a genuinely
    // expired auth is fine (the money is already back on the card); a
    // transport error skips the bond so the next run retries.
    try {
      const { cancelPaymentIntent } = await import("@/lib/stripe");
      await cancelPaymentIntent(bond.stripePaymentIntentId);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      if (!/payment_intent_unexpected_state|already been canceled|canceled/i.test(message)) {
        const { logger } = await import("@/lib/logger");
        logger.warn(
          { err: message, bondLedgerId: bond.id },
          "bond-auto-release: Stripe cancel failed; will retry next run",
        );
        continue;
      }
    }

    await prisma.$transaction(async (tx) => {
      await tx.bondLedger.update({
        where: { id: bond.id },
        data: {
          status: "RELEASED",
          releasedAmount: bond.heldAmount,
        },
      });
      await tx.payment.create({
        data: {
          reference: `AUTO-RELEASE-${bond.booking.bookingReference}`,
          customerId: bond.customerId,
          bookingId: bond.bookingId,
          type: "BOND_RELEASE",
          method: "STRIPE",
          amount: bond.heldAmount,
          status: "SUCCEEDED",
          notes: `Auto-released after ${autoReleaseDays} days`,
        },
      });
    });
    released += 1;

    const customer = bond.booking.customer;
    const html = await render(
      createElement(BondReleased, {
        customerName: customer.firstName,
        bookingReference: bond.booking.bookingReference,
        amount: formatCurrency(Number(bond.heldAmount)),
      }),
    );
    await sendNotification({
      userId: customer.id,
      type: "BOND_RELEASED",
      channels: ["EMAIL"],
      subject: `Bond released — booking ${bond.booking.bookingReference}`,
      title: "Bond released",
      html,
      body: `Hi ${customer.firstName}, your bond of ${formatCurrency(Number(bond.heldAmount))} for booking ${bond.booking.bookingReference} has been released.`,
      bookingId: bond.bookingId,
      data: {
        bookingReference: bond.booking.bookingReference,
        amount: Number(bond.heldAmount),
      },
    });

    await trackServer({
      event: SERVER_EVENTS.bondAutoReleased,
      distinctId: bond.customerId,
      properties: {
        bookingId: bond.bookingId,
        reference: bond.booking.bookingReference,
        heldAud: Number(bond.heldAmount),
        autoReleaseDays,
      },
      groups: { depot: bond.booking.pickupDepot.slug },
    });
  }

  return released;
}

/** One "release blocked" manager alert per bond per 24h (audit-log dedup). */
async function alertReleaseBlockedOnce(
  bondLedgerId: string,
  info: {
    bookingId: string;
    bookingReference: string;
    balanceDue: number;
    openDamage: number;
    openIncidents: number;
    heldAud: number;
  },
): Promise<void> {
  const recent = await prisma.auditLog.findFirst({
    where: {
      action: "bond.release_blocked_alert",
      entityId: bondLedgerId,
      timestamp: { gt: new Date(Date.now() - 23 * 60 * 60 * 1000) },
    },
    select: { id: true },
  });
  if (recent) return;

  const managers = await prisma.user.findMany({
    where: { role: { in: ["MANAGER", "ADMIN", "SUPER_ADMIN"] }, status: "ACTIVE" },
    select: { id: true },
    take: 5,
  });
  for (const m of managers) {
    await sendNotification({
      userId: m.id,
      type: "INCIDENT_REPORTED",
      channels: ["IN_APP", "EMAIL"],
      subject: `Bond release blocked — ${info.bookingReference}`,
      title: "Bond auto-release blocked",
      body:
        `The ${formatCurrency(info.heldAud)} bond on booking ${info.bookingReference} is due for auto-release ` +
        `but ${[
          info.balanceDue > 0 ? `${formatCurrency(info.balanceDue)} is still owed` : null,
          info.openDamage > 0 ? `${info.openDamage} damage charge(s) are unresolved` : null,
          info.openIncidents > 0
            ? `${info.openIncidents} customer-liable incident(s) are still open`
            : null,
        ]
          .filter(Boolean)
          .join(" and ")}. ` +
        `Capture from the bond (Booking → Settlement → Capture bond) or resolve the balance/incident — the release runs automatically once clear.`,
      bookingId: info.bookingId,
      data: { bondLedgerId, ...info },
    });
  }
  await prisma.auditLog.create({
    data: {
      category: "JOB",
      action: "bond.release_blocked_alert",
      entity: "BondLedger",
      entityId: bondLedgerId,
      status: "SUCCESS",
      newData: { ...info },
    },
  });
}

export function startBondAutoReleaseScheduler() {
  registerWorker(QUEUE, async () => runBondAutoRelease());
  monitorCron(QUEUE, "0 2 * * *");
  const q = getQueue(QUEUE);
  if (!q) return;
  q.add(
    "nightly",
    {},
    { repeat: { pattern: "0 2 * * *", tz: "Australia/Brisbane" }, jobId: "repeat-nightly" },
  );
}
