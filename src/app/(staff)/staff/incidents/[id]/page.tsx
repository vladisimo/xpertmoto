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
  // Excess-cap banner + manager-only void toggle (Area 1). The summary is
  // per-booking, so it only renders when the incident is linked to one.
  const me = trpc.session.whoAmI.useQuery(undefined, { staleTime: 60_000 });
  const isManager = ["MANAGER", "ADMIN", "SUPER_ADMIN"].includes(me.data?.role ?? "");
  const { data: excess } = trpc.staffBooking.excessSummary.useQuery(
    { bookingId: inc?.booking?.id ?? "" },
    { enabled: !!inc?.booking?.id },
  );
  const [voidReason, setVoidReason] = useState("");
  const [voidErr, setVoidErr] = useState<string | null>(null);
  const setExcessVoided = trpc.fleet.setIncidentExcessVoided.useMutation({
    onSuccess: () => {
      setVoidReason("");
      setVoidErr(null);
      void util.fleet.incidentDetail.invalidate({ id });
      if (inc?.booking?.id) {
        void util.staffBooking.excessSummary.invalidate({ bookingId: inc.booking.id });
      }
    },
    onError: (e) => setVoidErr(e.message),
  });

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

      {inc.booking && excess && (
        <Card>
          <CardHeader>
            <CardTitle className="h3">
              Insurance excess{excess.tierName ? ` — ${excess.tierName}` : ""}
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3 text-sm">
            <div className="grid gap-1 sm:max-w-sm">
              <div className="flex justify-between">
                <span className="text-muted-foreground">Excess cap (per hire)</span>
                <span>{formatCurrency(excess.excess)}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">Already recovered this hire</span>
                <span>{formatCurrency(excess.used)}</span>
              </div>
              <div className="flex justify-between border-t pt-1 font-semibold">
                <span className="text-muted-foreground">Remaining headroom</span>
                <span>{formatCurrency(excess.remaining)}</span>
              </div>
            </div>
            {inc.excessVoided ? (
              <div className="rounded-md border border-destructive/30 bg-destructive/10 p-3">
                <div className="font-medium">Excess cap voided for this incident</div>
                <p className="caption mt-1">{inc.excessVoidReason}</p>
                {inc.excessVoidedAt && (
                  <p className="caption mt-1">Voided {formatDateTime(inc.excessVoidedAt)}</p>
                )}
              </div>
            ) : (
              <p className="caption">
                Charges raised from this incident are capped at the remaining headroom unless a manager voids
                the excess (e.g. negligence or prohibited use under the rental agreement).
              </p>
            )}
            {isManager && (
              <div className="space-y-2 border-t pt-3">
                {!inc.excessVoided && (
                  <div className="space-y-1.5">
                    <Label htmlFor="excess-void-reason">Void reason (required)</Label>
                    <Input
                      id="excess-void-reason"
                      value={voidReason}
                      onChange={(e) => setVoidReason(e.target.value)}
                      placeholder="e.g. Prohibited use — off-road riding per agreement §6"
                    />
                  </div>
                )}
                {voidErr && (
                  <div className="rounded-md border border-destructive/30 bg-destructive/10 p-3 text-sm text-destructive">
                    {voidErr}
                  </div>
                )}
                <Button
                  size="sm"
                  variant={inc.excessVoided ? "secondary" : "destructive"}
                  disabled={setExcessVoided.isPending || (!inc.excessVoided && voidReason.trim().length < 3)}
                  onClick={() =>
                    setExcessVoided.mutate({
                      incidentId: inc.id,
                      voided: !inc.excessVoided,
                      reason: voidReason.trim() || undefined,
                    })
                  }
                >
                  {setExcessVoided.isPending
                    ? "Saving…"
                    : inc.excessVoided
                      ? "Reinstate excess cap"
                      : "Void excess cap"}
                </Button>
              </div>
            )}
          </CardContent>
        </Card>
      )}

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
