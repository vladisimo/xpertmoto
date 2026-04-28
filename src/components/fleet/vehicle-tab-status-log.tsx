"use client";

import { formatDateTime } from "@/lib/utils";
import type { VehicleDetail } from "./vehicle-detail-types";

type ChangeLog = VehicleDetail["changeLog"];

const FIELD_LABELS: Record<string, string> = {
  internalCode: "Internal code",
  rego: "Rego",
  regoState: "Rego state",
  vin: "VIN",
  engineNumber: "Engine #",
  make: "Make",
  model: "Model",
  year: "Year",
  colour: "Colour",
  fuelType: "Fuel type",
  currentOdometerKm: "Odometer",
  regoExpiry: "Rego expiry",
  ctpExpiry: "CTP expiry",
  insuranceExpiry: "Insurance expiry",
  insurancePolicyNumber: "Insurance policy #",
  lastServiceDate: "Last service date",
  lastServiceKm: "Last service km",
  nextServiceDueDate: "Next service date",
  nextServiceDueKm: "Next service km",
  warrantyExpiry: "Warranty expiry",
  categoryId: "Category",
  depotId: "Home depot",
  condition: "Condition",
  purchasePrice: "Purchase price",
  purchaseDate: "Purchase date",
  depreciationMethod: "Depreciation method",
  depreciationRate: "Depreciation rate",
  currentBookValue: "Book value",
};

function labelFor(field: string): string {
  return FIELD_LABELS[field] ?? field;
}

function renderValue(value: unknown): string {
  if (value == null) return "—";
  if (typeof value === "string") {
    // ISO date → short Australian date.
    if (/^\d{4}-\d{2}-\d{2}T/.test(value)) {
      const d = new Date(value);
      if (!Number.isNaN(d.getTime())) return d.toLocaleDateString("en-AU");
    }
    return value;
  }
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  return JSON.stringify(value);
}

export function VehicleTabStatusLog({ changeLog }: { changeLog: ChangeLog }) {
  return (
    <div className="space-y-3">
      <h2 className="text-xl font-semibold">Change log</h2>

      {changeLog.length === 0 ? (
        <div className="rounded-lg border py-8 text-center text-muted-foreground">
          No changes recorded.
        </div>
      ) : (
        <div className="overflow-hidden rounded-md border bg-card">
          <table className="w-full text-sm">
            <thead className="bg-primary text-primary-foreground">
              <tr className="border-b border-primary/40 text-left">
                <th className="px-4 py-3 text-xs font-semibold uppercase tracking-wide text-primary-foreground/80">When</th>
                <th className="px-4 py-3 text-xs font-semibold uppercase tracking-wide text-primary-foreground/80">Who</th>
                <th className="px-4 py-3 text-xs font-semibold uppercase tracking-wide text-primary-foreground/80">Field</th>
                <th className="px-4 py-3 text-xs font-semibold uppercase tracking-wide text-primary-foreground/80">Previous</th>
                <th className="px-4 py-3 text-xs font-semibold uppercase tracking-wide text-primary-foreground/80">New</th>
                <th className="px-4 py-3 text-xs font-semibold uppercase tracking-wide text-primary-foreground/80">Reason</th>
              </tr>
            </thead>
            <tbody className="bg-card">
              {changeLog.flatMap((entry) => {
                if (entry.kind === "status") {
                  return [(
                    <tr key={entry.id} className="border-b last:border-0">
                      <td className="whitespace-nowrap px-4 py-3 text-muted-foreground">{formatDateTime(entry.timestamp)}</td>
                      <td className="px-4 py-3 text-muted-foreground">{entry.actorName ?? "—"}</td>
                      <td className="px-4 py-3 font-medium">Status</td>
                      <td className="px-4 py-3 text-muted-foreground">
                        {entry.previousStatus ? entry.previousStatus.replace(/_/g, " ") : "—"}
                      </td>
                      <td className="px-4 py-3 font-medium">{entry.newStatus.replace(/_/g, " ")}</td>
                      <td className="px-4 py-3 text-muted-foreground">{entry.reason ?? "—"}</td>
                    </tr>
                  )];
                }
                if (entry.kind === "document") {
                  const typeLabel = entry.documentType.replace(/_/g, " ");
                  return [(
                    <tr key={entry.id} className="border-b last:border-0">
                      <td className="whitespace-nowrap px-4 py-3 text-muted-foreground">{formatDateTime(entry.timestamp)}</td>
                      <td className="px-4 py-3 text-muted-foreground">{entry.actorName ?? "—"}</td>
                      <td className="px-4 py-3 font-medium">
                        Document {entry.action === "UPLOADED" ? "uploaded" : "deleted"}
                      </td>
                      <td className="px-4 py-3 text-muted-foreground">
                        {entry.action === "DELETED" ? typeLabel : "—"}
                      </td>
                      <td className="px-4 py-3">
                        {entry.action === "UPLOADED" ? typeLabel : "—"}
                      </td>
                      <td className="px-4 py-3 text-muted-foreground">
                        {entry.referenceNumber ?? "—"}
                      </td>
                    </tr>
                  )];
                }
                const keys = Object.keys(entry.newData);
                if (keys.length === 0) return [];
                return keys.map((key, i) => (
                  <tr key={`${entry.id}:${key}`} className="border-b last:border-0">
                    <td className="whitespace-nowrap px-4 py-3 text-muted-foreground">
                      {i === 0 ? formatDateTime(entry.timestamp) : ""}
                    </td>
                    <td className="px-4 py-3 text-muted-foreground">
                      {i === 0 ? entry.actorName ?? "—" : ""}
                    </td>
                    <td className="px-4 py-3 font-medium">{labelFor(key)}</td>
                    <td className="px-4 py-3 text-muted-foreground">{renderValue(entry.previousData[key])}</td>
                    <td className="px-4 py-3">{renderValue(entry.newData[key])}</td>
                    <td className="px-4 py-3 text-muted-foreground">—</td>
                  </tr>
                ));
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
