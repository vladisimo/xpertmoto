"use client";

import Image from "next/image";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { DamageMapCanvas, normalizeMarkers, type DamageMarker, type DamageView } from "@/components/agreement/damage-map-canvas";

type InspectionForCondition = {
  id: string;
  photos: { id: string; url: string; caption: string | null }[];
  bodyDamageMap: unknown;
} | null;

export function ConditionPage({
  inspection,
  onAddCustomerMarker,
}: {
  inspection: InspectionForCondition;
  onAddCustomerMarker: (marker: { x: number; y: number; severity: "MINOR" | "MODERATE" | "MAJOR"; view: DamageView }) => Promise<void>;
}) {
  const allMarkers = normalizeMarkers(
    (inspection?.bodyDamageMap as unknown as { markers?: unknown[] } | null)?.markers ?? [],
  );
  const staffMarkers: DamageMarker[] = allMarkers
    .filter((m) => m.source !== "customer")
    .map((m) => ({ ...m, source: "staff" as const }));
  const customerMarkers: DamageMarker[] = allMarkers.filter((m) => m.source === "customer");

  const [adding, setAdding] = useState(false);
  const [customerDraft, setCustomerDraft] = useState<DamageMarker[]>([]);

  async function commit(markers: DamageMarker[]) {
    const fresh = markers.filter((m) => !customerDraft.find((c) => c.id === m.id));
    for (const m of fresh) {
      await onAddCustomerMarker({ x: m.x, y: m.y, severity: m.severity, view: m.view ?? "LEFT" });
    }
    setCustomerDraft(markers);
  }

  return (
    <div className="space-y-6">
      <p>
        Please review the vehicle condition with the staff member. The photos and damage map below were captured at
        handover and form part of this agreement — they are the reference used at return to assess any new damage.
      </p>
      {inspection && inspection.photos.length > 0 ? (
        <div>
          <div className="eyebrow mb-2">Pre-hire photos</div>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
            {inspection.photos.map((p) => (
              <div key={p.id} className="relative aspect-[4/3] overflow-hidden rounded-md border border-border">
                <Image src={p.url} alt={p.caption ?? "Pre-hire photo"} fill sizes="(max-width: 640px) 50vw, 33vw" className="object-contain" />
                {p.caption && (
                  <div className="absolute bottom-0 left-0 right-0 bg-black/60 px-2 py-1 text-[10px] uppercase tracking-wide text-white">
                    {p.caption}
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>
      ) : (
        <div className="rounded-md border border-dashed border-border bg-muted/40 p-4 text-sm text-muted-foreground">
          No photos attached to this inspection.
        </div>
      )}

      <div>
        <div className="flex items-center justify-between">
          <div className="eyebrow">Damage map</div>
          {!adding && (
            <Button type="button" variant="secondary" size="sm" onClick={() => setAdding(true)}>
              Add a mark
            </Button>
          )}
        </div>
        <div className="mt-2">
          <DamageMapCanvas
            baseMarkers={staffMarkers}
            markers={[...customerMarkers, ...customerDraft]}
            onChange={(m) => void commit(m)}
            source="customer"
            readOnly={!adding}
          />
        </div>
        <p className="caption mt-2">
          Grey markers were recorded at pickup by staff. Tap the button above to add your own marks if you spot
          something the staff member missed.
        </p>
      </div>

      <div className="rounded-md bg-muted/40 p-3 text-sm">
        I've reviewed the condition report and the vehicle's condition matches the record above. I understand that any
        new damage identified at return will be assessed against this baseline.
      </div>
    </div>
  );
}
