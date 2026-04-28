import type { PrismaClient } from "@prisma/client";
import type { prisma as extendedPrisma } from "@/lib/prisma";
import { writeAudit, type AuditEntry } from "./audit";

/**
 * Accept both the raw `@prisma/client` PrismaClient and the extended
 * `@/lib/prisma` client (which has a different type due to `$extends`).
 * The pre-existing `writeAudit` helper only types the raw client; this
 * widens the accepted input so callers using `@/lib/prisma` typecheck
 * cleanly. At runtime both shapes expose the `.auditLog.create` surface
 * that `writeAudit` actually uses.
 */
type AuditablePrisma = PrismaClient | typeof extendedPrisma;

/**
 * Payment-specific audit wrapper.
 *
 * Standardises how payment-mutating code paths record their side-effects so
 * that Finance / Security can filter AuditLog by `entity IN ('Payment',
 * 'BondLedger','Invoice','StripeWebhookEvent','DamageCharge','Infringement')`
 * and see a uniform before/after trail. Use from:
 *   - tRPC mutations that create or mutate Payment / BondLedger / DamageCharge
 *   - the Stripe webhook route
 *   - BullMQ jobs that capture or retry payments
 *
 * G13 (Phase 4 P0). Existing mutations in booking/staff-booking/fleet still
 * rely on the default auto-audit middleware — they will be swept to this
 * helper in a P1 follow-up.
 */
export type PaymentAuditEntry = Omit<AuditEntry, "entity" | "category"> & {
  entity:
    | "Payment"
    | "BondLedger"
    | "Invoice"
    | "CreditNote"
    | "DamageCharge"
    | "Infringement"
    | "StripeWebhookEvent";
};

export async function writePaymentAudit(
  prisma: AuditablePrisma,
  entry: PaymentAuditEntry,
): Promise<void> {
  await writeAudit(prisma as PrismaClient, { ...entry, category: "MUTATION" });
}
