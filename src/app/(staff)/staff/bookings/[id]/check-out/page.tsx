"use client";

import Link from "next/link";
import { use } from "react";
import { trpc } from "@/lib/trpc/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { PageHeader } from "@/components/layout/page-header";
import { PageShell } from "@/components/layout/page-section";
import { LoadingBlock } from "@/components/ui/spinner";
import { formatDateTime } from "@/lib/utils";

export default function CheckOutLandingPage(props: { params: Promise<{ id: string }> }) {
  const { id } = use(props.params);
  const { data: b, isLoading } = trpc.staffBooking.detail.useQuery({ id });
  const { data: inspections } = trpc.inspection.byBooking.useQuery({ bookingId: id });
  const { data: agreements } = trpc.agreement.byBooking.useQuery({ bookingId: id });

  if (isLoading) return <LoadingBlock padded="lg" />;
  if (!b) return <div className="p-8 text-muted-foreground">Not found</div>;

  const preHire = inspections?.find((i) => i.type === "PRE_HIRE");
  const preHireReady = preHire?.status === "COMPLETED" || !!preHire; // draft counts for step 1
  const identityDone = b.licenceVerified && b.customerIdVerified;
  const draftAgreement = agreements?.find((a) => a.status === "DRAFT");
  const signedAgreement = agreements?.find((a) => a.status === "SIGNED");
  const signReady = !!signedAgreement;
  const checkedOut = b.status === "ACTIVE" || b.status === "CHECKED_OUT";

  const steps = [
    {
      number: 1,
      title: "Pre-hire inspection",
      description:
        "Take photos of the scooter, capture odometer + fuel, and mark any existing damage on the map. Staff can do this before the customer arrives.",
      href: `/staff/bookings/${id}/check-out/inspect`,
      done: preHireReady,
      cta: preHire ? "Continue inspection" : "Start inspection",
    },
    {
      number: 2,
      title: "Identity & licence verification",
      description:
        "Check the customer's photo ID and licence against the booking. Eligibility is re-verified before the signing step.",
      href: `/staff/bookings/${id}/check-out/verify`,
      done: identityDone,
      cta: identityDone ? "Review" : "Verify",
      disabled: !preHireReady,
    },
    {
      number: 3,
      title: "Sign rental agreement",
      description:
        "The customer reviews and initials each page of the agreement on the tablet, then signs in full alongside the staff witness.",
      href: `/staff/bookings/${id}/check-out/sign`,
      done: signReady,
      cta: signedAgreement ? "Review signed agreement" : draftAgreement ? "Resume signing" : "Start signing",
      disabled: !preHireReady || !identityDone,
    },
    {
      number: 4,
      title: "Confirm handover",
      description:
        "Review the signed agreement, confirm keys handed over, and complete check-out. The booking moves to ACTIVE.",
      href: `/staff/bookings/${id}/check-out/confirm`,
      done: checkedOut,
      cta: checkedOut ? "Handover complete" : "Confirm handover",
      disabled: !signReady,
    },
  ];

  return (
    <PageShell>
      <PageHeader
        eyebrow="Operations"
        breadcrumbs={[
          { label: "Bookings", href: "/staff/calendar" },
          { label: b.bookingReference, href: `/staff/bookings/${id}` },
          { label: "Check out" },
        ]}
        title={`Check out — ${b.bookingReference}`}
        description={`${b.customer.firstName} ${b.customer.lastName} · pickup ${formatDateTime(b.pickupDateTime)}`}
      />

      {steps.map((s) => (
        <Card key={s.number} className={s.disabled ? "opacity-60" : undefined}>
          <CardHeader>
            <CardTitle className="flex items-center justify-between gap-4 h3">
              <span>
                <span className="mr-2 inline-flex h-7 w-7 items-center justify-center rounded-full bg-primary text-xs font-semibold text-primary-foreground">
                  {s.number}
                </span>
                <span>{s.title}</span>
              </span>
              {s.done && <span className="text-sm text-primary">Done</span>}
            </CardTitle>
          </CardHeader>
          <CardContent className="flex items-start justify-between gap-4">
            <p className="body-text flex-1">{s.description}</p>
            <Button asChild disabled={s.disabled} variant={s.done ? "secondary" : "default"}>
              <Link href={s.href}>{s.cta}</Link>
            </Button>
          </CardContent>
        </Card>
      ))}
    </PageShell>
  );
}
