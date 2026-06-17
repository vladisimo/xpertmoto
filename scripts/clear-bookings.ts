/**
 * Wipe all booking-derived data and reset customer/vehicle counters back to a
 * fresh-fleet state, while preserving users, customer master data, vehicles,
 * pricing, and system settings. Generated PDFs and signature/photo blobs are
 * also removed from S3/MinIO.
 *
 * Run: `npm run db:clear-bookings`
 */
import { PrismaClient, VehicleStatus } from "@prisma/client";
import { deleteFile } from "@/lib/storage";

const prisma = new PrismaClient();

type S3Env = { publicUrl?: string; endpoint?: string; bucket: string };

function getS3Env(): S3Env {
  return {
    publicUrl: process.env.S3_PUBLIC_URL,
    endpoint: process.env.S3_ENDPOINT,
    bucket: process.env.S3_BUCKET ?? "xpertmoto",
  };
}

/**
 * Normalise any URL/key value held in the DB to the bare bucket key that
 * `deleteFile()` expects. Handles all four shapes we ever write:
 *   - bare key:        "invoices/<uuid>.pdf"
 *   - local fallback:  "/uploads/invoices/<uuid>.pdf"
 *   - public URL:      "<S3_PUBLIC_URL>/invoices/<uuid>.pdf"
 *   - endpoint URL:    "<S3_ENDPOINT>/<bucket>/invoices/<uuid>.pdf"
 * Returns null for inputs that aren't ours (data: URLs, external CDNs).
 */
function toBucketKey(value: string | null | undefined, env: S3Env): string | null {
  if (!value) return null;
  if (value.startsWith("data:")) return null;

  if (value.startsWith("/uploads/")) {
    return value.slice("/uploads/".length);
  }

  if (env.publicUrl) {
    const base = env.publicUrl.replace(/\/$/, "");
    if (value.startsWith(base + "/")) return value.slice(base.length + 1);
  }
  if (env.endpoint) {
    const base = `${env.endpoint.replace(/\/$/, "")}/${env.bucket}`;
    if (value.startsWith(base + "/")) return value.slice(base.length + 1);
  }

  if (value.startsWith("http://") || value.startsWith("https://")) {
    return null;
  }

  return value;
}

async function collectStorageKeys(env: S3Env): Promise<Set<string>> {
  const keys = new Set<string>();
  const add = (v: string | null | undefined) => {
    const k = toBucketKey(v, env);
    if (k) keys.add(k);
  };

  const [
    invoices,
    adjustments,
    rentalAgreements,
    returnAssessments,
    inspections,
    inspectionPhotos,
    bookingSwaps,
    incidentPhotos,
    incidentDocuments,
    damageCharges,
    bookings,
  ] = await Promise.all([
    prisma.invoice.findMany({ select: { pdfKey: true, pdfUrl: true } }),
    prisma.adjustmentNote.findMany({ select: { pdfKey: true, pdfUrl: true } }),
    prisma.rentalAgreement.findMany({
      select: {
        pdfKey: true,
        pdfUrl: true,
        customerSignatureUrl: true,
        customerInitialsUrl: true,
        staffSignatureUrl: true,
        timestampTsaUrl: true,
      },
    }),
    prisma.returnAssessment.findMany({
      select: {
        pdfKey: true,
        pdfUrl: true,
        customerSignatureUrl: true,
        customerInitialsUrl: true,
        staffSignatureUrl: true,
        timestampTsaUrl: true,
      },
    }),
    prisma.inspection.findMany({
      select: { customerSignatureUrl: true, staffSignatureUrl: true },
    }),
    prisma.inspectionPhoto.findMany({ select: { url: true } }),
    prisma.bookingSwap.findMany({
      select: {
        documentUrl: true,
        customerSignatureUrl: true,
        staffSignatureUrl: true,
      },
    }),
    prisma.incidentPhoto.findMany({ select: { url: true } }),
    prisma.incidentDocument.findMany({ select: { fileUrl: true } }),
    prisma.damageCharge.findMany({ select: { photoUrls: true } }),
    prisma.booking.findMany({ select: { signatureUrl: true } }),
  ]);

  for (const r of invoices) {
    add(r.pdfKey);
    if (!r.pdfKey) add(r.pdfUrl);
  }
  for (const r of adjustments) {
    add(r.pdfKey);
    if (!r.pdfKey) add(r.pdfUrl);
  }
  for (const r of rentalAgreements) {
    add(r.pdfKey);
    if (!r.pdfKey) add(r.pdfUrl);
    add(r.customerSignatureUrl);
    add(r.customerInitialsUrl);
    add(r.staffSignatureUrl);
    add(r.timestampTsaUrl);
  }
  for (const r of returnAssessments) {
    add(r.pdfKey);
    if (!r.pdfKey) add(r.pdfUrl);
    add(r.customerSignatureUrl);
    add(r.customerInitialsUrl);
    add(r.staffSignatureUrl);
    add(r.timestampTsaUrl);
  }
  for (const r of inspections) {
    add(r.customerSignatureUrl);
    add(r.staffSignatureUrl);
  }
  for (const r of inspectionPhotos) add(r.url);
  for (const r of bookingSwaps) {
    add(r.documentUrl);
    add(r.customerSignatureUrl);
    add(r.staffSignatureUrl);
  }
  for (const r of incidentPhotos) add(r.url);
  for (const r of incidentDocuments) add(r.fileUrl);
  for (const r of damageCharges) {
    for (const u of r.photoUrls) add(u);
  }
  for (const r of bookings) add(r.signatureUrl);

  return keys;
}

