"use client";
import { useMemo, useState, use } from "react";
import Link from "next/link";
import { Loader2, ShieldAlert } from "lucide-react";
import { trpc } from "@/lib/trpc/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { StatusBadge, type StatusKey } from "@/components/ui/status-badge";
import { PageHeader } from "@/components/layout/page-header";
import { PageShell } from "@/components/layout/page-section";
import { LoadingBlock } from "@/components/ui/spinner";
import { formatCurrency, formatDateTime } from "@/lib/utils";

const STATUSES = ["REPORTED", "UNDER_INVESTIGATION", "ASSESSED", "RESOLVED", "CLOSED", "INSURANCE_CLAIM"] as const;

type GpsSnapshot = {
  lat: number;
  lng: number;
  speedKph: number | null;
  ignitionOn: boolean | null;
  timestamp: string | null;
  deviceId: string | null;
};

/** Defensive parse of the write-once Incident.gpsSnapshot JSON blob. */
function parseGpsSnapshot(value: unknown): GpsSnapshot | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const v = value as Record<string, unknown>;
  if (typeof v.lat !== "number" || typeof v.lng !== "number") return null;
  return {
    lat: v.lat,
    lng: v.lng,
    speedKph: typeof v.speedKph === "number" ? v.speedKph : null,
    ignitionOn: typeof v.ignitionOn === "boolean" ? v.ignitionOn : null,
    timestamp: typeof v.timestamp === "string" ? v.timestamp : null,
    deviceId: typeof v.deviceId === "string" ? v.deviceId : null,
  };
}

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
  // Claim card (Area 3): editable police report / insurance claim numbers.
  // Drafts stay undefined until touched so a background refetch doesn't
  // clobber typing.
  const [policeDraft, setPoliceDraft] = useState<string | undefined>(undefined);
  const [claimDraft, setClaimDraft] = useState<string | undefined>(undefined);
  const [claimErr, setClaimErr] = useState<string | null>(null);
  const updateDetails = trpc.fleet.updateIncidentDetails.useMutation({
    onSuccess: () => {
      setPoliceDraft(undefined);
      setClaimDraft(undefined);
      setClaimErr(null);
      void util.fleet.incidentDetail.invalidate({ id });
    },
    onError: (e) => setClaimErr(e.message),
  });

  if (isLoading) return <LoadingBlock padded="lg" />;
  if (!inc) return <div className="p-8 text-muted-foreground">Not found</div>;

  const gps = parseGpsSnapshot(inc.gpsSnapshot);
  const policeValue = policeDraft ?? inc.policeReportNumber ?? "";
  const claimValue = claimDraft ?? inc.insuranceClaimNumber ?? "";
  const claimDirty =
    policeValue !== (inc.policeReportNumber ?? "") ||
    claimValue !== (inc.insuranceClaimNumber ?? "");
  const canConfirmTheft =
    isManager &&
    inc.type === "THEFT" &&
    !!inc.booking &&
    ["REPORTED", "UNDER_INVESTIGATION", "ASSESSED"].includes(inc.status);

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
            {canConfirmTheft && (
              <ConfirmTheftDialog
                incidentId={inc.id}
                incidentNumber={inc.incidentNumber}
                policeReportNumber={inc.policeReportNumber}
                insuranceClaimNumber={inc.insuranceClaimNumber}
                defaultCharge={Math.max(
                  0,
                  Math.min(
                    Number(
                      inc.vehicle.currentBookValue ?? inc.estimatedDamageCost ?? 0,
                    ),
                    excess ? excess.remaining : Number.POSITIVE_INFINITY,
                  ),
                )}
                excessRemaining={excess?.remaining ?? null}
                onDone={() => {
                  void util.fleet.incidentDetail.invalidate({ id });
                  if (inc.booking?.id) {
                    void util.staffBooking.excessSummary.invalidate({
                      bookingId: inc.booking.id,
                    });
                  }
                }}
              />
            )}
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

        <Card>
          <CardHeader><CardTitle className="h3">Claim</CardTitle></CardHeader>
          <CardContent className="text-sm space-y-3">
            <div className="space-y-1.5">
              <Label htmlFor="claim-police">Police report #</Label>
              <Input
                id="claim-police"
                value={policeValue}
                onChange={(e) => setPoliceDraft(e.target.value)}
                placeholder="Event / report number"
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="claim-insurance">Insurance claim #</Label>
              <Input
                id="claim-insurance"
                value={claimValue}
                onChange={(e) => setClaimDraft(e.target.value)}
                placeholder="Insurer claim number"
              />
            </div>
            {claimErr && <p className="text-destructive">{claimErr}</p>}
            <Button
              size="sm"
              variant="secondary"
              disabled={!claimDirty || updateDetails.isPending}
              onClick={() =>
                updateDetails.mutate({
                  id: inc.id,
                  policeReportNumber: policeValue.trim() || null,
                  insuranceClaimNumber: claimValue.trim() || null,
                })
              }
            >
              {updateDetails.isPending ? "Saving…" : "Save claim details"}
            </Button>
          </CardContent>
        </Card>

        {gps && (
          <Card>
            <CardHeader><CardTitle className="h3">Last GPS fix</CardTitle></CardHeader>
            <CardContent className="text-sm space-y-1">
              <div>
                Position: {gps.lat.toFixed(5)}, {gps.lng.toFixed(5)}
              </div>
              {gps.timestamp && <div>Fix time: {formatDateTime(new Date(gps.timestamp))}</div>}
              {gps.speedKph != null && <div>Speed: {Math.round(gps.speedKph)} km/h</div>}
              {gps.ignitionOn != null && <div>Ignition: {gps.ignitionOn ? "On" : "Off"}</div>}
              {gps.deviceId && (
                <div className="text-muted-foreground">Tracker: {gps.deviceId}</div>
              )}
              <a
                className="inline-block pt-1 font-medium text-primary hover:underline"
                href={`https://www.google.com/maps?q=${gps.lat},${gps.lng}`}
                target="_blank"
                rel="noopener noreferrer"
              >
                Open in Google Maps
              </a>
              <p className="caption pt-1 text-muted-foreground">
                Snapshot taken when the incident was raised — not a live position.
              </p>
            </CardContent>
          </Card>
        )}
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

