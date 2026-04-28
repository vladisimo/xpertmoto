"use client";

import * as React from "react";
import { AlertTriangle, Bell, Pause, Play, Plus, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { LoadingBlock } from "@/components/ui/stat-shell";
import { StatusBadge } from "@/components/ui/status-badge";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { trpc } from "@/lib/trpc/client";
import {
  ALERT_METRICS,
  ALERT_METRIC_LABEL,
  ALERT_OPERATORS,
  type AlertMetric,
  type AlertOperator,
} from "@/lib/analytics/segments";

/**
 * Staff-facing alerts management. Managers + admins can create /
 * update / delete alert rules; any staff can view the list + last
 * observed values.
 */
export function AlertsTab({ active }: { active: boolean }) {
  const utils = trpc.useUtils();
  const alerts = trpc.analyticsConfig.alertsList.useQuery(undefined, {
    enabled: active,
    refetchInterval: 30_000,
    staleTime: 15_000,
  });
  const updateAlert = trpc.analyticsConfig.alertUpdate.useMutation({
    onSuccess: () => utils.analyticsConfig.alertsList.invalidate(),
  });
  const deleteAlert = trpc.analyticsConfig.alertDelete.useMutation({
    onSuccess: () => utils.analyticsConfig.alertsList.invalidate(),
  });
  const [createOpen, setCreateOpen] = React.useState(false);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="h2 flex items-center gap-2 text-lg">
            <Bell className="h-4 w-4 text-muted-foreground" aria-hidden />
            Analytics alerts
          </h2>
          <p className="text-sm text-muted-foreground">
            Evaluated every 5 minutes by a background job. Email notifications fire
            when a threshold is crossed (respects each alert's cooldown).
          </p>
        </div>
        <Button onClick={() => setCreateOpen(true)} className="gap-1">
          <Plus className="h-3.5 w-3.5" aria-hidden />
          New alert
        </Button>
      </div>

      {alerts.isLoading ? (
        <LoadingBlock className="h-40 w-full" />
      ) : !alerts.data || alerts.data.length === 0 ? (
        <div className="rounded-md border border-dashed bg-muted/30 p-6 text-sm text-muted-foreground">
          No alerts configured yet. Create one to get email notifications when a key
          metric crosses a threshold — e.g. "bounces in last hour &gt; 20".
        </div>
      ) : (
        <div className="overflow-hidden rounded-md border bg-card">
          <table className="w-full text-sm">
            <thead className="border-b bg-muted/30 text-xs text-muted-foreground">
              <tr>
                <th className="px-3 py-2 text-left font-medium">Name</th>
                <th className="px-3 py-2 text-left font-medium">Metric</th>
                <th className="px-3 py-2 text-left font-medium">Condition</th>
                <th className="px-3 py-2 text-right font-medium">Last value</th>
                <th className="px-3 py-2 text-left font-medium">Last fired</th>
                <th className="px-3 py-2 text-left font-medium">State</th>
                <th className="px-3 py-2" />
              </tr>
            </thead>
            <tbody>
              {alerts.data.map((a) => {
                const crossed = a.lastValue != null && evaluateOperatorUI(a.lastValue, a.operator as AlertOperator, a.threshold);
                return (
                  <tr key={a.id} className="border-b last:border-b-0">
                    <td className="px-3 py-2">
                      <div className="flex items-center gap-1.5">
                        {crossed && a.isActive && (
                          <AlertTriangle className="h-3.5 w-3.5 text-destructive" aria-hidden />
                        )}
                        <span className="font-medium">{a.name}</span>
                      </div>
                      {a.createdByName && (
                        <p className="text-[10px] text-muted-foreground">
                          by {a.createdByName}
                        </p>
                      )}
                    </td>
                    <td className="px-3 py-2 text-xs">
                      {ALERT_METRIC_LABEL[a.metric as AlertMetric] ?? a.metric}
                    </td>
                    <td className="px-3 py-2 font-mono text-xs">
                      {a.operator}{" "}
                      {formatValue(a.threshold, a.metric as AlertMetric)}
                    </td>
                    <td className="px-3 py-2 text-right font-mono text-xs tabular-nums">
                      {a.lastValue != null
                        ? formatValue(a.lastValue, a.metric as AlertMetric)
                        : "—"}
                    </td>
                    <td className="px-3 py-2 text-xs text-muted-foreground">
                      {a.lastFiredAt ? relativeTime(new Date(a.lastFiredAt)) : "—"}
                    </td>
                    <td className="px-3 py-2">
                      {a.isActive ? (
                        <StatusBadge status="ACTIVE" />
                      ) : (
                        <StatusBadge status="PAUSED" />
                      )}
                    </td>
                    <td className="px-3 py-2">
                      <div className="flex items-center justify-end gap-1">
                        <Button
                          size="sm"
                          variant="ghost"
                          onClick={() =>
                            updateAlert.mutate({ id: a.id, isActive: !a.isActive })
                          }
                          title={a.isActive ? "Pause alert" : "Resume alert"}
                        >
                          {a.isActive ? (
                            <Pause className="h-3.5 w-3.5" aria-hidden />
                          ) : (
                            <Play className="h-3.5 w-3.5" aria-hidden />
                          )}
                        </Button>
                        <Button
                          size="sm"
                          variant="ghost"
                          onClick={() => {
                            if (confirm(`Delete alert "${a.name}"?`)) {
                              deleteAlert.mutate({ id: a.id });
                            }
                          }}
                          className="text-destructive"
                        >
                          <Trash2 className="h-3.5 w-3.5" aria-hidden />
                        </Button>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      <CreateAlertDialog
        open={createOpen}
        onOpenChange={setCreateOpen}
        onSaved={() => utils.analyticsConfig.alertsList.invalidate()}
      />
    </div>
  );
}

function CreateAlertDialog({
  open,
  onOpenChange,
  onSaved,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSaved: () => void;
}) {
  const createAlert = trpc.analyticsConfig.alertCreate.useMutation({
    onSuccess: () => {
      onSaved();
      onOpenChange(false);
      reset();
    },
  });
  const [name, setName] = React.useState("");
  const [metric, setMetric] = React.useState<AlertMetric>("bounces_last_hour");
  const [operator, setOperator] = React.useState<AlertOperator>(">");
  const [threshold, setThreshold] = React.useState("10");
  const [emails, setEmails] = React.useState("");
  const [cooldown, setCooldown] = React.useState("60");

  const preview = trpc.analyticsConfig.alertPreview.useQuery(
    { metric },
    { enabled: open, staleTime: 30_000 },
  );

  function reset() {
    setName("");
    setMetric("bounces_last_hour");
    setOperator(">");
    setThreshold("10");
    setEmails("");
    setCooldown("60");
  }

  async function handleSave() {
    const emailList = emails
      .split(/[,;\n]/)
      .map((s) => s.trim())
      .filter(Boolean);
    if (!name.trim() || emailList.length === 0) return;
    const t = Number(threshold);
    if (!Number.isFinite(t)) return;
    const c = Math.max(5, Math.min(1440, Number(cooldown) || 60));
    await createAlert.mutateAsync({
      name: name.trim(),
      metric,
      operator,
      threshold: t,
      notifyEmails: emailList,
      cooldownMinutes: c,
      isActive: true,
    });
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        onOpenChange(o);
        if (!o) reset();
      }}
    >
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>New alert</DialogTitle>
          <DialogDescription>
            Fires an email to the listed addresses when the metric crosses the
            threshold. Evaluator runs every 5 minutes.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <div>
            <label className="text-sm" htmlFor="alert-name">Name</label>
            <Input
              id="alert-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Bounces spiking"
            />
          </div>
          <div>
            <label className="text-sm">Metric</label>
            <Select value={metric} onValueChange={(v) => setMetric(v as AlertMetric)}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {ALERT_METRICS.map((m) => (
                  <SelectItem key={m} value={m}>
                    {ALERT_METRIC_LABEL[m]}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <p className="mt-1 text-[11px] text-muted-foreground">
              Current value:{" "}
              {preview.isLoading
                ? "…"
                : preview.data
                  ? formatValue(preview.data.value, metric)
                  : "—"}
            </p>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-sm">Operator</label>
              <Select value={operator} onValueChange={(v) => setOperator(v as AlertOperator)}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {ALERT_OPERATORS.map((o) => (
                    <SelectItem key={o} value={o}>
                      {o}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div>
              <label className="text-sm">Threshold</label>
              <Input
                type="number"
                value={threshold}
                onChange={(e) => setThreshold(e.target.value)}
                step="any"
              />
            </div>
          </div>
          <div>
            <label className="text-sm" htmlFor="alert-emails">
              Notify emails (comma-separated)
            </label>
            <Input
              id="alert-emails"
              value={emails}
              onChange={(e) => setEmails(e.target.value)}
              placeholder="ops@xpert.com, manager@xpert.com"
            />
          </div>
          <div>
            <label className="text-sm" htmlFor="alert-cooldown">
              Cooldown (minutes)
            </label>
            <Input
              id="alert-cooldown"
              type="number"
              min={5}
              max={1440}
              value={cooldown}
              onChange={(e) => setCooldown(e.target.value)}
            />
            <p className="mt-1 text-[11px] text-muted-foreground">
              After firing, the alert won't fire again for this many minutes.
            </p>
          </div>
        </div>
        <DialogFooter>
          <Button variant="secondary" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button
            onClick={handleSave}
            disabled={
              createAlert.isPending ||
              !name.trim() ||
              emails.trim().length === 0 ||
              !Number.isFinite(Number(threshold))
            }
          >
            {createAlert.isPending ? "Saving…" : "Create alert"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function evaluateOperatorUI(value: number, op: AlertOperator, threshold: number): boolean {
  switch (op) {
    case ">":
      return value > threshold;
    case "<":
      return value < threshold;
    case ">=":
      return value >= threshold;
    case "<=":
      return value <= threshold;
    case "==":
      return value === threshold;
  }
}

function formatValue(value: number, metric: AlertMetric): string {
  if (metric.endsWith("_rate_last_24h")) return `${(value * 100).toFixed(2)}%`;
  if (metric === "avg_engagement_score_last_24h") return value.toFixed(0);
  return value.toLocaleString("en-AU");
}

function relativeTime(d: Date): string {
  const ms = Date.now() - d.getTime();
  const mins = Math.round(ms / 60_000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.round(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.round(hours / 24);
  return `${days}d ago`;
}
