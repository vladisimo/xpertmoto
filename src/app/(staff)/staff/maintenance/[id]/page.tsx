"use client";
import { useState, use } from "react";
import Link from "next/link";
import { trpc } from "@/lib/trpc/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { StatusBadge, type StatusKey } from "@/components/ui/status-badge";
import { PageHeader } from "@/components/layout/page-header";
import { PageShell } from "@/components/layout/page-section";
import { LoadingBlock } from "@/components/ui/spinner";
import { formatCurrency, formatDateTime } from "@/lib/utils";

const STATUSES = ["OPEN", "ASSIGNED", "IN_PROGRESS", "AWAITING_PARTS", "COMPLETED", "CANCELLED"] as const;

export default function WorkOrderDetailPage(props: { params: Promise<{ id: string }> }) {
  const params = use(props.params);
  const { id } = params;
  const util = trpc.useUtils();
  const { data: wo, isLoading } = trpc.fleet.workOrderDetail.useQuery({ id });
  const update = trpc.fleet.updateWorkOrderStatus.useMutation({
    onSuccess: () => util.fleet.workOrderDetail.invalidate({ id }),
  });
  const [actualCost, setActualCost] = useState("");
  const [actualHours, setActualHours] = useState("");
  const [notes, setNotes] = useState("");

  if (isLoading) return <LoadingBlock padded="lg" />;
  if (!wo) return <div className="p-8 text-muted-foreground">Not found</div>;

  return (
    <PageShell className="max-w-4xl">
      <PageHeader
        breadcrumbs={[
          { label: "Maintenance", href: "/staff/fleet?tab=maintenance" },
          { label: wo.workOrderNumber },
        ]}
        title={wo.workOrderNumber}
        description={wo.title}
        actions={
          <>
            <StatusBadge status={wo.status as StatusKey} />
            <StatusBadge status={wo.priority as StatusKey} />
          </>
        }
      />

      <div className="grid gap-6 md:grid-cols-2">
        <Card>
          <CardHeader><CardTitle className="h3">Vehicle</CardTitle></CardHeader>
          <CardContent className="text-sm space-y-1">
            <Link className="font-medium text-primary hover:underline" href={`/staff/fleet/vehicles/${wo.vehicle.id}`}>
              {wo.vehicle.internalCode} · {wo.vehicle.make} {wo.vehicle.model}
            </Link>
            <div className="text-muted-foreground">{wo.vehicle.category.name} · {wo.vehicle.rego}</div>
            <div className="flex items-center gap-2 text-muted-foreground">
              <span>{wo.vehicle.currentOdometerKm.toLocaleString()} km</span>
              <span>·</span>
              <StatusBadge status={wo.vehicle.status as StatusKey} />
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader><CardTitle className="h3">Job</CardTitle></CardHeader>
          <CardContent className="text-sm space-y-1">
            <div><strong>{wo.title}</strong></div>
            <div className="text-muted-foreground whitespace-pre-wrap">{wo.description ?? "—"}</div>
            <div className="mt-2">Type: {wo.type.replace(/_/g, " ")}</div>
            <div>Reported by: {wo.reportedBy ? `${wo.reportedBy.firstName} ${wo.reportedBy.lastName}` : "—"}</div>
            <div>Assigned: {wo.assignedTo ? `${wo.assignedTo.firstName} ${wo.assignedTo.lastName}` : "—"}</div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader><CardTitle className="h3">Estimated</CardTitle></CardHeader>
          <CardContent className="text-sm space-y-1">
            <div>Hours: {wo.estimatedHours ? Number(wo.estimatedHours) : "—"}</div>
            <div>Cost: {wo.estimatedCost ? formatCurrency(Number(wo.estimatedCost)) : "—"}</div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader><CardTitle className="h3">Actual</CardTitle></CardHeader>
          <CardContent className="text-sm space-y-1">
            <div>Hours: {wo.actualHours ? Number(wo.actualHours) : "—"}</div>
            <div>Cost: {wo.actualCost ? formatCurrency(Number(wo.actualCost)) : "—"}</div>
            <div>Started: {wo.startedAt ? formatDateTime(wo.startedAt) : "—"}</div>
            <div>Completed: {wo.completedAt ? formatDateTime(wo.completedAt) : "—"}</div>
          </CardContent>
        </Card>
      </div>
      <Card>
        <CardHeader><CardTitle className="h3">Update status</CardTitle></CardHeader>
        <CardContent className="space-y-4">
          <div className="flex flex-wrap gap-2">
            {STATUSES.map((s) => (
              <Button
                key={s}
                size="sm"
                variant={wo.status === s ? "default" : "secondary"}
                disabled={update.isPending}
                onClick={() =>
                  update.mutate({
                    id: wo.id,
                    status: s,
                    actualCost: actualCost ? Number(actualCost) : undefined,
                    actualHours: actualHours ? Number(actualHours) : undefined,
                    notes: notes || undefined,
                  })
                }
              >
                {s.replace(/_/g, " ")}
              </Button>
            ))}
          </div>
          <div className="grid gap-3 md:grid-cols-2">
            <div className="space-y-1.5">
              <Label>Actual cost (on complete)</Label>
              <Input type="number" value={actualCost} onChange={(e) => setActualCost(e.target.value)} />
            </div>
            <div className="space-y-1.5">
              <Label>Actual hours</Label>
              <Input type="number" step="0.5" value={actualHours} onChange={(e) => setActualHours(e.target.value)} />
            </div>
            <div className="space-y-1.5 md:col-span-2">
              <Label>Note</Label>
              <Input value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Optional status change note" />
            </div>
          </div>
          <p className="text-xs text-muted-foreground">Vehicle auto-moves to IN_MAINTENANCE when job starts, back to AVAILABLE when complete.</p>
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle className="h3">Activity log</CardTitle></CardHeader>
        <CardContent className="space-y-1 text-sm">
          {wo.logs.map((l) => (
            <div key={l.id} className="flex justify-between border-b py-1.5 last:border-0">
              <span><strong>{l.action}</strong>{l.notes && ` — ${l.notes}`}</span>
              <span className="text-xs text-muted-foreground">{formatDateTime(l.timestamp)}</span>
            </div>
          ))}
        </CardContent>
      </Card>
    </PageShell>
  );
}
