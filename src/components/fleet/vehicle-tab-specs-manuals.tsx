"use client";

import { ExternalLink, FileText, RefreshCw } from "lucide-react";
import { trpc } from "@/lib/trpc/client";
import { Button } from "@/components/ui/button";
import { PageSection } from "@/components/layout/page-section";
import { StatusBadge, type StatusKey } from "@/components/ui/status-badge";
import { formatDateTime } from "@/lib/utils";
import type { VehicleWithRelations } from "./vehicle-detail-types";

const DOC_TYPE_LABEL: Record<string, string> = {
  OWNERS_MANUAL: "Owner's manual",
  SERVICE_SCHEDULE: "Service schedule",
  PARTS_CATALOGUE: "Parts catalogue",
  WIRING_DIAGRAM: "Wiring diagram",
  BROCHURE: "Brochure",
};

export function VehicleTabSpecsManuals({
  vehicle,
  canRefresh,
}: {
  vehicle: VehicleWithRelations;
  canRefresh: boolean;
}) {
  const model = vehicle.catalogueModel;
  const util = trpc.useUtils();
  const enrich = trpc.vehicleModel.enqueueEnrichment.useMutation({
    onSuccess: () => util.fleet.vehicleDetail.invalidate({ id: vehicle.id }),
  });

  if (!model) {
    return (
      <PageSection title="Specifications & manuals">
        <div className="flex flex-col items-start gap-3 rounded-md border border-dashed border-border p-6">
          <p className="text-sm text-muted-foreground">
            No catalogue model linked to <strong>{vehicle.make} {vehicle.model}</strong> yet.
            Specs and owner's manuals are shared across every vehicle of the same
            make / model / year — link this vehicle to a catalogue entry in admin →
            Fleet configuration → Vehicle models.
          </p>
        </div>
      </PageSection>
    );
  }

  const specRows: Array<[string, string | null]> = [
    ["Engine", model.engineCapacityCc ? `${model.engineCapacityCc}cc` : null],
    ["Power", model.enginePowerKw ? `${model.enginePowerKw} kW` : null],
    ["Torque", model.engineTorqueNm ? `${model.engineTorqueNm} Nm` : null],
    ["Dry weight", model.dryWeightKg ? `${model.dryWeightKg} kg` : null],
    ["Fuel tank", model.fuelTankLitres ? `${model.fuelTankLitres} L` : null],
    ["Fuel type", model.fuelType],
    ["Seat height", model.seatHeightMm ? `${model.seatHeightMm} mm` : null],
    ["Top speed", model.topSpeedKmh ? `${model.topSpeedKmh} km/h` : null],
    ["Front tyre", model.tyreFront],
    ["Rear tyre", model.tyreRear],
    [
      "Service interval",
      model.serviceIntervalKm ? `${model.serviceIntervalKm} km` : null,
    ],
  ];

  return (
    <div className="space-y-6">
      <PageSection
        title="Specifications"
        description={
          <span className="flex flex-wrap items-center gap-2 text-caption">
            <StatusBadge status={model.specsConfidence as StatusKey} />
            {model.specsSourceName && <span>{model.specsSourceName}</span>}
            {model.specsFetchedAt && (
              <>
                <span aria-hidden className="text-border">·</span>
                <span>Fetched {formatDateTime(model.specsFetchedAt)}</span>
              </>
            )}
            {model.specsSourceUrl && (
              <a
                href={model.specsSourceUrl}
                target="_blank"
                rel="noreferrer noopener"
                className="inline-flex items-center gap-1 text-muted-foreground hover:text-foreground"
              >
                <ExternalLink className="h-3 w-3" />
                Source
              </a>
            )}
          </span>
        }
        actions={
          canRefresh ? (
            <Button
              variant="secondary"
              size="sm"
              disabled={enrich.isPending}
              onClick={() => enrich.mutate({ id: model.id })}
            >
              <RefreshCw className="h-4 w-4" />
              {enrich.isPending ? "Refreshing…" : "Refresh from manufacturer"}
            </Button>
          ) : null
        }
      >
        {model.lastEnrichmentError && (
          <div className="rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">
            {model.lastEnrichmentError}
          </div>
        )}
        <dl className="grid grid-cols-2 gap-2 text-sm sm:grid-cols-3">
          {specRows.map(([label, value]) => (
            <div
              key={label}
              className="flex flex-col rounded-md border border-border p-2"
            >
              <dt className="caption text-muted-foreground">{label}</dt>
              <dd className="font-medium tabular-nums">{value ?? "—"}</dd>
            </div>
          ))}
        </dl>
      </PageSection>

      <PageSection
        title="Manuals"
        description={
          model.documents.length === 0
            ? "No manuals attached yet."
            : `${model.documents.length} document${model.documents.length === 1 ? "" : "s"} from manufacturer sources.`
        }
      >
        {model.documents.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            {canRefresh
              ? "Click Refresh from manufacturer above to pull the owner's manual and any other published documents for this model."
              : "No manuals have been attached yet. Ask an admin to run the enrichment job from Fleet configuration → Vehicle models."}
          </p>
        ) : (
          <ul className="space-y-2">
            {model.documents.map((d) => (
              <li
                key={d.id}
                className="flex items-center justify-between gap-3 rounded-md border border-border p-3"
              >
                <div className="min-w-0">
                  <div className="font-medium">{d.title}</div>
                  <div className="truncate text-xs text-muted-foreground">
                    {DOC_TYPE_LABEL[d.type] ?? d.type} · {d.sourceDomain}
                    {d.sizeBytes ? ` · ${Math.round(d.sizeBytes / 1024)} KB` : ""}
                    {d.pageCount ? ` · ${d.pageCount} pages` : ""}
                  </div>
                </div>
                <Button asChild variant="secondary" size="sm">
                  <a href={d.fileUrl} target="_blank" rel="noreferrer noopener">
                    <FileText className="h-4 w-4" />
                    Open
                  </a>
                </Button>
              </li>
            ))}
          </ul>
        )}
      </PageSection>
    </div>
  );
}
