"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Image from "next/image";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { useSession } from "next-auth/react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Eye, FileText, Info, Pencil } from "lucide-react";

import { useBookingWizard } from "@/stores/booking-wizard";
import { trpc } from "@/lib/trpc/client";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { LoadingBlock } from "@/components/ui/spinner";
import { StatusBadge } from "@/components/ui/status-badge";
import { IdentityUploadCard, type IdentityExtractedPatch } from "@/components/customer/identity-upload-card";
import { LicenceDropzonePair } from "@/components/customer/licence-dropzone-pair";
import { detailsStepSchema, type DetailsStepValues } from "@/lib/validators/booking";
import { useBookingFlags } from "@/components/booking/booking-flags-context";
import { InlineAuthPanel } from "@/components/booking/identity/inline-auth-panel";
import { AuLicenceQuestion } from "@/components/booking/identity/au-licence-question";
import { useStepContinueAction } from "@/hooks/use-step-continue-action";
import { useWizardShellLayout } from "@/components/booking/wizard-shell-layout-context";
import { useRequiredIdImagesGuard } from "@/components/booking/use-required-id-images-guard";

const AU_STATES = ["QLD", "NSW", "VIC", "TAS", "SA", "WA", "NT", "ACT"] as const;

const toDateInput = (value: Date | string | null | undefined): string => {
  if (!value) return "";
  const d = value instanceof Date ? value : new Date(value);
  return Number.isNaN(d.getTime()) ? "" : d.toISOString().slice(0, 10);
};

const formatDate = (value: Date | string | null | undefined): string => {
  if (!value) return "—";
  const d = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleDateString("en-AU", { day: "2-digit", month: "short", year: "numeric" });
};

const orDash = (value: string | null | undefined): string =>
  value && value.trim().length > 0 ? value : "—";

/**
 * Identity images on CustomerProfile store raw S3 keys. Route them through
 * the same-origin /api/identity-image proxy (auth + CSP-safe) — same
 * resolver IdentityUploadCard uses.
 */
function resolveImageSrc(raw: string | null | undefined): string | null {
  if (!raw) return null;
  if (raw.startsWith("http://") || raw.startsWith("https://") || raw.startsWith("/")) {
    return raw;
  }
  return `/api/identity-image?key=${encodeURIComponent(raw)}`;
}

function expiryStatus(raw: Date | string | null | undefined): "VALID" | "EXPIRES_SOON" | "EXPIRED" | null {
  if (!raw) return null;
  const d = new Date(raw);
  if (Number.isNaN(d.getTime())) return null;
  const diffDays = Math.floor((d.getTime() - Date.now()) / (1000 * 60 * 60 * 24));
  if (diffDays < 0) return "EXPIRED";
  if (diffDays <= 60) return "EXPIRES_SOON";
  return "VALID";
}

/**
 * A review-viable profile has enough data to render the summary without
 * looking half-empty. If any of these are missing we surface the full
 * edit form directly instead of showing a skeleton review card.
 */
function isProfileReviewable(
  me: { firstName?: string | null; lastName?: string | null; dateOfBirth?: Date | string | null; customerProfile?: { licenceNumber?: string | null; licenceState?: string | null; licenceExpiry?: Date | string | null; passportNumber?: string | null; passportExpiry?: Date | string | null } | null } | null | undefined,
): boolean {
  if (!me) return false;
  const profile = me.customerProfile;
  const hasName = !!(me.firstName && me.lastName);
  const hasDob = !!me.dateOfBirth;
  const hasLicence = !!(profile?.licenceNumber && profile?.licenceState && profile?.licenceExpiry);
  const hasPassport = !!(profile?.passportNumber && profile?.passportExpiry);
  return hasName && hasDob && (hasLicence || hasPassport);
}

/** Where the booking wizard lives. Used as the `next` query param when
 * we bounce a logged-in-but-not-onboarded customer through /onboarding. */
const STEP4_RETURN_PATH = "/booking/4";

