"use client";

import { use, useMemo, useState } from "react";
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
import { DamageMapCanvas, normalizeMarkers, type DamageMarker } from "@/components/agreement/damage-map-canvas";
import { PhotoCaptureGrid } from "@/components/agreement/photo-capture-grid";

export default function CheckOutInspectPage(props: { params: Promise<{ id: string }> }) {
  const { id } = use(props.params);
  const router = useRouter();
  const utils = trpc.useUtils();
  const { data: b } = trpc.staffBooking.detail.useQuery({ id });
  const { data: inspections } = trpc.inspection.byBooking.useQuery({ bookingId: id });
  const existingPre = inspections?.find((i) => i.type === "PRE_HIRE");

  const createInspection = trpc.inspection.create.useMutation();
  const updateInspection = trpc.inspection.update.useMutation();

  const [createdInspectionId, setCreatedInspectionId] = useState<string | null>(null);
  const inspectionId = createdInspectionId ?? existingPre?.id ?? null;

  const [odometer, setOdometer] = useState(existingPre?.odometerKm?.toString() ?? "");
  const [fuel, setFuel] = useState(existingPre?.fuelLevel ?? 100);
  const [overall, setOverall] = useState<"EXCELLENT" | "GOOD" | "FAIR" | "POOR">(
    (existingPre?.overallCondition as "EXCELLENT" | "GOOD" | "FAIR" | "POOR" | undefined) ?? "GOOD",
  );
  const [severity, setSeverity] = useState<"MINOR" | "MODERATE" | "MAJOR">("MINOR");
  const [markers, setMarkers] = useState<DamageMarker[]>(() => {
    const src = (existingPre?.bodyDamageMap as unknown as { markers?: unknown[] } | null)?.markers ?? [];
    return normalizeMarkers(src);
  });
  const [err, setErr] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const photos = useMemo(
    () => (existingPre?.photos ?? []).map((p) => ({ id: p.id, url: p.url, caption: p.caption ?? undefined })),
    [existingPre?.photos],
  );

  if (!b) return <PageShell><LoadingBlock padded="lg" /></PageShell>;

  async function createDraft() {
    if (!b || !b.vehicle) {
      setErr("No vehicle assigned yet. Allocate a vehicle before inspection.");
      return;
    }
    setSaving(true);
    try {
      const draft = await createInspection.mutateAsync({
        vehicleId: b.vehicle.id,
        bookingId: b.id,
        type: "PRE_HIRE",
        depotId: b.pickupDepotId,
        odometerKm: Number(odometer || 0),
        fuelLevel: Number(fuel),
        overallCondition: overall,
        damageMarkers: markers.map((m) => ({
          id: m.id,
          x: m.x,
          y: m.y,
          severity: m.severity,
          note: m.note,
          source: m.source,
          view: m.view ?? "LEFT",
        })),
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
        damageMarkers: markers.map((m) => ({
          id: m.id,
          x: m.x,
          y: m.y,
          severity: m.severity,
          note: m.note,
          source: m.source,
          view: m.view ?? "LEFT",
          addedAt: m.addedAt,
        })),
      });
      await utils.inspection.byBooking.invalidate({ bookingId: b!.id });
      setErr(null);
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Failed to save");
    } finally {
      setSaving(false);
    }
  }

  async function readyForCustomer() {
    await saveProgress();
    router.push(`/staff/bookings/${id}/check-out/verify`);
  }

  return (
    <PageShell>
      <PageHeader
        eyebrow="Operations · Step 1 of 4"
        breadcrumbs={[
          { label: "Bookings", href: "/staff/calendar" },
          { label: b.bookingReference, href: `/staff/bookings/${id}` },
          { label: "Check out", href: `/staff/bookings/${id}/check-out` },
          { label: "1. Pre-hire inspection" },
        ]}
        title="Pre-hire inspection"
        description="Run this before the customer arrives. Photos and the damage map become the reference for the return assessment."
        back={`/staff/bookings/${id}/check-out`}
        mobileCompact
      />

      <Card>
        <CardHeader>
          <CardTitle className="h3">Vehicle & readings</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          {b.vehicle ? (
            <div className="rounded-md border border-border bg-muted/40 p-3 text-sm">
              <strong>{b.vehicle.internalCode}</strong> · {b.vehicle.rego} ·{" "}
              {b.vehicle.make} {b.vehicle.model}
            </div>
          ) : (
            <div className="rounded-md border border-destructive/30 bg-destructive/10 p-3 text-sm text-destructive">
              No vehicle assigned. Go back to the booking detail and assign one before inspecting.
            </div>
          )}
          <div className="grid grid-cols-2 gap-4">
            <div>
              <Label>Odometer (km)</Label>
              <Input
                type="number"
                inputMode="numeric"
                value={odometer}
                onChange={(e) => setOdometer(e.target.value)}
              />
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

      {inspectionId ? (
        <Card>
          <CardHeader>
            <CardTitle className="h3">Photos</CardTitle>
          </CardHeader>
          <CardContent>
            <PhotoCaptureGrid
              uploadUrl="/api/upload/inspection-photo"
              extraFields={{ inspectionId }}
              initial={photos}
              onUploaded={() => utils.inspection.byBooking.invalidate({ bookingId: b.id })}
              onRemoved={() => utils.inspection.byBooking.invalidate({ bookingId: b.id })}
            />
          </CardContent>
        </Card>
      ) : (
        <Card>
          <CardContent className="py-6 text-center text-sm text-muted-foreground">
            Save the readings first to enable photo capture.
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader>
          <CardTitle className="h3">Existing damage</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="flex items-center gap-2 text-sm">
            <span>Severity:</span>
            {(["MINOR", "MODERATE", "MAJOR"] as const).map((s) => (
              <Button
                key={s}
                type="button"
                variant={severity === s ? "default" : "secondary"}
                size="sm"
                onClick={() => setSeverity(s)}
              >
                {s.slice(0, 1) + s.slice(1).toLowerCase()}
              </Button>
            ))}
          </div>
          <DamageMapCanvas
            markers={markers}
            onChange={setMarkers}
            activeSeverity={severity}
            source="staff"
          />
          <p className="caption">
            {markers.length === 0
              ? "No existing damage marked. Tap the silhouette to add a marker."
              : `${markers.length} marker(s) recorded.`}
          </p>
        </CardContent>
      </Card>

      {err && (
        <div className="rounded-md border border-destructive/30 bg-destructive/10 p-3 text-sm text-destructive">
          {err}
        </div>
      )}

      <div className="hidden gap-3 md:flex">
        {!inspectionId ? (
          <Button onClick={createDraft} disabled={!b.vehicle || saving}>
            {saving ? "Starting…" : "Start inspection"}
          </Button>
        ) : (
          <>
            <Button variant="secondary" onClick={saveProgress} disabled={saving}>
              {saving ? "Saving…" : "Save progress"}
            </Button>
            <Button onClick={readyForCustomer} disabled={saving}>
              Ready for customer →
            </Button>
          </>
        )}
        <Button variant="ghost" asChild>
          <Link href={`/staff/bookings/${id}/check-out`}>Back to overview</Link>
        </Button>
      </div>

      <MobileBottomBar>
        {!inspectionId ? (
          <Button onClick={createDraft} disabled={!b.vehicle || saving} className="flex-1">
            {saving ? "Starting…" : "Start inspection"}
          </Button>
        ) : (
          <>
            <Button variant="secondary" size="sm" onClick={saveProgress} disabled={saving}>
              {saving ? "Saving…" : "Save"}
            </Button>
            <Button onClick={readyForCustomer} disabled={saving} className="flex-1">
              Ready for customer
            </Button>
          </>
        )}
      </MobileBottomBar>
    </PageShell>
  );
}
