"use client";

import { ArrowUpFromLine, Clock, Gauge, Network } from "lucide-react";
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

function formatBytes(bytes: number | null): string {
  if (bytes === null || bytes === undefined) return "—";
  const units = ["B", "KB", "MB", "GB", "TB"];
  let i = 0;
  let v = bytes;
  while (v >= 1024 && i < units.length - 1) {
    v /= 1024;
    i += 1;
  }
  return `${v.toFixed(v >= 100 ? 0 : 1)} ${units[i]}`;
}

export function ServerTab() {
  const q = trpc.platform.serverUsage.useQuery();
  if (q.isLoading || !q.data) return <LoadingBlock padded="md" />;
  const d = q.data;

  return (
    <div className="space-y-6">
      <p className="text-caption text-muted-foreground">
        Sampled request volume from src/proxy.ts. Extrapolation multiplies the
        sampled count by the sample weight set at capture time.
      </p>

      {d.source === "placeholder" && d.reason && (
        <CalloutCard
          tone="warning"
          title="Request logging disabled"
          description={d.reason}
        />
      )}

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <KpiCard
          title="Requests · 24h"
          primary={d.extrapolatedRequests24h.toLocaleString("en-AU")}
          secondary="Extrapolated from sample"
          icon={Network}
        />
        <KpiCard
          title="Requests · 7d"
          primary={d.extrapolatedRequests7d.toLocaleString("en-AU")}
          icon={Network}
        />
        <KpiCard
          title="Requests · 30d"
          primary={d.extrapolatedRequests30d.toLocaleString("en-AU")}
          secondary={`${d.sampledRequests30d.toLocaleString("en-AU")} sampled`}
          icon={Gauge}
        />
        <KpiCard
          title="Egress · 30d"
          primary={formatBytes(d.bytesOut30d)}
          secondary="From response Content-Length"
          icon={ArrowUpFromLine}
        />
      </div>

      <PageSection title="Top 10 paths · 30 days">
        {d.topPaths30d.length === 0 ? (
          <Card>
            <CardContent className="py-8 text-center text-sm text-muted-foreground">
              No samples yet.
            </CardContent>
          </Card>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Path</TableHead>
                <TableHead className="text-right">Sampled</TableHead>
                <TableHead className="text-right">Extrapolated</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {d.topPaths30d.map((p) => (
                <TableRow key={p.path}>
                  <TableCell className="font-mono text-xs">{p.path}</TableCell>
                  <TableCell className="text-right tabular-nums">
                    {p.sampled.toLocaleString("en-AU")}
                  </TableCell>
                  <TableCell className="text-right tabular-nums font-semibold">
                    {p.extrapolated.toLocaleString("en-AU")}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </PageSection>

      <div className="rounded-md border bg-muted/50 p-4 text-sm">
        <div className="mb-1 flex items-center gap-1.5 font-semibold">
          <Clock className="h-3.5 w-3.5" aria-hidden /> Next step
        </div>
        <p className="text-muted-foreground">{d.enableHint}</p>
      </div>
    </div>
  );
}