export function StepDetails() {
  const w = useBookingWizard();
  const flags = useBookingFlags();
  const layout = useWizardShellLayout();
  const router = useRouter();
  const { data: session, status, update: updateSession } = useSession();

  // Deep-link guard: a logged-in customer who hasn't completed
  // onboarding yet and lands directly on /booking/4 must be routed to
  // /onboarding before they can keep going. Booking is unauthenticated-
  // safe so the layout doesn't catch this case for us. pending2fa
  // step-up takes priority over onboarding (see src/server/trpc/CLAUDE.md).
  useEffect(() => {
    if (status !== "authenticated") return;
    if (session?.pending2fa === true) {
      router.push(`/verify-2fa-step-up?next=${encodeURIComponent(STEP4_RETURN_PATH)}`);
      return;
    }
    if (session?.requiresOnboarding === true) {
      router.push(`/onboarding?next=${encodeURIComponent(STEP4_RETURN_PATH)}`);
    }
  }, [status, session?.pending2fa, session?.requiresOnboarding, router]);
  const { data: me, refetch: refetchMe, isSuccess: meLoaded } = trpc.customer.me.useQuery(undefined, {
    // Don't fire while the customer is being routed through step-up or
    // onboarding — the protectedProcedure gate would reject and surface
    // a noisy error.
    enabled:
      !!session?.user &&
      session?.pending2fa !== true &&
      session?.requiresOnboarding !== true,
    staleTime: 60_000,
  });
  const updateProfile = trpc.customer.updateProfile.useMutation();
  // Legacy passport toggle — only used when wizard_intl_licence_flow is OFF.
  // With the flag ON the binary AU-vs-IDP gate drives the UI, so this
  // state is ignored.
  const [usingPassport, setUsingPassport] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [mode, setMode] = useState<"review" | "edit">("review");

  const form = useForm<DetailsStepValues>({
    resolver: zodResolver(detailsStepSchema),
    mode: "onBlur",
    defaultValues: {
      firstName: w.customer.firstName || session?.user?.name?.split(" ")[0] || "",
      lastName: w.customer.lastName || "",
      email: w.customer.email || session?.user?.email || "",
      phone: w.customer.phone || "",
      dateOfBirth: w.customer.dateOfBirth || "",
      identityPath: w.identityPath ?? undefined,
      licenceNumber: w.customer.licenceNumber || "",
      licenceState: (w.customer.licenceState as (typeof AU_STATES)[number]) || undefined,
      licenceCountry: w.customer.licenceCountry || "",
      licenceExpiry: w.customer.licenceExpiry || "",
      licenceClass: w.customer.licenceClass || "",
      passportNumber: w.customer.passportNumber || "",
      passportCountry: w.customer.passportCountry || "",
      passportExpiry: w.customer.passportExpiry || "",
      emergencyContactName: w.customer.emergencyContactName || "",
      emergencyContactPhone: w.customer.emergencyContactPhone || "",
    },
  });

  // When `me` resolves, treat the profile as authoritative and seed both
  // the wizard store (so later steps see the real data) and the form
  // (so editing starts from the correct values). We only overwrite fields
  // the user hasn't typed into in this session so a signed-in customer
  // who started as a guest doesn't lose their typed-over entries.
  useEffect(() => {
    if (!me) return;
    const profile = me.customerProfile;
    const fromProfile: DetailsStepValues = {
      firstName: me.firstName ?? "",
      lastName: me.lastName ?? "",
      email: me.email ?? "",
      phone: me.phone ?? "",
      dateOfBirth: toDateInput(me.dateOfBirth),
      identityPath:
        profile?.licenceType === "AU_LICENCE" || profile?.licenceType === "INTERNATIONAL"
          ? profile.licenceType
          : undefined,
      licenceNumber: profile?.licenceNumber ?? "",
      licenceState: (profile?.licenceState as (typeof AU_STATES)[number] | undefined) ?? undefined,
      licenceCountry: profile?.licenceCountry ?? "",
      licenceExpiry: toDateInput(profile?.licenceExpiry),
      licenceClass: profile?.licenceClass ?? "",
      passportNumber: profile?.passportNumber ?? "",
      passportCountry: profile?.passportCountry ?? "",
      passportExpiry: toDateInput(profile?.passportExpiry),
      emergencyContactName: profile?.emergencyContactName ?? "",
      emergencyContactPhone: profile?.emergencyContactPhone ?? "",
    };
    const current = form.getValues();
    const patch: Partial<DetailsStepValues> = {};
    (Object.keys(fromProfile) as (keyof DetailsStepValues)[]).forEach((key) => {
      const next = fromProfile[key];
      const now = current[key];
      const nowEmpty = now === undefined || now === null || now === "";
      if (next && nowEmpty) patch[key] = next as never;
    });
    if (Object.keys(patch).length > 0) {
      form.reset({ ...current, ...patch }, { keepDirtyValues: true });
    }
    // Mirror the seeded values into the wizard store so Review/Payment
    // see the customer's real identity even before they hit Continue.
    w.setCustomer({
      firstName: fromProfile.firstName || w.customer.firstName || "",
      lastName: fromProfile.lastName || w.customer.lastName || "",
      email: fromProfile.email || w.customer.email || "",
      phone: fromProfile.phone || w.customer.phone || "",
      dateOfBirth: fromProfile.dateOfBirth || w.customer.dateOfBirth || "",
      licenceNumber: fromProfile.licenceNumber || w.customer.licenceNumber || "",
      licenceState: fromProfile.licenceState || w.customer.licenceState || "",
      licenceCountry: fromProfile.licenceCountry || w.customer.licenceCountry || "",
      licenceExpiry: fromProfile.licenceExpiry || w.customer.licenceExpiry || "",
      licenceClass: fromProfile.licenceClass || w.customer.licenceClass || "",
      passportNumber: fromProfile.passportNumber || w.customer.passportNumber || "",
      passportCountry: fromProfile.passportCountry || w.customer.passportCountry || "",
      passportExpiry: fromProfile.passportExpiry || w.customer.passportExpiry || "",
      emergencyContactName: fromProfile.emergencyContactName || w.customer.emergencyContactName || "",
      emergencyContactPhone: fromProfile.emergencyContactPhone || w.customer.emergencyContactPhone || "",
    });
    // Seed identityPath from the profile if present and we don't have a
    // fresh answer in the store from this wizard session.
    if (fromProfile.identityPath && !w.identityPath) {
      w.set("identityPath", fromProfile.identityPath);
    }
    // Auto-expand the passport toggle if the customer already has a
    // passport on file (upload happened via /dashboard/documents, say).
    if (profile?.passportNumber || profile?.passportImage) {
      setUsingPassport(true);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [me]);

  // Route incomplete profiles straight to edit mode so the user isn't
  // shown a review card full of em-dashes.
  const reviewable = useMemo(() => isProfileReviewable(me ?? null), [me]);
  useEffect(() => {
    if (meLoaded && !reviewable) setMode("edit");
  }, [meLoaded, reviewable]);

  const profile = me?.customerProfile;

  // Required ID images by identity path. The hook re-runs the same check
  // at steps 5 & 6 as a safety net for deep-link / back-button bypasses.
  const { missingImagesMessage } = useRequiredIdImagesGuard();

  const uploadSectionRef = useRef<HTMLDivElement | null>(null);

  function focusUploadSection() {
    requestAnimationFrame(() => {
      uploadSectionRef.current?.scrollIntoView({ behavior: "smooth", block: "center" });
    });
  }

  useEffect(() => {
    const sub = form.watch((values) => {
      w.setCustomer({
        firstName: values.firstName ?? "",
        lastName: values.lastName ?? "",
        email: values.email ?? "",
        phone: values.phone ?? "",
        dateOfBirth: values.dateOfBirth ?? "",
        licenceNumber: values.licenceNumber ?? "",
        licenceState: values.licenceState ?? "",
        licenceCountry: values.licenceCountry ?? "",
        licenceExpiry: values.licenceExpiry ?? "",
        licenceClass: values.licenceClass ?? "",
        passportNumber: values.passportNumber ?? "",
        passportCountry: values.passportCountry ?? "",
        passportExpiry: values.passportExpiry ?? "",
        emergencyContactName: values.emergencyContactName ?? "",
        emergencyContactPhone: values.emergencyContactPhone ?? "",
      });
    });
    return () => sub.unsubscribe();
  }, [form, w]);

  // Register the step's Continue action up-front so hook order stays
  // stable regardless of which render branch we take below. Behaviour:
  // - Unauth'd / loading → disabled (inline auth panel owns the flow).
  // - Review mode with a complete profile → simple w.next().
  // - Edit mode → trigger react-hook-form submit (validates + saves via
  //   updateProfile before advancing).
  const isUnauthedOrLoading = status === "loading" || !session?.user;
  const continueLabel = mode === "edit" ? "Save & continue" : "Continue";

  function handleContinue() {
    if (isUnauthedOrLoading) return;
    if (missingImagesMessage) {
      setSaveError(missingImagesMessage);
      if (mode !== "edit") setMode("edit");
      focusUploadSection();
      return;
    }
    if (mode === "edit") {
      void form.handleSubmit(onSubmit)();
      return;
    }
    w.next();
  }

  useStepContinueAction({
    label: continueLabel,
    disabled: isUnauthedOrLoading,
    pending: updateProfile.isPending,
    onClick: handleContinue,
  });

  if (status === "loading") return <LoadingBlock padded="md" />;
  // While the redirect-to-/verify-2fa-step-up or /onboarding useEffect
  // runs, render a spinner instead of the form. Avoids flashing the
  // licence inputs on a customer who is about to be bounced.
  if (
    status === "authenticated" &&
    (session?.pending2fa === true || session?.requiresOnboarding === true)
  ) {
    return <LoadingBlock padded="md" />;
  }

  if (!session?.user) {
    if (flags.wizard_inline_auth) {
      return (
        <div className="space-y-4">
          <h2 className="h2 hidden md:block">Who&apos;s hiring?</h2>
          <InlineAuthPanel
            allProviders={flags.allOAuthProviders}
            enabledProviders={flags.enabledOAuthProviders}
            onAuthenticated={async () => {
              // Refresh the session so Step 4 re-renders in its signed-in
              // state without a full page reload.
              const refreshed = await updateSession();
              // If the freshly-authenticated customer hasn't completed
              // onboarding, route them through it before continuing the
              // booking. The wizard's Zustand store is persisted, so the
              // booking state survives the round-trip.
              if (refreshed?.requiresOnboarding === true) {
                router.push(`/onboarding?next=${encodeURIComponent(STEP4_RETURN_PATH)}`);
              }
            }}
          />
        </div>
      );
    }
    // Legacy fork (flag off) — the pre-refactor redirect-away behaviour.
    return (
      <div className="space-y-4">
        <h2 className="h2 hidden md:block">Sign in to continue</h2>
        <p className="text-muted-foreground">Please sign in or create an account to complete your booking.</p>
        <div className="flex gap-3">
          <Button asChild>
            <Link href={`/login?callbackUrl=/booking`}>Sign in</Link>
          </Button>
          <Button asChild variant="outline">
            <Link href={`/register?callbackUrl=/booking`}>Create account</Link>
          </Button>
        </div>
      </div>
    );
  }

  function applyExtractedPatch(patch: IdentityExtractedPatch) {
    const current = form.getValues();
    const merge: Partial<DetailsStepValues> = {};
    for (const [k, v] of Object.entries(patch) as [keyof IdentityExtractedPatch, string | undefined][]) {
      if (!v) continue;
      const currentVal = (current as Record<string, unknown>)[k];
      if (!currentVal || currentVal === "") {
        merge[k as keyof DetailsStepValues] = v as never;
      }
    }
    if (Object.keys(merge).length > 0) {
      form.reset({ ...current, ...merge }, { keepDirtyValues: true });
    }
  }

  async function onSubmit(values: DetailsStepValues) {
    setSaveError(null);
    if (missingImagesMessage) {
      setSaveError(missingImagesMessage);
      focusUploadSection();
      return;
    }
    try {
      await updateProfile.mutateAsync({
        firstName: values.firstName,
        lastName: values.lastName,
        phone: values.phone || undefined,
        dateOfBirth: values.dateOfBirth || undefined,
        licenceType: values.identityPath,
        licenceNumber: values.licenceNumber || undefined,
        licenceState: values.identityPath === "INTERNATIONAL" ? undefined : values.licenceState,
        licenceCountry:
          values.identityPath === "INTERNATIONAL" && values.licenceCountry
            ? values.licenceCountry
            : undefined,
        licenceExpiry: values.licenceExpiry || undefined,
        licenceClass: values.licenceClass || undefined,
        passportNumber: values.passportNumber || undefined,
        passportCountry: values.passportCountry || undefined,
        passportExpiry: values.passportExpiry || undefined,
        emergencyContactName: values.emergencyContactName || undefined,
        emergencyContactPhone: values.emergencyContactPhone || undefined,
      });
      await refetchMe().catch(() => undefined);
      w.next();
    } catch (err) {
      setSaveError(err instanceof Error ? err.message : "Could not save your details.");
    }
  }

  if (mode === "review" && me && reviewable) {
    return (
      <div className="space-y-6">
        <h2 className="h2 hidden md:block">Review your details</h2>

        <div className="relative rounded-lg border border-border bg-card px-5 pb-5 pt-3 space-y-5">
          <Button
            type="button"
            variant="secondary"
            size="sm"
            onClick={() => setMode("edit")}
            className="absolute right-3 top-3"
          >
            <Pencil className="mr-1.5 h-3.5 w-3.5" />
            Edit details
          </Button>
          <ReviewBlock title="Personal">
            <ReviewRow label="Name" value={`${me.firstName ?? ""} ${me.lastName ?? ""}`.trim() || "—"} />
            <ReviewRow label="Email" value={orDash(me.email)} />
            <ReviewRow label="Phone" value={orDash(me.phone)} />
            <ReviewRow label="Date of birth" value={formatDate(me.dateOfBirth)} />
          </ReviewBlock>

          {((profile?.licenceNumber || profile?.licenceState || profile?.licenceExpiry) ||
            (profile?.passportNumber || profile?.passportExpiry)) && (
            <div className="grid grid-cols-2 gap-x-6 gap-y-4">
              {(profile?.licenceNumber || profile?.licenceState || profile?.licenceExpiry) && (
                <ReviewBlock title="Driver&apos;s licence">
                  <ReviewRow label="Licence number" value={orDash(profile?.licenceNumber)} />
                  <ReviewRow label="State" value={orDash(profile?.licenceState)} />
                  <ReviewRow label="Class" value={orDash(profile?.licenceClass)} />
                  <ReviewRow label="Expires" value={formatDate(profile?.licenceExpiry)} />
                </ReviewBlock>
              )}

              {(profile?.passportNumber || profile?.passportExpiry) && (
                <ReviewBlock title="Passport">
                  <ReviewRow label="Passport number" value={orDash(profile?.passportNumber)} />
                  <ReviewRow label="Country" value={orDash(profile?.passportCountry)} />
                  <ReviewRow label="Expires" value={formatDate(profile?.passportExpiry)} />
                </ReviewBlock>
              )}
            </div>
          )}

          {(profile?.emergencyContactName || profile?.emergencyContactPhone) && (
            <ReviewBlock title="Emergency contact">
              <ReviewRow label="Name" value={orDash(profile?.emergencyContactName)} />
              <ReviewRow label="Phone" value={orDash(profile?.emergencyContactPhone)} />
            </ReviewBlock>
          )}
        </div>

        <div className="space-y-2">
          <p className="text-sm font-medium">Identity documents on file</p>
          <div className="divide-y divide-border rounded-lg border border-border bg-card">
            {profile?.licenceImageFront && (
              <IdentityReviewRow
                label="Driver's licence (front)"
                imageKey={profile.licenceImageFront}
                expiry={profile.licenceExpiry ?? null}
                verifiedAt={profile.licenceVerifiedAt ?? null}
                onReplace={() => setMode("edit")}
              />
            )}
            {profile?.licenceImageBack && (
              <IdentityReviewRow
                label="Driver's licence (back)"
                imageKey={profile.licenceImageBack}
                expiry={null}
                verifiedAt={null}
                onReplace={() => setMode("edit")}
              />
            )}
            {profile?.passportImage && (
              <IdentityReviewRow
                label="Passport"
                imageKey={profile.passportImage}
                expiry={profile.passportExpiry ?? null}
                verifiedAt={profile.passportVerifiedAt ?? null}
                onReplace={() => setMode("edit")}
              />
            )}
            {!profile?.licenceImageFront && !profile?.licenceImageBack && !profile?.passportImage && (
              <p className="p-4 text-sm text-muted-foreground">
                No images on file yet. Click <button type="button" onClick={() => setMode("edit")} className="underline underline-offset-2">Edit details</button> to upload.
              </p>
            )}
          </div>
          {missingImagesMessage && (
            <div className="rounded-md border border-destructive/30 bg-destructive/10 p-3 text-sm text-destructive">
              <Info className="mr-1 -mt-0.5 inline-block h-4 w-4" />
              {missingImagesMessage}{" "}
              <button
                type="button"
                onClick={() => setMode("edit")}
                className="underline underline-offset-2"
              >
                Edit details
              </button>{" "}
              to upload.
            </div>
          )}
        </div>

        {layout === "desktop" && (
          <div className="flex justify-between">
            <Button type="button" variant="outline" onClick={() => w.back()}>Back</Button>
            <Button type="button" onClick={handleContinue}>Continue</Button>
          </div>
        )}
      </div>
    );
  }

  return (
    <Form {...form}>
      <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-6">
        <div className="flex items-start justify-between gap-3">
          <div>
            <h2 className="h2 hidden md:block">Your details</h2>
            <p className="body-text text-muted-foreground">
              Upload either a driver&apos;s licence or a passport — one valid document is enough to hire.
              We&apos;ll read the details from the image so you don&apos;t have to type them all.
            </p>
          </div>
          {reviewable && (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={() => setMode("review")}
            >
              Cancel edit
            </Button>
          )}
        </div>

        <div className="space-y-4" ref={uploadSectionRef}>
          {missingImagesMessage && (
            <div className="rounded-md border border-destructive/30 bg-destructive/10 p-3 text-sm text-destructive">
              <Info className="mr-1 -mt-0.5 inline-block h-4 w-4" />
              {missingImagesMessage}
            </div>
          )}
          {flags.wizard_intl_licence_flow ? (
            <>
              <AuLicenceQuestion
                value={w.identityPath}
                onChange={(next) => {
                  w.set("identityPath", next);
                  form.setValue("identityPath", next, { shouldValidate: true });
                }}
              />

              {w.identityPath === "AU_LICENCE" && (
                <LicenceDropzonePair
                  profile={profile ?? null}
                  onExtracted={applyExtractedPatch}
                  onUploaded={() => refetchMe()}
                />
              )}

              {w.identityPath === "INTERNATIONAL" && (
                <>
                  <div className="rounded-md border border-primary/20 bg-primary/5 p-3 text-sm">
                    <p className="font-medium">
                      You&apos;ll need both documents to hire
                    </p>
                    <p className="text-muted-foreground">
                      Upload your International Driver&apos;s Permit <strong>and</strong>{" "}
                      your passport. Both are required when you don&apos;t hold an AU
                      licence.
                    </p>
                  </div>
                  <IdentityUploadCard
                    kind="LICENCE_FRONT"
                    currentImageUrl={profile?.licenceImageFront ?? null}
                    currentExpiry={profile?.licenceExpiry ?? null}
                    currentVerifiedAt={profile?.licenceVerifiedAt ?? null}
                    onExtracted={applyExtractedPatch}
                    onUploaded={() => refetchMe()}
                  />
                  <IdentityUploadCard
                    kind="PASSPORT"
                    currentImageUrl={profile?.passportImage ?? null}
                    currentExpiry={profile?.passportExpiry ?? null}
                    currentVerifiedAt={profile?.passportVerifiedAt ?? null}
                    onExtracted={applyExtractedPatch}
                    onUploaded={() => refetchMe()}
                  />
                </>
              )}
            </>
          ) : (
            <>
              <LicenceDropzonePair
                profile={profile ?? null}
                onExtracted={applyExtractedPatch}
                onUploaded={() => refetchMe()}
              />

              <label className="flex items-start gap-2 rounded-md border border-border bg-muted/40 p-3 text-sm">
                <input
                  type="checkbox"
                  checked={usingPassport}
                  onChange={(e) => setUsingPassport(e.target.checked)}
                  className="mt-0.5 h-4 w-4"
                />
                <span>
                  <span className="font-medium">I&apos;m using a passport</span>
                  <span className="block text-muted-foreground">
                    Tick this if you want to rely on a passport alone (no licence on file). A valid
                    passport is accepted at check-out in place of a driver&apos;s licence.
                  </span>
                </span>
              </label>

              {usingPassport && (
                <IdentityUploadCard
                  kind="PASSPORT"
                  currentImageUrl={profile?.passportImage ?? null}
                  currentExpiry={profile?.passportExpiry ?? null}
                  currentVerifiedAt={profile?.passportVerifiedAt ?? null}
                  onExtracted={applyExtractedPatch}
                  onUploaded={() => refetchMe()}
                />
              )}
            </>
          )}
        </div>

        <div className="grid grid-cols-2 gap-3 md:gap-4">
          <FormField
            control={form.control}
            name="firstName"
            render={({ field }) => (
              <FormItem>
                <FormLabel>First name</FormLabel>
                <FormControl><Input autoComplete="given-name" {...field} /></FormControl>
                <FormMessage />
              </FormItem>
            )}
          />
          <FormField
            control={form.control}
            name="lastName"
            render={({ field }) => (
              <FormItem>
                <FormLabel>Last name</FormLabel>
                <FormControl><Input autoComplete="family-name" {...field} /></FormControl>
                <FormMessage />
              </FormItem>
            )}
          />
          <FormField
            control={form.control}
            name="email"
            render={({ field }) => (
              <FormItem>
                <FormLabel>Email</FormLabel>
                <FormControl><Input type="email" autoComplete="email" {...field} /></FormControl>
                <FormMessage />
              </FormItem>
            )}
          />
          <FormField
            control={form.control}
            name="phone"
            render={({ field }) => (
              <FormItem>
                <FormLabel>Phone</FormLabel>
                <FormControl>
                  <Input type="tel" autoComplete="tel" placeholder="0412 345 678" {...field} value={field.value ?? ""} />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />
          <FormField
            control={form.control}
            name="dateOfBirth"
            render={({ field }) => (
              <FormItem>
                <FormLabel>Date of birth</FormLabel>
                <FormControl><Input type="date" autoComplete="bday" {...field} /></FormControl>
                <FormMessage />
              </FormItem>
            )}
          />

          {(!flags.wizard_intl_licence_flow || w.identityPath === "AU_LICENCE") && (
            <>
              <div className="col-span-2">
                <h3 className="h3 mt-2">
                  {flags.wizard_intl_licence_flow
                    ? "Australian driver's licence"
                    : "Driver's licence (optional if passport supplied)"}
                </h3>
              </div>
              <FormField
                control={form.control}
                name="licenceNumber"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Licence number</FormLabel>
                    <FormControl><Input {...field} value={field.value ?? ""} /></FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="licenceState"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Licence state</FormLabel>
                    <Select
                      value={field.value ?? ""}
                      onValueChange={(v) => field.onChange(v === "__none__" ? "" : v)}
                    >
                      <FormControl>
                        <SelectTrigger>
                          <SelectValue placeholder="—" />
                        </SelectTrigger>
                      </FormControl>
                      <SelectContent>
                        <SelectItem value="__none__">—</SelectItem>
                        {AU_STATES.map((s) => (
                          <SelectItem key={s} value={s}>{s}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="licenceExpiry"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Licence expiry</FormLabel>
                    <FormControl><Input type="date" {...field} value={field.value ?? ""} /></FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="licenceClass"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Licence class</FormLabel>
                    <FormControl><Input {...field} value={field.value ?? ""} placeholder="e.g. C, RE, R" /></FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
            </>
          )}

          {flags.wizard_intl_licence_flow && w.identityPath === "INTERNATIONAL" && (
            <>
              <div className="col-span-2">
                <h3 className="h3 mt-2">International Driver&apos;s Permit</h3>
              </div>
              <FormField
                control={form.control}
                name="licenceNumber"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>IDP number</FormLabel>
                    <FormControl><Input {...field} value={field.value ?? ""} /></FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="licenceCountry"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Issuing country (2-letter code)</FormLabel>
                    <FormControl>
                      <Input
                        {...field}
                        value={field.value ?? ""}
                        placeholder="US, GB, NZ…"
                        maxLength={2}
                        autoCapitalize="characters"
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="licenceExpiry"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>IDP expiry</FormLabel>
                    <FormControl><Input type="date" {...field} value={field.value ?? ""} /></FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="licenceClass"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>IDP class (optional)</FormLabel>
                    <FormControl><Input {...field} value={field.value ?? ""} placeholder="e.g. A, B" /></FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <div className="col-span-2">
                <h3 className="h3 mt-2">Passport</h3>
              </div>
              <FormField
                control={form.control}
                name="passportNumber"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Passport number</FormLabel>
                    <FormControl><Input {...field} value={field.value ?? ""} /></FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="passportCountry"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Passport country</FormLabel>
                    <FormControl><Input {...field} value={field.value ?? ""} placeholder="US, GB…" /></FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="passportExpiry"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Passport expiry</FormLabel>
                    <FormControl><Input type="date" {...field} value={field.value ?? ""} /></FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
            </>
          )}

          {!flags.wizard_intl_licence_flow && usingPassport && (
            <>
              <div className="col-span-2">
                <h3 className="h3 mt-2">Passport</h3>
              </div>
              <FormField
                control={form.control}
                name="passportNumber"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Passport number</FormLabel>
                    <FormControl><Input {...field} value={field.value ?? ""} /></FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="passportCountry"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Country</FormLabel>
                    <FormControl><Input {...field} value={field.value ?? ""} placeholder="AU" /></FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="passportExpiry"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Passport expiry</FormLabel>
                    <FormControl><Input type="date" {...field} value={field.value ?? ""} /></FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
            </>
          )}

          <div className="col-span-2">
            <h3 className="h3 mt-2">Emergency contact</h3>
          </div>
          <FormField
            control={form.control}
            name="emergencyContactName"
            render={({ field }) => (
              <FormItem>
                <FormLabel>Emergency contact name</FormLabel>
                <FormControl><Input {...field} value={field.value ?? ""} /></FormControl>
                <FormMessage />
              </FormItem>
            )}
          />
          <FormField
            control={form.control}
            name="emergencyContactPhone"
            render={({ field }) => (
              <FormItem>
                <FormLabel>Emergency contact phone</FormLabel>
                <FormControl><Input type="tel" {...field} value={field.value ?? ""} /></FormControl>
                <FormMessage />
              </FormItem>
            )}
          />
        </div>

        {form.formState.submitCount > 0 && !form.formState.isValid && (
          <div className="rounded-md border border-destructive/30 bg-destructive/5 p-3 text-sm text-destructive">
            <Info className="inline-block h-4 w-4 mr-1 -mt-0.5" />
            A few things need your attention above before we can continue.
          </div>
        )}
        {saveError && (
          <div className="rounded-md border border-destructive/30 bg-destructive/10 p-3 text-sm text-destructive">
            {saveError}
          </div>
        )}
        {layout === "desktop" && (
          <div className="flex justify-between">
            <Button type="button" variant="outline" onClick={() => w.back()}>Back</Button>
            <Button type="submit" disabled={updateProfile.isPending}>
              {updateProfile.isPending ? "Saving…" : "Save & continue"}
            </Button>
          </div>
        )}
      </form>
    </Form>
  );
}

function ReviewBlock({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="space-y-2">
      <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
        {title}
      </p>
      <dl className="divide-y divide-border/50">
        {children}
      </dl>
    </div>
  );
}

function ReviewRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-baseline justify-between gap-3 py-1.5">
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className="truncate text-right text-sm font-medium">{value}</dd>
    </div>
  );
}

function IdentityReviewRow({
  label,
  imageKey,
  expiry,
  verifiedAt,
  onReplace,
}: {
  label: string;
  imageKey: string;
  expiry: Date | string | null;
  verifiedAt: Date | string | null;
  onReplace: () => void;
}) {
  const [open, setOpen] = useState(false);
  const src = resolveImageSrc(imageKey);
  const tone = expiryStatus(expiry);

  return (
    <div className="flex flex-wrap items-center gap-3 p-3">
      <FileText className="h-5 w-5 shrink-0 text-muted-foreground" aria-hidden />
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-sm font-medium">{label}</span>
          {verifiedAt && <StatusBadge status="VERIFIED" />}
          {tone && <StatusBadge status={tone} />}
        </div>
      </div>
      <div className="flex items-center gap-1">
        {src && (
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={() => setOpen(true)}
            aria-label={`View ${label}`}
          >
            <Eye className="h-4 w-4" />
          </Button>
        )}
        <Button type="button" variant="ghost" size="sm" onClick={onReplace}>
          Replace
        </Button>
      </div>
      {src && (
        <Dialog open={open} onOpenChange={setOpen}>
          <DialogContent className="max-w-3xl">
            <DialogHeader>
              <DialogTitle>{label}</DialogTitle>
            </DialogHeader>
            <div className="relative aspect-[8/5] w-full overflow-hidden rounded-md border border-border bg-muted/40">
              <Image
                src={src}
                alt={label}
                fill
                sizes="(max-width: 768px) 100vw, 800px"
                className="object-contain"
                unoptimized
              />
            </div>
          </DialogContent>
        </Dialog>
      )}
    </div>
  );
}
