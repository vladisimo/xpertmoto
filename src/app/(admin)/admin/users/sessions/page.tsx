"use client";

import { useState } from "react";
import { KeyRound, Loader2, Search } from "lucide-react";
import { trpc } from "@/lib/trpc/client";
import { PageHeader } from "@/components/layout/page-header";
import { PageShell, PageSection } from "@/components/layout/page-section";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

export default function AdminUserSessionsPage() {
  const [userIdInput, setUserIdInput] = useState("");
  const [userId, setUserId] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  const sessions = trpc.session.listForUser.useQuery(
    { userId: userId ?? "" },
    { enabled: !!userId, retry: false },
  );
  const utils = trpc.useUtils();

  const revokeOne = trpc.session.revokeForUser.useMutation({
    onSuccess: () =>
      userId && utils.session.listForUser.invalidate({ userId }),
    onError: (e) => setErr(e.message),
  });
  const revokeAll = trpc.session.revokeAllForUser.useMutation({
    onSuccess: () =>
      userId && utils.session.listForUser.invalidate({ userId }),
    onError: (e) => setErr(e.message),
  });

  return (
    <PageShell>
      <PageHeader
        eyebrow="Administration"
        title="User sessions"
        description="Look up any user's active NextAuth sessions and revoke them. Useful for suspected compromise, terminated staff, or support requests where a customer needs to be logged out everywhere."
      />

      <PageSection title="Lookup">
        <Card>
          <CardContent className="p-4 space-y-3">
            <div className="space-y-2">
              <Label htmlFor="userId">User id</Label>
              <div className="flex gap-2">
                <Input
                  id="userId"
                  value={userIdInput}
                  onChange={(e) => setUserIdInput(e.target.value)}
                  placeholder="cmo...abc"
                  className="font-mono"
                />
                <Button
                  onClick={() => {
                    setUserId(userIdInput.trim() || null);
                    setErr(null);
                  }}
                >
                  <Search className="mr-1.5 h-4 w-4" aria-hidden />
                  Load
                </Button>
              </div>
              <p className="text-xs text-muted-foreground">
                Copy the user id from the Users list, a customer detail URL, or
                an audit log row. Works for staff, admin, and customer accounts.
              </p>
            </div>
          </CardContent>
        </Card>
      </PageSection>

      {userId && (
        <PageSection
          title="Active sessions"
          description={`Sessions that would currently pass the NextAuth expires check.`}
        >
          {sessions.isLoading ? (
            <div className="text-sm text-muted-foreground">Loading…</div>
          ) : sessions.error ? (
            <div className="text-sm text-destructive">{sessions.error.message}</div>
          ) : !sessions.data || sessions.data.length === 0 ? (
            <Card>
              <CardContent className="py-6 text-center text-sm text-muted-foreground">
                No active sessions for this user.
              </CardContent>
            </Card>
          ) : (
            <Card>
              <CardContent className="p-4 space-y-3">
                <ul className="divide-y">
                  {sessions.data.map((s) => (
                    <li
                      key={s.id}
                      className="flex items-center justify-between py-2 text-sm"
                    >
                      <div>
                        <div className="font-mono text-xs">{s.id}</div>
                        <div className="text-xs text-muted-foreground">
                          Expires {new Date(s.expires).toLocaleString("en-AU")}
                        </div>
                      </div>
                      <Button
                        variant="ghost"
                        size="sm"
                        disabled={revokeOne.isPending}
                        onClick={() =>
                          revokeOne.mutate({ sessionId: s.id, userId })
                        }
                      >
                        {revokeOne.isPending && (
                          <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" aria-hidden />
                        )}
                        Revoke
                      </Button>
                    </li>
                  ))}
                </ul>

                {sessions.data.length > 0 && (
                  <div className="flex justify-end border-t pt-3">
                    <Button
                      variant="destructive"
                      size="sm"
                      disabled={revokeAll.isPending}
                      onClick={() => revokeAll.mutate({ userId })}
                    >
                      <KeyRound className="mr-1.5 h-3.5 w-3.5" aria-hidden />
                      Revoke all sessions
                    </Button>
                  </div>
                )}

                {err && <div className="text-sm text-destructive">{err}</div>}
              </CardContent>
            </Card>
          )}
        </PageSection>
      )}
    </PageShell>
  );
}
