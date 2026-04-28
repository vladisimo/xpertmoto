"use client";

import Image from "next/image";
import { trpc } from "@/lib/trpc/client";
import { StatusBadge, type StatusKey } from "@/components/ui/status-badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { formatCurrency, formatDateTime } from "@/lib/utils";

export function CustomerTabAccidents({ customerId }: { customerId: string }) {
  const { data: incidents, isLoading } = trpc.staffCustomer.incidents.useQuery({ customerId });

  if (isLoading) return <div className="py-8 text-center text-muted-foreground">Loading incidents...</div>;

  if (!incidents || incidents.length === 0) {
    return (
      <div className="space-y-4">
        <h2 className="text-xl font-semibold">Accidents & Incidents</h2>
        <div className="py-8 text-center text-muted-foreground">No incidents recorded.</div>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <h2 className="text-xl font-semibold">Accidents & Incidents</h2>
      <div className="space-y-4">
        {incidents.map((inc) => (
          <Card key={inc.id}>
            <CardHeader className="pb-3">
              <div className="flex items-center justify-between">
                <CardTitle className="text-base flex items-center gap-2">
                  {inc.incidentNumber}
                  <StatusBadge status={inc.severity as StatusKey} />
                  <StatusBadge status={inc.status as StatusKey} />
                </CardTitle>
                <span className="text-xs text-muted-foreground">{formatDateTime(inc.dateTime)}</span>
              </div>
            </CardHeader>
            <CardContent className="space-y-3">
              <dl className="grid grid-cols-2 gap-x-6 gap-y-2 text-sm">
                <div>
                  <dt className="text-muted-foreground">Type</dt>
                  <dd className="font-medium">{inc.type.replace(/_/g, " ")}</dd>
                </div>
                <div>
                  <dt className="text-muted-foreground">Vehicle</dt>
                  <dd>{inc.vehicle.internalCode} ({inc.vehicle.rego})</dd>
                </div>
                <div>
                  <dt className="text-muted-foreground">Booking</dt>
                  <dd>{inc.booking?.bookingReference ?? "—"}</dd>
                </div>
                <div>
                  <dt className="text-muted-foreground">Location</dt>
                  <dd>{inc.location ?? "—"}</dd>
                </div>
                {inc.estimatedDamageCost && (
                  <div>
                    <dt className="text-muted-foreground">Est. Damage</dt>
                    <dd className="font-medium">{formatCurrency(Number(inc.estimatedDamageCost))}</dd>
                  </div>
                )}
                {inc.actualDamageCost && (
                  <div>
                    <dt className="text-muted-foreground">Actual Damage</dt>
                    <dd className="font-medium">{formatCurrency(Number(inc.actualDamageCost))}</dd>
                  </div>
                )}
                {inc.customerChargeAmount && (
                  <div>
                    <dt className="text-muted-foreground">Customer Charged</dt>
                    <dd className="font-medium text-destructive">{formatCurrency(Number(inc.customerChargeAmount))}</dd>
                  </div>
                )}
                <div>
                  <dt className="text-muted-foreground">Customer Liable</dt>
                  <dd>{inc.customerLiable ? "Yes" : "No"}</dd>
                </div>
                {inc.policeReportNumber && (
                  <div>
                    <dt className="text-muted-foreground">Police Report</dt>
                    <dd>{inc.policeReportNumber}</dd>
                  </div>
                )}
                {inc.insuranceClaimNumber && (
                  <div>
                    <dt className="text-muted-foreground">Insurance Claim</dt>
                    <dd>{inc.insuranceClaimNumber}</dd>
                  </div>
                )}
              </dl>
              <div>
                <p className="text-xs text-muted-foreground mb-1">Description</p>
                <p className="text-sm">{inc.description}</p>
              </div>
              {inc.resolution && (
                <div>
                  <p className="text-xs text-muted-foreground mb-1">Resolution</p>
                  <p className="text-sm">{inc.resolution}</p>
                </div>
              )}
              {inc.photos.length > 0 && (
                <div>
                  <p className="text-xs text-muted-foreground mb-2">Photos ({inc.photos.length})</p>
                  <div className="flex gap-2 flex-wrap">
                    {inc.photos.map((p) => (
                      <div key={p.id} className="relative h-20 w-20 overflow-hidden rounded border">
                        <Image
                          src={p.url}
                          alt={p.caption ?? "Incident photo"}
                          fill
                          sizes="80px"
                          className="object-cover"
                        />
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </CardContent>
          </Card>
        ))}
      </div>
    </div>
  );
}
