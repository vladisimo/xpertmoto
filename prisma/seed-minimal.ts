// Dev-only minimal seed. Hardcoded password — never use in prod.
// Inserts a single SUPER_ADMIN and nothing else. Paired with
// `prisma migrate reset --force --skip-seed` via `npm run db:reset`.

import { PrismaClient, UserRole, UserStatus } from "@prisma/client";
import bcrypt from "bcryptjs";

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
