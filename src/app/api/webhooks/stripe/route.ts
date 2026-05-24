import { NextResponse } from "next/server";
import { Prisma } from "@prisma/client";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { logger } from "@/lib/logger";
import { constructWebhookEvent, type StripeWebhookEvent } from "@/lib/stripe";
import { withAudit } from "@/lib/with-audit";
import { writePaymentAudit } from "@/server/services/audit-payment";
import { writeAudit } from "@/server/services/audit";
import { writePaymentEvent } from "@/server/services/payment-events";
import { applyCaptureToBalanceDue } from "@/server/services/balance-due";
import { stripeWebhookOutcome } from "@/server/services/metrics";
import { sendNotification } from "@/server/services/notification-sender";
import { recordRefund, invalidateRevenueCaches } from "@/server/services/revenue-aggregator";
import { trackServer } from "@/lib/analytics";
import { SERVER_EVENTS } from "@/lib/analytics/server-event-names";

function humanisePaymentType(type: string): string {
  return type
    .toLowerCase()
    .split("_")
    .map((p) => p.charAt(0).toUpperCase() + p.slice(1))
    .join(" ");
}

export const POST = withAudit({ name: "webhooks.stripe", entity: "StripeWebhook" }, handlePost);

async function handlePost(req: Request) {
  const raw = await req.text();
  const sig = req.headers.get("stripe-signature");

  let event: StripeWebhookEvent | null;
  try {
    event = await constructWebhookEvent(raw, sig);
  } catch (err) {
    logger.warn(
      { err: err instanceof Error ? err.message : String(err) },
      "stripe webhook signature verification failed",
    );
    return new NextResponse("Invalid signature", { status: 400 });
  }
  if (!event) {
    return new NextResponse("Stripe webhook not configured", { status: 503 });
  }

  // G1 — insert-then-process dedup. A duplicate event id hits the PK and
  // raises P2002; we treat that as "already seen, acknowledge and move on".
  // This is the only guard that makes replays from `stripe events resend`
  // and Stripe's built-in retry idempotent.
  try {
    await prisma.stripeWebhookEvent.create({
      data: {
        id: event.id,
        type: event.type,
        apiVersion: (event as { api_version?: string | null }).api_version ?? null,
        livemode: Boolean((event as { livemode?: boolean }).livemode),
        payload: event as unknown as Prisma.InputJsonValue,
      },
    });
  } catch (err) {
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") {
      logger.info({ eventId: event.id, type: event.type }, "stripe webhook duplicate event — skipping");
      stripeWebhookOutcome(event.type, "duplicate");
      return NextResponse.json({ received: true, duplicate: true });
    }
    // Insert failure is unexpected — surface as 500 so Stripe retries.
    logger.error(
      { err: err instanceof Error ? err.message : String(err), eventId: event.id },
      "stripe webhook event log insert failed",
    );
    return new NextResponse("Event log write failed", { status: 500 });
  }

  await prisma.stripeWebhookEvent.update({
    where: { id: event.id },
    data: { status: "PROCESSING", attempts: { increment: 1 } },
  });

  try {
    await handleEvent(event);
    await prisma.stripeWebhookEvent.update({
      where: { id: event.id },
      data: { status: "PROCESSED", processedAt: new Date() },
    });
    stripeWebhookOutcome(event.type, "processed");
    await writePaymentAudit(prisma, {
      action: `stripe.${event.type}`,
      entity: "StripeWebhookEvent",
      entityId: event.id,
      status: "SUCCESS",
      newData: { type: event.type, id: event.id },
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    logger.error(
      { err: message, eventType: event.type, eventId: event.id },
      "stripe webhook handler error",
    );
    await prisma.stripeWebhookEvent.update({
      where: { id: event.id },
      data: { status: "FAILED", errorReason: message.slice(0, 1024) },
    });
    stripeWebhookOutcome(event.type, "failed");
    await writePaymentAudit(prisma, {
      action: `stripe.${event.type}`,
      entity: "StripeWebhookEvent",
      entityId: event.id,
      status: "FAILURE",
      errorCode: "HANDLER_ERROR",
      newData: { type: event.type, id: event.id, error: message.slice(0, 256) },
    });
    // Return 500 so Stripe retries per its exponential-backoff schedule.
    return new NextResponse("Handler error", { status: 500 });
  }

  return NextResponse.json({ received: true });
}

// Per-event-type Zod schemas. We only validate the subset of fields the
// handler actually reads — Stripe payloads are large and versioned, so a
// strict whole-object schema would fight future API version bumps.
const paymentIntentSchema = z.object({
  id: z.string().min(1),
  latest_charge: z.string().nullable().optional(),
  // Non-null when the PI went through with `capture_method: manual` and
  // was later captured (potentially for a partial amount). `amount` is
  // the original authorisation, `amount_received` is what was actually
  // captured — their delta is what Stripe returned to the customer on
  // capture.
  amount: z.number().int().nonnegative().optional(),
  amount_received: z.number().int().nonnegative().optional(),
  capture_method: z.string().optional(),
  metadata: z.record(z.string(), z.string()).nullable().optional(),
});
const paymentIntentFailedSchema = z.object({ id: z.string().min(1) });
const chargeRefundedSchema = z.object({
  payment_intent: z.string().nullable().optional(),
  amount_refunded: z.number().int().nonnegative().optional(),
  amount: z.number().int().nonnegative().optional(),
});
const chargeDisputeSchema = z.object({
  id: z.string().min(1),
  payment_intent: z.string().nullable().optional(),
  reason: z.string().optional(),
  amount: z.number().int().nonnegative().optional(),
});
const identityVerifiedSchema = z.object({
  metadata: z.record(z.string(), z.string()).nullable().optional(),
});
const refundUpdatedSchema = z.object({
  id: z.string().min(1),
  payment_intent: z.string().nullable().optional(),
  status: z.string().optional(),
  failure_reason: z.string().nullable().optional(),
  amount: z.number().int().nonnegative().optional(),
});
const paymentMethodSchema = z.object({
  id: z.string().min(1),
  customer: z.string().nullable().optional(),
  type: z.string().optional(),
  card: z
    .object({
      brand: z.string().nullable().optional(),
      last4: z.string().nullable().optional(),
      exp_month: z.number().int().optional(),
      exp_year: z.number().int().optional(),
    })
    .nullable()
    .optional(),
});
const chargeDisputeUpdatedSchema = z.object({
  id: z.string().min(1),
  payment_intent: z.string().nullable().optional(),
  status: z.string().optional(),
  amount: z.number().int().nonnegative().optional(),
});

function parseEventObject<T extends z.ZodTypeAny>(
  schema: T,
  raw: unknown,
  eventType: string,
): z.infer<T> | null {
  const parsed = schema.safeParse(raw);
  if (!parsed.success) {
    logger.warn(
      { eventType, issues: parsed.error.issues },
      "stripe webhook payload shape unexpected — skipping handler",
    );
    return null;
  }
  return parsed.data;
}

async function handleEvent(event: StripeWebhookEvent): Promise<void> {
  const obj = event.data.object;
  switch (event.type) {
    case "payment_intent.succeeded": {
      const parsed = parseEventObject(paymentIntentSchema, obj, event.type);
      if (!parsed) return;
      const id = parsed.id;
      const chargeId = parsed.latest_charge ?? null;

      // Bond detection + partial-capture handling. A bond hold succeeds
      // when `capture_method === "manual"` has been captured; the BondLedger
      // row should reflect what was actually captured (`amount_received`)
      // vs what was originally held (`amount`). Mid-flight captures
      // initiated from `bookingSettlement.captureBond` already update the
      // ledger; this branch is the webhook safety-net for captures that
      // happen outside our UI (e.g. via the Stripe dashboard).
      const isBondHold =
        parsed.capture_method === "manual" || parsed.metadata?.type === "bond";
      if (isBondHold && typeof parsed.amount === "number") {
        const authorised = parsed.amount / 100;
        const captured = (parsed.amount_received ?? 0) / 100;
        const bondLedger = await prisma.bondLedger.findFirst({
          where: { stripePaymentIntentId: id },
        });
        if (bondLedger) {
          const newStatus =
            captured === 0
              ? "RELEASED"
              : captured >= authorised - 0.01
                ? "FULLY_CAPTURED"
                : "PARTIALLY_CAPTURED";
          await prisma.bondLedger.update({
            where: { id: bondLedger.id },
            data: {
              status: newStatus,
              capturedAmount: captured,
              releasedAmount: authorised - captured,
            },
          });
        }
      }

      // Capture the prior status BEFORE the flip so the balanceDue decrement
      // below stays idempotent: a redelivered webhook (or the deposit's own
      // payment_intent.succeeded, which is already SUCCEEDED) must not
      // double-decrement. Bond holds are handled in the branch above.
      const priorCharge = await prisma.payment.findFirst({
        where: { stripePaymentIntentId: id },
        select: { bookingId: true, type: true, amount: true, status: true },
      });

      await prisma.payment.updateMany({
        where: { stripePaymentIntentId: id },
        data: {
          status: "SUCCEEDED",
          stripeChargeId: chargeId,
          processedAt: new Date(),
        },
      });
      // Remove a now-collected ancillary charge from Booking.balanceDue
      // (no-op for the deposit / bonds / already-SUCCEEDED redeliveries).
      if (priorCharge) {
        await applyCaptureToBalanceDue(prisma, {
          bookingId: priorCharge.bookingId,
          type: priorCharge.type,
          amount: priorCharge.amount,
          previousStatus: priorCharge.status,
        });
      }
      const payment = await prisma.payment.findFirst({
        where: { stripePaymentIntentId: id },
        select: {
          id: true,
          customerId: true,
          amount: true,
          reference: true,
          type: true,
          processedAt: true,
          bookingId: true,
          booking: {
            select: {
              bookingReference: true,
              pickupDepot: { select: { slug: true } },
            },
          },
          customer: { select: { firstName: true } },
          adjustmentNote: { select: { id: true } },
        },
      });
      if (payment?.id) {
        await writePaymentEvent(prisma, {
          paymentId: payment.id,
          eventType: "CAPTURED",
          newStatus: "SUCCEEDED",
          amountDelta: Number(payment.amount),
          source: "webhook",
          stripeEventId: event.id,
          data: { stripeChargeId: chargeId, stripePaymentIntentId: id },
        }, { swallow: true });
      }
      // PostHog: emit `payment.captured` once, from the Stripe webhook —
      // the single source of truth for money actually settling. Skip bond
      // holds (tracked via bond.* events) and idempotent redeliveries (the
      // charge was already SUCCEEDED before this delivery), so a redelivered
      // webhook never double-counts. Best-effort, never blocks the webhook.
      if (payment?.id && payment.customerId && !isBondHold && priorCharge?.status !== "SUCCEEDED") {
        const depotSlug = payment.booking?.pickupDepot?.slug;
        await trackServer({
          event: SERVER_EVENTS.paymentCaptured,
          distinctId: payment.customerId,
          properties: {
            paymentId: payment.id,
            bookingId: payment.bookingId,
            reference: payment.booking?.bookingReference ?? payment.reference,
            amountAud: Number(payment.amount),
            type: payment.type,
          },
          ...(depotSlug ? { groups: { depot: depotSlug } } : {}),
        });
      }
      // Issue a branded receipt PDF for the now-SUCCEEDED payment so the
      // attachment resolver can find a `receiptPdfKey` to email out.
      // Best-effort — the post-trip sweep retries any payments still
      // missing a receipt.
      if (payment?.id) {
        try {
          const { issueReceiptForPayment } = await import(
            "@/server/services/invoice-lifecycle"
          );
          await issueReceiptForPayment({ paymentId: payment.id });
        } catch (err) {
          logger.warn(
            { err: err instanceof Error ? err.message : String(err), paymentId: payment.id },
            "stripe webhook: receipt issuance failed; sweep will retry",
          );
        }
      }
      if (payment?.customerId) {
        const { default: PaymentReceiptEmail } = await import(
          "../../../../../emails/payment-receipt"
        );
        const { render: renderEmailFn } = await import("@react-email/render");
        const { createElement } = await import("react");
        const amountLabel = `A$${Number(payment.amount).toFixed(2)}`;
        const html = await renderEmailFn(
          createElement(PaymentReceiptEmail, {
            customerName: payment.customer?.firstName ?? "there",
            bookingReference: payment.booking?.bookingReference ?? payment.reference,
            amount: amountLabel,
            paymentType: humanisePaymentType(payment.type),
            paidAt: (payment.processedAt ?? new Date()).toLocaleString("en-AU", {
              dateStyle: "medium",
              timeStyle: "short",
            }),
          }),
        );
        // Receipts get attached for every payment. EXTENSION / DAMAGE_CHARGE
        // / MANUAL_CHARGE / REFUND payments also have a linked
        // AdjustmentNote — attach the GST document so the customer's inbox
        // mirrors what they'd get from the portal.
        const attachments: import("@/server/services/notification-sender").AttachmentRef[] = [
          { kind: "receipt", paymentId: payment.id },
        ];
        if (payment.adjustmentNote?.id) {
          attachments.push({
            kind: "adjustment-note",
            adjustmentNoteId: payment.adjustmentNote.id,
          });
        }
        await sendNotification({
          userId: payment.customerId,
          type: "PAYMENT_RECEIVED",
          channels: ["EMAIL"],
          subject: `Payment received${payment.booking ? ` — ${payment.booking.bookingReference}` : ""}`,
          title: "Payment received",
          body: `We've received your payment of ${amountLabel}.${payment.booking ? ` Booking: ${payment.booking.bookingReference}.` : ""} Reference: ${payment.reference}.`,
          html,
          templateKey: "payment-receipt",
          bookingId: payment.bookingId ?? undefined,
          attachments,
          data: {
            paymentReference: payment.reference,
            amountAud: Number(payment.amount),
          },
          dedupKey: `payment-received:${payment.id}`,
        });
      }
      return;
    }
    case "payment_intent.amount_capturable_updated": {
      const parsed = parseEventObject(paymentIntentFailedSchema, obj, event.type);
      if (!parsed) return;
      const id = parsed.id;
      await prisma.bondLedger.updateMany({
        where: { stripePaymentIntentId: id },
        data: { status: "HELD" },
      });
      const bond = await prisma.bondLedger.findFirst({
        where: { stripePaymentIntentId: id },
        select: {
          bookingId: true,
          customerId: true,
          heldAmount: true,
          booking: { select: { pickupDepot: { select: { slug: true } } } },
        },
      });
      if (bond) {
        await trackServer({
          event: SERVER_EVENTS.bondHeldUpdated,
          distinctId: bond.customerId,
          properties: {
            bookingId: bond.bookingId,
            heldAud: Number(bond.heldAmount),
          },
          groups: { depot: bond.booking.pickupDepot.slug },
        });
      }
      return;
    }
    case "payment_intent.payment_failed": {
      const parsed = parseEventObject(paymentIntentFailedSchema, obj, event.type);
      if (!parsed) return;
      const id = parsed.id;
      await prisma.payment.updateMany({
        where: { stripePaymentIntentId: id },
        data: { status: "FAILED" },
      });
      const failedPayments = await prisma.payment.findMany({
        where: { stripePaymentIntentId: id },
        select: {
          id: true,
          customerId: true,
          bookingId: true,
          amount: true,
          type: true,
          booking: { select: { pickupDepot: { select: { slug: true } } } },
        },
      });
      for (const p of failedPayments) {
        await writePaymentEvent(prisma, {
          paymentId: p.id,
          eventType: "STATUS_CHANGED",
          newStatus: "FAILED",
          source: "webhook",
          stripeEventId: event.id,
        }, { swallow: true });
        if (p.customerId) {
          await trackServer({
            event: SERVER_EVENTS.paymentFailed,
            distinctId: p.customerId,
            properties: {
              paymentId: p.id,
              bookingId: p.bookingId,
              amountAud: Number(p.amount),
              type: p.type,
            },
            ...(p.booking?.pickupDepot?.slug
              ? { groups: { depot: p.booking.pickupDepot.slug } }
              : {}),
          });
        }
      }
      // C3: transition any stuck PENDING_PAYMENT / QUOTE booking tied to
      // this intent to CANCELLED immediately. Avoids a pile of abandoned
      // bookings blocking the dashboards. We look up via the Payment row
      // because `stripePaymentIntentId` is the link between Stripe and
      // the booking.
      const affectedPayments = await prisma.payment.findMany({
        where: { stripePaymentIntentId: id, bookingId: { not: null } },
        select: { bookingId: true },
      });
      const bookingIds = affectedPayments
        .map((p) => p.bookingId)
        .filter((x): x is string => !!x);
      if (bookingIds.length > 0) {
        const stuck = await prisma.booking.findMany({
          where: {
            id: { in: bookingIds },
            status: { in: ["PENDING_PAYMENT", "QUOTE"] },
          },
          select: { id: true, status: true },
        });
        for (const b of stuck) {
          await prisma.booking.update({
            where: { id: b.id },
            data: {
              status: "CANCELLED",
              cancellationReason: "Payment failed",
              statusLog: {
                create: {
                  previousStatus: b.status,
                  newStatus: "CANCELLED",
                  reason: "Stripe payment_intent.payment_failed",
                },
              },
            },
          });
        }
      }
      return;
    }
    case "charge.refunded": {
      const parsed = parseEventObject(chargeRefundedSchema, obj, event.type);
      if (!parsed) return;
      const pi = parsed.payment_intent ?? undefined;
      const amountRefundedCents = parsed.amount_refunded ?? 0;
      const amountCents = parsed.amount ?? 0;
      const fullyRefunded = amountRefundedCents >= amountCents;
      if (pi) {
        await prisma.payment.updateMany({
          where: { stripePaymentIntentId: pi },
          data: { status: fullyRefunded ? "REFUNDED" : "PARTIALLY_REFUNDED" },
        });
        const payment = await prisma.payment.findFirst({
          where: { stripePaymentIntentId: pi, bookingId: { not: null } },
          select: {
            id: true,
            customerId: true,
            bookingId: true,
            booking: {
              select: { depotId: true, pickupDepot: { select: { slug: true } } },
            },
          },
        });
        if (payment?.id && amountRefundedCents > 0) {
          await writePaymentEvent(prisma, {
            paymentId: payment.id,
            eventType: "REFUNDED",
            newStatus: fullyRefunded ? "REFUNDED" : "PARTIALLY_REFUNDED",
            amountDelta: -amountRefundedCents / 100,
            source: "webhook",
            stripeEventId: event.id,
            data: { amountRefundedCents, fullyRefunded },
          }, { swallow: true });
          if (payment.customerId) {
            const depotSlug = payment.booking?.pickupDepot?.slug;
            await trackServer({
              event: SERVER_EVENTS.paymentRefunded,
              distinctId: payment.customerId,
              properties: {
                paymentId: payment.id,
                bookingId: payment.bookingId,
                amountRefundedAud: amountRefundedCents / 100,
                fullyRefunded,
                source: "stripe_webhook",
              },
              ...(depotSlug ? { groups: { depot: depotSlug } } : {}),
            });
          }
        }
        const depotId = payment?.booking?.depotId;
        if (depotId && amountRefundedCents > 0) {
          await prisma.$transaction(async (tx) => {
            await recordRefund(tx, {
              depotId,
              at: new Date(),
              amount: amountRefundedCents / 100,
            });
          });
          await invalidateRevenueCaches(depotId);
        }
      }
      return;
    }
    case "charge.dispute.created": {
      // G2 — dispute workflow. Flip Payment → DISPUTED, create a CHARGEBACK
      // Incident, and notify managers. Evidence compilation is a P1
      // deliverable (src/server/services/dispute-response.ts).
      const parsed = parseEventObject(chargeDisputeSchema, obj, event.type);
      if (!parsed) return;
      const pi = parsed.payment_intent ?? undefined;
      const disputeId = parsed.id;
      const reason = parsed.reason ?? "unknown";
      const disputeAmountCents = parsed.amount ?? 0;
      if (!pi) return;

      await prisma.payment.updateMany({
        where: { stripePaymentIntentId: pi },
        data: { status: "DISPUTED" },
      });
      const disputedRows = await prisma.payment.findMany({
        where: { stripePaymentIntentId: pi },
        select: { id: true },
      });
      for (const p of disputedRows) {
        await writePaymentEvent(prisma, {
          paymentId: p.id,
          eventType: "DISPUTED",
          newStatus: "DISPUTED",
          source: "webhook",
          stripeEventId: event.id,
          data: { disputeId, reason, disputeAmountCents },
        }, { swallow: true });
      }

      const payment = await prisma.payment.findFirst({
        where: { stripePaymentIntentId: pi },
        select: {
          id: true,
          bookingId: true,
          customerId: true,
          amount: true,
          booking: {
            select: {
              vehicleId: true,
              depotId: true,
              bookingReference: true,
              pickupDepot: { select: { slug: true } },
            },
          },
        },
      });
      if (!payment) return;

      // Create CHARGEBACK Incident (idempotent — keyed on incidentNumber
      // derived from dispute id so Stripe retries don't duplicate). Incident
      // requires a vehicleId; skip the row if we can't resolve one but still
      // notify managers so they can respond within the Stripe evidence
      // window. IncidentType has no CHARGEBACK member — we use OTHER + the
      // "CBK-" number prefix as the discriminator.
      const incidentNumber = `CBK-${disputeId}`;
      const existing = await prisma.incident.findFirst({
        where: { incidentNumber },
        select: { id: true },
      });
      let incidentId: string | undefined = existing?.id;
      const vehicleIdForIncident = payment.booking?.vehicleId ?? null;
      if (!existing && vehicleIdForIncident) {
        const incident = await prisma.incident.create({
          data: {
            incidentNumber,
            type: "OTHER",
            severity: "MODERATE",
            status: "UNDER_INVESTIGATION",
            dateTime: new Date(),
            description: `Stripe chargeback initiated. Reason: ${reason}. Payment ${payment.id}.`,
            customerId: payment.customerId ?? undefined,
            bookingId: payment.bookingId ?? undefined,
            vehicleId: vehicleIdForIncident,
            estimatedDamageCost: new Prisma.Decimal(disputeAmountCents / 100),
            customerLiable: false,
          },
        });
        incidentId = incident.id;
      }

      if (!existing) {
        await writePaymentAudit(prisma, {
          action: "dispute.created",
          entity: "Payment",
          entityId: payment.id,
          status: "SUCCESS",
          newData: {
            disputeId,
            reason,
            disputeAmountCents,
            incidentId,
            incidentNumber,
            bookingReference: payment.booking?.bookingReference,
            vehicleless: !vehicleIdForIncident,
          },
        });

        // Notify every MANAGER + ADMIN. Email is the canonical channel;
        // Twilio cost for every manager is not warranted.
        const managers = await prisma.user.findMany({
          where: { role: { in: ["MANAGER", "ADMIN", "SUPER_ADMIN"] }, status: "ACTIVE" },
          select: { id: true },
        });
        for (const m of managers) {
          await sendNotification({
            userId: m.id,
            type: "INCIDENT_REPORTED",
            channels: ["EMAIL", "IN_APP"],
            subject: `Chargeback received — ${payment.booking?.bookingReference ?? payment.id}`,
            title: "Stripe chargeback — action required",
            body: `A chargeback has been initiated on payment ${payment.id} (${payment.booking?.bookingReference ?? "no booking"}).\n\nReason: ${reason}\nDispute amount: A$${(disputeAmountCents / 100).toFixed(2)}\n\nSee docs/payments/runbook-dispute-response.md for response procedure. Target: respond within 5 business days.`,
            bookingId: payment.bookingId ?? undefined,
            data: { disputeId, incidentNumber, reason },
          });
        }

        if (payment.customerId) {
          const depotSlug = payment.booking?.pickupDepot?.slug;
          await trackServer({
            event: SERVER_EVENTS.paymentDisputed,
            distinctId: payment.customerId,
            properties: {
              paymentId: payment.id,
              bookingId: payment.bookingId,
              disputeId,
              reason,
              disputeAmountAud: disputeAmountCents / 100,
              incidentNumber,
            },
            ...(depotSlug ? { groups: { depot: depotSlug } } : {}),
          });
        }
      }
      return;
    }
    case "payment_intent.canceled": {
      const parsed = parseEventObject(paymentIntentFailedSchema, obj, event.type);
      if (!parsed) return;
      const id = parsed.id;
      const released = await prisma.bondLedger.updateMany({
        where: { stripePaymentIntentId: id, status: "HELD" },
        data: { status: "RELEASED", releasedAmount: new Prisma.Decimal(0) },
      });
      if (released.count > 0) {
        const bond = await prisma.bondLedger.findFirst({
          where: { stripePaymentIntentId: id },
          select: {
            bookingId: true,
            customerId: true,
            heldAmount: true,
            booking: { select: { pickupDepot: { select: { slug: true } } } },
          },
        });
        if (bond) {
          await trackServer({
            event: SERVER_EVENTS.bondReleased,
            distinctId: bond.customerId,
            properties: {
              bookingId: bond.bookingId,
              heldAud: Number(bond.heldAmount),
              source: "stripe_webhook",
            },
            groups: { depot: bond.booking.pickupDepot.slug },
          });
        }
      }
      return;
    }
    case "charge.refund.updated": {
      // Async refund lifecycle — Stripe can flip a just-created refund to
      // FAILED days later (rare but real). When that happens the source
      // Payment is no longer truly refunded, so revert it to SUCCEEDED and
      // alert managers to investigate. Our `REFUND` Payment row gets
      // flipped to FAILED so the ledger shows the reversal.
      const parsed = parseEventObject(refundUpdatedSchema, obj, event.type);
      if (!parsed) return;
      const refundStatus = parsed.status ?? "unknown";
      const failedReason = parsed.failure_reason ?? null;
      if (refundStatus !== "failed" && refundStatus !== "canceled") {
        // Most updates are succeeded/pending — no action needed.
        return;
      }
      const pi = parsed.payment_intent ?? null;
      if (!pi) return;
      // Flip the source payment back to SUCCEEDED and the REFUND row to
      // FAILED so the ledger reflects reality.
      await prisma.payment.updateMany({
        where: {
          stripePaymentIntentId: pi,
          type: { in: ["BOOKING_PAYMENT", "EXTENSION", "ADDON_CHARGE", "MANUAL_CHARGE"] },
          status: { in: ["REFUNDED", "PARTIALLY_REFUNDED"] },
        },
        data: { status: "SUCCEEDED" },
      });
      await prisma.payment.updateMany({
        where: {
          stripePaymentIntentId: pi,
          type: "REFUND",
          status: "SUCCEEDED",
        },
        data: { status: "FAILED", notes: `Async refund failure: ${failedReason ?? refundStatus}` },
      });
      // Notify managers so they can decide manual intervention vs retry.
      const managers = await prisma.user.findMany({
        where: { role: { in: ["MANAGER", "ADMIN", "SUPER_ADMIN"] }, status: "ACTIVE" },
        select: { id: true },
      });
      for (const m of managers) {
        await sendNotification({
          userId: m.id,
          type: "INCIDENT_REPORTED",
          channels: ["EMAIL", "IN_APP"],
          subject: `Stripe refund failed asynchronously (${parsed.id})`,
          title: "Refund failed after initial success",
          body: `Stripe reports refund ${parsed.id} moved to status "${refundStatus}"${
            failedReason ? ` — reason: ${failedReason}` : ""
          }. The source Payment has been restored to SUCCEEDED; please investigate and either retry the refund or compensate the customer manually.`,
          data: { refundId: parsed.id, paymentIntentId: pi, status: refundStatus, failedReason },
        });
      }
      await writePaymentAudit(prisma, {
        action: "refund.async_failure",
        entity: "Payment",
        entityId: pi,
        status: "FAILURE",
        errorCode: "REFUND_ASYNC_FAILED",
        newData: { refundId: parsed.id, status: refundStatus, failedReason },
      });
      return;
    }
    case "charge.dispute.funds_withdrawn":
    case "charge.dispute.funds_reinstated":
    case "charge.dispute.updated":
    case "charge.dispute.closed": {
      // Track dispute lifecycle so staff can see latest state without
      // hitting the Stripe dashboard. `charge.dispute.closed` also tells
      // us we won / lost — flip the Payment row appropriately.
      const parsed = parseEventObject(chargeDisputeUpdatedSchema, obj, event.type);
      if (!parsed) return;
      const pi = parsed.payment_intent ?? null;
      if (!pi) return;
      const disputeStatus = parsed.status ?? "unknown";
      const incidentNumber = `CBK-${parsed.id}`;
      const incident = await prisma.incident.findFirst({
        where: { incidentNumber },
        select: {
          id: true,
          bookingId: true,
          customerId: true,
          booking: { select: { pickupDepot: { select: { slug: true } } } },
        },
      });
      if (!incident) {
        logger.info(
          { eventType: event.type, disputeId: parsed.id },
          "dispute update for unknown incident — skipping",
        );
        return;
      }
      let incidentStatus: "UNDER_INVESTIGATION" | "RESOLVED" | "CLOSED" = "UNDER_INVESTIGATION";
      let paymentStatus: "DISPUTED" | "FAILED" | "SUCCEEDED" = "DISPUTED";
      if (event.type === "charge.dispute.closed") {
        // Stripe dispute.status values at close: "won" | "lost" | "warning_closed"
        if (disputeStatus === "won" || disputeStatus === "warning_closed") {
          incidentStatus = "RESOLVED";
          paymentStatus = "SUCCEEDED";
        } else if (disputeStatus === "lost") {
          incidentStatus = "CLOSED";
          paymentStatus = "FAILED";
        }
      }
      await prisma.incident.update({
        where: { id: incident.id },
        data: {
          status: incidentStatus,
          resolution: `Stripe dispute ${disputeStatus}`,
          resolvedAt: event.type === "charge.dispute.closed" ? new Date() : undefined,
        },
      });
      if (event.type === "charge.dispute.closed") {
        await prisma.payment.updateMany({
          where: { stripePaymentIntentId: pi, status: "DISPUTED" },
          data: { status: paymentStatus },
        });
      }
      await writeAudit(prisma, {
        action: event.type.replace(/\./g, "_"),
        entity: "Incident",
        entityId: incident.id,
        status: "SUCCESS",
        newData: { disputeId: parsed.id, disputeStatus, paymentIntentId: pi },
      });
      const disputeEventByType: Record<string, string> = {
        "charge.dispute.funds_withdrawn": SERVER_EVENTS.disputeFundsWithdrawn,
        "charge.dispute.funds_reinstated": SERVER_EVENTS.disputeFundsReinstated,
        "charge.dispute.updated": SERVER_EVENTS.disputeUpdated,
        "charge.dispute.closed": SERVER_EVENTS.disputeClosed,
      };
      const disputeEvent = disputeEventByType[event.type];
      if (disputeEvent && incident.customerId) {
        const depotSlug = incident.booking?.pickupDepot?.slug;
        await trackServer({
          event: disputeEvent,
          distinctId: incident.customerId,
          properties: {
            incidentId: incident.id,
            bookingId: incident.bookingId,
            disputeId: parsed.id,
            disputeStatus,
          },
          ...(depotSlug ? { groups: { depot: depotSlug } } : {}),
        });
      }
      return;
    }
    case "payment_method.attached":
    case "payment_method.updated":
    case "payment_method.automatically_updated": {
      // Keep CustomerProfile.stripePaymentMethod* in sync. The Stripe Card
      // Updater service fires `automatically_updated` when an issuer
      // reissues a card — we want to log it and refresh the exp date so
      // the card-expiry sweep job doesn't flag the old expiry.
      const parsed = parseEventObject(paymentMethodSchema, obj, event.type);
      if (!parsed?.customer || parsed.type !== "card" || !parsed.card) return;
      await prisma.customerProfile.updateMany({
        where: { stripeCustomerId: parsed.customer },
        data: {
          defaultStripePaymentMethodId: parsed.id,
          stripePaymentMethodBrand: parsed.card.brand ?? null,
          stripePaymentMethodLast4: parsed.card.last4 ?? null,
          stripePaymentMethodExpMonth: parsed.card.exp_month ?? null,
          stripePaymentMethodExpYear: parsed.card.exp_year ?? null,
        },
      });
      await writeAudit(prisma, {
        action: event.type.replace(/\./g, "_"),
        entity: "CustomerProfile",
        entityId: parsed.id,
        status: "SUCCESS",
        newData: {
          stripeCustomerId: parsed.customer,
          paymentMethodId: parsed.id,
          expMonth: parsed.card.exp_month,
          expYear: parsed.card.exp_year,
        },
      });
      return;
    }
    case "payment_method.detached": {
      // Customer (or Stripe) detached a card from the Customer. Clear
      // stored PM so subsequent off-session charges don't try to reuse
      // a PM that no longer exists.
      const parsed = parseEventObject(paymentMethodSchema, obj, event.type);
      if (!parsed) return;
      // `customer` is null on a detached PM — match by PM id.
      await prisma.customerProfile.updateMany({
        where: { defaultStripePaymentMethodId: parsed.id },
        data: {
          defaultStripePaymentMethodId: null,
          stripePaymentMethodBrand: null,
          stripePaymentMethodLast4: null,
          stripePaymentMethodExpMonth: null,
          stripePaymentMethodExpYear: null,
        },
      });
      await writeAudit(prisma, {
        action: "payment_method_detached",
        entity: "CustomerProfile",
        entityId: parsed.id,
        status: "SUCCESS",
        newData: { paymentMethodId: parsed.id },
      });
      return;
    }
    case "identity.verification_session.verified": {
      const parsed = parseEventObject(identityVerifiedSchema, obj, event.type);
      const customerId = parsed?.metadata?.customerId;
      if (customerId) {
        await prisma.customerProfile.updateMany({
          where: { userId: customerId },
          data: { licenceVerifiedAt: new Date() },
        });
        await trackServer({
          event: SERVER_EVENTS.identityVerified,
          distinctId: customerId,
          properties: { source: "stripe_identity" },
        });
      }
      return;
    }
    case "identity.verification_session.requires_input": {
      logger.info({ eventId: event.id }, "identity verification requires more input");
      const parsed = parseEventObject(identityVerifiedSchema, obj, event.type);
      const customerId = parsed?.metadata?.customerId;
      if (customerId) {
        await trackServer({
          event: SERVER_EVENTS.identityRequiresInput,
          distinctId: customerId,
          properties: { source: "stripe_identity" },
        });
      }
      return;
    }
    default:
      logger.info({ type: event.type, id: event.id }, "stripe webhook: unhandled event type");
  }
}
