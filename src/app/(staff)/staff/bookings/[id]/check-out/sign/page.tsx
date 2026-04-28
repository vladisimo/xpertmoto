"use client";

import { use, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { trpc } from "@/lib/trpc/client";
import { Button } from "@/components/ui/button";
import { PageHeader } from "@/components/layout/page-header";
import { PageShell } from "@/components/layout/page-section";
import { LoadingBlock } from "@/components/ui/spinner";
import { AgreementSigner, type AgreementPage } from "@/components/agreement/agreement-signer";
import { CoverPage } from "@/components/agreement/pickup/cover-page";
import { PricingPage } from "@/components/agreement/pickup/pricing-page";
import { ConditionPage } from "@/components/agreement/pickup/condition-page";
import { TermsPage } from "@/components/agreement/pickup/terms-page";
import { BondPolicyPage } from "@/components/agreement/pickup/bond-policy-page";
import { DeclarationsPage } from "@/components/agreement/pickup/declarations-page";
import { CURRENT_TERMS } from "@/lib/agreement/terms";

export default function CheckOutSignPage(props: { params: Promise<{ id: string }> }) {
  const { id } = use(props.params);
  const router = useRouter();
  const utils = trpc.useUtils();
  const { data: booking } = trpc.staffBooking.detail.useQuery({ id });
  const { data: agreements, isLoading: loadingAgreements } = trpc.agreement.byBooking.useQuery({ bookingId: id });
  const { data: inspections } = trpc.inspection.byBooking.useQuery({ bookingId: id });

  const startDraft = trpc.agreement.startDraft.useMutation();
  const saveSignature = trpc.agreement.saveSignature.useMutation();
  const addCustomerMarker = trpc.agreement.addCustomerDamageMarker.useMutation();
  const finalise = trpc.agreement.finalise.useMutation();

  const [err, setErr] = useState<string | null>(null);

  const currentAgreement = useMemo(
    () => agreements?.find((a) => a.status === "DRAFT") ?? agreements?.find((a) => a.status === "SIGNED"),
    [agreements],
  );

  async function ensureDraft() {
    if (!booking) return;
    setErr(null);
    try {
      await startDraft.mutateAsync({ bookingId: booking.id });
      await utils.agreement.byBooking.invalidate({ bookingId: booking.id });
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Failed to start agreement");
    }
  }

  const preHire = inspections?.find((i) => i.type === "PRE_HIRE");

  if (!booking || loadingAgreements) {
    return (
      <PageShell>
        <LoadingBlock padded="lg" />
      </PageShell>
    );
  }

  // Auto-start draft if none exists
  if (!currentAgreement) {
    return (
      <PageShell>
        <PageHeader
          breadcrumbs={[
            { label: "Bookings", href: "/staff/calendar" },
            { label: booking.bookingReference, href: `/staff/bookings/${id}` },
            { label: "Check out", href: `/staff/bookings/${id}/check-out` },
            { label: "3. Sign" },
          ]}
          title="Rental agreement"
          description="Start the agreement to begin the signing ritual."
        />
        <Button onClick={ensureDraft} disabled={startDraft.isPending}>
          {startDraft.isPending ? "Starting…" : "Start signing"}
        </Button>
        {err && (
          <div className="rounded-md border border-destructive/30 bg-destructive/10 p-3 text-sm text-destructive">
            {err}
          </div>
        )}
      </PageShell>
    );
  }

  if (currentAgreement.status === "SIGNED") {
    return (
      <PageShell>
        <PageHeader
          breadcrumbs={[
            { label: "Bookings", href: "/staff/calendar" },
            { label: booking.bookingReference, href: `/staff/bookings/${id}` },
            { label: "Check out", href: `/staff/bookings/${id}/check-out` },
            { label: "3. Sign" },
          ]}
          title="Agreement signed"
          description={`Agreement ${currentAgreement.agreementNumber} · v${currentAgreement.version}`}
        />
        <div className="flex gap-3">
          <Button asChild>
            <Link href={`/staff/bookings/${id}/check-out/confirm`}>Continue to handover →</Link>
          </Button>
          {currentAgreement.pdfUrl && (
            <Button variant="secondary" asChild>
              <Link href={currentAgreement.pdfUrl} target="_blank">
                View signed PDF
              </Link>
            </Button>
          )}
        </div>
      </PageShell>
    );
  }

  const pagesInitialled =
    ((currentAgreement.pagesInitialled as unknown as { pageId: string; initialsUrl: string; signedAt: string }[]) ?? []);

  async function handleInitials(pageId: string, url: string) {
    try {
      const payload = url.startsWith("data:") ? { dataUrl: url } : { reuseUrl: url };
      await saveSignature.mutateAsync({
        agreementId: currentAgreement!.id,
        kind: "initials",
        pageId: pageId as
          | "cover"
          | "pricing"
          | "condition"
          | "terms"
          | "bond-policy"
          | "declarations",
        ...payload,
      });
      await utils.agreement.byBooking.invalidate({ bookingId: id });
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Failed to save initials");
    }
  }

  async function handleCustomer(dataUrl: string) {
    try {
      await saveSignature.mutateAsync({
        agreementId: currentAgreement!.id,
        kind: "full-customer",
        dataUrl,
      });
      await utils.agreement.byBooking.invalidate({ bookingId: id });
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Failed to save signature");
    }
  }

  async function handleStaff(dataUrl: string) {
    try {
      await saveSignature.mutateAsync({
        agreementId: currentAgreement!.id,
        kind: "full-staff",
        dataUrl,
      });
      await utils.agreement.byBooking.invalidate({ bookingId: id });
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Failed to save signature");
    }
  }

  async function handleCustomerMarker(marker: { x: number; y: number; severity: "MINOR" | "MODERATE" | "MAJOR"; view: "LEFT" | "RIGHT" | "FRONT" | "REAR" }) {
    try {
      await addCustomerMarker.mutateAsync({ agreementId: currentAgreement!.id, marker });
      await utils.inspection.byBooking.invalidate({ bookingId: id });
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Failed to save marker");
    }
  }

  async function submit() {
    setErr(null);
    try {
      await finalise.mutateAsync({ agreementId: currentAgreement!.id });
      await utils.agreement.byBooking.invalidate({ bookingId: id });
      router.push(`/staff/bookings/${id}/check-out/confirm`);
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Failed to finalise");
    }
  }

  const pages: AgreementPage[] = [
    {
      id: "cover",
      title: "Cover",
      content: <CoverPage booking={booking} />,
    },
    {
      id: "pricing",
      title: "Pricing summary",
      content: <PricingPage booking={booking} />,
    },
    {
      id: "condition",
      title: "Vehicle condition report",
      content: <ConditionPage inspection={preHire ?? null} onAddCustomerMarker={handleCustomerMarker} />,
    },
    {
      id: "terms",
      title: `Terms & conditions — v${CURRENT_TERMS.version}`,
      content: <TermsPage />,
    },
    {
      id: "bond-policy",
      title: "Bond & cancellation policy",
      content: <BondPolicyPage booking={booking} />,
    },
    {
      id: "declarations",
      title: "Driver declarations",
      content: <DeclarationsPage />,
    },
  ];

  return (
    <PageShell>
      <PageHeader
        eyebrow="Operations"
        breadcrumbs={[
          { label: "Bookings", href: "/staff/calendar" },
          { label: booking.bookingReference, href: `/staff/bookings/${id}` },
          { label: "Check out", href: `/staff/bookings/${id}/check-out` },
          { label: "3. Sign" },
        ]}
        title="Rental agreement"
        description={`Agreement ${currentAgreement.agreementNumber} · v${currentAgreement.version}`}
      />

      {err && (
        <div className="rounded-md border border-destructive/30 bg-destructive/10 p-3 text-sm text-destructive">
          {err}
        </div>
      )}

      <AgreementSigner
        title={`Agreement ${currentAgreement.agreementNumber}`}
        subtitle={`${booking.customer.firstName} ${booking.customer.lastName} · ${booking.bookingReference}`}
        pages={pages}
        initialisedPages={pagesInitialled}
        onInitials={handleInitials}
        onCustomerSignature={handleCustomer}
        onStaffSignature={handleStaff}
        existingCustomerSignatureUrl={currentAgreement.customerSignatureUrl}
        existingStaffSignatureUrl={currentAgreement.staffSignatureUrl}
        onSubmit={submit}
        submitting={finalise.isPending}
      />
    </PageShell>
  );
}
