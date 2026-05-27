/**
 * Reconcile CustomerProfile rewards counters to the agreed semantics:
 *   - totalSpend       = net money actually collected (SUCCEEDED − refunds,
 *                        excl. bond holds) across all non-cancelled bookings
 *   - completedBookings = COMPLETED count
 *   - totalBookings    = completed + in-flight (current) bookings
 *   - lifetimePoints   = floor(spend × pointsPerDollar) + ledger bonuses
 *   - loyaltyPoints    = lifetimePoints − burns/expiries
 *   - loyaltyTier      = tier for lifetime points
 *
 * This recomputes from source ledgers via the customer-rewards service (the
 * same code the nightly job and completion/no-show hooks use), so a no-show's
 * retained fees and in-flight bookings are reflected. Supersedes the earlier
 * reconcile-customer-aggregates.ts (completed-totalAmount basis).
 *
 * Usage:
 *   npx tsx scripts/reconcile-customer-rewards.ts          # dry-run report
 *   npx tsx scripts/reconcile-customer-rewards.ts --apply  # write corrections
 *
 * --apply updates each drifted profile and writes an AuditLog row
 * (action: customer.rewards_backfill). Idempotent.
 */
import { PrismaClient, Prisma } from "@prisma/client";
import { computeCustomerRewards } from "../src/server/services/customer-rewards";

const prisma = new PrismaClient();
const apply = process.argv.includes("--apply");

async function main(): Promise<void> {
  // Candidates: anyone with a booking or a loyalty-ledger entry. Everyone
  // else is all-zero and already correct.
  const [bookingCustomers, ledgerUsers] = await Promise.all([
    prisma.booking.findMany({ distinct: ["customerId"], select: { customerId: true } }),
    prisma.loyaltyLedger.findMany({ distinct: ["userId"], select: { userId: true } }),
  ]);
  const ids = new Set<string>();
  for (const b of bookingCustomers) ids.add(b.customerId);
  for (const l of ledgerUsers) ids.add(l.userId);

  const drifted: {
    userId: string;
    email: string | null;
    before: { spend: number; bookings: number; points: number; tier: string };
    after: { spend: number; bookings: number; points: number; tier: string };
  }[] = [];

  for (const userId of ids) {
    const profile = await prisma.customerProfile.findUnique({
      where: { userId },
      select: {
        totalSpend: true,
        totalBookings: true,
        completedBookings: true,
        lastBookingAt: true,
        lifetimePoints: true,
        loyaltyPoints: true,
        loyaltyTier: true,
        user: { select: { email: true } },
      },
    });
    if (!profile) continue; // staff/admin users have no customer profile

    const snap = await computeCustomerRewards(prisma, userId);
    const changed =
      !profile.totalSpend.equals(snap.totalSpend) ||
      profile.totalBookings !== snap.totalBookings ||
      profile.completedBookings !== snap.completedBookings ||
      profile.lifetimePoints !== snap.lifetimePoints ||
      profile.loyaltyPoints !== snap.loyaltyPoints ||
      profile.loyaltyTier !== snap.loyaltyTier ||
      (profile.lastBookingAt?.getTime() ?? null) !== (snap.lastBookingAt?.getTime() ?? null);

    if (!changed) continue;

    drifted.push({
      userId,
      email: profile.user?.email ?? null,
      before: {
        spend: profile.totalSpend.toNumber(),
        bookings: profile.totalBookings,
        points: profile.lifetimePoints,
        tier: profile.loyaltyTier,
      },
      after: {
        spend: snap.totalSpend.toNumber(),
        bookings: snap.totalBookings,
        points: snap.lifetimePoints,
        tier: snap.loyaltyTier,
      },
    });

    if (apply) {
      await prisma.$transaction(async (tx) => {
        await tx.customerProfile.updateMany({
          where: { userId },
          data: {
            totalSpend: snap.totalSpend,
            totalBookings: snap.totalBookings,
            completedBookings: snap.completedBookings,
            lastBookingAt: snap.lastBookingAt,
            lifetimePoints: snap.lifetimePoints,
            loyaltyPoints: snap.loyaltyPoints,
            loyaltyTier: snap.loyaltyTier,
          },
        });
        await tx.auditLog.create({
          data: {
            action: "customer.rewards_backfill",
            entity: "CustomerProfile",
            entityId: userId,
            previousData: {
              totalSpend: profile.totalSpend.toFixed(2),
              totalBookings: profile.totalBookings,
              completedBookings: profile.completedBookings,
              lifetimePoints: profile.lifetimePoints,
              loyaltyPoints: profile.loyaltyPoints,
              loyaltyTier: profile.loyaltyTier,
            },
            newData: {
              totalSpend: snap.totalSpend.toFixed(2),
              totalBookings: snap.totalBookings,
              completedBookings: snap.completedBookings,
              lifetimePoints: snap.lifetimePoints,
              loyaltyPoints: snap.loyaltyPoints,
              loyaltyTier: snap.loyaltyTier,
              reason:
                "Recomputed rewards from source ledgers (net-collected spend, all-collected-money points, completed+current bookings).",
            } as Prisma.InputJsonValue,
          },
        });
      });
    }
  }

  console.log(`Scanned ${ids.size} candidate customers.`);
  console.log(`Drifted: ${drifted.length}\n`);
  for (const d of drifted.slice(0, 50)) {
    console.log(
      `  ${(d.email ?? d.userId).padEnd(34)} ` +
        `spend $${d.before.spend.toFixed(2)}→$${d.after.spend.toFixed(2)}  ` +
        `bookings ${d.before.bookings}→${d.after.bookings}  ` +
        `points ${d.before.points}→${d.after.points}  ` +
        `tier ${d.before.tier}→${d.after.tier}`,
    );
  }
  if (drifted.length > 50) console.log(`  … and ${drifted.length - 50} more.`);

  if (!apply && drifted.length > 0) {
    console.log("\nDry run — nothing written. Re-run with --apply to correct.");
  } else if (apply) {
    console.log(`\nApplied ${drifted.length} correction(s).`);
  }
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
