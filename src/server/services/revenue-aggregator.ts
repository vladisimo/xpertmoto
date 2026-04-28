import { Prisma } from "@prisma/client";
import type { Prisma as P } from "@prisma/client";
import { invalidateTag } from "@/lib/cache";
import { CACHE_TAGS } from "@/lib/cache-tags";

type Tx = P.TransactionClient;

function utcDay(d: Date): Date {
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
}

type RevenueDelta = {
  date: Date;
  depotId: string;
  bookingRevenue?: P.Decimal | number;
  addonRevenue?: P.Decimal | number;
  damageRevenue?: P.Decimal | number;
  lateFeesRevenue?: P.Decimal | number;
  totalRevenue?: P.Decimal | number;
  totalGst?: P.Decimal | number;
  totalRefunds?: P.Decimal | number;
  netRevenue?: P.Decimal | number;
};

function toDecimal(v: P.Decimal | number | undefined): P.Decimal {
  if (v == null) return new Prisma.Decimal(0);
  return v instanceof Prisma.Decimal ? v : new Prisma.Decimal(v);
}

export async function applyRevenueDelta(tx: Tx, delta: RevenueDelta): Promise<void> {
  const date = utcDay(delta.date);
  const booking = toDecimal(delta.bookingRevenue);
  const addon = toDecimal(delta.addonRevenue);
  const damage = toDecimal(delta.damageRevenue);
  const lateFees = toDecimal(delta.lateFeesRevenue);
  const total = toDecimal(delta.totalRevenue);
  const gst = toDecimal(delta.totalGst);
  const refunds = toDecimal(delta.totalRefunds);
  const net = toDecimal(delta.netRevenue);

  await tx.dailyRevenue.upsert({
    where: { date_depotId: { date, depotId: delta.depotId } },
    create: {
      date,
      depotId: delta.depotId,
      bookingRevenue: booking,
      addonRevenue: addon,
      damageRevenue: damage,
      lateFeesRevenue: lateFees,
      totalRevenue: total,
      totalGst: gst,
      totalRefunds: refunds,
      netRevenue: net,
    },
    update: {
      bookingRevenue: { increment: booking },
      addonRevenue: { increment: addon },
      damageRevenue: { increment: damage },
      lateFeesRevenue: { increment: lateFees },
      totalRevenue: { increment: total },
      totalGst: { increment: gst },
      totalRefunds: { increment: refunds },
      netRevenue: { increment: net },
    },
  });
}

type BookingCompletionInput = {
  id: string;
  customerId: string;
  depotId: string;
  actualReturnDateTime: Date | null;
  subtotal: P.Decimal;
  addonTotal: P.Decimal;
  gstAmount: P.Decimal;
  totalAmount: P.Decimal;
};

export async function recordBookingCompletion(
  tx: Tx,
  booking: BookingCompletionInput,
): Promise<void> {
  const when = booking.actualReturnDateTime ?? new Date();
  await applyRevenueDelta(tx, {
    date: when,
    depotId: booking.depotId,
    bookingRevenue: booking.subtotal,
    addonRevenue: booking.addonTotal,
    totalRevenue: booking.totalAmount,
    totalGst: booking.gstAmount,
    netRevenue: booking.totalAmount,
  });

  await tx.customerProfile.updateMany({
    where: { userId: booking.customerId },
    data: {
      totalBookings: { increment: 1 },
      completedBookings: { increment: 1 },
      totalSpend: { increment: booking.totalAmount },
      lastBookingAt: when,
    },
  });
}

type AdditionalChargesInput = {
  depotId: string;
  at: Date;
  damageAmount?: P.Decimal | number;
  lateFeeAmount?: P.Decimal | number;
  fuelChargeAmount?: P.Decimal | number;
};

export async function recordAdditionalCharges(
  tx: Tx,
  input: AdditionalChargesInput,
): Promise<void> {
  const damage = toDecimal(input.damageAmount);
  const lateFee = toDecimal(input.lateFeeAmount);
  const fuel = toDecimal(input.fuelChargeAmount);
  const total = damage.add(lateFee).add(fuel);
  if (total.equals(0)) return;
  await applyRevenueDelta(tx, {
    date: input.at,
    depotId: input.depotId,
    damageRevenue: damage,
    lateFeesRevenue: lateFee.add(fuel),
    totalRevenue: total,
    netRevenue: total,
  });
}

export async function invalidateRevenueCaches(depotId: string | null | undefined): Promise<void> {
  await invalidateTag(CACHE_TAGS.DASHBOARD(depotId ?? null));
  await invalidateTag(CACHE_TAGS.DASHBOARD(null));
}

export async function recordIncidentForCustomer(
  tx: Tx,
  customerId: string | null | undefined,
): Promise<void> {
  if (!customerId) return;
  await tx.customerProfile.updateMany({
    where: { userId: customerId },
    data: { incidentCount: { increment: 1 } },
  });
}

type RefundInput = {
  depotId: string;
  at: Date;
  amount: P.Decimal | number;
};

export async function recordRefund(tx: Tx, input: RefundInput): Promise<void> {
  const amount = toDecimal(input.amount);
  if (amount.equals(0)) return;
  await applyRevenueDelta(tx, {
    date: input.at,
    depotId: input.depotId,
    totalRefunds: amount,
    netRevenue: amount.negated(),
  });
}
