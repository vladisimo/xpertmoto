import { render } from "@react-email/render";
import { createElement } from "react";

import { prisma } from "@/lib/prisma";
import { formatCurrency } from "@/lib/utils";
import { getSetting, SETTING_DEFAULTS } from "@/lib/settings";
import { sendNotification } from "@/server/services/notification-sender";
import BondReleased from "../../../emails/bond-released";
import { getQueue, registerWorker } from "./queue";

const QUEUE = "bond-auto-release" as const;

/**
 * Daily at 02:00. Release bond holds that are older than 14 days and
 * haven't been captured — business rule 3 from CLAUDE.md. Stripe auth
 * holds expire naturally after ~7 days, so this is a bookkeeping update
 * plus a confirmation email.
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
      booking: { include: { customer: true } },
    },
  });

  for (const bond of candidates) {
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
  }

  return candidates.length;
}

export function startBondAutoReleaseScheduler() {
  registerWorker(QUEUE, async () => runBondAutoRelease());
  const q = getQueue(QUEUE);
  if (!q) return;
  q.add(
    "nightly",
    {},
    { repeat: { pattern: "0 2 * * *", tz: "Australia/Brisbane" }, jobId: "repeat-nightly" },
  );
}