/**
 * Area 3 — the theft ladder's terminal manager act, from the incident page:
 * record the police report (or the audited "pending" escape), raise the
 * excess-capped theft charge (bond-first), choose the unused-days settlement
 * (FORFEIT pre-selected; REFUND for no-negligence third-party theft) and
 * terminate the hire. Mirrors `TerminateForLossDialog`'s conventions.
 */
function ConfirmTheftDialog({
  incidentId,
  incidentNumber,
  policeReportNumber,
  insuranceClaimNumber,
  defaultCharge,
  excessRemaining,
  onDone,
}: {
  incidentId: string;
  incidentNumber: string;
  policeReportNumber: string | null;
  insuranceClaimNumber: string | null;
  defaultCharge: number;
  excessRemaining: number | null;
  onDone: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [reportNumber, setReportNumber] = useState(policeReportNumber ?? "");
  const [reportPending, setReportPending] = useState(false);
  const [pendingReason, setPendingReason] = useState("");
  const [claimNumber, setClaimNumber] = useState(insuranceClaimNumber ?? "");
  const [chargeInput, setChargeInput] = useState(() =>
    (Math.round(defaultCharge * 100) / 100).toFixed(2),
  );
  const [refundMode, setRefundMode] = useState<"FORFEIT" | "REFUND">("FORFEIT");
  const [terminate, setTerminate] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const chargeAmount = useMemo(() => {
    const n = Number(chargeInput);
    return Number.isFinite(n) && n >= 0 ? Math.round(n * 100) / 100 : null;
  }, [chargeInput]);

  const confirm = trpc.fleet.confirmTheft.useMutation({
    onSuccess: () => {
      setOpen(false);
      onDone();
    },
    onError: (e) => setError(e.message),
  });

  const invalid =
    chargeAmount === null ||
    (reportPending
      ? pendingReason.trim().length < 3
      : reportNumber.trim().length === 0);

  const submit = () => {
    if (invalid) return;
    setError(null);
    confirm.mutate({
      incidentId,
      policeReportNumber: reportPending ? undefined : reportNumber.trim(),
      policeReportPending: reportPending ? true : undefined,
      policeReportPendingReason: reportPending ? pendingReason.trim() : undefined,
      insuranceClaimNumber: claimNumber.trim() || undefined,
      chargeAmount: chargeAmount ?? undefined,
      terminate,
      refundMode,
    });
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="destructive" size="sm">
          <ShieldAlert className="mr-1.5 h-3.5 w-3.5" aria-hidden />
          Confirm theft
        </Button>
      </DialogTrigger>
      <DialogContent className="max-h-[90vh] max-w-lg overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Confirm theft — {incidentNumber}</DialogTitle>
          <DialogDescription>
            Formally records the theft: marks the vehicle STOLEN, charges the customer
            (bond first, capped at the insurance excess), and ends the hire. The
            customer is notified in writing.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-1.5">
          <Label htmlFor="theft-report">Police report #</Label>
          <Input
            id="theft-report"
            value={reportNumber}
            onChange={(e) => setReportNumber(e.target.value)}
            disabled={reportPending}
            placeholder="Event / report number"
          />
          <label className="flex items-start gap-2 pt-1 text-sm">
            <input
              type="checkbox"
              className="mt-0.5"
              checked={reportPending}
              onChange={(e) => setReportPending(e.target.checked)}
            />
            <span>Report number not yet issued (audited — reason required)</span>
          </label>
          {reportPending && (
            <Input
              value={pendingReason}
              onChange={(e) => setPendingReason(e.target.value)}
              placeholder="Why is the report pending? e.g. lodged, event number to follow"
            />
          )}
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="theft-claim">Insurance claim # (optional)</Label>
          <Input
            id="theft-claim"
            value={claimNumber}
            onChange={(e) => setClaimNumber(e.target.value)}
            placeholder="Insurer claim number"
          />
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="theft-charge">Customer charge (A$)</Label>
          <Input
            id="theft-charge"
            type="number"
            min="0"
            step="0.01"
            value={chargeInput}
            onChange={(e) => setChargeInput(e.target.value)}
          />
          <p className="caption text-muted-foreground">
            Defaults to the lesser of the vehicle&apos;s book value and the remaining
            insurance-excess headroom
            {excessRemaining != null ? ` (${formatCurrency(excessRemaining)})` : ""}.
            Set 0 to skip charging.
          </p>
        </div>

        <fieldset className="space-y-2">
          <legend className="text-sm font-medium">Unused prepaid days</legend>
          {(
            [
              ["FORFEIT", "Forfeit — customer keeps no claim (customer-caused loss)"],
              ["REFUND", "Refund — return the unused days (no-negligence third-party theft)"],
            ] as const
          ).map(([mode, label]) => (
            <label key={mode} className="flex items-start gap-2 text-sm">
              <input
                type="radio"
                name="theft-refund-mode"
                className="mt-0.5"
                checked={refundMode === mode}
                onChange={() => setRefundMode(mode)}
              />
              <span>{label}</span>
            </label>
          ))}
          <label className="flex items-start gap-2 text-sm">
            <input
              type="checkbox"
              className="mt-0.5"
              checked={terminate}
              onChange={(e) => setTerminate(e.target.checked)}
            />
            <span>End the hire now (loss termination — recommended)</span>
          </label>
        </fieldset>

        {error && <p className="text-sm text-destructive">{error}</p>}

        <DialogFooter>
          <Button variant="ghost" onClick={() => setOpen(false)} disabled={confirm.isPending}>
            Cancel
          </Button>
          <Button variant="destructive" onClick={submit} disabled={confirm.isPending || invalid}>
            {confirm.isPending && (
              <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" aria-hidden />
            )}
            Confirm theft
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
