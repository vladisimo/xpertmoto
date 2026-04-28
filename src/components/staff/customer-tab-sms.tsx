"use client";

import { trpc } from "@/lib/trpc/client";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { formatDateTime } from "@/lib/utils";
import { Mail, MessageCircle, ArrowUpRight, ArrowDownLeft } from "lucide-react";

export function CustomerTabSMS({ customerId }: { customerId: string }) {
  const { data: comms, isLoading } = trpc.staffCustomer.communications.useQuery({ customerId });

  if (isLoading) return <div className="py-8 text-center text-muted-foreground">Loading communications...</div>;

  if (!comms || comms.length === 0) {
    return (
      <div className="space-y-4">
        <h2 className="text-xl font-semibold">SMS & Communications</h2>
        <div className="py-8 text-center text-muted-foreground">No communications found.</div>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <h2 className="text-xl font-semibold">SMS & Communications</h2>
      <div className="space-y-3">
        {comms.map((c) => (
          <Card key={c.id}>
            <CardContent className="py-3 px-4">
              <div className="flex items-start justify-between gap-4">
                <div className="flex items-start gap-3">
                  <div className="mt-0.5">
                    {c.channel === "SMS" ? (
                      <MessageCircle className="h-4 w-4 text-blue-500" />
                    ) : (
                      <Mail className="h-4 w-4 text-purple-500" />
                    )}
                  </div>
                  <div>
                    <div className="flex items-center gap-2 mb-1">
                      <Badge variant="outline" className="text-xs">
                        {c.channel}
                      </Badge>
                      <Badge variant={c.direction === "OUTBOUND" ? "default" : "secondary"} className="text-xs">
                        {c.direction === "OUTBOUND" ? (
                          <><ArrowUpRight className="mr-1 h-3 w-3" />Sent</>
                        ) : (
                          <><ArrowDownLeft className="mr-1 h-3 w-3" />Received</>
                        )}
                      </Badge>
                      {c.templateUsed && (
                        <span className="text-xs text-muted-foreground">Template: {c.templateUsed}</span>
                      )}
                    </div>
                    {c.subject && <p className="text-sm font-medium mb-1">{c.subject}</p>}
                    <p className="text-sm text-muted-foreground whitespace-pre-wrap">{c.body}</p>
                  </div>
                </div>
                <span className="text-xs text-muted-foreground whitespace-nowrap">
                  {formatDateTime(c.sentAt)}
                </span>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>
    </div>
  );
}
