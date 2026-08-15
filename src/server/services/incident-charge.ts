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

  // Idempotency: if a live DAMAGE_CHARGE payment already references this
  // incident, abort — the charge has already been applied. A bond-funded
  // run lands `INC-<num>`; a card-only run (bond not HELD) lands ONLY
  // `INC-<num>-CARD`, so both spellings must trip the pre-check or a retry
  // sails past it and dies on the Payment.reference @unique (P2002).
  // Checked BEFORE the excess cap: the prior charge itself consumes the cap
  // (getDamageLiabilityUsed counts it), so a retry on an already-charged
  // incident must report the truth (CONFLICT) rather than a misleading
  // "cap exhausted — override to proceed".
  //
  // FAILED rows do NOT block: a hard-declined card slice (capture sweep /
  // retry queue marks it FAILED) would otherwise permanently jam the unique
  // reference and make the incident forever unchargeable. Instead the
  // FAILED row is RESURRECTED inside the charging transaction below —
  // flipped back to a live status with the new slice's amount — so the
  // reference stays unique and idempotency is preserved. (PaymentStatus has
  // no CANCELLED; FAILED is the only resurrectable terminal state. Anything
  // else — PENDING, SUCCEEDED, REFUNDED, DISPUTED, WRITTEN_OFF — represents
  // a live or deliberately-settled charge and still CONFLICTs.)
  const chargeReference = `INC-${incident.incidentNumber}`;
  const cardReference = `${chargeReference}-CARD`;
  const priorSlices = await prisma.payment.findMany({
    where: { reference: { in: [chargeReference, cardReference] } },
    select: { id: true, reference: true, status: true, amount: true, notes: true },
  });
  if (priorSlices.some((r) => r.status !== "FAILED")) {
    throw new TRPCError({ code: "CONFLICT", message: "Customer has already been charged for this incident." });
  }
  const failedBondSlice = priorSlices.find((r) => r.reference === chargeReference) ?? null;
  const failedCardSlice = priorSlices.find((r) => r.reference === cardReference) ?? null;

  // DamageCharge rows linked to the failed attempt: getDamageLiabilityUsed
  // counts CONFIRMED/CAPTURED charge rows regardless of the linked
  // payment's status, so the failed slice still consumes excess-cap
  // headroom AND would double-count if we created a fresh row alongside it.
  // The retry supersedes the failed attempt, so (a) its liability is freed
  // back to the cap for this computation, and (b) the row is UPDATED to the
  // new slice in the transaction instead of duplicated.
  const failedSliceIds = [failedBondSlice, failedCardSlice]
    .filter((r): r is NonNullable<typeof r> => !!r)
    .map((r) => r.id);
  const supersededCharges = failedSliceIds.length
    ? await prisma.damageCharge.findMany({
        where: {
          capturedPaymentId: { in: failedSliceIds },
          status: { in: ["CONFIRMED", "CAPTURED"] },
        },
        select: { id: true, amount: true, capturedPaymentId: true },
      })
    : [];
  const supersededLiability = supersededCharges.reduce((acc, c) => acc + Number(c.amount), 0);

  // Excess cap (per-hire aggregate): the customer's insurance excess is
  // the ceiling on TOTAL damage recovery for the hire — return-assessment
  // lines, quote close-outs and incident charges all draw on it. Clamped
  // here BEFORE any Payment is created, unless the incident's excess was
  // voided (§6 grounds via setIncidentExcessVoided) or the manager
  // explicitly overrides for this one charge (audited below).
  const bookingExcess = await getBookingExcess(prisma, bookingId);
  const liabilityUsed = Math.max(
    0,
    Math.round(((await getDamageLiabilityUsed(prisma, bookingId)) - supersededLiability) * 100) /
      100,
  );
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

  // Unified damage surface: every money slice below also lands a
  // DamageCharge row parented by the incident (DB CHECK: a charge needs a
  // return assessment OR an incident). `getDamageLiabilityUsed` counts the
  // charge rows and dedupes their linked payments out of the historical
  // INC-% Payment fallback via `capturedPaymentId`.
  const chargeDescription =
    `Incident ${incident.incidentNumber} — ${incident.description}`.slice(0, 500);

  // Resurrection note: appended (never overwriting) so the failed attempt's
  // history survives. The "[RECONCILED:balance-due]" marker is deliberate —
  // scripts/reconcile-incident-charges.ts pass 2 backfills the balanceDue
  // raise onto PENDING INC-%-CARD rows created before the go-forward fix and
  // skips rows carrying that marker; a resurrected row gets its raise
  // accounted right here, so the marker stops the backfill double-applying.
  const retryNote = (prior: string | null | undefined, extra: string) =>
    `${prior ? `${prior}\n` : ""}[RETRY: previous attempt FAILED — resurrected ${extra}] [RECONCILED:balance-due]`;

  const result = await prisma.$transaction(async (tx) => {
    const payments: { id: string; amount: number; source: "BOND" | "CARD" }[] = [];

    if (fromBond > 0 && bond) {
      // Bond slice lands SUCCEEDED (money already captured at Stripe above).
      // A FAILED row on this reference (historical pre-unification card
      // charge) is resurrected in place so the unique reference is reused.
      const bondPayment = failedBondSlice
        ? await tx.payment.update({
            where: { id: failedBondSlice.id },
            data: {
              amount: fromBond,
              gstAmount: gstFromInclusive(fromBond),
              status: "SUCCEEDED",
              stripePaymentIntentId: bond.stripePaymentIntentId,
              stripeChargeId: bondChargeId,
              notes: retryNote(
                failedBondSlice.notes,
                `as bond capture for incident ${incident.incidentNumber}`,
              ),
              processedById: input.actorId,
              processedAt: new Date(),
            },
          })
        : await tx.payment.create({
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
      // Bond slice charge row: money already captured, so the charge lands
      // terminal (CAPTURED) with the bond deduction recorded. When the
      // failed attempt already left a DamageCharge linked to the resurrected
      // payment, update it in place (creating a second row would double
      // getDamageLiabilityUsed).
      const supersededBondCharge = failedBondSlice
        ? supersededCharges.find((c) => c.capturedPaymentId === failedBondSlice.id)
        : undefined;
      const bondChargePatch = {
        incidentId: incident.id,
        description: chargeDescription,
        severity: incident.severity,
        resolution: "STANDARD" as const,
        amount: fromBond,
        status: "CAPTURED" as const,
        capturedPaymentId: bondPayment.id,
        bondDeductionCents: Math.round(fromBond * 100),
        resolvedById: input.actorId,
        resolvedAt: new Date(),
      };
      if (supersededBondCharge) {
        // Keep the original creator on the superseded row — only the money
        // fields and resolution state change on a retry.
        await tx.damageCharge.update({
          where: { id: supersededBondCharge.id },
          data: bondChargePatch,
        });
      } else {
        await tx.damageCharge.create({
          data: { ...bondChargePatch, createdById: input.actorId },
        });
      }
    }

    if (fromCard > 0) {
      const cardPayment = failedCardSlice
        ? // Resurrect the hard-declined slice: back to PENDING with the new
          // amount so the off-session sweep re-attempts it — the unique
          // INC-<num>-CARD reference is reused, not duplicated.
          await tx.payment.update({
            where: { id: failedCardSlice.id },
            data: {
              amount: fromCard,
              gstAmount: gstFromInclusive(fromCard),
              status: "PENDING",
              notes: retryNote(
                failedCardSlice.notes,
                `as card charge for incident ${incident.incidentNumber}`,
              ),
              processedById: input.actorId,
            },
          })
        : await tx.payment.create({
        data: {
          reference: cardReference,
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
      // Card slice charge row: CONFIRMED (raised, capture pending) linked to
      // the PENDING card Payment the off-session sweep collects. On a retry
      // the failed attempt's existing row is updated in place — a second row
      // would double getDamageLiabilityUsed.
      const supersededCardCharge = failedCardSlice
        ? supersededCharges.find((c) => c.capturedPaymentId === failedCardSlice.id)
        : undefined;
      if (supersededCardCharge) {
        await tx.damageCharge.update({
          where: { id: supersededCardCharge.id },
          data: {
            incidentId: incident.id,
            description: chargeDescription,
            severity: incident.severity,
            resolution: "STANDARD",
            amount: fromCard,
            status: "CONFIRMED",
            capturedPaymentId: cardPayment.id,
          },
        });
      } else {
        await tx.damageCharge.create({
          data: {
            incidentId: incident.id,
            description: chargeDescription,
            severity: incident.severity,
            resolution: "STANDARD",
            amount: fromCard,
            status: "CONFIRMED",
            capturedPaymentId: cardPayment.id,
            createdById: input.actorId,
          },
        });
      }
      // Raise→add half of the balance-due contract (balance-due.ts):
      // DAMAGE_CHARGE is balance-affecting, so its capture decrements
      // balanceDue — without this increment the capture would eat into
      // UNRELATED debt on the booking and silently stop it being dunned.
      //
      // Resurrection accounting: neither FAILED path decrements balanceDue —
      // capture-pending-payments.ts flips PENDING→FAILED on a hard decline
      // with no applyCaptureToBalanceDue call, and capture-retry.ts does the
      // same when retries exhaust — so the failed slice's original raise is
      // STILL sitting on Booking.balanceDue. The net owed for the
      // resurrected row must equal its new amount, so only the DELTA
      // (new − failed) is applied here, clamped at zero like the capture
      // half of the contract. (Pre-balance-due-fix FAILED history that never
      // received a raise is out of this go-forward contract's scope —
      // scripts/reconcile-incident-charges.ts owns historical repair.)
      if (failedCardSlice) {
        const delta =
          Math.round((fromCard - Number(failedCardSlice.amount)) * 100) / 100;
        if (delta !== 0) {
          const current = await tx.booking.findUnique({
            where: { id: bookingId },
            select: { balanceDue: true },
          });
          const nextBalance = Math.max(
            0,
            Math.round((Number(current?.balanceDue ?? 0) + delta) * 100) / 100,
          );
          await tx.booking.update({
            where: { id: bookingId },
            data: { balanceDue: nextBalance },
          });
        }
      } else {
        await tx.booking.update({
          where: { id: bookingId },
          data: { balanceDue: { increment: fromCard } },
        });
      }
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

/**
 * Area 5 — work-order → incident actual-cost feedback. Called from
 * `fleet.updateWorkOrderStatus` when a work order with `relatedIncidentId`
 * completes:
 *
 *   - Backfills `Incident.actualDamageCost` from the work order's actual
 *     cost when the incident doesn't have one yet (audited).
 *   - Customer-liable but not yet charged → nudge depot managers to review
 *     the incident charge now a real cost exists.
 *   - Already charged more than the actual repair cost → nudge managers to
 *     issue a partial refund (manual action — under the ACL we cannot
 *     retain more than the actual loss).
 *
 * Notifications are best-effort; the cost write is the only state change.
 */
export async function recordWorkOrderCostForIncident(
  prisma: PrismaLike,
  args: {
    incidentId: string;
    workOrderNumber: string;
    /** Work order's recorded actual cost in AUD (null when not captured). */
    actualCost: number | null;
    actorId: string;
  },
): Promise<{ actualDamageCostWritten: boolean }> {
  const incident = await prisma.incident.findUnique({
    where: { id: args.incidentId },
    select: {
      id: true,
      incidentNumber: true,
      customerLiable: true,
      actualDamageCost: true,
      vehicle: { select: { depotId: true, internalCode: true } },
    },
  });
  if (!incident) return { actualDamageCostWritten: false };
  const actualCost =
    args.actualCost != null && Number.isFinite(args.actualCost) && args.actualCost >= 0
      ? Math.round(args.actualCost * 100) / 100
      : null;

  let actualDamageCostWritten = false;
  if (incident.actualDamageCost == null && actualCost != null) {
    await prisma.incident.update({
      where: { id: incident.id },
      data: { actualDamageCost: actualCost },
    });
    writeAuditAsync(prisma, {
      userId: args.actorId,
      action: "INCIDENT_ACTUAL_COST_RECORDED",
      entity: "Incident",
      entityId: incident.id,
      previousData: { actualDamageCost: null },
      newData: {
        actualDamageCost: actualCost,
        source: `work order ${args.workOrderNumber}`,
      },
    });
    actualDamageCostWritten = true;
  }

  if (!incident.customerLiable || actualCost == null) {
    return { actualDamageCostWritten };
  }

  // Has this incident been charged? Post-unification slices AND historical
  // pre-unification charges both carry INC-<num> Payment references.
  const chargeReference = `INC-${incident.incidentNumber}`;
  const chargePayments = await prisma.payment.findMany({
    where: {
      reference: { in: [chargeReference, `${chargeReference}-CARD`] },
      type: "DAMAGE_CHARGE",
      status: { in: ["PENDING", "SUCCEEDED"] },
      deletedAt: null,
    },
    select: { amount: true },
  });
  const chargedTotal =
    Math.round(chargePayments.reduce((acc, p) => acc + Number(p.amount), 0) * 100) / 100;

  let subject: string | null = null;
  let body: string | null = null;
  if (chargePayments.length === 0) {
    subject = `Incident ${incident.incidentNumber} — actual repair cost recorded`;
    body =
      `Work order ${args.workOrderNumber} on ${incident.vehicle.internalCode} completed with an actual repair cost of ` +
      `A$${actualCost.toFixed(2)}. The incident is marked customer-liable but the customer has not been charged yet — ` +
      `review the incident and raise the charge if appropriate.`;
  } else if (actualCost < chargedTotal) {
    subject = `Incident ${incident.incidentNumber} — actual cost below amount charged`;
    body =
      `Work order ${args.workOrderNumber} on ${incident.vehicle.internalCode} completed with an actual repair cost of ` +
      `A$${actualCost.toFixed(2)}, but the customer was charged A$${chargedTotal.toFixed(2)} for this incident. ` +
      `Under the ACL we cannot retain more than the actual loss — review and issue a partial refund of ` +
      `A$${(Math.round((chargedTotal - actualCost) * 100) / 100).toFixed(2)}.`;
  }
  if (!subject || !body) return { actualDamageCostWritten };

  try {
    const { sendNotification } = await import("@/server/services/notification-sender");
    const managers = await prisma.user.findMany({
      where: {
        role: { in: ["MANAGER", "ADMIN"] },
        deletedAt: null,
        OR: [{ depotId: incident.vehicle.depotId ?? undefined }, { depotId: null }],
      },
      select: { id: true },
    });
    for (const m of managers) {
      await sendNotification({
        userId: m.id,
        type: "INCIDENT_REPORTED",
        category: "OPERATIONAL",
        channels: ["IN_APP", "EMAIL"],
        subject,
        title: subject,
        body,
        data: {
          incidentId: incident.id,
          incidentNumber: incident.incidentNumber,
          actualCostAud: actualCost,
          chargedAud: chargedTotal,
        },
        sentById: args.actorId,
      });
    }
  } catch (err) {
    const { logger } = await import("@/lib/logger");
    logger.error(
      {
        err: err instanceof Error ? err.message : String(err),
        incidentId: incident.id,
      },
      "incident-charge: work-order cost feedback notification failed",
    );
  }

  return { actualDamageCostWritten };
}
