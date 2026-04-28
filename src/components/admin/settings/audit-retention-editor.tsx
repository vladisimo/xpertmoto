"use client";
import { useEffect, useRef, useState } from "react";
import { Check, Loader2 } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { FormGrid } from "@/components/forms/form-grid";

type AuditCategory = "API" | "JOB" | "AUTH" | "QUERY" | "WEBHOOK" | "MUTATION" | "PAGE_VIEW";

export interface AuditRetentionValue {
  enabled: boolean;
  retention: Partial<Record<AuditCategory, number>>;
}

const CATEGORY_META: { key: AuditCategory; label: string; hint: string }[] = [
  { key: "AUTH", label: "Authentication", hint: "Logins, password resets, role changes." },
  { key: "MUTATION", label: "Data mutations", hint: "Every create / update / delete performed by staff or customers." },
  { key: "API", label: "API access", hint: "External API calls against /api/**." },
  { key: "WEBHOOK", label: "Webhooks", hint: "Inbound Stripe / Twilio / Linkt events." },
  { key: "JOB", label: "Background jobs", hint: "Scheduled BullMQ job runs and failures." },
  { key: "QUERY", label: "Queries", hint: "Sensitive read queries flagged by the audit layer." },
  { key: "PAGE_VIEW", label: "Page views", hint: "Customer and staff route navigations." },
];

export interface AuditRetentionEditorProps {
  value: AuditRetentionValue;
  onSave: (next: AuditRetentionValue) => Promise<unknown>;
}

export function AuditRetentionEditor({ value, onSave }: AuditRetentionEditorProps) {
  const [local, setLocal] = useState<AuditRetentionValue>(value);
  const [state, setState] = useState<"idle" | "saving" | "saved" | "error">("idle");
  const savedTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    setLocal(value);
  }, [value]);

  async function commit(next: AuditRetentionValue) {
    setLocal(next);
    setState("saving");
    try {
      await onSave(next);
      setState("saved");
      if (savedTimer.current) clearTimeout(savedTimer.current);
      savedTimer.current = setTimeout(() => setState("idle"), 1800);
    } catch {
      setState("error");
    }
  }

  useEffect(
    () => () => {
      if (savedTimer.current) clearTimeout(savedTimer.current);
    },
    [],
  );

  const indicator =
    state === "saving" ? (
      <span className="flex items-center gap-1 text-xs text-muted-foreground">
        <Loader2 className="h-3 w-3 animate-spin" aria-hidden /> Saving…
      </span>
    ) : state === "saved" ? (
      <span className="flex items-center gap-1 text-xs text-primary">
        <Check className="h-3 w-3" aria-hidden /> Saved
      </span>
    ) : state === "error" ? (
      <span className="text-xs text-destructive">Save failed</span>
    ) : null;

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between rounded-md border border-border bg-muted/40 p-3">
        <div className="space-y-1">
          <Label htmlFor="audit-enabled" className="text-sm font-medium">
            Automatic retention trimming
          </Label>
          <p className="caption text-xs text-muted-foreground">
            When enabled, the daily cron at 03:00 Australia/Brisbane deletes audit rows older than the per-category window below.
          </p>
        </div>
        <div className="flex items-center gap-3">
          <div className="min-h-[1rem]">{indicator}</div>
          <Select
            value={local.enabled ? "true" : "false"}
            onValueChange={(v) => void commit({ ...local, enabled: v === "true" })}
          >
            <SelectTrigger id="audit-enabled" className="w-32">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="true">Enabled</SelectItem>
              <SelectItem value="false">Disabled</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </div>

      <FormGrid cols={2}>
        {CATEGORY_META.map((c) => {
          const current = local.retention[c.key];
          return (
            <div key={c.key} className="space-y-1">
              <Label htmlFor={`audit-retention-${c.key}`} className="text-sm font-medium">
                {c.label}
              </Label>
              <div className="relative flex items-center">
                <Input
                  id={`audit-retention-${c.key}`}
                  type="number"
                  inputMode="numeric"
                  defaultValue={current ?? ""}
                  min={0}
                  onBlur={(e) => {
                    const n = e.target.value === "" ? undefined : Math.max(0, Math.round(Number(e.target.value)));
                    if (n === current) return;
                    void commit({
                      ...local,
                      retention: { ...local.retention, [c.key]: n ?? 0 },
                    });
                  }}
                  className="pr-12"
                />
                <span className="pointer-events-none absolute right-3 text-xs text-muted-foreground">days</span>
              </div>
              <p className="caption text-xs text-muted-foreground">{c.hint}</p>
            </div>
          );
        })}
      </FormGrid>
    </div>
  );
}
