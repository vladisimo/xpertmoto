"use client";

import { use, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { trpc } from "@/lib/trpc/client";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { PageHeader } from "@/components/layout/page-header";
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

  if (!b) return <PageShell><LoadingBlock padded="lg" /></PageShell>;


  const requireLicence = prereqs?.requireLicenceVerification ?? true;
  const canSubmit =
    !!signed &&
    keysHanded &&
    (!requireLicence || b.licenceVerified) &&
    b.customerIdVerified &&
    !!preHire;

  async function submit() {
    if (!signed || !preHire) return;
    setErr(null);
    try {
      await checkOut.mutateAsync({
        bookingId: id,
        odometerKm: preHire.odometerKm,
        fuelLevel: preHire.fuelLevel,
        licenceVerified: b!.licenceVerified,
        customerIdVerified: b!.customerIdVerified,
        agreementId: signed.id,
        notes: notes || undefined,
      });
      await utils.staffBooking.detail.invalidate({ id });
      router.push(`/staff/bookings/${id}`);
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Check-out failed");
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
        eyebrow="Operations"
        breadcrumbs={[
          { label: "Bookings", href: "/staff/calendar" },
          { label: b.bookingReference, href: `/staff/bookings/${id}` },
          { label: "Check out", href: `/staff/bookings/${id}/check-out` },
          { label: "4. Confirm" },
        ]}
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
            <Button variant="secondary" asChild>
              <Link href={signed.pdfUrl} target="_blank">
                View / download PDF
              </Link>
            </Button>
            {signed.timestampStatus === "OK" && signed.timestampedAt && (
              <p className="caption mt-2">
                Timestamped via RFC3161 on{" "}
                {new Date(signed.timestampedAt).toLocaleString("en-AU")}
              </p>
            )}
            {signed.timestampStatus === "FAILED" && (
              <p className="caption mt-2 text-amber-600">Timestamping failed — retry available from the booking page.</p>
            )}
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

      <div className="flex gap-3">
        <Button onClick={submit} disabled={!canSubmit || checkOut.isPending}>
          {checkOut.isPending ? "Completing…" : "Complete check-out"}
        </Button>
        <Button variant="ghost" asChild>
          <Link href={`/staff/bookings/${id}/check-out`}>Back to overview</Link>
        </Button>
      </div>
    </PageShell>
  );
}
