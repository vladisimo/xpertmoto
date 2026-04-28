import { auth } from "@/lib/auth";
import { getEnabledOAuthProviders } from "@/lib/auth-providers";
import { prisma } from "@/lib/prisma";
import { PageHeader } from "@/components/layout/page-header";
import { PageSection, PageShell } from "@/components/layout/page-section";
import { SetPasswordForm } from "./set-password-form";
import { ConnectedAccounts } from "./connected-accounts";
import { getBranding } from "@/lib/branding";

export default async function SecurityPage() {
  const session = await auth();
  const [user, branding] = await Promise.all([
    prisma.user.findUnique({
      where: { id: session!.user.id },
      select: { passwordHash: true },
    }),
    getBranding(),
  ]);
  const hasPassword = !!user?.passwordHash;
  const enabledProviders = getEnabledOAuthProviders();

  return (
    <PageShell className="max-w-xl">
      <PageHeader
        title="Security"
        description={`Manage how you sign in to ${branding.siteName}.`}
      />

      <PageSection
        title={hasPassword ? "Password" : "Set a password"}
        description={
          hasPassword
            ? "You already have a password set. Use the forgot-password flow from the sign-in page to change it."
            : "You're currently signing in with a one-time email link or a connected account. Add a password below if you'd like to sign in with credentials too."
        }
      >
        {!hasPassword && <SetPasswordForm />}
      </PageSection>

      {enabledProviders.length > 0 && (
        <PageSection
          title="Connected accounts"
          description="Link a provider so you can sign in with one click next time. You can connect as many as you like."
        >
          <ConnectedAccounts
            enabledProviders={enabledProviders}
            hasPassword={hasPassword}
          />
        </PageSection>
      )}
    </PageShell>
  );
}
