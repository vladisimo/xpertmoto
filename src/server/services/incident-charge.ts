import { TRPCError } from "@trpc/server";
import { Prisma, type PrismaClient } from "@prisma/client";
import { prisma as defaultPrisma } from "@/lib/prisma";
import {
  applyExcessCap,
  getBookingExcess,
  getDamageLiabilityUsed,
} from "@/server/services/excess";
import { writeAuditAsync } from "@/server/services/audit";
import { gstFromInclusive } from "@/lib/money";
import { capturePaymentIntent } from "@/lib/stripe";
import { trackServer } from "@/lib/analytics";
import { SERVER_EVENTS } from "@/lib/analytics/server-event-names";

type PrismaLike = PrismaClient | typeof defaultPrisma;

export type ChargeCustomerForIncidentArgs = {
  incidentId: string;
  /** Optional override — if not provided, uses the incident's recorded
   *  `customerChargeAmount`. */
  amount?: number;
  notes?: string;
  /** Manager-attested reason to charge beyond the insurance excess cap for
   *  this one charge (audited as EXCESS_CAP_OVERRIDDEN). Prefer
   *  `setIncidentExcessVoided` for §6 grounds that void the excess on the
   *  incident itself. */
  overrideExcessCap?: { reason: string };
  actorId: string;
  /** Theft flow: keep the incident's status/resolvedAt untouched (the caller
   *  owns the lifecycle — e.g. `confirmTheft` lands INSURANCE_CLAIM, not
   *  RESOLVED). Charge amounts are still recorded on the incident. Default
   *  false preserves the classic one-click resolve behaviour. */
  keepStatus?: boolean;
};

export type IncidentChargePaymentRow = {
  id: string;
  amount: number;
  source: "BOND" | "CARD";
};

/**
 * D2: one-click "charge customer" on an incident (extracted from the
 * `fleet.chargeCustomerForIncident` router body so the theft-confirmation
 * flow can share it). Creates the damage charge payment(s), captures from
 * the bond ledger when there's still an active hold, and transitions the
 * incident to RESOLVED (unless `keepStatus`). Idempotent via the
 * `chargeReference` check: running it twice won't double-charge.
 *
 * Behaviour depends on the state of the bond at the time of the charge:
 *   - Bond still HELD → capture up to the damage amount from the bond;
 *     any excess creates a second PENDING payment for card-on-file
 *     follow-up.
 *   - Bond already RELEASED / FULLY_CAPTURED → create a PENDING card
 *     charge for the whole amount. Staff processes it through the
 *     normal payment flow.
 */
