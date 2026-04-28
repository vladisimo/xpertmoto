import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { PageHeader } from "@/components/layout/page-header";
import { PageShell } from "@/components/layout/page-section";
import { readPiiField } from "@/lib/customer-pii";
import { TwoFactorCard } from "@/components/customer/two-factor-card";
import { ProfileIdentityCards } from "@/components/customer/profile-identity-cards";

function toIso(raw: Date | null | undefined): string | null {
  if (!raw) return null;
  return new Date(raw).toISOString();
}

export default async function ProfilePage() {
  const session = await auth();
  const user = await prisma.user.findUnique({
    where: { id: session!.user.id },
    include: { customerProfile: true },
  });
  if (!user) return null;

  const cp = user.customerProfile;

  const licenceNumberPlain = readPiiField(
    cp?.licenceNumber ?? null,
    cp?.licenceNumberEnc ?? null,
  );
  const passportNumberPlain = readPiiField(
    cp?.passportNumber ?? null,
    cp?.passportNumberEnc ?? null,
  );

  return (
    <PageShell className="max-w-3xl">
      <PageHeader
        title="Profile"
        description="Your identity documents, personal details, and account security."
      />

      <ProfileIdentityCards
        initial={{
          firstName: user.firstName,
          lastName: user.lastName,
          email: user.email,
          phone: user.phone ?? null,
          dateOfBirth: toIso(user.dateOfBirth),
          licenceNumber: licenceNumberPlain,
          licenceState: cp?.licenceState ?? null,
          licenceExpiry: toIso(cp?.licenceExpiry ?? null),
          licenceClass: cp?.licenceClass ?? null,
          passportNumber: passportNumberPlain,
          passportCountry: cp?.passportCountry ?? null,
          passportExpiry: toIso(cp?.passportExpiry ?? null),
          emergencyContactName: cp?.emergencyContactName ?? null,
          emergencyContactPhone: cp?.emergencyContactPhone ?? null,
          companyName: cp?.companyName ?? null,
          abn: cp?.abn ?? null,
        }}
      />

      <TwoFactorCard />
    </PageShell>
  );
}
