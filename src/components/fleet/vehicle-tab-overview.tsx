"use client";

import * as React from "react";
import { useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Pencil } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { StatusBadge, type StatusKey } from "@/components/ui/status-badge";
import { formatCurrency, formatDate } from "@/lib/utils";
import { useVehicleActions } from "./vehicle-action-sheets";
import { VehicleEditSheet, type VehicleEditSection } from "./vehicle-edit-sheet";
import type { VehicleDetail } from "./vehicle-detail-types";
import { expiryTone } from "./expiry";

const EDIT_SECTIONS: VehicleEditSection[] = [
  "identity",
  "compliance",
  "assignment",
  "financial",
  "pricing",
];

function asEditSection(value: string | null): VehicleEditSection | null {
  return value && (EDIT_SECTIONS as string[]).includes(value)
    ? (value as VehicleEditSection)
    : null;
}

export function VehicleTabOverview({ data }: { data: VehicleDetail }) {
  const { vehicle: v, depreciation: dep, totalRevenue, totalBookings, totalMaintenanceCost } = data;
  const roi = dep ? totalRevenue - dep.depreciation - totalMaintenanceCost : null;
  const { open } = useVehicleActions();
  const router = useRouter();
  const searchParams = useSearchParams();
  // Deep links (e.g. from the dashboard "Vehicles needing attention" card) can
  // request a section sheet to open via ?edit=compliance.
  const [editing, setEditing] = useState<VehicleEditSection | null>(() =>
    asEditSection(searchParams.get("edit")),
  );

  const closeEditing = () => {
    setEditing(null);
    if (searchParams.get("edit")) {
      const url = new URL(window.location.href);
      url.searchParams.delete("edit");
      router.replace(url.pathname + url.search, { scroll: false });
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <h2 className="text-xl font-semibold">Vehicle overview</h2>
          <StatusBadge
            status={v.condition as StatusKey}
            label={`Condition: ${v.condition[0]}${v.condition.slice(1).toLowerCase()}`}
          />
        </div>
        <div className="flex gap-2">
          <Button size="sm" onClick={() => open("workOrder")}>+ Work order</Button>
          <Button size="sm" variant="secondary" onClick={() => open("inspection")}>+ Inspection</Button>
          <Button size="sm" variant="secondary" onClick={() => open("incident")}>+ Incident</Button>
        </div>
      </div>

      <div className="grid gap-6 md:grid-cols-2">
        <Card>
          <EditableCardHeader title="Identity" onEdit={() => setEditing("identity")} />
          <CardContent>
            <dl className="space-y-2 text-sm">
              <Row label="Internal code" value={v.internalCode} bold />
              <Row label="Rego" value={`${v.rego} (${v.regoState})`} />
              <Row label="VIN" value={v.vin ?? "—"} />
              <Row label="Engine #" value={v.engineNumber ?? "—"} />
              <Row label="Make / model" value={`${v.make} ${v.model}`} />
              <Row label="Year" value={String(v.year)} />
              <Row label="Colour" value={v.colour} />
              <Row label="Fuel type" value={v.fuelType ?? "—"} />
              <Row label="Odometer" value={`${v.currentOdometerKm.toLocaleString()} km`} />
            </dl>
          </CardContent>
        </Card>

        <Card>
          <EditableCardHeader title="Compliance" onEdit={() => setEditing("compliance")} />
          <CardContent>
            <dl className="space-y-2 text-sm">
              <Row label="Rego expiry" value={v.regoExpiry ? formatDate(v.regoExpiry) : "—"} expiry={expiryTone(v.regoExpiry)} />
              <Row label="CTP expiry" value={v.ctpExpiry ? formatDate(v.ctpExpiry) : "—"} expiry={expiryTone(v.ctpExpiry)} />
              <Row label="Insurance expiry" value={v.insuranceExpiry ? formatDate(v.insuranceExpiry) : "—"} expiry={expiryTone(v.insuranceExpiry)} />
              <Row label="Insurance policy" value={v.insurancePolicyNumber ?? "—"} />
              <Row label="Last service" value={v.lastServiceDate ? formatDate(v.lastServiceDate) : "—"} />
              <Row label="Next service date" value={v.nextServiceDueDate ? formatDate(v.nextServiceDueDate) : "—"} expiry={expiryTone(v.nextServiceDueDate)} />
              <Row label="Next service km" value={v.nextServiceDueKm ? `${v.nextServiceDueKm.toLocaleString()} km` : "—"} />
              <Row label="Warranty expiry" value={v.warrantyExpiry ? formatDate(v.warrantyExpiry) : "—"} expiry={expiryTone(v.warrantyExpiry)} />
            </dl>
          </CardContent>
        </Card>

        <Card>
          <EditableCardHeader title="Assignment" onEdit={() => setEditing("assignment")} />
          <CardContent>
            <dl className="space-y-2 text-sm">
              <Row label="Category" value={v.category.name} />
              <Row label="Home depot" value={v.depot.name} />
              <Row label="Status" value={<StatusBadge status={v.status as StatusKey} />} />
              <Row label="Condition" value={<StatusBadge status={v.condition as StatusKey} />} />
              <Row label="Active" value={v.isActive ? "Yes" : "No"} />
              <Row label="Onboarded" value={formatDate(v.createdAt)} />
            </dl>
          </CardContent>
        </Card>

        <Card>
          <EditableCardHeader title="Financial" onEdit={() => setEditing("financial")} />
          <CardContent>
            <dl className="space-y-2 text-sm">
              <Row label="Purchase price" value={v.purchasePrice ? formatCurrency(Number(v.purchasePrice)) : "—"} />
              <Row label="Purchase date" value={v.purchaseDate ? formatDate(v.purchaseDate) : "—"} />
              {dep && (
                <>
                  <Row label="Age" value={`${dep.ageYears.toFixed(1)} yrs`} />
                  <Row label="Depreciation" value={formatCurrency(dep.depreciation)} />
                  <Row label="Book value" value={formatCurrency(dep.bookValue)} bold />
                </>
              )}
              <Row label="Total bookings" value={String(totalBookings)} />
              <Row label="Total revenue" value={formatCurrency(totalRevenue)} />
              <Row label="Maintenance cost" value={formatCurrency(totalMaintenanceCost)} />
              {roi !== null && (
                <Row label="Lifetime ROI" value={formatCurrency(roi)} bold tone={roi < 0 ? "warn" : "ok"} />
              )}
            </dl>
          </CardContent>
        </Card>

        <Card>
          <EditableCardHeader title="Pricing" onEdit={() => setEditing("pricing")} />
          <CardContent>
            <dl className="space-y-2 text-sm">
              <Row
                label="Base rate"
                value={
                  v.baseRateOverride != null
                    ? `${formatCurrency(Number(v.baseRateOverride))} (vehicle override)`
                    : v.catalogueModel?.baseRate != null
                      ? `${formatCurrency(Number(v.catalogueModel.baseRate))} (from model)`
                      : "— (uses category default)"
                }
              />
              <Row
                label="Base period"
                value={
                  v.basePeriodHoursOverride
                    ? `${v.basePeriodHoursOverride === "H48" ? "48 h" : "24 h"} (vehicle override)`
                    : v.catalogueModel?.basePeriodHours
                      ? `${v.catalogueModel.basePeriodHours === "H48" ? "48 h" : "24 h"} (from model)`
                      : "24 h (default)"
                }
              />
              <Row
                label="Tier ladder"
                value={
                  v.catalogueModel
                    ? "Inherited from model — edit at /admin/pricing → Models"
                    : "Inherited from category — edit at /admin/pricing → Rates → Tiered"
                }
              />
            </dl>
          </CardContent>
        </Card>

        {v.notes && (
          <Card className="md:col-span-2">
            <CardHeader>
              <CardTitle className="text-base">Notes</CardTitle>
            </CardHeader>
            <CardContent>
              <p className="text-sm whitespace-pre-wrap">{v.notes}</p>
            </CardContent>
          </Card>
        )}
      </div>

      <VehicleEditSheet
        section={editing}
        vehicle={v}
        open={editing !== null}
        onOpenChange={(o) => { if (!o) closeEditing(); }}
      />
    </div>
  );
}

function EditableCardHeader({ title, onEdit }: { title: string; onEdit: () => void }) {
  return (
    <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
      <CardTitle className="text-base">{title}</CardTitle>
      <Button
        type="button"
        size="icon"
        variant="ghost"
        className="h-7 w-7 text-muted-foreground"
        onClick={onEdit}
        aria-label={`Edit ${title.toLowerCase()}`}
      >
        <Pencil className="h-3.5 w-3.5" />
      </Button>
    </CardHeader>
  );
}

function Row({
  label,
  value,
  bold,
  tone,
  expiry,
}: {
  label: string;
  value: React.ReactNode;
  bold?: boolean;
  tone?: "warn" | "ok";
  expiry?: "expired" | "soon" | null;
}) {
  const expiryTitle =
    expiry === "expired"
      ? "Expired — renew immediately"
      : expiry === "soon"
        ? "Due within 7 days"
        : undefined;
  return (
    <div className="flex justify-between">
      <dt className="text-muted-foreground">{label}</dt>
      <dd
        title={expiryTitle}
        className={[
          bold ? "font-semibold" : "",
          tone === "warn" ? "text-destructive" : "",
          tone === "ok" ? "text-brand-green" : "",
          expiry === "expired" ? "animate-flash-destructive" : "",
          expiry === "soon" ? "animate-flash-warning" : "",
        ].join(" ").trim()}
      >
        {value}
      </dd>
    </div>
  );
}
