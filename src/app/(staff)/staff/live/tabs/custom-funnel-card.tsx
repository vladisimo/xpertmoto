"use client";

import * as React from "react";
import { Plus, Save, Trash2, TrendingDown } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { LoadingBlock } from "@/components/ui/stat-shell";
import { StatusBadge } from "@/components/ui/status-badge";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { trpc } from "@/lib/trpc/client";
import { useAnalyticsFilters } from "@/hooks/use-analytics-filters";
import type { FunnelStep } from "@/lib/analytics/segments";

type StepDraft =
  | { kind: "path"; label: string; match: string }
  | { kind: "event"; label: string; eventKind: string; target: string }
  | { kind: "outcome"; label: string; outcome: string }
  | { kind: "wizardStep"; label: string; minStep: number };

const DEFAULT_STEP: StepDraft = {
  kind: "path",
  label: "Landing",
  match: "/",
};

/**
 * Custom funnel widget on the Conversion tab. Staff pick a saved
 * funnel from the dropdown to evaluate it against the current range +
 * segment, or open the builder dialog to create a new one with
 * arbitrary path / event / wizard-step / outcome steps.
 */
export function CustomFunnelCard() {
  const { filters } = useAnalyticsFilters();
  const utils = trpc.useUtils();
  const funnels = trpc.analyticsConfig.funnelsList.useQuery(undefined, {
    staleTime: 60_000,
    refetchOnWindowFocus: false,
  });
  const [selectedId, setSelectedId] = React.useState<string | null>(null);
  const evaluation = trpc.analyticsConfig.funnelEvaluate.useQuery(
    {
      funnelId: selectedId ?? "",
      range: filters.range,
      segment: selectedId
        ? {
            segment: filters.segment,
            country: filters.country ?? undefined,
            landingPath: filters.landing ?? undefined,
            utmSource: filters.source ?? undefined,
            utmMedium: filters.medium ?? undefined,
            utmCampaign: filters.campaign ?? undefined,
            referrerDomain: filters.referrer ?? undefined,
            wizardStepEq: filters.step ?? undefined,
            pickupDepotId: filters.depot ?? undefined,
            categoryId: filters.category ?? undefined,
            vehicleId: filters.vehicle ?? undefined,
            discountCode: filters.code ?? undefined,
          }
        : undefined,
    },
    { enabled: !!selectedId, staleTime: 30_000, refetchOnWindowFocus: false },
  );
  const createFunnel = trpc.analyticsConfig.funnelCreate.useMutation({
    onSuccess: ({ id }) => {
      utils.analyticsConfig.funnelsList.invalidate();
      setSelectedId(id);
    },
  });
  const deleteFunnel = trpc.analyticsConfig.funnelDelete.useMutation({
    onSuccess: () => utils.analyticsConfig.funnelsList.invalidate(),
  });

  const [builderOpen, setBuilderOpen] = React.useState(false);
  const [draftName, setDraftName] = React.useState("");
  const [draftSteps, setDraftSteps] = React.useState<StepDraft[]>([{ ...DEFAULT_STEP }]);
  const resetBuilder = () => {
    setDraftName("");
    setDraftSteps([{ ...DEFAULT_STEP }]);
  };

  const activeFunnel = funnels.data?.find((f) => f.id === selectedId) ?? null;

  return (
    <div className="rounded-lg border bg-card p-4 shadow-sm">
      <div className="mb-3 flex items-center gap-2">
        <h3 className="h3 flex items-center gap-2 text-sm">
          <TrendingDown className="h-4 w-4 text-muted-foreground" aria-hidden />
          Custom funnel
        </h3>
        <div className="ml-auto flex items-center gap-2">
          <Select
            value={selectedId ?? ""}
            onValueChange={(v) => setSelectedId(v || null)}
          >
            <SelectTrigger className="w-60">
              <SelectValue placeholder="Pick a saved funnel…" />
            </SelectTrigger>
            <SelectContent>
              {funnels.data?.map((f) => (
                <SelectItem key={f.id} value={f.id}>
                  {f.name}
                </SelectItem>
              ))}
              {funnels.data && funnels.data.length === 0 && (
                <div className="px-2 py-1.5 text-[11px] text-muted-foreground">
                  No saved funnels yet.
                </div>
              )}
            </SelectContent>
          </Select>
          <Button size="sm" variant="secondary" onClick={() => setBuilderOpen(true)}>
            <Plus className="h-3.5 w-3.5" aria-hidden />
            New funnel
          </Button>
          {activeFunnel?.mine && (
            <Button
              size="sm"
              variant="ghost"
              onClick={() => {
                if (confirm(`Delete funnel "${activeFunnel.name}"?`)) {
                  deleteFunnel.mutate({ id: activeFunnel.id });
                  setSelectedId(null);
                }
              }}
              className="text-destructive"
            >
              <Trash2 className="h-3.5 w-3.5" aria-hidden />
            </Button>
          )}
        </div>
      </div>

      {!selectedId ? (
        <p className="text-xs text-muted-foreground">
          Pick a saved funnel above, or create a new one to evaluate an arbitrary
          sequence of path / event / wizard-step / outcome steps.
        </p>
      ) : evaluation.isLoading || !evaluation.data ? (
        <LoadingBlock className="h-40 w-full" />
      ) : (
        <div>
          {evaluation.data.description && (
            <p className="mb-2 text-xs text-muted-foreground">{evaluation.data.description}</p>
          )}
          <p className="mb-3 text-[11px] text-muted-foreground">
            Starting from {evaluation.data.startingSessions.toLocaleString("en-AU")} sessions
            in range.
          </p>
          <div className="space-y-3">
            {evaluation.data.steps.map((s) => {
              const share =
                evaluation.data.startingSessions > 0
                  ? Math.min(
                      100,
                      Math.round((s.reached / evaluation.data.startingSessions) * 100),
                    )
                  : 0;
              return (
                <div key={s.step}>
                  <div className="flex items-baseline justify-between gap-3">
                    <span className="text-xs font-medium text-foreground">
                      Step {s.step} · {s.label}
                      <span className="ml-2 text-muted-foreground">{share}%</span>
                    </span>
                    <span className="flex items-baseline gap-2 text-xs">
                      <span className="tabular-nums text-muted-foreground">
                        {s.reached.toLocaleString("en-AU")} reached
                      </span>
                      {s.dropOffRate != null && (
                        s.dropOffRate > 0.3 ? (
                          <StatusBadge
                            status="AT_RISK"
                            label={`-${(s.dropOffRate * 100).toFixed(0)}% vs prev`}
                          />
                        ) : (
                          <span className="text-[10px] text-muted-foreground">
                            -{(s.dropOffRate * 100).toFixed(0)}% vs prev
                          </span>
                        )
                      )}
                    </span>
                  </div>
                  <div className="mt-1.5 h-2 w-full overflow-hidden rounded-full bg-muted">
                    <div
                      className="h-full rounded-full bg-primary transition-[width]"
                      style={{ width: `${share}%` }}
                      aria-hidden
                    />
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      <Dialog
        open={builderOpen}
        onOpenChange={(o) => {
          setBuilderOpen(o);
          if (!o) resetBuilder();
        }}
      >
        <DialogContent className="sm:max-w-xl">
          <DialogHeader>
            <DialogTitle>New custom funnel</DialogTitle>
            <DialogDescription>
              Define 2–8 steps. Each step is a path match, event firing, wizard-step
              reached, or session outcome. Sessions must satisfy every prior step in order
              to advance.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div className="space-y-1">
              <label className="text-sm" htmlFor="funnel-name">
                Name
              </label>
              <Input
                id="funnel-name"
                value={draftName}
                onChange={(e) => setDraftName(e.target.value)}
                placeholder="Hero → Fleet → Booked"
              />
            </div>
            <div className="space-y-2">
              {draftSteps.map((step, idx) => (
                <StepEditor
                  key={idx}
                  step={step}
                  onChange={(next) =>
                    setDraftSteps((prev) => prev.map((s, i) => (i === idx ? next : s)))
                  }
                  onRemove={
                    draftSteps.length > 1
                      ? () =>
                          setDraftSteps((prev) => prev.filter((_, i) => i !== idx))
                      : undefined
                  }
                />
              ))}
              {draftSteps.length < 8 && (
                <Button
                  size="sm"
                  variant="secondary"
                  onClick={() =>
                    setDraftSteps((prev) => [...prev, { ...DEFAULT_STEP, label: `Step ${prev.length + 1}` }])
                  }
                >
                  <Plus className="h-3.5 w-3.5" aria-hidden />
                  Add step
                </Button>
              )}
            </div>
          </div>
          <DialogFooter>
            <Button variant="secondary" onClick={() => setBuilderOpen(false)}>
              Cancel
            </Button>
            <Button
              onClick={async () => {
                const stepsClean = draftSteps
                  .map(toFunnelStep)
                  .filter((s): s is FunnelStep => s != null);
                if (stepsClean.length < 2 || !draftName.trim()) return;
                await createFunnel.mutateAsync({
                  name: draftName.trim(),
                  steps: stepsClean as unknown as FunnelStep[],
                });
                setBuilderOpen(false);
                resetBuilder();
              }}
              disabled={createFunnel.isPending || draftSteps.length < 2 || !draftName.trim()}
            >
              <Save className="h-3.5 w-3.5" aria-hidden />
              Save funnel
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function StepEditor({
  step,
  onChange,
  onRemove,
}: {
  step: StepDraft;
  onChange: (next: StepDraft) => void;
  onRemove?: () => void;
}) {
  return (
    <div className="rounded-md border bg-muted/20 p-3 space-y-2">
      <div className="flex items-center gap-2">
        <Input
          value={step.label}
          onChange={(e) => onChange({ ...step, label: e.target.value })}
          placeholder="Step name"
          className="max-w-xs"
        />
        <Select
          value={step.kind}
          onValueChange={(v) => {
            if (v === step.kind) return;
            if (v === "path") onChange({ kind: "path", label: step.label, match: "/" });
            else if (v === "event")
              onChange({ kind: "event", label: step.label, eventKind: "CTA_CLICK", target: "" });
            else if (v === "outcome")
              onChange({ kind: "outcome", label: step.label, outcome: "CONVERTED" });
            else if (v === "wizardStep")
              onChange({ kind: "wizardStep", label: step.label, minStep: 1 });
          }}
        >
          <SelectTrigger className="w-36">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="path">Path</SelectItem>
            <SelectItem value="event">Event</SelectItem>
            <SelectItem value="wizardStep">Wizard step</SelectItem>
            <SelectItem value="outcome">Outcome</SelectItem>
          </SelectContent>
        </Select>
        {onRemove && (
          <Button variant="ghost" size="sm" onClick={onRemove} className="ml-auto text-muted-foreground">
            <Trash2 className="h-3.5 w-3.5" aria-hidden />
          </Button>
        )}
      </div>
      {step.kind === "path" && (
        <Input
          value={step.match}
          onChange={(e) => onChange({ ...step, match: e.target.value })}
          placeholder="/fleet or /booking*"
        />
      )}
      {step.kind === "event" && (
        <div className="flex gap-2">
          <Select
            value={step.eventKind}
            onValueChange={(v) => onChange({ ...step, eventKind: v })}
          >
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {[
                "CLICK",
                "CTA_CLICK",
                "FLEET_VIEW",
                "FLEET_CLICK",
                "SEARCH",
                "DISCOUNT_ATTEMPTED",
                "DISCOUNT_APPLIED",
                "WIZARD_STEP_ENTER",
                "SCROLL_DEPTH",
                "EXIT_INTENT",
                "RAGE_CLICK",
              ].map((k) => (
                <SelectItem key={k} value={k}>
                  {k}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Input
            value={step.target}
            onChange={(e) => onChange({ ...step, target: e.target.value })}
            placeholder="optional target (e.g. hero-primary-cta)"
          />
        </div>
      )}
      {step.kind === "outcome" && (
        <Select value={step.outcome} onValueChange={(v) => onChange({ ...step, outcome: v })}>
          <SelectTrigger>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {["CONVERTED", "ABANDONED_WIZARD", "BOUNCED", "LEFT"].map((o) => (
              <SelectItem key={o} value={o}>
                {o}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      )}
      {step.kind === "wizardStep" && (
        <Select
          value={String(step.minStep)}
          onValueChange={(v) => onChange({ ...step, minStep: Number(v) })}
        >
          <SelectTrigger>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {[1, 2, 3, 4, 5, 6].map((n) => (
              <SelectItem key={n} value={String(n)}>
                Reached step {n}+
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      )}
    </div>
  );
}

function toFunnelStep(s: StepDraft): FunnelStep | null {
  const label = s.label.trim();
  if (!label) return null;
  if (s.kind === "path") {
    return s.match.trim() ? { kind: "path", label, match: s.match.trim() } : null;
  }
  if (s.kind === "event") {
    const target = s.target.trim();
    return {
      kind: "event",
      label,
      eventKind: s.eventKind as FunnelStep extends { kind: "event"; eventKind: infer K } ? K : never,
      ...(target ? { target } : {}),
    };
  }
  if (s.kind === "outcome") {
    return { kind: "outcome", label, outcome: s.outcome as "CONVERTED" | "ABANDONED_WIZARD" | "BOUNCED" | "LEFT" };
  }
  return { kind: "wizardStep", label, minStep: s.minStep };
}
