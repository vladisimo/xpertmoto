"use client";

import { DollarSign, MessageSquare, Send, Smartphone } from "lucide-react";
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
import { StatusBadge, type StatusKey } from "@/components/ui/status-badge";
import { formatCurrency } from "@/lib/utils";
import { KpiCard } from "./kpi-card";

export function SmsTab() {
  const q = trpc.platform.smsUsage.useQuery();
  if (q.isLoading || !q.data) return <LoadingBlock padded="md" />;
  const d = q.data;

  return (
    <div className="space-y-6">
      <p className="text-caption text-muted-foreground">
        Twilio SMS: booking reminders, overdue alerts, OTP codes. Cost is
        converted from Twilio&apos;s USD price via USD_AUD_RATE in src/lib/constants.ts.
      </p>

      {d.source === "placeholder" && d.reason && (
        <CalloutCard tone="info" title="No SMS yet" description={d.reason} />
      )}

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <KpiCard
          title="Sent · 24h"
          primary={d.sent24h.toLocaleString("en-AU")}
          icon={Send}
        />
        <KpiCard
          title="Sent · 7d"
          primary={d.sent7d.toLocaleString("en-AU")}
          icon={Smartphone}
        />
        <KpiCard
          title="Segments · 30d"
          primary={d.segments30d.toLocaleString("en-AU")}
          secondary={`${d.sent30d.toLocaleString("en-AU")} messages`}
          icon={MessageSquare}
        />
        <KpiCard
          title="Cost · 30d"
          primary={formatCurrency(d.costAud30d)}
          secondary="Settled by Twilio webhook"
          icon={DollarSign}
        />
      </div>

      <PageSection title="By status · last 30 days">
        {d.byStatus30d.length === 0 ? (
          <Card>
            <CardContent className="py-8 text-center text-sm text-muted-foreground">
              No status data yet.
            </CardContent>
          </Card>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Status</TableHead>
                <TableHead className="text-right">Count</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {d.byStatus30d.map((s) => (
                <TableRow key={s.status}>
                  <TableCell>
                    <StatusBadge status={s.status as StatusKey} />
                  </TableCell>
                  <TableCell className="text-right tabular-nums font-semibold">
                    {s.count.toLocaleString("en-AU")}
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
