import { PrismaClient } from "@prisma/client";
import { anonymiseUser } from "@/server/services/anonymise-user";

const prisma = new PrismaClient();

async function main() {
  const email = process.argv[2];
  const reason = process.argv[3] ?? "Manual admin deletion (one-off script)";
  if (!email) throw new Error("usage: tsx scripts/anonymise-user.ts <email> [reason]");

  const user = await prisma.user.findUnique({
    where: { email },
    select: { id: true, email: true, role: true, deletedAt: true },
  });
  if (!user) { console.error("No user found for", email); process.exit(1); }
  if (user.deletedAt) { console.error("Already deleted:", email); process.exit(1); }

  console.log("Anonymising", user.email, `(${user.role}, id=${user.id})`);
  await anonymiseUser(prisma, user.id, { reason });
  console.log("Done.");
}
main().catch((e) => { console.error(e); process.exit(1); }).finally(() => prisma.$disconnect());