export async function chargeCustomerForIncident(
  prisma: PrismaLike,
  input: ChargeCustomerForIncidentArgs,
) {
  const incident = await prisma.incident.findUniqueOrThrow({
    where: { id: input.incidentId },
    include: {
      booking: {
        include: { bondLedger: true, pickupDepot: { select: { slug: true } } },
      },
    },
  });
  if (!incident.booking) {
    throw new TRPCError({ code: "BAD_REQUEST", message: "Incident must be linked to a booking before charging." });
  }
  if (!incident.customerLiable) {
    throw new TRPCError({ code: "BAD_REQUEST", message: "Incident must be marked customerLiable before charging." });
  }
  const requestedAmount = input.amount ?? Number(incident.customerChargeAmount ?? 0);
  if (requestedAmount <= 0) {
    throw new TRPCError({ code: "BAD_REQUEST", message: "No charge amount set on incident." });
  }
  const bookingId = incident.booking.id;
  const customerId = incident.booking.customerId;

  // Excess cap (per-hire aggregate): the customer's insurance excess is
  // the ceiling on TOTAL damage recovery for the hire — return-assessment
  // lines, quote close-outs and incident charges all draw on it. Clamped
  // here BEFORE any Payment is created, unless the incident's excess was
  // voided (§6 grounds via setIncidentExcessVoided) or the manager
  // explicitly overrides for this one charge (audited below).
  const bookingExcess = await getBookingExcess(prisma, bookingId);
  const liabilityUsed = await getDamageLiabilityUsed(prisma, bookingId);
  const capResult = applyExcessCap({
    proposed: requestedAmount,
    used: liabilityUsed,
    excess: bookingExcess.excess,
    voided: incident.excessVoided,
    managerOverride: !!input.overrideExcessCap,
  });
  const amount = capResult.chargeable;
  if (amount <= 0) {
    throw new TRPCError({
      code: "BAD_REQUEST",
      message: `Insurance excess cap exhausted — excess A$${bookingExcess.excess.toFixed(2)}, already recovered A$${liabilityUsed.toFixed(2)}. Nothing chargeable. Void the excess on the incident (manager) or override with a reason to proceed.`,
    });
  }

  // Idempotency: if a DAMAGE_CHARGE payment already references this
  // incident, abort — the charge has already been applied.
  const chargeReference = `INC-${incident.incidentNumber}`;
  const existing = await prisma.payment.findFirst({
    where: { reference: chargeReference },
    select: { id: true },
  });
  if (existing) {
    throw new TRPCError({ code: "CONFLICT", message: "Customer has already been charged for this incident." });
  }

  const bond = incident.booking!.bondLedger;
  const bondHeld =
    bond && bond.status === "HELD" ? Number(bond.heldAmount) - Number(bond.capturedAmount) : 0;
  const fromBond = Math.min(bondHeld, amount);
  const fromCard = Math.round((amount - fromBond) * 100) / 100;

  // Capture the bond hold at Stripe BEFORE the DB transaction — never hold
  // a Postgres transaction open across a Stripe round-trip. A manual hold
  // is single-capture, so this consumes the hold (Stripe releases the
  // rest); any excess is billed to the card as a PENDING follow-up below.
  let bondChargeId: string | null = null;
  if (fromBond > 0 && bond) {
    try {
      const capture = await capturePaymentIntent(bond.stripePaymentIntentId, {
        amountToCaptureCents: Math.round(fromBond * 100),
        idempotencyKey: `bond-capture-incident-${incident.id}`,
      });
      bondChargeId = capture.latestChargeId;
    } catch (err) {
      throw new TRPCError({
        code: "BAD_REQUEST",
        message: `Stripe could not capture the bond hold: ${
          err instanceof Error ? err.message : "unknown error"
        }. No charge was applied.`,
      });
    }
  }

  const result = await prisma.$transaction(async (tx) => {
    const payments: { id: string; amount: number; source: "BOND" | "CARD" }[] = [];

    if (fromBond > 0 && bond) {
      const bondPayment = await tx.payment.create({
        data: {
          reference: chargeReference,
          bookingId,
          customerId,
          type: "DAMAGE_CHARGE",
          method: "STRIPE",
          amount: fromBond,
          // Bond-funded damage recovery is a taxable supply — GST-inclusive
          // like the card remainder below (gst-bas-export reads Payment.gstAmount).
          gstAmount: gstFromInclusive(fromBond),
          status: "SUCCEEDED",
          // Link the Stripe ids so reconcile matches this to the charge.
          stripePaymentIntentId: bond.stripePaymentIntentId,
          stripeChargeId: bondChargeId,
          notes: input.notes ?? `Damage charge captured from bond for incident ${incident.incidentNumber}`,
          processedById: input.actorId,
          processedAt: new Date(),
        },
      });
      const newCaptured = Number(bond.capturedAmount) + fromBond;
      const newReleased = Math.max(0, Number(bond.heldAmount) - newCaptured);
      const prior = Array.isArray(bond.deductions) ? (bond.deductions as unknown[]) : [];
      await tx.bondLedger.update({
        where: { bookingId },
        data: {
          capturedAmount: newCaptured,
          releasedAmount: newReleased,
          // Single-capture: the hold is finalised once captured (Stripe
          // released the remainder), so always land terminal.
          status: "FULLY_CAPTURED",
          deductions: [
            ...prior,
            { reason: `Incident ${incident.incidentNumber}`, amount: fromBond },
          ] as Prisma.InputJsonValue,
        },
      });
      payments.push({ id: bondPayment.id, amount: fromBond, source: "BOND" });
    }

    if (fromCard > 0) {
      const cardPayment = await tx.payment.create({
        data: {
          reference: `${chargeReference}-CARD`,
          bookingId,
          customerId,
          type: "DAMAGE_CHARGE",
          method: "STRIPE",
          amount: fromCard,
          gstAmount: gstFromInclusive(fromCard),
          status: "PENDING",
          notes:
            input.notes ??
            `Damage charge remainder for incident ${incident.incidentNumber} — bond insufficient, follow-up card charge required`,
          processedById: input.actorId,
        },
      });
      payments.push({ id: cardPayment.id, amount: fromCard, source: "CARD" });
      // Raise→add half of the balance-due contract (balance-due.ts):
      // DAMAGE_CHARGE is balance-affecting, so its capture decrements
      // balanceDue — without this increment the capture would eat into
      // UNRELATED debt on the booking and silently stop it being dunned.
      await tx.booking.update({
        where: { id: bookingId },
        data: { balanceDue: { increment: fromCard } },
      });
    }

    const updatedIncident = await tx.incident.update({
      where: { id: incident.id },
      data: {
        ...(input.keepStatus
          ? {}
          : {
              status: "RESOLVED",
              resolvedAt: incident.resolvedAt ?? new Date(),
            }),
        actualDamageCost: incident.actualDamageCost ?? amount,
        customerChargeAmount: amount,
      },
    });

    return { incident: updatedIncident, payments, fromBond, fromCard };
  });

  // Excess-cap audit trail: pre-cap vs charged, or the manager's
  // attested reason for charging past the cap.
  if (input.overrideExcessCap) {
    writeAuditAsync(prisma, {
      userId: input.actorId,
      action: "EXCESS_CAP_OVERRIDDEN",
      entity: "Incident",
      entityId: incident.id,
      newData: {
        bookingId,
        reason: input.overrideExcessCap.reason,
        uncappedAmount: requestedAmount,
        charged: amount,
        excess: bookingExcess.excess,
        usedBefore: liabilityUsed,
        capRemaining: capResult.capRemaining,
      },
    });
  } else if (capResult.cappedBy > 0) {
    writeAuditAsync(prisma, {
      userId: input.actorId,
      action: "EXCESS_CAP_APPLIED",
      entity: "Incident",
      entityId: incident.id,
      newData: {
        bookingId,
        preCapAmount: requestedAmount,
        charged: amount,
        cappedBy: capResult.cappedBy,
        excess: bookingExcess.excess,
        excessSource: bookingExcess.source,
        usedBefore: liabilityUsed,
      },
    });
  }

  // Issue an ATO §29-75 adjustment note for the damage charge. Each
  // payment row (bond capture and / or card capture) gets a
  // separate adjustment so the audit trail mirrors the cash flow.
  try {
    const { tryIssueAdjustmentForBooking } = await import(
      "@/server/services/invoice-lifecycle"
    );
    for (const p of result.payments) {
      await tryIssueAdjustmentForBooking({
        bookingId,
        type: "INCREASE",
        reason: "DAMAGE",
        description: `Damage charge — incident ${incident.incidentNumber}${
          p.source === "BOND" ? " (captured from bond)" : ""
        }`,
        lineItems: [
          {
            description: `Damage to vehicle (incident ${incident.incidentNumber})`,
            detail:
              input.notes ??
              (p.source === "BOND"
                ? "Captured from security bond hold"
                : "Charged to card on file"),
            quantity: 1,
            unitPrice: p.amount,
            totalPrice: p.amount,
            gstAmount: gstFromInclusive(p.amount).toNumber(),
            gstIncluded: true,
          },
        ],
        paymentId: p.id,
        issuedById: input.actorId,
      });
    }
  } catch {
    // tryIssueAdjustmentForBooking already logs internal failures.
  }

  await trackServer({
    event: SERVER_EVENTS.incidentCustomerCharged,
    distinctId: customerId,
    properties: {
      incidentId: incident.id,
      incidentNumber: incident.incidentNumber,
      bookingId,
      amountAud: amount,
      fromBondAud: result.fromBond,
      fromCardAud: result.fromCard,
      actorUserId: input.actorId,
    },
    ...(incident.booking?.pickupDepot?.slug
      ? { groups: { depot: incident.booking.pickupDepot.slug } }
      : {}),
  });

  return result;
}
