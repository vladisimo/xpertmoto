"use client";

import { use, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { ArrowLeft, ArrowRight, CheckCircle2, Loader2 } from "lucide-react";

import { trpc } from "@/lib/trpc/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { PageHeader } from "@/components/layout/page-header";
import { PageShell, PageSection } from "@/components/layout/page-section";
import { LoadingBlock } from "@/components/ui/spinner";
import { StatusBadge } from "@/components/ui/status-badge";
import {
  DamageMapCanvas,
  normalizeMarkers,
  type DamageMarker,
} from "@/components/agreement/damage-map-canvas";
import { SignaturePad } from "@/components/agreement/signature-pad";
import { cn } from "@/lib/utils";

type Step = "reason" | "outgoing" | "select" | "incoming" | "review";

type InspectionDraft = {
  odometerKm: string;
  fuelLevel: number;
  overallCondition: "EXCELLENT" | "GOOD" | "FAIR" | "POOR";
  notes: string;
  markers: DamageMarker[];
  activeSeverity: "MINOR" | "MODERATE" | "MAJOR";
};

const REASON_OPTIONS: Array<{
  value: "UPGRADE" | "DOWNGRADE" | "LATERAL" | "MECHANICAL_FAULT" | "ACCIDENT_DAMAGE" | "OPERATIONAL";
  label: string;
  priceEffect: "charge" | "refund" | "none" | "same-category-only";
  description: string;
}> = [
  {
    value: "LATERAL",
    label: "Lateral (same category)",
    priceEffect: "same-category-only",
    description: "Customer wants a different bike in the same class. No price change.",
  },
  {
    value: "UPGRADE",
    label: "Upgrade (higher category)",
    priceEffect: "charge",
    description: "Customer moves to a higher-spec category. Pays pro-rata difference.",
  },
  {
    value: "DOWNGRADE",
    label: "Downgrade (lower category)",
    priceEffect: "refund",
    description: "Customer moves to a lower-spec category. Refunded pro-rata difference.",
  },
  {
    value: "MECHANICAL_FAULT",
    label: "Mechanical fault",
    priceEffect: "none",
    description: "Vehicle unrideable. No price change. Work order opened automatically.",
  },
  {
    value: "ACCIDENT_DAMAGE",
    label: "Accident damage",
    priceEffect: "none",
    description: "Damage from an incident. No price change. Work order + incident opened.",
  },
  {
    value: "OPERATIONAL",
    label: "Operational (depot need)",
    priceEffect: "none",
    description: "Depot-driven swap (scheduled service, rego expiry, etc). No price change.",
  },
];

const ORIGIN_OPTIONS = [
  { value: "CUSTOMER_WALK_IN", label: "Customer at depot counter" },
  { value: "CUSTOMER_PHONE_SUPPORT", label: "Customer phoned support" },
  { value: "CUSTOMER_SELF_SERVICE", label: "Customer via portal" },
  { value: "ROADSIDE_ASSIST", label: "Roadside assist partner" },
  { value: "STAFF_OBSERVED", label: "Staff observed" },
  { value: "TELEMATICS_ALERT", label: "Telematics alert" },
] as const;

const CONDITION_OPTIONS = ["EXCELLENT", "GOOD", "FAIR", "POOR"] as const;

function inspectionPayload(d: InspectionDraft) {
  return {
    odometerKm: Number(d.odometerKm),
    fuelLevel: d.fuelLevel,
    overallCondition: d.overallCondition,
    notes: d.notes || undefined,
    damageMarkers: d.markers.map((m) => ({
      id: m.id,
      x: m.x,
      y: m.y,
      severity: m.severity,
      note: m.note,
      source: m.source,
      view: m.view,
      addedAt: m.addedAt,
    })),
  };
}

function emptyInspection(): InspectionDraft {
  return {
    odometerKm: "",
    fuelLevel: 100,
    overallCondition: "GOOD",
    notes: "",
    markers: [],
    activeSeverity: "MINOR",
  };
}

export default function SwapWizardPage(props: { params: Promise<{ id: string }> }) {
  const { id } = use(props.params);
  const router = useRouter();

  const { data: booking } = trpc.staffBooking.detail.useQuery({ id });

  const [step, setStep] = useState<Step>("reason");
  const [swapId, setSwapId] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  // Step 1
  const [reason, setReason] = useState<(typeof REASON_OPTIONS)[number]["value"] | "">("");
  const [origin, setOrigin] = useState<(typeof ORIGIN_OPTIONS)[number]["value"] | "">("");
  const [reasonNotes, setReasonNotes] = useState("");
  const [originDetails, setOriginDetails] = useState("");

  // Step 2 / 4 — inspections
  const [outgoing, setOutgoing] = useState<InspectionDraft>(emptyInspection);
  const [incoming, setIncoming] = useState<InspectionDraft>(emptyInspection);

  // Step 3 — selected vehicle
  const [incomingVehicleId, setIncomingVehicleId] = useState<string>("");
  const [includeCrossCategory, setIncludeCrossCategory] = useState(false);

  // Step 5 — signatures + incident severity + work-order priority
  const [customerSignatureUrl, setCustomerSignatureUrl] = useState<string | null>(null);
  const [staffSignatureUrl, setStaffSignatureUrl] = useState<string | null>(null);
  const [incidentSeverity, setIncidentSeverity] = useState<"MINOR" | "MODERATE" | "MAJOR" | "TOTAL_LOSS">(
    "MODERATE",
  );
  const [workOrderPriority, setWorkOrderPriority] = useState<"LOW" | "MEDIUM" | "HIGH" | "URGENT">(
    "HIGH",
  );

  // Cross-category is only meaningful for fault/operational reasons; spec
  // changes explicitly move across categories and don't need the toggle.
  const isFaultReason =
    reason === "MECHANICAL_FAULT" || reason === "ACCIDENT_DAMAGE" || reason === "OPERATIONAL";

  const start = trpc.bookingSwap.startSwapDraft.useMutation();
  const voidDraft = trpc.bookingSwap.voidSwapDraft.useMutation();
  const confirm = trpc.bookingSwap.confirmSwap.useMutation();

  const candidates = trpc.bookingSwap.listCandidates.useQuery(
    { bookingId: id, includeCrossCategory: isFaultReason || includeCrossCategory },
    { enabled: step === "select" && Boolean(booking?.vehicle) },
  );

  const selectedCandidate = useMemo(
    () => candidates.data?.vehicles.find((v) => v.id === incomingVehicleId) ?? null,
    [candidates.data, incomingVehicleId],
  );

  const deltaQuote = trpc.bookingSwap.quoteDelta.useQuery(
    {
      bookingId: id,
      newCategoryId: selectedCandidate?.categoryId ?? "",
      reason: reason || "LATERAL",
    },
    { enabled: Boolean(selectedCandidate && reason) },
  );

  if (!booking) {
    return (
      <PageShell>
        <LoadingBlock padded="lg" />
      </PageShell>
    );
  }

  if (!booking.vehicle) {
    return (
      <PageShell>
        <PageHeader
          title="Swap vehicle"
          description="This booking has no assigned vehicle — allocate one before attempting a swap."
          breadcrumbs={[
            { href: "/staff/bookings", label: "Bookings" },
            { href: `/staff/bookings/${id}`, label: booking.bookingReference },
          ]}
        />
      </PageShell>
    );
  }

  const currentVehicle = booking.vehicle;
  const currentCategoryId = booking.categoryId;

  async function handleStartDraft() {
    if (!reason || !origin || !reasonNotes.trim()) {
      setErr("Reason, origin, and a short note are all required.");
      return;
    }
    setErr(null);
    try {
      const draft = await start.mutateAsync({
        bookingId: id,
        reason,
        origin,
        reasonNotes: reasonNotes.trim(),
        originDetails: originDetails.trim() || undefined,
      });
      setSwapId(draft.id);
      setStep("outgoing");
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Failed to start swap draft.");
    }
  }

  async function handleAbandon() {
    if (!swapId) {
      router.push(`/staff/bookings/${id}`);
      return;
    }
    try {
      await voidDraft.mutateAsync({ swapId, reason: "Wizard abandoned by staff" });
    } catch {
      /* best-effort — draft will be cleaned up by nightly job */
    }
    router.push(`/staff/bookings/${id}`);
  }

  async function handleConfirm() {
    if (!swapId || !incomingVehicleId) return;
    if (!outgoing.odometerKm || !incoming.odometerKm) {
      setErr("Both odometer readings are required.");
      return;
    }
    setErr(null);
    try {
      await confirm.mutateAsync({
        swapId,
        incomingVehicleId,
        outgoingInspection: inspectionPayload(outgoing),
        incomingInspection: inspectionPayload(incoming),
        customerSignatureUrl: customerSignatureUrl ?? undefined,
        staffSignatureUrl: staffSignatureUrl ?? undefined,
        incidentSeverity: reason === "ACCIDENT_DAMAGE" ? incidentSeverity : undefined,
        workOrderPriority,
      });
      router.push(`/staff/bookings/${id}`);
      router.refresh();
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Failed to commit swap.");
    }
  }

  return (
    <PageShell>
      <PageHeader
        eyebrow="Mid-rental swap"
        title={`Swap vehicle — ${booking.bookingReference}`}
        description={`Currently assigned: ${currentVehicle.internalCode} · ${currentVehicle.rego}`}
        breadcrumbs={[
          { href: "/staff/bookings", label: "Bookings" },
          { href: `/staff/bookings/${id}`, label: booking.bookingReference },
        ]}
        actions={
          <Button variant="ghost" size="sm" onClick={handleAbandon}>
            Cancel swap
          </Button>
        }
      />

      <StepNav current={step} swapId={swapId} />

      {err && (
        <div className="rounded-md border border-destructive bg-destructive/10 px-3 py-2 text-sm text-destructive">
          {err}
        </div>
      )}

      {step === "reason" && (
        <PageSection title="Why is this vehicle changing?" description="Reason drives pricing; origin is audit-only.">
          <div className="space-y-6">
            <div className="space-y-2">
              <Label>Reason</Label>
              <Select value={reason} onValueChange={(v) => setReason(v as typeof reason)}>
                <SelectTrigger>
                  <SelectValue placeholder="Choose a reason…" />
                </SelectTrigger>
                <SelectContent>
                  {REASON_OPTIONS.map((r) => (
                    <SelectItem key={r.value} value={r.value}>
                      {r.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {reason && (
                <p className="text-xs text-muted-foreground">
                  {REASON_OPTIONS.find((r) => r.value === reason)!.description}
                </p>
              )}
            </div>

            <div className="space-y-2">
              <Label>Origin (how was the issue raised?)</Label>
              <Select value={origin} onValueChange={(v) => setOrigin(v as typeof origin)}>
                <SelectTrigger>
                  <SelectValue placeholder="Choose an origin…" />
                </SelectTrigger>
                <SelectContent>
                  {ORIGIN_OPTIONS.map((o) => (
                    <SelectItem key={o.value} value={o.value}>
                      {o.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2">
              <Label>Details (customer's exact words if via phone/portal)</Label>
              <Input
                value={reasonNotes}
                onChange={(e) => setReasonNotes(e.target.value)}
                placeholder="e.g. Brakes feel soft, squeaking on hard stop"
              />
            </div>

            <div className="space-y-2">
              <Label>Reference (support ticket, call log, telematics event)</Label>
              <Input
                value={originDetails}
                onChange={(e) => setOriginDetails(e.target.value)}
                placeholder="Optional — e.g. TKT-1234 or telematics alert ID"
              />
            </div>

            <StepFooter
              onNext={handleStartDraft}
              nextDisabled={!reason || !origin || !reasonNotes.trim() || start.isPending}
              nextLabel={start.isPending ? "Starting…" : "Continue"}
            />
          </div>
        </PageSection>
      )}

      {step === "outgoing" && (
        <PageSection
          title="Outgoing vehicle inspection"
          description={`Post-hire condition of ${currentVehicle.internalCode} before handing it back.`}
        >
          <InspectionForm
            draft={outgoing}
            onChange={setOutgoing}
            vehicleLabel={`${currentVehicle.internalCode} · ${currentVehicle.rego}`}
          />
          <StepFooter
            onBack={() => setStep("reason")}
            onNext={() => setStep("select")}
            nextDisabled={!outgoing.odometerKm}
          />
        </PageSection>
      )}

      {step === "select" && (
        <PageSection
          title="Choose replacement vehicle"
          description={
            isFaultReason
              ? "Fault swap — any available vehicle, no price change."
              : "Pick a replacement. Pricing delta shown inline."
          }
        >
          <div className="space-y-4">
            {!isFaultReason && reason !== "LATERAL" && (
              <div className="flex items-center gap-2 text-xs text-muted-foreground">
                <input
                  id="cross-cat"
                  type="checkbox"
                  checked={includeCrossCategory}
                  onChange={(e) => setIncludeCrossCategory(e.target.checked)}
                />
                <label htmlFor="cross-cat">Include other categories</label>
              </div>
            )}
            {candidates.isLoading && <LoadingBlock padded="md" />}
            {candidates.data?.eligible && candidates.data.vehicles.length === 0 && (
              <p className="text-sm text-muted-foreground">
                No candidate vehicles found for the remaining rental window.
              </p>
            )}
            {candidates.data?.eligible && candidates.data.vehicles.length > 0 && (
              <div className="space-y-2">
                {candidates.data.vehicles
                  .filter((v) => v.free)
                  .map((v) => {
                    const differentCategory = v.categoryId !== currentCategoryId;
                    return (
                      <button
                        key={v.id}
                        type="button"
                        onClick={() => setIncomingVehicleId(v.id)}
                        className={cn(
                          "w-full rounded-md border px-4 py-3 text-left text-sm transition",
                          incomingVehicleId === v.id
                            ? "border-primary bg-primary/5"
                            : "border-border hover:border-foreground/40",
                        )}
                      >
                        <div className="flex items-center justify-between gap-2">
                          <div className="font-medium">
                            {v.internalCode} · {v.rego}
                          </div>
                          <div className="flex items-center gap-2">
                            <StatusBadge status={v.condition} />
                            {differentCategory && (
                              <span className="text-xs text-muted-foreground">
                                {v.categoryName}
                              </span>
                            )}
                          </div>
                        </div>
                        <div className="mt-1 text-xs text-muted-foreground">
                          {v.currentOdometerKm.toLocaleString()} km
                          {v.docsExpiringDuringRental.length > 0 &&
                            ` · ⚠️ ${v.docsExpiringDuringRental.join(", ")} expires during rental`}
                        </div>
                      </button>
                    );
                  })}
              </div>
            )}

            {selectedCandidate && deltaQuote.data && (
              <div className="rounded-md border bg-muted/30 px-4 py-3 text-sm">
                <div className="font-medium">Pricing preview</div>
                {deltaQuote.data.forcedZero ? (
                  <p className="mt-1 text-muted-foreground">
                    {deltaQuote.data.forcedZero === "reason"
                      ? "No price change — reason forces zero delta."
                      : "No price change — same category."}
                  </p>
                ) : (
                  <p className="mt-1 text-muted-foreground">
                    {deltaQuote.data.direction === "CHARGE" ? "Charge" : "Refund"}{" "}
                    A$
                    {Math.abs(deltaQuote.data.deltaAmount).toFixed(2)} (GST A$
                    {deltaQuote.data.gstAmount.toFixed(2)}) over {deltaQuote.data.remainingDays}{" "}
                    remaining day(s).
                  </p>
                )}
              </div>
            )}

            <StepFooter
              onBack={() => setStep("outgoing")}
              onNext={() => setStep("incoming")}
              nextDisabled={!incomingVehicleId}
            />
          </div>
        </PageSection>
      )}

      {step === "incoming" && selectedCandidate && (
        <PageSection
          title="Incoming vehicle inspection"
          description={`Pre-hire condition of ${selectedCandidate.internalCode} before customer rides away.`}
        >
          <InspectionForm
            draft={incoming}
            onChange={setIncoming}
            vehicleLabel={`${selectedCandidate.internalCode} · ${selectedCandidate.rego}`}
          />
          <StepFooter
            onBack={() => setStep("select")}
            onNext={() => setStep("review")}
            nextDisabled={!incoming.odometerKm}
          />
        </PageSection>
      )}

      {step === "review" && selectedCandidate && (
        <PageSection
          title="Review and sign"
          description="Confirm the swap, capture signatures, and apply."
        >
          <div className="space-y-6">
            <Card>
              <CardHeader>
                <CardTitle className="text-base">Summary</CardTitle>
              </CardHeader>
              <CardContent className="space-y-2 text-sm">
                <div>
                  <span className="text-muted-foreground">Reason: </span>
                  {REASON_OPTIONS.find((r) => r.value === reason)?.label}
                </div>
                <div>
                  <span className="text-muted-foreground">Origin: </span>
                  {ORIGIN_OPTIONS.find((o) => o.value === origin)?.label}
                </div>
                <div>
                  <span className="text-muted-foreground">Outgoing: </span>
                  {currentVehicle.internalCode} · {currentVehicle.rego} ·{" "}
                  {outgoing.odometerKm} km · fuel {outgoing.fuelLevel}%
                </div>
                <div>
                  <span className="text-muted-foreground">Incoming: </span>
                  {selectedCandidate.internalCode} · {selectedCandidate.rego} ·{" "}
                  {incoming.odometerKm} km · fuel {incoming.fuelLevel}%
                </div>
                {deltaQuote.data && !deltaQuote.data.forcedZero && (
                  <div>
                    <span className="text-muted-foreground">Price adjustment: </span>
                    {deltaQuote.data.direction === "CHARGE" ? "Charge " : "Refund "}
                    A${Math.abs(deltaQuote.data.deltaAmount).toFixed(2)} (GST A$
                    {deltaQuote.data.gstAmount.toFixed(2)})
                  </div>
                )}
                {deltaQuote.data?.forcedZero && (
                  <div>
                    <span className="text-muted-foreground">Price adjustment: </span>
                    No change
                  </div>
                )}
              </CardContent>
            </Card>

            {reason === "ACCIDENT_DAMAGE" && (
              <div className="space-y-2">
                <Label>Incident severity</Label>
                <Select
                  value={incidentSeverity}
                  onValueChange={(v) => setIncidentSeverity(v as typeof incidentSeverity)}
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="MINOR">Minor</SelectItem>
                    <SelectItem value="MODERATE">Moderate</SelectItem>
                    <SelectItem value="MAJOR">Major</SelectItem>
                    <SelectItem value="TOTAL_LOSS">Total loss</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            )}
            {(reason === "MECHANICAL_FAULT" || reason === "ACCIDENT_DAMAGE") && (
              <div className="space-y-2">
                <Label>Work-order priority</Label>
                <Select
                  value={workOrderPriority}
                  onValueChange={(v) => setWorkOrderPriority(v as typeof workOrderPriority)}
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="LOW">Low</SelectItem>
                    <SelectItem value="MEDIUM">Medium</SelectItem>
                    <SelectItem value="HIGH">High</SelectItem>
                    <SelectItem value="URGENT">Urgent</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            )}

            <div className="grid gap-4 md:grid-cols-2">
              <div className="space-y-2">
                <Label>Customer signature</Label>
                <SignaturePad
                  onAccept={setCustomerSignatureUrl}
                  existingUrl={customerSignatureUrl}
                  label="Sign here — customer"
                />
              </div>
              <div className="space-y-2">
                <Label>Staff signature</Label>
                <SignaturePad
                  onAccept={setStaffSignatureUrl}
                  existingUrl={staffSignatureUrl}
                  label="Sign here — staff"
                />
              </div>
            </div>

            <StepFooter
              onBack={() => setStep("incoming")}
              onNext={handleConfirm}
              nextDisabled={confirm.isPending}
              nextLabel={
                confirm.isPending ? "Committing…" : <>
                  <CheckCircle2 className="mr-1.5 h-4 w-4" aria-hidden />
                  Confirm swap
                </>
              }
            />
          </div>
        </PageSection>
      )}
    </PageShell>
  );
}

function StepNav({ current, swapId }: { current: Step; swapId: string | null }) {
  const steps: Array<{ key: Step; label: string }> = [
    { key: "reason", label: "Reason" },
    { key: "outgoing", label: "Outgoing" },
    { key: "select", label: "Choose" },
    { key: "incoming", label: "Incoming" },
    { key: "review", label: "Review" },
  ];
  const currentIdx = steps.findIndex((s) => s.key === current);
  return (
    <div className="flex items-center gap-2 text-xs text-muted-foreground">
      {steps.map((s, i) => (
        <div key={s.key} className="flex items-center gap-2">
          <span
            className={cn(
              "rounded-full px-2 py-0.5",
              i === currentIdx
                ? "bg-primary text-primary-foreground"
                : i < currentIdx
                  ? "bg-muted-foreground/20 text-foreground"
                  : "bg-muted text-muted-foreground",
            )}
          >
            {i + 1}. {s.label}
          </span>
          {i < steps.length - 1 && <span>→</span>}
        </div>
      ))}
      {swapId && (
        <span className="ml-auto text-[11px] text-muted-foreground">
          draft {swapId.slice(0, 8)}
        </span>
      )}
    </div>
  );
}

function StepFooter({
  onBack,
  onNext,
  nextDisabled,
  nextLabel,
}: {
  onBack?: () => void;
  onNext: () => void;
  nextDisabled?: boolean;
  nextLabel?: React.ReactNode;
}) {
  return (
    <div className="mt-6 flex items-center justify-between">
      {onBack ? (
        <Button variant="ghost" size="sm" onClick={onBack}>
          <ArrowLeft className="mr-1.5 h-3.5 w-3.5" aria-hidden />
          Back
        </Button>
      ) : (
        <span />
      )}
      <Button size="sm" onClick={onNext} disabled={nextDisabled}>
        {nextDisabled && typeof nextLabel !== "string" ? (
          <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" aria-hidden />
        ) : null}
        {nextLabel ?? (
          <>
            Continue
            <ArrowRight className="ml-1.5 h-3.5 w-3.5" aria-hidden />
          </>
        )}
      </Button>
    </div>
  );
}

function InspectionForm({
  draft,
  onChange,
  vehicleLabel,
}: {
  draft: InspectionDraft;
  onChange: (next: InspectionDraft) => void;
  vehicleLabel: string;
}) {
  return (
    <div className="space-y-4">
      <p className="text-xs text-muted-foreground">{vehicleLabel}</p>
      <div className="grid gap-4 md:grid-cols-3">
        <div className="space-y-2">
          <Label>Odometer (km)</Label>
          <Input
            inputMode="numeric"
            value={draft.odometerKm}
            onChange={(e) =>
              onChange({ ...draft, odometerKm: e.target.value.replace(/[^\d]/g, "") })
            }
            placeholder="e.g. 12345"
          />
        </div>
        <div className="space-y-2">
          <Label>Fuel level (%)</Label>
          <Input
            inputMode="numeric"
            type="number"
            min={0}
            max={100}
            value={draft.fuelLevel}
            onChange={(e) =>
              onChange({ ...draft, fuelLevel: Math.max(0, Math.min(100, Number(e.target.value))) })
            }
          />
        </div>
        <div className="space-y-2">
          <Label>Overall condition</Label>
          <Select
            value={draft.overallCondition}
            onValueChange={(v) =>
              onChange({ ...draft, overallCondition: v as InspectionDraft["overallCondition"] })
            }
          >
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {CONDITION_OPTIONS.map((c) => (
                <SelectItem key={c} value={c}>
                  {c.charAt(0) + c.slice(1).toLowerCase()}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>

      <div className="space-y-2">
        <Label>Notes</Label>
        <Input
          value={draft.notes}
          onChange={(e) => onChange({ ...draft, notes: e.target.value })}
          placeholder="Anything notable for the record"
        />
      </div>

      <div className="space-y-2">
        <div className="flex items-center justify-between">
          <Label>Damage markers</Label>
          <Select
            value={draft.activeSeverity}
            onValueChange={(v) =>
              onChange({ ...draft, activeSeverity: v as InspectionDraft["activeSeverity"] })
            }
          >
            <SelectTrigger className="w-[140px]">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="MINOR">Minor</SelectItem>
              <SelectItem value="MODERATE">Moderate</SelectItem>
              <SelectItem value="MAJOR">Major</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <DamageMapCanvas
          baseMarkers={[]}
          markers={normalizeMarkers(draft.markers)}
          onChange={(next) => onChange({ ...draft, markers: next })}
          activeSeverity={draft.activeSeverity}
          source="staff"
        />
      </div>
    </div>
  );
}
