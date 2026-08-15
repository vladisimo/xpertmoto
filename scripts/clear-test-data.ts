import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

const KEEP_EMAILS = [
  "admin@xpertmoto.com.au",
  "manager.gold-coast@xpertmoto.com.au",
  "staff.gold-coast@xpertmoto.com.au",
  "sarah.smith@example.com",
];

async function main() {
  console.log("🧹 Clearing test data, keeping:", KEEP_EMAILS.join(", "));

  await prisma.$transaction([
    // Operational data — wipe everything
    // DamageCharge must go BEFORE Incident: the DamageCharge_parent_chk DB
    // CHECK requires a returnAssessment OR incident parent, and the
    // incident FK is onDelete: SetNull — deleting an incident whose charge
    // has no return-assessment parent would orphan the row and violate the
    // CHECK mid-transaction.
    prisma.damageCharge.deleteMany(),
    prisma.bookingAddon.deleteMany(),
    prisma.bookingInsurance.deleteMany(),
    prisma.bookingNote.deleteMany(),
    prisma.bookingStatusLog.deleteMany(),
    prisma.payment.deleteMany(),
    prisma.creditNote.deleteMany(),
    prisma.invoice.deleteMany(),
    prisma.bondLedger.deleteMany(),
    prisma.dailyRevenue.deleteMany(),
    prisma.booking.deleteMany(),

    prisma.inspectionPhoto.deleteMany(),
    prisma.inspectionItem.deleteMany(),
    prisma.inspection.deleteMany(),

    prisma.maintenancePart.deleteMany(),
    prisma.maintenanceLog.deleteMany(),
    prisma.maintenanceWorkOrder.deleteMany(),
    prisma.maintenanceSchedule.deleteMany(),

    prisma.incidentPhoto.deleteMany(),
    prisma.incidentDocument.deleteMany(),
    prisma.incidentNote.deleteMany(),
    prisma.incident.deleteMany(),
    prisma.infringement.deleteMany(),

    prisma.vehicleImage.deleteMany(),
    prisma.vehicleDocument.deleteMany(),
    prisma.vehicleStatusLog.deleteMany(),
    prisma.vehicleTransfer.deleteMany(),
    prisma.vehicle.deleteMany(),

    prisma.notification.deleteMany(),
    prisma.communicationLog.deleteMany(),
    prisma.auditLog.deleteMany(),

    // Discounts (test ones)
    prisma.discount.deleteMany(),

    // Non-essential users
    prisma.customerProfile.deleteMany({ where: { user: { email: { notIn: KEEP_EMAILS } } } }),
    prisma.staffProfile.deleteMany({ where: { user: { email: { notIn: KEEP_EMAILS } } } }),
    prisma.account.deleteMany({ where: { user: { email: { notIn: KEEP_EMAILS } } } }),
    prisma.session.deleteMany({ where: { user: { email: { notIn: KEEP_EMAILS } } } }),
    prisma.user.deleteMany({ where: { email: { notIn: KEEP_EMAILS } } }),
  ]);

  const counts = {
    users: await prisma.user.count(),
    depots: await prisma.depot.count(),
    categories: await prisma.vehicleCategory.count(),
    vehicles: await prisma.vehicle.count(),
    bookings: await prisma.booking.count(),
    addons: await prisma.addon.count(),
    insurance: await prisma.insuranceOption.count(),
    seasons: await prisma.season.count(),
  };
  console.log("✅ Done. Remaining:");
  console.table(counts);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
