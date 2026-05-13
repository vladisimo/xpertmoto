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

export default function CheckInLandingPage(props: { params: Promise<{ id: string }> }) {
  const { id } = use(props.params);
  const { data: b } = trpc.staffBooking.detail.useQuery({ id });
  const { data: inspections } = trpc.inspection.byBooking.useQuery({ bookingId: id });
  const { data: assessment } = trpc.return.byBooking.useQuery({ bookingId: id });

  if (!b) return <PageShell><LoadingBlock padded="lg" /></PageShell>;

  const postHire = inspections?.find((i) => i.type === "POST_HIRE");
  const postHireReady = !!postHire;
  const assessReady = !!assessment;
  const signed = assessment?.status === "SIGNED" || assessment?.status === "FINALISED";
  const settled = b.status === "RETURNED" || b.status === "COMPLETED";

  const steps = [
    {
      number: 1,
      title: "Post-hire inspection",
      description: "Capture odometer, fuel, photos and any new damage (the pre-hire map is shown as a reference).",
      href: `/staff/bookings/${id}/check-in/inspect`,
      done: postHireReady,
      cta: postHire ? "Continue inspection" : "Start inspection",
    },
    {
      number: 2,
      title: "Damage assessment",
      description: "For each new damage item, pick a resolution: standard tariff, mechanic quote, waived or warranty.",
      href: `/staff/bookings/${id}/check-in/assess`,
      done: assessReady,
      cta: assessment ? "Continue assessment" : "Start assessment",
      disabled: !postHireReady,
    },
    {
      number: 3,
      title: "Sign return statement",
      description: "The customer reviews charges and initials each page; both parties sign the return statement.",
      href: `/staff/bookings/${id}/check-in/sign`,
      done: signed,
      cta: signed ? "Review signed statement" : "Start signing",
      disabled: !assessReady,
    },
    {
      number: 4,
      title: "Settle & close",
      description: "Capture bond deductions, release the remainder, process any above-bond charges, and close the hire.",
      href: `/staff/bookings/${id}/check-in/settle`,
      done: settled,
      cta: settled ? "Settled" : "Settle",
      disabled: !signed,
    },
  ];

  return (
    <PageShell>
      <PageHeader
        eyebrow="Operations"
        breadcrumbs={[
          { label: "Bookings", href: "/staff/calendar" },
          { label: b.bookingReference, href: `/staff/bookings/${id}` },
          { label: "Check in" },
        ]}
        title={`Check in — ${b.bookingReference}`}
        description={`${b.customer.firstName} ${b.customer.lastName} · scheduled return ${formatDateTime(b.returnDateTime)}`}
        back={`/staff/bookings/${id}`}
      />
      {steps.map((s) => (
        <Card key={s.number} className={s.disabled ? "opacity-60" : undefined}>
          <CardHeader>
            <CardTitle className="flex items-center justify-between gap-4 h3">
              <span>
                <span className="mr-2 inline-flex h-7 w-7 items-center justify-center rounded-full bg-primary text-xs font-semibold text-primary-foreground">
                  {s.number}
                </span>
                {s.title}
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
