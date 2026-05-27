/**
 * One-shot: recompute the denormalized CustomerProfile reward counters
 * (totalSpend, totalBookings, loyaltyPoints, tier) for a single customer.
 * Idempotent. Normally maintained by the nightly rewards-recompute job +
 * booking-completion/no-show triggers; this corrects a profile whose only
 * bookings are in-flight (CONFIRMED/ACTIVE) and so never triggered a recompute.
 *
 * Usage: tsx scripts/recompute-rewards-once.ts <userId>
 */
import { PrismaClient } from "@prisma/client";

import { recomputeCustomerRewards } from "@/server/services/customer-rewards";

const prisma = new PrismaClient();

async function main() {
  const userId = process.argv[2];
  if (!userId) throw new Error("usage: recompute-rewards-once.ts <userId>");
  const snap = await recomputeCustomerRewards(prisma, userId);
  console.log(
    `${userId}\n  bookings=${snap.totalBookings} (completed=${snap.completedBookings})` +
      `\n  spend=$${snap.totalSpend.toFixed(2)}` +
      `\n  loyaltyPoints=${snap.loyaltyPoints} (lifetime=${snap.lifetimePoints}, tier=${snap.loyaltyTier})`,
  );
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