async function wipeDatabase() {
  // Order matters: every model with `onDelete: Restrict` to a row we're about
  // to delete must be cleared first. Verified against prisma/schema.prisma.
  return prisma.$transaction([
    prisma.rentalAgreement.deleteMany(),
    prisma.damageCharge.deleteMany(),
    prisma.returnAssessment.deleteMany(),
    prisma.bookingSwap.deleteMany(),
    prisma.creditNote.deleteMany(),
    prisma.adjustmentNote.deleteMany(),
    prisma.bondLedger.deleteMany(),
    prisma.paymentEvent.deleteMany(),
    prisma.payment.deleteMany(),
    prisma.invoice.deleteMany(),

    prisma.inspectionPhoto.deleteMany(),
    prisma.inspectionItem.deleteMany(),
    prisma.inspection.deleteMany(),

    prisma.incidentPhoto.deleteMany(),
    prisma.incidentDocument.deleteMany(),
    prisma.incidentNote.deleteMany(),
    prisma.incident.deleteMany(),

    prisma.linktUnmatchedRow.deleteMany(),
    prisma.linktSync.deleteMany(),
    prisma.infringement.deleteMany(),

    prisma.review.deleteMany(),
    prisma.loyaltyLedger.deleteMany(),
    prisma.referral.deleteMany(),

    prisma.speedEvent.deleteMany(),
    prisma.zoneEvent.deleteMany(),
    prisma.rentalZone.deleteMany(),
    prisma.serviceDispatch.deleteMany(),

    prisma.partnerTransaction.deleteMany(),
    prisma.giftCardTransaction.deleteMany(),

    prisma.bookingBillingPlan.deleteMany(),
    prisma.bookingAddon.deleteMany(),
    prisma.bookingInsurance.deleteMany(),
    prisma.bookingNote.deleteMany(),
    prisma.bookingStatusLog.deleteMany(),
    prisma.booking.deleteMany(),

    prisma.maintenanceLog.deleteMany(),
    prisma.maintenancePart.deleteMany(),
    prisma.maintenanceWorkOrder.deleteMany(),

    prisma.vehicleStatusLog.deleteMany(),
    prisma.vehicleTelemetry.deleteMany(),

    prisma.notification.deleteMany(),
    prisma.communicationLog.deleteMany(),
    prisma.pushSubscription.deleteMany(),

    prisma.dailyRevenue.deleteMany(),
    prisma.priceRecommendation.deleteMany(),
    prisma.demandEvent.deleteMany(),

    prisma.visitorPageView.deleteMany(),
    prisma.visitorEvent.deleteMany(),
    prisma.visitorSession.deleteMany(),
    prisma.analyticsFunnel.deleteMany(),
    prisma.analyticsAlert.deleteMany(),

    prisma.supportFeedback.deleteMany(),
    prisma.supportCostLog.deleteMany(),
    prisma.supportMessage.deleteMany(),
    prisma.supportConversation.deleteMany(),
    prisma.supportTicketNote.deleteMany(),
    prisma.supportTicket.deleteMany(),

    prisma.ocrCostLog.deleteMany(),
    prisma.twilioMessageLog.deleteMany(),
    prisma.emailSendLog.deleteMany(),
    prisma.serverRequestLog.deleteMany(),
    prisma.stripeFeeLedger.deleteMany(),
    prisma.unmatchedTransaction.deleteMany(),
    prisma.observabilityUsageSnapshot.deleteMany(),
    prisma.databaseBackup.deleteMany(),
    prisma.storageUsageEvent.deleteMany(),

    prisma.staffTaskActivity.deleteMany(),
    prisma.auditLog.deleteMany(),

    prisma.customerProfile.updateMany({
      data: {
        totalBookings: 0,
        completedBookings: 0,
        totalSpend: 0,
        lastBookingAt: null,
        incidentCount: 0,
        loyaltyPoints: 0,
        lifetimePoints: 0,
        loyaltyTier: "SILVER",
        referralCreditBalance: 0,
        stripeCustomerId: null,
        defaultStripePaymentMethodId: null,
        stripePaymentMethodBrand: null,
        stripePaymentMethodLast4: null,
        stripePaymentMethodExpMonth: null,
        stripePaymentMethodExpYear: null,
      },
    }),

    prisma.vehicle.updateMany({
      where: { status: { in: [VehicleStatus.RENTED, VehicleStatus.RESERVED] } },
      data: { status: VehicleStatus.AVAILABLE },
    }),
  ]);
}

