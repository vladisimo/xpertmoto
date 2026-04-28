import { PrismaClient } from "@prisma/client";
const prisma = new PrismaClient();

async function main() {
  const email = process.argv[2];
  if (!email) throw new Error("usage: tsx scripts/inspect-user.ts <email>");

  const user = await prisma.user.findUnique({
    where: { email },
    select: {
      id: true, email: true, firstName: true, lastName: true,
      role: true, status: true, deletedAt: true, createdAt: true,
    },
  });
  if (!user) { console.log("No user found for", email); return; }
  console.log("USER:", user);

  const [bookings, payments, invoices, bonds, incidents, docs] = await Promise.all([
    prisma.booking.groupBy({ by: ["status"], where: { customerId: user.id }, _count: true }),
    prisma.payment.count({ where: { customerId: user.id } }),
    prisma.invoice.groupBy({ by: ["status"], where: { customerId: user.id }, _count: true }),
    prisma.bondLedger.groupBy({ by: ["status"], where: { customerId: user.id }, _count: true }),
    prisma.incident.count({ where: { customerId: user.id } }),
    prisma.customerDocument.count({ where: { customerId: user.id } }),
  ]);
  console.log("BOOKINGS BY STATUS:", bookings);
  console.log("PAYMENTS:", payments);
  console.log("INVOICES BY STATUS:", invoices);
  console.log("BONDS BY STATUS:", bonds);
  console.log("INCIDENTS:", incidents);
  console.log("CUSTOMER DOCS:", docs);
}
main().catch((e) => { console.error(e); process.exit(1); }).finally(() => prisma.$disconnect());
