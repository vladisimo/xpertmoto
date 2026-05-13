"use client";

import { use, useMemo, useState } from "react";
import Link from "next/link";
import Image from "next/image";
import { useRouter } from "next/navigation";
import { trpc } from "@/lib/trpc/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { PageHeader } from "@/components/layout/page-header";
import { PageShell } from "@/components/layout/page-section";
import { MobileBottomBar } from "@/components/layout/mobile-bottom-bar";
import { LoadingBlock } from "@/components/ui/spinner";
import { formatDate } from "@/lib/utils";
import { formatLicenceClasses } from "@/lib/licence-class";

// Identity images are stored as raw S3 keys (e.g. "drivers/<uid>/file.jpg").
// next/image needs a leading "/" or an absolute URL, and direct MinIO/S3 URLs
// fail under our CSP — route bytes through the same-origin /api/identity-image
// proxy, which enforces auth (staff can fetch any identity key).
function resolveImageSrc(raw: string | null | undefined): string | null {
  if (!raw) return null;
  if (raw.startsWith("http://") || raw.startsWith("https://") || raw.startsWith("/")) {
    return raw;
  }
  return `/api/identity-image?key=${encodeURIComponent(raw)}`;
}

export default function CheckOutVerifyPage(props: { params: Promise<{ id: string }> }) {
  const { id } = use(props.params);
  const router = useRouter();
  const utils = trpc.useUtils();
  const { data: b } = trpc.staffBooking.detail.useQuery({ id });
  const setVerification = trpc.staffBooking.setVerification.useMutation();
  const [idOk, setIdOk] = useState(false);
  const [validIdOk, setValidIdOk] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  // Compute whether the incoming profile carries a valid passport at the
  // scheduled pickup date. We mirror the server rule so the motorcycle
  // warning can be rendered even before the mutation runs.
  const passportValidAtPickup = useMemo(() => {
    if (!b) return false;
    const cp = b.customer.customerProfile;
    if (!cp?.passportNumber || !cp.passportExpiry) return false;
    const expiry = new Date(cp.passportExpiry);
    const pickup = new Date(b.pickupDateTime);
    return expiry.getTime() >= pickup.getTime();
  }, [b]);

  const licenceValidAtPickup = useMemo(() => {
    if (!b) return false;
    const cp = b.customer.customerProfile;
    if (!cp?.licenceClass) return false;
    if (!cp.licenceExpiry) return true;
    const expiry = new Date(cp.licenceExpiry);
    const pickup = new Date(b.pickupDateTime);
    return expiry.getTime() >= pickup.getTime();
  }, [b]);

  const isMotorcycleCategory = useMemo(() => {
    if (!b) return false;
    const req = (b.category.licenceRequired || "").toUpperCase();
    return req === "R" || req === "RE";
  }, [b]);

  // "Passport-only" means: we have a valid passport but the licence path
  // won't carry eligibility (missing or expired or wrong class). Staff need
  // a prominent warning when the rental is motorcycle-class.
  const eligibilityOnPassportOnly =
    passportValidAtPickup && !licenceValidAtPickup;

  if (!b) return <PageShell><LoadingBlock padded="lg" /></PageShell>;

  const profile = b.customer.customerProfile;
  const licenceFrontSrc = resolveImageSrc(profile?.licenceImageFront);
  const licenceBackSrc = resolveImageSrc(profile?.licenceImageBack);
  const passportSrc = resolveImageSrc(profile?.passportImage);

  async function proceed() {
    setErr(null);
    if (!idOk || !validIdOk) {
      setErr("Both the identity check and the valid-ID check must be confirmed before proceeding.");
      return;
    }
    try {
      await setVerification.mutateAsync({
        bookingId: id,
        licenceVerified: validIdOk,
        customerIdVerified: idOk,
      });
      await utils.staffBooking.detail.invalidate({ id });
      router.push(`/staff/bookings/${id}/check-out/sign`);
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Failed to save verification");
    }
  }

  return (
    <PageShell>
      <PageHeader
        eyebrow="Operations · Step 2 of 4"
        breadcrumbs={[
          { label: "Bookings", href: "/staff/calendar" },
          { label: b.bookingReference, href: `/staff/bookings/${id}` },
          { label: "Check out", href: `/staff/bookings/${id}/check-out` },
          { label: "2. Verify" },
        ]}
        title="Identity & licence verification"
        description="Confirm the customer is who they say they are and hold a valid licence or passport."
        back={`/staff/bookings/${id}/check-out`}
        mobileCompact
      />

      <Card>
        <CardHeader>
          <CardTitle className="h3">Customer profile</CardTitle>
        </CardHeader>
        <CardContent className="space-y-2 text-sm">
          <div>
            <strong>{b.customer.firstName} {b.customer.lastName}</strong>
          </div>
          <div className="text-muted-foreground">{b.customer.email}{b.customer.phone ? ` · ${b.customer.phone}` : ""}</div>
          {b.customer.dateOfBirth && (
            <div>Date of birth: {formatDate(b.customer.dateOfBirth)}</div>
          )}
          <div>
            Licence: {profile?.licenceNumber ?? "—"} ({profile?.licenceState ?? "—"}) · Class: {formatLicenceClasses(profile?.licenceClass) || "—"}
          </div>
          <div>
            Licence expiry: {profile?.licenceExpiry ? formatDate(profile.licenceExpiry) : "—"}
          </div>
          <div>
            Passport: {profile?.passportNumber ?? "—"}{profile?.passportCountry ? ` (${profile.passportCountry})` : ""}
          </div>
          <div>
            Passport expiry: {profile?.passportExpiry ? formatDate(profile.passportExpiry) : "—"}
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="h3">Licence photos</CardTitle>
        </CardHeader>
        <CardContent className="grid gap-3 sm:grid-cols-2">
          {licenceFrontSrc ? (
            <div className="relative aspect-[16/10] overflow-hidden rounded-md border border-border">
              <Image src={licenceFrontSrc} alt="Licence front" fill sizes="(max-width: 640px) 100vw, 50vw" className="object-contain" unoptimized />
            </div>
          ) : (
            <div className="flex aspect-[16/10] items-center justify-center rounded-md border border-dashed border-border bg-muted/40 text-sm text-muted-foreground">
              No front photo on file
            </div>
          )}
          {licenceBackSrc ? (
            <div className="relative aspect-[16/10] overflow-hidden rounded-md border border-border">
              <Image src={licenceBackSrc} alt="Licence back" fill sizes="(max-width: 640px) 100vw, 50vw" className="object-contain" unoptimized />
            </div>
          ) : (
            <div className="flex aspect-[16/10] items-center justify-center rounded-md border border-dashed border-border bg-muted/40 text-sm text-muted-foreground">
              No back photo on file
            </div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="h3">Passport</CardTitle>
        </CardHeader>
        <CardContent>
          {passportSrc ? (
            <div className="relative aspect-[4/3] overflow-hidden rounded-md border border-border">
              <Image src={passportSrc} alt="Passport bio-data page" fill sizes="(max-width: 640px) 100vw, 60vw" className="object-contain" unoptimized />
            </div>
          ) : (
            <div className="flex aspect-[4/3] items-center justify-center rounded-md border border-dashed border-border bg-muted/40 text-sm text-muted-foreground">
              No passport photo on file
            </div>
          )}
        </CardContent>
      </Card>

      {eligibilityOnPassportOnly && isMotorcycleCategory && (
        <div className="rounded-md border border-destructive/40 bg-destructive/10 p-4 text-sm text-destructive">
          <p className="font-medium">Eligibility relies on the passport alone.</p>
          <p className="mt-1">
            {b.category.name} requires a {b.category.licenceRequired} motorcycle licence. Sight
            the customer&apos;s riding licence in person before handover — this warning does not block
            check-out, but it will be recorded against the booking.
          </p>
        </div>
      )}

      <Card>
        <CardHeader>
          <CardTitle className="h3">Checks</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3 text-sm">
          <label className="flex items-start gap-3 text-base">
            <input
              type="checkbox"
              checked={idOk}
              onChange={(e) => setIdOk(e.target.checked)}
              className="mt-1 h-5 w-5"
            />
            <span>Photo ID sighted and matches the customer in person.</span>
          </label>
          <label className="flex items-start gap-3 text-base">
            <input
              type="checkbox"
              checked={validIdOk}
              onChange={(e) => setValidIdOk(e.target.checked)}
              className="mt-1 h-5 w-5"
            />
            <span>
              At least one of: valid driver&apos;s licence sighted (correct class for the {b.category.name})
              OR valid passport sighted.
            </span>
          </label>
        </CardContent>
      </Card>

      {err && (
        <div className="rounded-md border border-destructive/30 bg-destructive/10 p-3 text-sm text-destructive">
          {err}
        </div>
      )}

      <div className="hidden gap-3 md:flex">
        <Button onClick={proceed} disabled={setVerification.isPending}>
          {setVerification.isPending ? "Saving…" : "Save & proceed to signing →"}
        </Button>
        <Button variant="ghost" asChild>
          <Link href={`/staff/bookings/${id}/check-out`}>Back to overview</Link>
        </Button>
      </div>

      <MobileBottomBar>
        <Button
          onClick={proceed}
          disabled={setVerification.isPending}
          className="flex-1"
        >
          {setVerification.isPending ? "Saving…" : "Save & continue"}
        </Button>
      </MobileBottomBar>
    </PageShell>
  );
}
