"use client";

import { use, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { trpc } from "@/lib/trpc/client";
import { Button } from "@/components/ui/button";
import { DocumentViewerButton } from "@/components/shared/document-viewer-dialog";
import { PageHeader } from "@/components/layout/page-header";
import { PageShell } from "@/components/layout/page-section";
import { LoadingBlock } from "@/components/ui/spinner";
import { AgreementSigner, type AgreementPage } from "@/components/agreement/agreement-signer";
import { ReturnCoverPage } from "@/components/agreement/return/cover-page";
import { ReturnConditionPage } from "@/components/agreement/return/condition-page";
import { ReturnChargesPage } from "@/components/agreement/return/charges-page";
import { ReturnFeesPage } from "@/components/agreement/return/fees-page";
import { QuoteAckPage } from "@/components/agreement/return/quote-ack-page";
import { SettlementPage } from "@/components/agreement/return/settlement-page";

export default function CheckInSignPage(props: { params: Promise<{ id: string }> }) {
  const { id } = use(props.params);
  const router = useRouter();
  const utils = trpc.useUtils();
  const { data: booking } = trpc.staffBooking.detail.useQuery({ id });
  const { data: assessment, isLoading } = trpc.return.byBooking.useQuery({ bookingId: id });
  const { data: inspections } = trpc.inspection.byBooking.useQuery({ bookingId: id });
  const fees = trpc.return.computeFees.useQuery(
    { assessmentId: assessment?.id ?? "" },
    { enabled: !!assessment },
  );

  const saveSignature = trpc.return.saveSignature.useMutation();
  const finalise = trpc.return.finalise.useMutation();

  const [err, setErr] = useState<string | null>(null);

  const postHire = inspections?.find((i) => i.type === "POST_HIRE");

  if (!booking || isLoading || !assessment) {
    return <PageShell><LoadingBlock padded="lg" /></PageShell>;
  }

  if (assessment.status === "SIGNED" || assessment.status === "FINALISED") {
    return (
      <PageShell>
        <PageHeader
          eyebrow="Operations"
          breadcrumbs={[
            { label: "Bookings", href: "/staff/calendar" },
            { label: booking.bookingReference, href: `/staff/bookings/${id}` },
            { label: "Check in", href: `/staff/bookings/${id}/check-in` },
            { label: "3. Sign" },
          ]}
          title="Return statement signed"
          description={`Assessment ${assessment.assessmentNumber}`}
        />
        <div className="flex gap-3">
          <Button asChild>
            <Link href={`/staff/bookings/${id}/check-in/settle`}>Continue to settle →</Link>
          </Button>
          {assessment.pdfUrl && (
            <DocumentViewerButton
              variant="secondary"
              fileUrl={assessment.pdfUrl}
              title={`Return assessment ${assessment.assessmentNumber}`}
              kind="pdf"
            >
              View signed PDF
            </DocumentViewerButton>
          )}
        </div>
      </PageShell>
    );
  }

  const pagesInitialled =
    ((assessment.pagesInitialled as unknown as { pageId: string; initialsUrl: string; signedAt: string }[]) ?? []);

  const standardCharges = assessment.damageCharges ?? [];
  const pendingCharges = standardCharges.filter((c) => c.resolution === "QUOTE_PENDING");
  const hasQuotePending = pendingCharges.length > 0;
  const standardTotal = standardCharges
    .filter((c) => c.resolution === "STANDARD")
    .reduce((acc, c) => acc + Number(c.amount), 0);
  const pendingQuoteCap = pendingCharges.reduce((acc, c) => acc + Number(c.quoteCapAmount ?? 0), 0);
  const lateFee = fees.data?.lateFee ?? 0;
  const fuelCharge = fees.data?.fuelCharge ?? 0;

  async function handleInitials(pageId: string, url: string) {
    try {
      const payload = url.startsWith("data:") ? { dataUrl: url } : { reuseUrl: url };
      await saveSignature.mutateAsync({
        assessmentId: assessment!.id,
        kind: "initials",
        pageId: pageId as "cover" | "condition" | "charges" | "fees" | "quote-ack" | "settlement",
        ...payload,
      });
      await utils.return.byBooking.invalidate({ bookingId: id });
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Failed to save initials");
    }
  }

  async function handleCustomer(dataUrl: string) {
    try {
      await saveSignature.mutateAsync({ assessmentId: assessment!.id, kind: "full-customer", dataUrl });
      await utils.return.byBooking.invalidate({ bookingId: id });
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Failed to save signature");
    }
  }

  async function handleStaff(dataUrl: string) {
    try {
      await saveSignature.mutateAsync({ assessmentId: assessment!.id, kind: "full-staff", dataUrl });
      await utils.return.byBooking.invalidate({ bookingId: id });
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Failed to save signature");
    }
  }

  async function submit() {
    setErr(null);
    try {
      await finalise.mutateAsync({ assessmentId: assessment!.id });
      await utils.return.byBooking.invalidate({ bookingId: id });
      router.push(`/staff/bookings/${id}/check-in/settle`);
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Failed to finalise");
    }
  }

  const pages: AgreementPage[] = [
    {
      id: "cover",
      title: "Cover",
      content: (
        <ReturnCoverPage
          booking={{
            bookingReference: booking.bookingReference,
            customer: booking.customer,
            category: booking.category,
            vehicle: booking.vehicle,
            pickupDateTime: booking.pickupDateTime,
            returnDateTime: booking.returnDateTime,
            actualReturnDateTime: booking.actualReturnDateTime,
            pickupOdometerKm: booking.pickupOdometerKm,
            returnDepot: booking.returnDepot,
          }}
          inspection={{
            odometerKm: postHire?.odometerKm ?? 0,
            fuelLevel: postHire?.fuelLevel ?? 0,
          }}
        />
      ),
    },
    {
      id: "condition",
      title: "Condition report",
      content: <ReturnConditionPage inspectionId={postHire?.id ?? null} />,
    },
    {
      id: "charges",
      title: "Damage charges",
      content: (
        <ReturnChargesPage
          charges={standardCharges.map((c) => ({
            id: c.id,
            description: c.description,
            severity: c.severity,
            resolution: c.resolution,
            amount: Number(c.amount),
            quoteCapAmount: c.quoteCapAmount ? Number(c.quoteCapAmount) : null,
            tariffName: c.damageTariff?.name ?? null,
            staffNote: c.staffNote ?? null,
          }))}
        />
      ),
    },
    {
      id: "fees",
      title: "Fees",
      content: (
        <ReturnFeesPage
          lateFee={lateFee}
          fuelCharge={fuelCharge}
          lateHours={fees.data?.lateHours ?? 0}
          pickupFuel={fees.data?.pickupFuel ?? 0}
          returnFuel={fees.data?.returnFuel ?? 0}
        />
      ),
    },
    ...(hasQuotePending
      ? [
          {
            id: "quote-ack",
            title: "Pending quote acknowledgment",
            content: (
              <QuoteAckPage
                charges={pendingCharges.map((c) => ({
                  id: c.id,
                  description: c.description,
                  quoteCapAmount: c.quoteCapAmount ? Number(c.quoteCapAmount) : null,
                }))}
              />
            ),
          } as AgreementPage,
        ]
      : []),
    {
      id: "settlement",
      title: "Settlement",
      content: (
        <SettlementPage
          standardTotal={standardTotal}
          lateFee={lateFee}
          fuelCharge={fuelCharge}
          pendingQuoteCap={pendingQuoteCap}
          bondHeld={Number(booking.bondAmount)}
        />
      ),
    },
  ];

  return (
    <PageShell>
      <PageHeader
        eyebrow="Operations"
        breadcrumbs={[
          { label: "Bookings", href: "/staff/calendar" },
          { label: booking.bookingReference, href: `/staff/bookings/${id}` },
          { label: "Check in", href: `/staff/bookings/${id}/check-in` },
          { label: "3. Sign" },
        ]}
        title="Return statement"
        description={`Assessment ${assessment.assessmentNumber}`}
      />
      {err && (
        <div className="rounded-md border border-destructive/30 bg-destructive/10 p-3 text-sm text-destructive">
          {err}
        </div>
      )}
      <AgreementSigner
        title={`Return ${assessment.assessmentNumber}`}
        subtitle={`${booking.customer.firstName} ${booking.customer.lastName} · ${booking.bookingReference}`}
        pages={pages}
        initialisedPages={pagesInitialled}
        onInitials={handleInitials}
        onCustomerSignature={handleCustomer}
        onStaffSignature={handleStaff}
        existingCustomerSignatureUrl={assessment.customerSignatureUrl}
        existingStaffSignatureUrl={assessment.staffSignatureUrl}
        onSubmit={submit}
        submitting={finalise.isPending}
      />
    </PageShell>
  );
}
