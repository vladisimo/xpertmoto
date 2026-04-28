import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { PageHeader } from "@/components/layout/page-header";
import { PageShell, PageSection } from "@/components/layout/page-section";
import {
  DriversLicenceSection,
  PassportSection,
  IdentityHistorySection,
} from "@/components/customer/identity-page-client";
import { AgreementsAndAssessmentsSection } from "@/components/customer/agreements-assessments-section";
import { PoliciesSection } from "@/components/customer/policies-section";
import { TaxDocumentsSection } from "@/components/customer/tax-documents-section";

function toIso(raw: Date | null | undefined): string | null {
  if (!raw) return null;
  return new Date(raw).toISOString();
}

// Image columns on CustomerProfile store raw S3 keys (e.g. "drivers/u1/file.jpg").
// next/image needs a leading "/" or an absolute URL, and we can't hand the
// browser a direct MinIO/S3 URL because (a) in dev it's unreachable from remote
// clients, and (b) CSP img-src is scoped to `'self'`. Route bytes through the
// same-origin /api/identity-image proxy instead — it enforces auth and works
// identically in dev and prod.
function resolveImage(raw: string | null | undefined): string | null {
  if (!raw) return null;
  if (raw.startsWith("http://") || raw.startsWith("https://") || raw.startsWith("/")) {
    return raw;
  }
  return `/api/identity-image?key=${encodeURIComponent(raw)}`;
}

export default async function DocumentsPage() {
  const session = await auth();
  const user = await prisma.user.findUnique({
    where: { id: session!.user.id },
    include: { customerProfile: true },
  });
  if (!user) return null;
  const cp = user.customerProfile;

  const licenceImageFront = resolveImage(cp?.licenceImageFront);
  const licenceImageBack = resolveImage(cp?.licenceImageBack);
  const passportImage = resolveImage(cp?.passportImage);

  return (
    <PageShell className="max-w-4xl space-y-3">
      <PageHeader
        title="Documents"
        description="Your licence, passport, booking documents, and signed policies."
      />

      <PoliciesSection />

      <PageSection
        title="Tax invoices & receipts"
        collapsible
        name="customer-docs"
        className="p-4"
      >
        <TaxDocumentsSection />
      </PageSection>

      <PageSection title="Driver's licence" collapsible name="customer-docs" className="p-4">
        <DriversLicenceSection
          initial={{
            licenceImageFront,
            licenceImageBack,
            licenceExpiry: toIso(cp?.licenceExpiry ?? null),
            licenceVerifiedAt: toIso(cp?.licenceVerifiedAt ?? null),
          }}
        />
      </PageSection>

      <PageSection title="Passport" collapsible name="customer-docs" className="p-4">
        <PassportSection
          initial={{
            passportImage,
            passportExpiry: toIso(cp?.passportExpiry ?? null),
            passportVerifiedAt: toIso(cp?.passportVerifiedAt ?? null),
          }}
        />
      </PageSection>

      <AgreementsAndAssessmentsSection />

      <PageSection title="Previous identity documents" collapsible name="customer-docs" className="p-4">
        <IdentityHistorySection />
      </PageSection>
    </PageShell>
  );
}
