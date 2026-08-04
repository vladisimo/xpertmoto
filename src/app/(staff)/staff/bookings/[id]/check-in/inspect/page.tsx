"use client";

import { use, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { trpc } from "@/lib/trpc/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { PageHeader } from "@/components/layout/page-header";
import { PageShell } from "@/components/layout/page-section";
import { MobileBottomBar } from "@/components/layout/mobile-bottom-bar";
import { LoadingBlock } from "@/components/ui/spinner";
import { PhotoIssueCapture } from "@/components/agreement/photo-issue-capture";

export default function CheckInInspectPage(props: { params: Promise<{ id: string }> }) {
  const { id } = use(props.params);
  const router = useRouter();
  const utils = trpc.useUtils();
  const { data: b } = trpc.staffBooking.detail.useQuery({ id });
  const { data: inspections } = trpc.inspection.byBooking.useQuery({ bookingId: id });
  const preHire = inspections?.find((i) => i.type === "PRE_HIRE");
  const existingPost = inspections?.find((i) => i.type === "POST_HIRE");

  const createInspection = trpc.inspection.create.useMutation();
  const updateInspection = trpc.inspection.update.useMutation();
  const completeInspection = trpc.inspection.complete.useMutation();
  const startReturnDraft = trpc.return.startDraft.useMutation();

  const [createdInspectionId, setCreatedInspectionId] = useState<string | null>(null);
  const inspectionId = createdInspectionId ?? existingPost?.id ?? null;

  const [odometer, setOdometer] = useState(existingPost?.odometerKm?.toString() ?? "");
  const [fuel, setFuel] = useState(existingPost?.fuelLevel ?? 100);
  const [overall, setOverall] = useState<"EXCELLENT" | "GOOD" | "FAIR" | "POOR">(
    (existingPost?.overallCondition as "EXCELLENT" | "GOOD" | "FAIR" | "POOR" | undefined) ?? "GOOD",
  );
  const [err, setErr] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  if (!b) return <PageShell><LoadingBlock padded="lg" /></PageShell>;

  async function createDraft() {
    if (!b || !b.vehicle) {
      setErr("No vehicle assigned — the pickup flow should have allocated one.");
      return;
    }
    setSaving(true);
    try {
      const draft = await createInspection.mutateAsync({
        vehicleId: b.vehicle.id,
        bookingId: b.id,
        type: "POST_HIRE",
        depotId: b.returnDepotId,
        odometerKm: Number(odometer || 0),
        fuelLevel: Number(fuel),
        overallCondition: overall,
        status: "DRAFT",
      });
      setCreatedInspectionId(draft.id);
      await utils.inspection.byBooking.invalidate({ bookingId: b.id });
      setErr(null);
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Failed to start inspection");
    } finally {
      setSaving(false);
    }
  }

  async function saveProgress() {
    if (!inspectionId) return;
    setSaving(true);
    try {
      await updateInspection.mutateAsync({
        id: inspectionId,
        odometerKm: Number(odometer || 0),
        fuelLevel: Number(fuel),
        overallCondition: overall,
      });
      await utils.inspection.byBooking.invalidate({ bookingId: b!.id });
      setErr(null);
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Failed to save");
    } finally {
      setSaving(false);
    }
  }

  async function proceed() {
    if (!inspectionId) return;
    setErr(null);
    try {
      await saveProgress();
      await completeInspection.mutateAsync({ id: inspectionId });
      await startReturnDraft.mutateAsync({ bookingId: b!.id, inspectionId });
      await utils.return.byBooking.invalidate({ bookingId: b!.id });
      router.push(`/staff/bookings/${id}/check-in/assess`);
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Failed to proceed");
    }
  }

  return (
    <PageShell>
      <PageHeader
        eyebrow="Operations · Step 1 of 3"
        breadcrumbs={[
          { label: "Bookings", href: "/staff/calendar" },
          { label: b.bookingReference, href: `/staff/bookings/${id}` },
          { label: "Check in", href: `/staff/bookings/${id}/check-in` },
          { label: "1. Inspect" },
        ]}
        title="Post-hire inspection"
        description="Do this alongside the customer. Compare against the pre-hire reference — the new damage you pin on the return photos is what gets assessed."
        back={`/staff/bookings/${id}/check-in`}
        mobileCompact
      />

      <Card>
        <CardHeader>
          <CardTitle className="h3">Readings</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid grid-cols-2 gap-4">
            <div>
              <Label>Odometer (km)</Label>
              <Input
                type="number"
                inputMode="numeric"
                value={odometer}
                onChange={(e) => setOdometer(e.target.value)}
              />
              {b.pickupOdometerKm ? (
                <p className="caption mt-1">Pickup: {b.pickupOdometerKm} km</p>
              ) : null}
            </div>
            <div>
              <Label>Fuel level (%)</Label>
              <Input
                type="number"
                min={0}
                max={100}
                value={fuel}
                onChange={(e) => setFuel(Number(e.target.value))}
              />
            </div>
          </div>
          <div>
            <Label>Overall condition</Label>
            <div className="mt-2 flex gap-2">
              {(["EXCELLENT", "GOOD", "FAIR", "POOR"] as const).map((c) => (
                <Button
                  key={c}
                  type="button"
                  variant={overall === c ? "default" : "secondary"}
                  size="sm"
                  onClick={() => setOverall(c)}
                >
                  {c.slice(0, 1) + c.slice(1).toLowerCase()}
                </Button>
              ))}
            </div>
          </div>
        </CardContent>
      </Card>

      {preHire ? (
        <Card>
          <CardHeader>
            <CardTitle className="h3">Pre-hire reference</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="caption mb-3">
              Condition documented at check-out — read only. Only <em>new</em> damage you record below is assessed.
            </p>
            <PhotoIssueCapture inspectionId={preHire.id} categoryId={b.categoryId} readOnly />
          </CardContent>
        </Card>
      ) : null}

      {inspectionId ? (
        <Card>
          <CardHeader>
            <CardTitle className="h3">Return photos &amp; new damage</CardTitle>
          </CardHeader>
          <CardContent>
            <PhotoIssueCapture inspectionId={inspectionId} categoryId={b.categoryId} />
          </CardContent>
        </Card>
      ) : (
        <Card>
          <CardContent className="py-6 text-center text-sm text-muted-foreground">
            Save the readings first to enable photo capture.
          </CardContent>
        </Card>
      )}

      {err && (
        <div className="rounded-md border border-destructive/30 bg-destructive/10 p-3 text-sm text-destructive">
          {err}
        </div>
      )}

      <div className="hidden gap-3 md:flex">
        {!inspectionId ? (
          <Button onClick={createDraft} disabled={saving}>
            {saving ? "Starting…" : "Start post-hire inspection"}
          </Button>
        ) : (
          <>
            <Button variant="secondary" onClick={saveProgress} disabled={saving}>
              {saving ? "Saving…" : "Save progress"}
            </Button>
            <Button onClick={proceed} disabled={saving}>
              Proceed to damage assessment →
            </Button>
          </>
        )}
        <Button variant="ghost" asChild>
          <Link href={`/staff/bookings/${id}/check-in`}>Back to overview</Link>
        </Button>
      </div>

      <MobileBottomBar>
        {!inspectionId ? (
          <Button onClick={createDraft} disabled={saving} className="flex-1">
            {saving ? "Starting…" : "Start inspection"}
          </Button>
        ) : (
          <>
            <Button variant="secondary" size="sm" onClick={saveProgress} disabled={saving}>
              {saving ? "Saving…" : "Save"}
            </Button>
            <Button onClick={proceed} disabled={saving} className="flex-1">
              Continue
            </Button>
          </>
        )}
      </MobileBottomBar>
    </PageShell>
  );
}
