"use client";

import { useState } from "react";
import { trpc } from "@/lib/trpc/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Spinner } from "@/components/ui/spinner";
import { StatusBadge, type StatusKey } from "@/components/ui/status-badge";
import { formatDateTime } from "@/lib/utils";
import { useBranding } from "@/components/shared/branding-provider";

export function IntegrationTabEtoll({ canManage = false }: { canManage?: boolean }) {
  const { siteName } = useBranding();
  const util = trpc.useUtils();
  const { data: accounts } = trpc.etoll.listAccounts.useQuery();
  const create = trpc.etoll.createAccount.useMutation({
    onSuccess: () => util.etoll.listAccounts.invalidate(),
  });
  const remove = trpc.etoll.deleteAccount.useMutation({
    onSuccess: () => util.etoll.listAccounts.invalidate(),
  });
  const sync = trpc.etoll.runSyncNow.useMutation({
    onSuccess: () => util.etoll.listAccounts.invalidate(),
  });

  const [form, setForm] = useState({ name: "", username: "", password: "" });
  const [openSyncs, setOpenSyncs] = useState<string | null>(null);
  const [lastSyncMsg, setLastSyncMsg] = useState<string | null>(null);

  async function submit() {
    await create.mutateAsync({
      name: form.name,
      username: form.username,
      password: form.password,
    });
    setForm({ name: "", username: "", password: "" });
  }

  async function runSync(id: string) {
    setLastSyncMsg(null);
    try {
      const res = await sync.mutateAsync({ id });
      setLastSyncMsg(`Sync ${res.syncId.slice(0, 8)} → ${res.status}`);
    } catch (e) {
      setLastSyncMsg(`Failed: ${e instanceof Error ? e.message : String(e)}`);
    }
  }

  return (
    <section className="space-y-4">
      <div>
        <h2 className="text-2xl font-semibold">NSW E-Toll accounts</h2>
        <p className="text-muted-foreground text-sm mt-1">
          Connect one or more myetoll.transport.nsw.gov.au accounts. The system will log in on a
          schedule, download account activity, and auto-create toll infringements against the
          booking active when each toll was incurred.
        </p>
      </div>

      {canManage && (
        <Card>
          <CardHeader>
            <CardTitle className="text-lg">Add account</CardTitle>
          </CardHeader>
          <CardContent className="grid grid-cols-1 md:grid-cols-2 gap-2">
            <Input
              placeholder={`Account label (e.g. ${siteName} Fleet — NSW)`}
              value={form.name}
              onChange={(e) => setForm({ ...form, name: e.target.value })}
            />
            <Input
              placeholder="Username / email"
              value={form.username}
              onChange={(e) => setForm({ ...form, username: e.target.value })}
            />
            <Input
              type="password"
              placeholder="Password"
              value={form.password}
              onChange={(e) => setForm({ ...form, password: e.target.value })}
              className="md:col-span-2"
            />
            <div className="md:col-span-2">
              <Button
                disabled={!form.name || !form.username || !form.password || create.isPending}
                onClick={submit}
              >
                {create.isPending ? "Saving…" : "Add account"}
              </Button>
            </div>
          </CardContent>
        </Card>
      )}

      {lastSyncMsg && (
        <Card className="border-primary">
          <CardContent className="p-3 text-sm">{lastSyncMsg}</CardContent>
        </Card>
      )}

      <div className="space-y-2">
        {accounts?.length === 0 ? (
          <p className="text-muted-foreground text-sm">No e-toll accounts connected.</p>
        ) : (
          accounts?.map((a) => (
            <Card key={a.id}>
              <CardContent className="p-3 space-y-2">
                <div className="flex justify-between items-start text-sm">
                  <div>
                    <div className="font-medium">
                      {a.name}{" "}
                      <span className="text-xs text-muted-foreground">({a.username})</span>
                    </div>
                    <div className="text-xs text-muted-foreground">
                      {a.lastSyncAt
                        ? `Last synced ${formatDateTime(a.lastSyncAt)} → ${a.lastSyncStatus}`
                        : "Never synced"}
                      {a.lastSyncError && (
                        <span className="text-red-600"> · {a.lastSyncError}</span>
                      )}
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    <Button
                      size="sm"
                      onClick={() => runSync(a.id)}
                      disabled={sync.isPending}
                    >
                      {sync.isPending ? "Syncing…" : "Sync now"}
                    </Button>
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() =>
                        setOpenSyncs(openSyncs === a.id ? null : a.id)
                      }
                    >
                      History
                    </Button>
                    {canManage && (
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => {
                          if (confirm(`Delete e-toll account "${a.name}"?`)) {
                            remove.mutate({ id: a.id });
                          }
                        }}
                      >
                        Delete
                      </Button>
                    )}
                  </div>
                </div>
                {openSyncs === a.id && <SyncHistory accountId={a.id} />}
              </CardContent>
            </Card>
          ))
        )}
      </div>
    </section>
  );
}

function SyncHistory({ accountId }: { accountId: string }) {
  const { data: syncs } = trpc.etoll.listSyncs.useQuery({ accountId, limit: 10 });
  if (!syncs) return <div className="flex py-1"><Spinner size="sm" /></div>;
  if (syncs.length === 0) return <div className="text-xs text-muted-foreground">No syncs yet.</div>;
  return (
    <div className="border-t pt-2 mt-2 space-y-1">
      <div className="text-xs font-semibold">Recent syncs</div>
      {syncs.map((s) => (
        <div key={s.id} className="text-xs flex justify-between gap-2 py-1 border-b last:border-0">
          <div className="flex items-center gap-1.5">
            {formatDateTime(s.startedAt)} —{" "}
            <StatusBadge status={s.status as StatusKey} />
          </div>
          <div className="text-muted-foreground">
            {s.rowsFetched} fetched · {s.rowsCreated} new · {s.rowsDuplicate} dup ·{" "}
            {s.rowsUnmatched} unmatched
            {s.error && <span className="text-red-600"> · {s.error}</span>}
          </div>
        </div>
      ))}
    </div>
  );
}