async function deleteStorageObjects(keys: Set<string>) {
  let ok = 0;
  let failed = 0;
  for (const key of keys) {
    try {
      await deleteFile(key);
      ok += 1;
    } catch (err) {
      failed += 1;
      console.warn(`  ! failed to delete ${key}:`, err instanceof Error ? err.message : err);
    }
  }
  return { ok, failed };
}

async function main() {
  console.log("🧹 clear-bookings: collecting S3 keys...");
  const env = getS3Env();
  const keys = await collectStorageKeys(env);
  console.log(`   ${keys.size} storage keys queued for deletion.`);

  console.log("🧹 clear-bookings: wiping database...");
  await wipeDatabase();

  console.log("🧹 clear-bookings: deleting storage objects...");
  const { ok, failed } = await deleteStorageObjects(keys);
  console.log(`   ${ok} deleted, ${failed} failed.`);

  // deleteFile() above writes one StorageUsageEvent row per delete. Drop
  // those so the table ends in the same clean state as the rest of the DB.
  await prisma.storageUsageEvent.deleteMany();

  const counts = {
    users: await prisma.user.count(),
    customers: await prisma.customerProfile.count(),
    vehicles: await prisma.vehicle.count(),
    depots: await prisma.depot.count(),
    bookings: await prisma.booking.count(),
    payments: await prisma.payment.count(),
    invoices: await prisma.invoice.count(),
    inspections: await prisma.inspection.count(),
    incidents: await prisma.incident.count(),
    settings: await prisma.systemSetting.count(),
  };
  console.log("✅ done. final counts:");
  console.table(counts);
}

main()
  .catch((e) => {
    console.error("❌ clear-bookings failed:", e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
