import { Suspense } from "react";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

import { AvatarUploader } from "@/components/profile/avatar-uploader";
import { BasicsForm } from "@/components/profile/basics-form";
import { ChangePasswordForm } from "@/components/profile/change-password-form";
import { PageHeader } from "@/components/layout/page-header";
import { PageSection, PageShell } from "@/components/layout/page-section";

const ROLE_LABEL: Record<string, string> = {
  STAFF: "Staff",
  MANAGER: "Manager",
  ADMIN: "Admin",
  SUPER_ADMIN: "Super Admin",
  CUSTOMER: "Customer",
};

function getInitials(firstName: string, lastName: string, email: string): string {
  const fi = firstName.trim()[0] ?? "";
  const li = lastName.trim()[0] ?? "";
  const combined = `${fi}${li}`.trim();
  if (combined) return combined.toUpperCase();
  return (email[0] ?? "U").toUpperCase();
}

// Sync page + async content behind Suspense: the session + profile reads stay
// fenced so prefetch/navigation validation never sees an unfenced runtime read.
export default function StaffProfilePage() {
  return (
    <PageShell className="max-w-3xl">
      <Suspense
        fallback={
          <div aria-busy="true" className="space-y-4">
            <div className="h-7 w-56 animate-pulse rounded-md bg-muted" />
            <div className="h-4 w-80 animate-pulse rounded bg-muted" />
            <div className="mt-4 h-72 animate-pulse rounded-lg bg-muted/60" />
          </div>
        }
      >
        <ProfileContent />
      </Suspense>
    </PageShell>
  );
}

async function ProfileContent() {
  const session = await auth();
  const user = await prisma.user.findUnique({
    where: { id: session!.user.id },
    select: {
      email: true,
      firstName: true,
      lastName: true,
      phone: true,
      avatarUrl: true,
      role: true,
      passwordHash: true,
      depot: { select: { name: true } },
    },
  });
  if (!user) return null;

  const initials = getInitials(user.firstName, user.lastName, user.email);
  const roleLabel = ROLE_LABEL[user.role] ?? user.role;
  const hasPassword = !!user.passwordHash;

  return (
    <>
      <PageHeader
        eyebrow={`${roleLabel}${user.depot?.name ? ` · ${user.depot.name}` : ""}`}
        title="My Profile"
        description="Update your name, contact details, profile photo, and password."
      />

      <PageSection
        title="Profile photo"
        description="Your photo is shown in the sidebar and alongside actions you take in the system."
      >
        <AvatarUploader initialUrl={user.avatarUrl} initials={initials} />
      </PageSection>

      <PageSection
        title="Personal details"
        description="Your name and contact phone. Email changes need an admin."
      >
        <BasicsForm
          email={user.email}
          initial={{
            firstName: user.firstName,
            lastName: user.lastName,
            phone: user.phone ?? "",
          }}
        />
      </PageSection>

      <PageSection
        title="Password"
        description={
          hasPassword
            ? "Rotate your password regularly. You'll need to enter your current password to set a new one."
            : "You don't have a password set yet — you sign in with a linked account or magic link. Use the link below to add one."
        }
      >
        {hasPassword ? (
          <ChangePasswordForm />
        ) : (
          <p className="text-body text-muted-foreground">
            Sign out and use &quot;Forgot password&quot; from the login page to set
            one, or contact an admin for help.
          </p>
        )}
      </PageSection>
    </>
  );
}
