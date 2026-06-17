"use client";
import { useState, use } from "react";
import Link from "next/link";
import { trpc } from "@/lib/trpc/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { StatusBadge, type StatusKey } from "@/components/ui/status-badge";
import { PageHeader } from "@/components/layout/page-header";
import { PageShell } from "@/components/layout/page-section";
import { LoadingBlock } from "@/components/ui/spinner";
import { formatCurrency, formatDateTime } from "@/lib/utils";

const STATUSES = ["REPORTED", "UNDER_INVESTIGATION", "ASSESSED", "RESOLVED", "CLOSED", "INSURANCE_CLAIM"] as const;

export default function IncidentDetailPage(props: { params: Promise<{ id: string }> }) {
  const params = use(props.params);
  const { id } = params;
  const util = trpc.useUtils();
  const { data: inc, isLoading } = trpc.fleet.incidentDetail.useQuery({ id });
  const update = trpc.fleet.updateIncidentStatus.useMutation({
    onSuccess: () => util.fleet.incidentDetail.invalidate({ id }),
  });
  const [resolution, setResolution] = useState("");
  const [actualCost, setActualCost] = useState("");

  if (isLoading) return <LoadingBlock padded="lg" />;
  if (!inc) return <div className="p-8 text-muted-foreground">Not found</div>;

  return (
    <PageShell className="max-w-4xl">
      <PageHeader
        breadcrumbs={[
          { label: "Incidents", href: "/staff/fleet/incidents" },
          { label: inc.incidentNumber },
        ]}
        title={inc.incidentNumber}
        actions={
          <>
            <StatusBadge status={inc.status as StatusKey} />
            <StatusBadge status={inc.severity as StatusKey} />
          </>
        }
      />

      <div className="grid gap-6 md:grid-cols-2">
        <Card>
          <CardHeader><CardTitle className="h3">Incident</CardTitle></CardHeader>
          <CardContent className="text-sm space-y-1">
            <div>Type: {inc.type}</div>
            <div>When: {formatDateTime(inc.dateTime)}</div>
            <div>Where: {inc.location ?? "—"}</div>
            <div className="pt-2 whitespace-pre-wrap">{inc.description}</div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader><CardTitle className="h3">Vehicle & customer</CardTitle></CardHeader>
          <CardContent className="text-sm space-y-1">
            <Link className="font-medium text-primary hover:underline" href={`/staff/fleet/vehicles/${inc.vehicle.id}`}>
              {inc.vehicle.internalCode} · {inc.vehicle.category.name}
            </Link>
            {inc.booking && (
              <Link className="block text-primary hover:underline" href={`/staff/bookings/${inc.booking.id}`}>
                {inc.booking.bookingReference} · {inc.booking.customer.firstName} {inc.booking.customer.lastName}
              </Link>
            )}
            {inc.reportedBy && <div className="text-muted-foreground">Reported by {inc.reportedBy.firstName} {inc.reportedBy.lastName}</div>}
          </CardContent>
        </Card>

        <Card>
          <CardHeader><CardTitle className="h3">Financial</CardTitle></CardHeader>
          <CardContent className="text-sm space-y-1">
            <div>Estimated damage: {inc.estimatedDamageCost ? formatCurrency(Number(inc.estimatedDamageCost)) : "—"}</div>
            <div>Actual damage: {inc.actualDamageCost ? formatCurrency(Number(inc.actualDamageCost)) : "—"}</div>
            <div>Customer liable: {inc.customerLiable ? "Yes" : "No"}</div>
            {inc.customerLiable && inc.customerChargeAmount && <div>Charge: {formatCurrency(Number(inc.customerChargeAmount))}</div>}
          </CardContent>
        </Card>

        <Card>
          <CardHeader><CardTitle className="h3">Resolution</CardTitle></CardHeader>
          <CardContent className="text-sm space-y-2">
            <p className="whitespace-pre-wrap">{inc.resolution ?? "—"}</p>
            {inc.resolvedAt && <div className="text-xs text-muted-foreground">Resolved {formatDateTime(inc.resolvedAt)}</div>}
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader><CardTitle className="h3">Update status</CardTitle></CardHeader>
        <CardContent className="space-y-4">
          <div className="flex flex-wrap gap-2">
            {STATUSES.map((s) => (
              <Button
                key={s}
                size="sm"
                variant={inc.status === s ? "default" : "secondary"}
                disabled={update.isPending}
                onClick={() =>
                  update.mutate({
                    id: inc.id,
                    status: s,
                    resolution: resolution || undefined,
                    actualDamageCost: actualCost ? Number(actualCost) : undefined,
                  })
                }
              >
                {s.replace(/_/g, " ")}
              </Button>
            ))}
          </div>
          <div className="grid gap-3 md:grid-cols-2">
            <div className="space-y-1.5">
              <Label>Resolution notes</Label>
              <Input value={resolution} onChange={(e) => setResolution(e.target.value)} />
            </div>
            <div className="space-y-1.5">
              <Label>Actual damage cost (A$)</Label>
              <Input type="number" value={actualCost} onChange={(e) => setActualCost(e.target.value)} />
            </div>
          </div>
        </CardContent>
      </Card>
    </PageShell>
  );
}
