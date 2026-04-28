"use client";

import { Mail, MailCheck, MailWarning, Send } from "lucide-react";
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

export function EmailTab() {
  const q = trpc.platform.emailUsage.useQuery();
  if (q.isLoading || !q.data) return <LoadingBlock padded="md" />;
  const d = q.data;
  const deliveryRate = d.sent30d > 0 ? (d.delivered30d / d.sent30d) * 100 : 0;
  const bounceRate = d.sent30d > 0 ? (d.bounced30d / d.sent30d) * 100 : 0;

  return (
    <div className="space-y-6">
      <p className="text-caption text-muted-foreground">
        Transactional email via Resend (SMTP fallback in dev). Delivered /
        bounced timestamps enriched by the /api/webhooks/resend handler.
      </p>

      {d.source === "placeholder" && d.reason && (
        <CalloutCard tone="info" title="No sends yet" description={d.reason} />
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
          icon={Mail}
        />
        <KpiCard
          title="Delivered · 30d"
          primary={d.delivered30d.toLocaleString("en-AU")}
          secondary={`${deliveryRate.toFixed(1)}% rate`}
          icon={MailCheck}
        />
        <KpiCard
          title="Bounced · 30d"
          primary={d.bounced30d.toLocaleString("en-AU")}
          secondary={`${bounceRate.toFixed(1)}% rate`}
          icon={MailWarning}
        />
      </div>

      <PageSection title="By provider · last 30 days">
        {d.byProvider30d.length === 0 ? (
          <Card>
            <CardContent className="py-8 text-center text-sm text-muted-foreground">
              No provider activity.
            </CardContent>
          </Card>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Provider</TableHead>
                <TableHead className="text-right">Sends</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {d.byProvider30d.map((p) => (
                <TableRow key={p.provider}>
                  <TableCell className="font-mono text-xs">{p.provider}</TableCell>
                  <TableCell className="text-right tabular-nums font-semibold">
                    {p.count.toLocaleString("en-AU")}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </PageSection>

      <div className="rounded-md border bg-muted/50 p-4 text-sm">
        <div className="mb-1 font-semibold">Cost</div>
        <p className="text-muted-foreground">{d.enableHint}</p>
      </div>
    </div>
  );
}
