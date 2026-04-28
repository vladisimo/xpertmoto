"use client";

import { Monitor, Loader2 } from "lucide-react";
import { trpc } from "@/lib/trpc/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";

export function ActiveSessionsCard() {
  const sessions = trpc.session.mine.useQuery();
  const utils = trpc.useUtils();
  const revoke = trpc.session.revokeMine.useMutation({
    onSuccess: () => utils.session.mine.invalidate(),
  });
  const revokeAll = trpc.session.revokeAllMineExceptCurrent.useMutation({
    onSuccess: () => utils.session.mine.invalidate(),
  });

  return (
    <Card>
      <CardHeader>
        <CardTitle className="h3 flex items-center gap-2">
          <Monitor className="h-4 w-4" aria-hidden />
          Active sessions
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3 text-sm">
        {sessions.isLoading ? (
          <div className="text-muted-foreground">Loading…</div>
        ) : !sessions.data || sessions.data.length === 0 ? (
          <div className="text-muted-foreground">No active sessions.</div>
        ) : (
          <>
            <ul className="divide-y">
              {sessions.data.map((s) => (
                <li key={s.id} className="flex items-center justify-between py-2">
                  <div className="text-xs">
                    <div className="font-mono text-muted-foreground">
                      {s.id.slice(-12)}
                    </div>
                    <div className="text-muted-foreground">
                      Expires {new Date(s.expires).toLocaleString("en-AU")}
                    </div>
                  </div>
                  <Button
                    variant="ghost"
                    size="sm"
                    disabled={revoke.isPending}
                    onClick={() => revoke.mutate({ sessionId: s.id })}
                  >
                    {revoke.isPending && <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" aria-hidden />}
                    Revoke
                  </Button>
                </li>
              ))}
            </ul>
            {sessions.data.length > 1 && (
              <div className="flex justify-end">
                <Button
                  variant="secondary"
                  size="sm"
                  disabled={revokeAll.isPending}
                  onClick={() => revokeAll.mutate()}
                >
                  Revoke all other sessions
                </Button>
              </div>
            )}
          </>
        )}
      </CardContent>
    </Card>
  );
}
