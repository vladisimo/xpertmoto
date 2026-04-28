"use client";

import { useState } from "react";
import { AlertTriangle, ExternalLink, ShieldAlert } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { StatusBadge, type StatusKey } from "@/components/ui/status-badge";
import { formatDateTime } from "@/lib/utils";

/**
 * Stripe dispute panel — surfaced on booking detail whenever the booking
 * has a CHARGEBACK incident (discriminator: incidentNumber starts with
 * `CBK-`, set by the webhook at `charge.dispute.created`). Shows status,
 * reason, countdown to the Stripe evidence deadline, and a link to the
 * Stripe dashboard where evidence is actually submitted.
 *
 * Evidence deadline is not surfaced by Stripe in webhook payloads —
 * their card-network rules default to 7-14 days depending on the
 * network and reason. We encode 7 days as a conservative MVP and
 * upgrade to the real `dispute.evidence_details.due_by` in a follow-up
 * that fetches the dispute object from Stripe directly.
 */

type Props = {
  incidents: Array<{
    id: string;
    incidentNumber: string;
    type: string;
    status: string;
    severity: string;
    dateTime: string | Date;
    description: string | null;
    estimatedDamageCost: string | number | null;
    resolvedAt: string | Date | null;
    resolution: string | null;
  }>;
};

const DEFAULT_EVIDENCE_WINDOW_DAYS = 7;

export function DisputePanel({ incidents }: Props) {
  const [snappedNow] = useState<number | null>(() =>
    typeof window === "undefined" ? null : Date.now(),
  );

  const disputes = incidents.filter((i) => i.incidentNumber.startsWith("CBK-"));
  if (disputes.length === 0) return null;

  return (
    <Card className="border-destructive/40">
      <CardHeader>
        <CardTitle className="h3 flex items-center gap-2 text-destructive">
          <ShieldAlert className="h-4 w-4" aria-hidden />
          Stripe dispute{disputes.length > 1 ? "s" : ""}
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4 text-sm">
        {disputes.map((d) => {
          const disputeId = d.incidentNumber.replace(/^CBK-/, "");
          const opened = new Date(d.dateTime);
          const deadline = new Date(
            opened.getTime() + DEFAULT_EVIDENCE_WINDOW_DAYS * 86_400_000,
          );
          const hoursLeft =
            snappedNow === null
              ? null
              : (deadline.getTime() - snappedNow) / (1000 * 60 * 60);
          const overdue = hoursLeft !== null && hoursLeft < 0;
          const urgent = hoursLeft !== null && hoursLeft > 0 && hoursLeft < 48;
          const resolved = d.status === "RESOLVED" || d.status === "CLOSED";

          return (
            <div
              key={d.id}
              className="space-y-2 rounded-md border bg-background p-3"
            >
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="flex items-center gap-2">
                  <span className="font-mono text-xs">{disputeId}</span>
                  <StatusBadge status={d.status as StatusKey} />
                  <StatusBadge status={d.severity as StatusKey} />
                </div>
                <a
                  href={`https://dashboard.stripe.com/disputes/${disputeId}`}
                  target="_blank"
                  rel="noreferrer"
                  className="inline-flex items-center gap-1 text-xs text-accent hover:underline"
                >
                  Stripe dashboard
                  <ExternalLink className="h-3 w-3" aria-hidden />
                </a>
              </div>

              {d.description && (
                <p className="text-xs text-muted-foreground">{d.description}</p>
              )}

              <div className="grid gap-2 sm:grid-cols-3 text-xs">
                <div>
                  <div className="text-muted-foreground">Opened</div>
                  <div>{formatDateTime(opened)}</div>
                </div>
                <div>
                  <div className="text-muted-foreground">Estimated loss</div>
                  <div>
                    {d.estimatedDamageCost !== null
                      ? `A$${Number(d.estimatedDamageCost).toFixed(2)}`
                      : "—"}
                  </div>
                </div>
                <div>
                  <div className="text-muted-foreground">
                    {resolved ? "Resolved" : "Evidence deadline"}
                  </div>
                  <div
                    className={
                      resolved
                        ? ""
                        : overdue
                          ? "text-destructive font-medium"
                          : urgent
                            ? "text-destructive"
                            : ""
                    }
                  >
                    {resolved
                      ? d.resolvedAt
                        ? formatDateTime(d.resolvedAt)
                        : "—"
                      : hoursLeft === null
                        ? "loading…"
                        : overdue
                          ? `${Math.floor(-hoursLeft / 24)}d overdue`
                          : hoursLeft < 48
                            ? `~${Math.floor(hoursLeft)}h left`
                            : `${Math.floor(hoursLeft / 24)}d left`}
                  </div>
                </div>
              </div>

              {!resolved && !overdue && (
                <p className="flex items-start gap-1 text-xs text-muted-foreground">
                  <AlertTriangle className="h-3 w-3 mt-0.5 shrink-0 text-destructive" aria-hidden />
                  Evidence must be submitted via the Stripe dashboard — our UI
                  doesn&apos;t yet support inline upload. See{" "}
                  <code className="font-mono">docs/payments/runbook-dispute-response.md</code>.
                </p>
              )}

              {overdue && !resolved && (
                <p className="text-xs text-destructive font-medium">
                  Deadline has passed. This dispute is likely lost — confirm in
                  the Stripe dashboard and mark the incident as closed.
                </p>
              )}

              {d.resolution && resolved && (
                <p className="text-xs text-muted-foreground">
                  Resolution: {d.resolution}
                </p>
              )}
            </div>
          );
        })}
      </CardContent>
    </Card>
  );
}
