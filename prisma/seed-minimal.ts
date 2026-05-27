// Dev-only minimal seed. Hardcoded password — never use in prod.
// Inserts a single SUPER_ADMIN and nothing else. Paired with
// `prisma migrate reset --force --skip-seed` via `npm run db:reset`.

import { PrismaClient, UserRole, UserStatus } from "@prisma/client";
import bcrypt from "bcryptjs";
import { buildOnboardingVersion } from "../src/lib/onboarding-status";

const prisma = new PrismaClient();

const ADMIN_EMAIL = "vladisimo@gmail.com";
const ADMIN_PASSWORD = "6qv384sx";

async function main() {
  const passwordHash = await bcrypt.hash(ADMIN_PASSWORD, 10);

  await prisma.user.create({
    data: {
      email: ADMIN_EMAIL,
      firstName: "Vlad",
      lastName: "Stanculescu",
      role: UserRole.SUPER_ADMIN,
      status: UserStatus.ACTIVE,
      passwordHash,
      dateOfBirth: new Date(1985, 0, 15),
      // Back-office users carry a CustomerProfile so they can rent. Seed it
      // fully onboarded + licence-verified so the dev login can immediately
      // exercise the customer portal.
      customerProfile: {
        create: {
          onboardedAt: new Date(),
          onboardingVersion: buildOnboardingVersion(),
          termsAcceptedAt: new Date(),
          privacyAcceptedAt: new Date(),
          licenceNumber: "90000000",
          licenceState: "QLD",
          licenceClass: "C",
          licenceExpiry: new Date(2030, 5, 1),
          licenceVerifiedAt: new Date(),
          addressLine1: "1 Admin St",
          suburb: "Surfers Paradise",
          state: "QLD",
          postcode: "4217",
        },
      },
    },
  });

  console.log(`Seeded SUPER_ADMIN ${ADMIN_EMAIL} / ${ADMIN_PASSWORD}`);
}

main()
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
