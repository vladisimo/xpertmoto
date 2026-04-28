"use client";

import { useState } from "react";
import {
  Clock,
  Database,
  DatabaseBackup,
  Download,
  HardDrive,
  PlayCircle,
} from "lucide-react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { trpc } from "@/lib/trpc/client";
import { PageSection } from "@/components/layout/page-section";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import {
  Form,
  FormControl,
  FormDescription,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form";
import { LoadingBlock } from "@/components/ui/spinner";
import { StatusBadge, type StatusKey } from "@/components/ui/status-badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { FormGrid, FormGridRow } from "@/components/forms/form-grid";
import { formatDateTime } from "@/lib/utils";

function formatBytes(bytes: number | null): string {
  if (!bytes) return "—";
  const units = ["B", "KB", "MB", "GB", "TB"];
  let i = 0;
  let v = bytes;
  while (v >= 1024 && i < units.length - 1) {
    v /= 1024;
    i += 1;
  }
  return `${v.toFixed(v >= 100 ? 0 : 1)} ${units[i]}`;
}

function formatMs(ms: number | null): string {
  if (!ms) return "—";
  if (ms < 1000) return `${ms} ms`;
  if (ms < 60_000) return `${(ms / 1000).toFixed(1)}s`;
  return `${(ms / 60_000).toFixed(1)}m`;
}

function tonedAge(since: Date): StatusKey {
  const hours = (Date.now() - since.getTime()) / (1000 * 60 * 60);
  if (hours < 26) return "SUCCESS" as StatusKey;
  if (hours < 50) return "PENDING" as StatusKey;
  return "FAILED" as StatusKey;
}

export function DatabaseTab() {
  const [triggerError, setTriggerError] = useState<string | null>(null);

  const list = trpc.backup.list.useQuery({ take: 25 });
  const summary = trpc.backup.summary.useQuery();
  const settings = trpc.backup.getSettings.useQuery();
  const stats = trpc.platform.databaseStats.useQuery();

  const utils = trpc.useUtils();
  const trigger = trpc.backup.triggerManual.useMutation({
    onSuccess: () => {
      utils.backup.list.invalidate();
      utils.backup.summary.invalidate();
      setTriggerError(null);
    },
    onError: (e) => setTriggerError(e.message),
  });

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="text-caption text-muted-foreground">
          Scheduled pg_dump history, retention policy, and manual triggers.
          Restore is SSH-only — see the runbook.
        </div>
        <Button
          onClick={() => {
            setTriggerError(null);
            trigger.mutate();
          }}
          disabled={trigger.isPending}
        >
          <PlayCircle className="mr-1.5 h-4 w-4" aria-hidden />
          {trigger.isPending ? "Queuing…" : "Trigger backup now"}
        </Button>
      </div>

      {triggerError && (
        <div className="rounded-md border border-destructive/30 bg-destructive/5 p-3 text-sm text-destructive">
          {triggerError}
        </div>
      )}

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <SummaryCard
          title="Database size"
          icon={<Database className="h-4 w-4" aria-hidden />}
          primary={formatBytes(stats.data?.dbSizeBytes ?? null)}
          secondary={
            stats.data?.source === "placeholder"
              ? "Not Postgres"
              : "Live, pg_database_size"
          }
        />
        <SummaryCard
          title="Last successful backup"
          icon={<Clock className="h-4 w-4" aria-hidden />}
          primary={
            summary.data?.lastSuccessAt
              ? formatDateTime(summary.data.lastSuccessAt)
              : "Never"
          }
          tone={
            summary.data?.lastSuccessAt
              ? tonedAge(new Date(summary.data.lastSuccessAt))
              : ("FAILED" as StatusKey)
          }
        />
        <SummaryCard
          title="Successful backups"
          icon={<DatabaseBackup className="h-4 w-4" aria-hidden />}
          primary={summary.data?.totalSuccessCount.toString() ?? "—"}
          secondary={
            summary.data?.lastSuccessSizeBytes
              ? `Last: ${formatBytes(summary.data.lastSuccessSizeBytes)}`
              : undefined
          }
        />
        <SummaryCard
          title="Total stored / retention"
          icon={<HardDrive className="h-4 w-4" aria-hidden />}
          primary={formatBytes(summary.data?.totalStoredBytes ?? null)}
          secondary={
            settings.data
              ? `${settings.data.retentionDays}d · ${settings.data.schedule}`
              : undefined
          }
        />
      </div>

      <PageSection
        title="History"
        description="Most recent 25 runs. Older rows are deleted by the retention sweep."
      >
        {list.isLoading ? (
          <LoadingBlock padded="md" />
        ) : !list.data || list.data.length === 0 ? (
          <Card>
            <CardContent className="py-8 text-center text-sm text-muted-foreground">
              No backups recorded yet. Click &ldquo;Trigger backup now&rdquo; or
              wait for the nightly schedule.
            </CardContent>
          </Card>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Started</TableHead>
                <TableHead>Duration</TableHead>
                <TableHead>Size</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Trigger</TableHead>
                <TableHead>Schema</TableHead>
                <TableHead>Retention</TableHead>
                <TableHead>Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {list.data.map((row) => (
                <TableRow key={row.id}>
                  <TableCell>{formatDateTime(row.startedAt)}</TableCell>
                  <TableCell>{formatMs(row.durationMs)}</TableCell>
                  <TableCell className="tabular-nums">
                    {formatBytes(row.sizeBytes)}
                  </TableCell>
                  <TableCell>
                    <StatusBadge status={row.status as StatusKey} />
                  </TableCell>
                  <TableCell>
                    {row.triggeredBy === "MANUAL_ADMIN" ? "Manual" : "Scheduled"}
                  </TableCell>
                  <TableCell className="font-mono text-xs text-muted-foreground">
                    {row.schemaVersion
                      ? row.schemaVersion.split("_").slice(0, 1).join("_")
                      : "—"}
                  </TableCell>
                  <TableCell>
                    {row.retentionUntil ? formatDateTime(row.retentionUntil) : "—"}
                  </TableCell>
                  <TableCell>
                    {row.status === "SUCCESS" && (
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => {
                          alert(
                            "Download requires SSH access per the restore runbook. See docs/ops/database-restore.md",
                          );
                        }}
                      >
                        <Download className="mr-1.5 h-3.5 w-3.5" aria-hidden />
                        Locate
                      </Button>
                    )}
                    {row.status === "FAILED" && row.errorMessage && (
                      <span
                        className="text-xs text-destructive"
                        title={row.errorMessage}
                      >
                        {row.errorMessage.slice(0, 40)}…
                      </span>
                    )}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </PageSection>

      <BackupSettings />
    </div>
  );
}

function SummaryCard({
  title,
  icon,
  primary,
  secondary,
  tone,
}: {
  title: string;
  icon: React.ReactNode;
  primary: string;
  secondary?: string;
  tone?: StatusKey;
}) {
  return (
    <Card>
      <CardContent className="p-4">
        <div className="flex items-center justify-between">
          <div className="text-xs text-muted-foreground">{title}</div>
          <span className="text-muted-foreground">{icon}</span>
        </div>
        <div className="mt-2 flex items-center gap-2">
          <div className="text-lg font-semibold tabular-nums">{primary}</div>
          {tone && <StatusBadge status={tone} />}
        </div>
        {secondary && (
          <div className="mt-1 text-xs text-muted-foreground">{secondary}</div>
        )}
      </CardContent>
    </Card>
  );
}

const backupSettingsSchema = z.object({
  schedule: z.string().min(9).max(64),
  retentionDays: z.coerce.number().int().min(7).max(3650),
  alertOnFailure: z.boolean(),
});

type BackupSettingsValues = z.infer<typeof backupSettingsSchema>;

function BackupSettings() {
  const q = trpc.backup.getSettings.useQuery();
  const utils = trpc.useUtils();
  const [err, setErr] = useState<string | null>(null);

  const form = useForm<BackupSettingsValues>({
    resolver: zodResolver(backupSettingsSchema),
    values: q.data
      ? {
          schedule: q.data.schedule,
          retentionDays: q.data.retentionDays,
          alertOnFailure: q.data.alertOnFailure,
        }
      : undefined,
  });

  const update = trpc.backup.updateSettings.useMutation({
    onSuccess: () => {
      utils.backup.getSettings.invalidate();
      utils.backup.summary.invalidate();
      form.reset(form.getValues());
      setErr(null);
    },
    onError: (e) => setErr(e.message),
  });

  if (!q.data) return null;
  const dirty = form.formState.isDirty;

  async function onSubmit(values: BackupSettingsValues) {
    setErr(null);
    update.mutate(values);
  }

  return (
    <PageSection title="Settings" description="Applies on next worker restart.">
      <Card>
        <CardContent className="space-y-4 p-4">
          <Form {...form}>
            <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
              <FormGrid cols={2}>
                <FormField
                  control={form.control}
                  name="schedule"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Cron schedule</FormLabel>
                      <FormControl>
                        <Input placeholder="0 3 * * *" {...field} />
                      </FormControl>
                      <FormDescription>
                        Timezone Australia/Brisbane. Default 03:00 daily.
                      </FormDescription>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <FormField
                  control={form.control}
                  name="retentionDays"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Retention (days)</FormLabel>
                      <FormControl>
                        <Input type="number" min={7} max={3650} {...field} />
                      </FormControl>
                      <FormDescription>
                        Rows older than this are swept daily at 03:15.
                      </FormDescription>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <FormGridRow>
                  <FormField
                    control={form.control}
                    name="alertOnFailure"
                    render={({ field }) => (
                      <FormItem className="flex items-center gap-2 space-y-0">
                        <FormControl>
                          <input
                            type="checkbox"
                            checked={field.value}
                            onChange={(e) => field.onChange(e.target.checked)}
                            ref={field.ref}
                            onBlur={field.onBlur}
                            className="h-4 w-4"
                          />
                        </FormControl>
                        <FormLabel className="text-sm font-normal">
                          Email super-admins on backup failure
                        </FormLabel>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                </FormGridRow>
              </FormGrid>
              {err && <div className="text-sm text-destructive">{err}</div>}
              <div className="flex justify-end gap-2">
                {dirty && (
                  <Button
                    variant="ghost"
                    size="sm"
                    type="button"
                    onClick={() => {
                      form.reset();
                      setErr(null);
                    }}
                  >
                    Cancel
                  </Button>
                )}
                <Button size="sm" type="submit" disabled={!dirty || update.isPending}>
                  {update.isPending ? "Saving…" : "Save settings"}
                </Button>
              </div>
            </form>
          </Form>
        </CardContent>
      </Card>
    </PageSection>
  );
}
