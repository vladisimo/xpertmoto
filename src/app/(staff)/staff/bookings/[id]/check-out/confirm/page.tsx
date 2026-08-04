"use client";

import { use, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { trpc } from "@/lib/trpc/client";
import { Button } from "@/components/ui/button";
import { DocumentViewerButton } from "@/components/shared/document-viewer-dialog";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { PageHeader } from "@/components/layout/page-header";
import { MobileBottomBar } from "@/components/layout/mobile-bottom-bar";
import { PageShell } from "@/components/layout/page-section";
import { LoadingBlock } from "@/components/ui/spinner";

export default function CheckOutConfirmPage(props: { params: Promise<{ id: string }> }) {
  const { id } = use(props.params);
  const router = useRouter();
  const utils = trpc.useUtils();
  const { data: b } = trpc.staffBooking.detail.useQuery({ id });
  const { data: agreements } = trpc.agreement.byBooking.useQuery({ bookingId: id });
  const { data: inspections } = trpc.inspection.byBooking.useQuery({ bookingId: id });
  const { data: prereqs } = trpc.staffBooking.checkoutPrereqs.useQuery();
  const checkOut = trpc.staffBooking.checkOut.useMutation();

  const signed = agreements?.find((a) => a.status === "SIGNED");
  const preHire = inspections?.find((i) => i.type === "PRE_HIRE");

  const [keysHanded, setKeysHanded] = useState(false);
  const [notes, setNotes] = useState("");
  const [err, setErr] = useState<string | null>(null);
  // Payment/bond failure recovery: which auto-step failed on the last
  // attempt, and the staff-entered reason for overriding it.
  const [failedStep, setFailedStep] = useState<"remainder" | "bond" | null>(null);
  const [overrideReason, setOverrideReason] = useState("");

  if (!b) return <PageShell><LoadingBlock padded="lg" /></PageShell>;


  const requireLicence = prereqs?.requireLicenceVerification ?? true;
  const canSubmit =
    !!signed &&
    keysHanded &&
    (!requireLicence || b.licenceVerified) &&
    b.customerIdVerified &&
    !!preHire;

  const balanceDue = Number(b.balanceDue ?? 0);

  async function submit(withOverride = false) {
    if (!signed || !preHire) return;
    setErr(null);
    try {
      const override =
        withOverride && failedStep && overrideReason.trim()
          ? failedStep === "remainder"
            ? { remainderOverride: { skip: true as const, reason: overrideReason.trim() } }
            : { bondOverride: { skip: true as const, reason: overrideReason.trim() } }
          : {};
      await checkOut.mutateAsync({
        bookingId: id,
        odometerKm: preHire.odometerKm,
        fuelLevel: preHire.fuelLevel,
        licenceVerified: b!.licenceVerified,
        customerIdVerified: b!.customerIdVerified,
        agreementId: signed.id,
        notes: notes || undefined,
        ...override,
      });
      await utils.staffBooking.detail.invalidate({ id });
      router.push(`/staff/bookings/${id}`);
    } catch (e) {
      const message = e instanceof Error ? e.message : "Check-out failed";
      setErr(message);
      // The server blocks handover on a failed auto-charge / bond hold;
      // classify so the override panel targets only the failing step.
      if (message.includes("balance is still due")) setFailedStep("remainder");
      else if (message.toLowerCase().includes("bond")) setFailedStep("bond");
      else setFailedStep(null);
    }
  }

  if (b.status === "ACTIVE" || b.status === "CHECKED_OUT") {
    return (
      <PageShell>
        <PageHeader
          eyebrow="Operations"
          breadcrumbs={[
            { label: "Bookings", href: "/staff/calendar" },
            { label: b.bookingReference, href: `/staff/bookings/${id}` },
            { label: "Check out", href: `/staff/bookings/${id}/check-out` },
            { label: "4. Confirm" },
          ]}
          title="Handover complete"
          description={`${b.bookingReference} is now ${b.status}`}
        />
        <Button asChild>
          <Link href={`/staff/bookings/${id}`}>← Back to booking</Link>
        </Button>
      </PageShell>
    );
  }

  return (
    <PageShell>
      <PageHeader
        eyebrow="Operations · Step 4 of 4"
        breadcrumbs={[
          { label: "Bookings", href: "/staff/calendar" },
          { label: b.bookingReference, href: `/staff/bookings/${id}` },
          { label: "Check out", href: `/staff/bookings/${id}/check-out` },
          { label: "4. Confirm" },
        ]}
        back={`/staff/bookings/${id}/check-out`}
        mobileCompact
        title="Confirm handover"
        description="Final review before the keys go over."
      />

      <Card>
        <CardHeader>
          <CardTitle className="h3">Checks</CardTitle>
        </CardHeader>
        <CardContent className="space-y-2 text-sm">
          <div className="flex justify-between">
            <span>Pre-hire inspection</span>
            <span>{preHire ? "✅" : "— missing"}</span>
          </div>
          <div className="flex justify-between">
            <span>Photo ID</span>
            <span>{b.customerIdVerified ? "✅" : "— not verified"}</span>
          </div>
          <div className="flex justify-between">
            <span>Licence</span>
            <span>{b.licenceVerified ? "✅" : "— not verified"}</span>
          </div>
          <div className="flex justify-between">
            <span>Rental agreement</span>
            <span>{signed ? `✅ ${signed.agreementNumber}` : "— not signed"}</span>
          </div>
        </CardContent>
      </Card>

      {signed?.pdfUrl && (
        <Card>
          <CardHeader>
            <CardTitle className="h3">Signed agreement</CardTitle>
          </CardHeader>
          <CardContent>
            <DocumentViewerButton
              variant="secondary"
              fileUrl={signed.pdfUrl}
              title={`Agreement ${signed.agreementNumber}`}
              kind="pdf"
            >
              View / download PDF
            </DocumentViewerButton>
            {signed.timestampStatus === "OK" && signed.timestampedAt && (
              <p className="caption mt-2">
                Timestamped via RFC3161 on{" "}
                {new Date(signed.timestampedAt).toLocaleString("en-AU")}
              </p>
            )}
            {signed.timestampStatus === "FAILED" && (
              <p className="caption mt-2 text-destructive">Timestamping failed — retry available from the booking page.</p>
            )}
          </CardContent>
        </Card>
      )}

      {balanceDue > 0.009 && (
        <Card>
          <CardHeader>
            <CardTitle className="h3">Payment at pickup</CardTitle>
          </CardHeader>
          <CardContent className="space-y-1 text-sm">
            <div className="flex justify-between">
              <span>Balance due now</span>
              <span className="font-semibold tabular-nums">
                A${balanceDue.toFixed(2)}
              </span>
            </div>
            <p className="text-muted-foreground">
              Charged automatically to the customer&apos;s saved card when you
              complete the handover. If the card declines you can take payment
              at the terminal instead.
            </p>
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader>
          <CardTitle className="h3">Handover</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <label className="flex items-start gap-3 text-base">
            <input
              type="checkbox"
              checked={keysHanded}
              onChange={(e) => setKeysHanded(e.target.checked)}
              className="mt-1 h-5 w-5"
            />
            <span>Keys, helmet and any agreed add-ons handed to the customer.</span>
          </label>
          <div>
            <Label>Staff notes (optional)</Label>
            <Input value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="e.g. customer arrived 15 min late" />
          </div>
        </CardContent>
      </Card>

      {err && (
        <div className="rounded-md border border-destructive/30 bg-destructive/10 p-3 text-sm text-destructive">
          {err}
        </div>
      )}

      {failedStep && (
        <Card>
          <CardHeader>
            <CardTitle className="h3">
              {failedStep === "remainder"
                ? "Payment could not be collected"
                : "Bond hold could not be placed"}
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3 text-sm">
            <p className="text-muted-foreground">
              {failedStep === "remainder"
                ? "Take the payment at the terminal (Record payment on the booking) and retry — or hand over anyway and collect later."
                : "Ask the customer for another card and retry — or hand over without bond security."}
            </p>
            {failedStep === "remainder" && (
              <Button variant="secondary" asChild>
                <Link href={`/staff/bookings/${id}`}>Open booking → Record payment</Link>
              </Button>
            )}
            <div>
              <Label>Override reason (required to proceed without it)</Label>
              <Input
                value={overrideReason}
                onChange={(e) => setOverrideReason(e.target.value)}
                placeholder={
                  failedStep === "remainder"
                    ? "e.g. EFTPOS terminal payment taken, receipt #1234"
                    : "e.g. manager approved handover without bond"
                }
              />
            </div>
            <Button
              variant="destructive"
              disabled={!overrideReason.trim() || checkOut.isPending}
              onClick={() => submit(true)}
            >
              Override &amp; complete handover
            </Button>
          </CardContent>
        </Card>
      )}

      <div className="hidden gap-3 md:flex">
        <Button onClick={() => submit()} disabled={!canSubmit || checkOut.isPending}>
          {checkOut.isPending ? "Completing…" : "Complete check-out"}
        </Button>
        <Button variant="ghost" asChild>
          <Link href={`/staff/bookings/${id}/check-out`}>Back to overview</Link>
        </Button>
      </div>

      <MobileBottomBar>
        <Button
          onClick={() => submit()}
          disabled={!canSubmit || checkOut.isPending}
          className="flex-1"
        >
          {checkOut.isPending ? "Completing…" : "Complete check-out"}
        </Button>
      </MobileBottomBar>
    </PageShell>
  );
}
