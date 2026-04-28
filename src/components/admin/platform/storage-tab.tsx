"use client";

import { Boxes, FolderTree, HardDrive, Upload } from "lucide-react";
import { trpc } from "@/lib/trpc/client";
import { PageSection } from "@/components/layout/page-section";
import { Card, CardContent } from "@/components/ui/card";
import { CalloutCard } from "@/components/ui/callout-card";
import { LoadingBlock } from "@/components/ui/spinner";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { KpiCard } from "./kpi-card";

function formatBytes(bytes: number): string {
  if (!bytes) return "0 B";
  const units = ["B", "KB", "MB", "GB", "TB"];
  let i = 0;
  let v = bytes;
  while (v >= 1024 && i < units.length - 1) {
    v /= 1024;
    i += 1;
  }
  return `${v.toFixed(v >= 100 ? 0 : 1)} ${units[i]}`;
}

export function StorageTab() {
  const q = trpc.platform.storageUsage.useQuery();
  if (q.isLoading || !q.data) return <LoadingBlock padded="md" />;
  const d = q.data;

  return (
    <div className="space-y-6">
      <p className="text-caption text-muted-foreground">
        S3 / MinIO object storage: inspection photos, licence captures, invoice
        PDFs, rental agreements. Running totals are computed from UPLOAD /
        DELETE deltas.
      </p>

      {d.source === "placeholder" && d.reason && (
        <CalloutCard tone="info" title="No events yet" description={d.reason} />
      )}

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <KpiCard
          title="Total bytes"
          primary={formatBytes(d.totalBytes)}
          secondary="Running delta"
          icon={HardDrive}
        />
        <KpiCard
          title="Events (all time)"
          primary={d.objectCount.toLocaleString("en-AU")}
          icon={Boxes}
        />
        <KpiCard
          title="Uploads · 30d"
          primary={d.uploads30d.toLocaleString("en-AU")}
          icon={Upload}
        />
        <KpiCard
          title="Folders"
          primary={d.byFolder.length.toLocaleString("en-AU")}
          icon={FolderTree}
        />
      </div>

      <PageSection title="By folder">
        {d.byFolder.length === 0 ? (
          <Card>
            <CardContent className="py-8 text-center text-sm text-muted-foreground">
              No storage events yet.
            </CardContent>
          </Card>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Folder</TableHead>
                <TableHead className="text-right">Events</TableHead>
                <TableHead className="text-right">Bytes (net)</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {d.byFolder.map((f) => (
                <TableRow key={f.folder}>
                  <TableCell className="font-mono text-xs">{f.folder}</TableCell>
                  <TableCell className="text-right tabular-nums">
                    {f.events.toLocaleString("en-AU")}
                  </TableCell>
                  <TableCell className="text-right tabular-nums font-semibold">
                    {formatBytes(f.bytes)}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </PageSection>

      <div className="rounded-md border bg-muted/50 p-4 text-sm">
        <div className="mb-1 font-semibold">Next step</div>
        <p className="text-muted-foreground">{d.enableHint}</p>
      </div>
    </div>
  );
}
