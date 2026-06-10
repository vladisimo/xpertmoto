"use client";

import { useRef, useState } from "react";
import { trpc } from "@/lib/trpc/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Spinner } from "@/components/ui/spinner";
import { StatusBadge, type StatusKey } from "@/components/ui/status-badge";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { formatDateTime } from "@/lib/utils";
import { useBranding } from "@/components/shared/branding-provider";

const REGIONS = ["NSW", "VIC", "QLD"] as const;
type Region = (typeof REGIONS)[number];

export function IntegrationTabLinkt({ canManage = false }: { canManage?: boolean }) {
  const { siteName } = useBranding();
  const util = trpc.useUtils();
  const { data: accounts } = trpc.linkt.listAccounts.useQuery();
  const create = trpc.linkt.createAccount.useMutation({
    onSuccess: () => util.linkt.listAccounts.invalidate(),
  });
  const remove = trpc.linkt.deleteAccount.useMutation({
    onSuccess: () => util.linkt.listAccounts.invalidate(),
  });
  const sync = trpc.linkt.runSyncNow.useMutation({
    onSuccess: () => util.linkt.listAccounts.invalidate(),
  });

  const [form, setForm] = useState<{
    name: string;
    username: string;
    password: string;
    region: Region;
  }>({ name: "", username: "", password: "", region: "NSW" });
  const [openSyncs, setOpenSyncs] = useState<string | null>(null);
  const [lastSyncMsg, setLastSyncMsg] = useState<string | null>(null);

  async function submit() {
    await create.mutateAsync({
      name: form.name,
      username: form.username,
      password: form.password,
      region: form.region,
    });
    setForm({ name: "", username: "", password: "", region: "NSW" });
  }

  async function runSync(id: string) {
    setLastSyncMsg(null);
    try {
      const res = await sync.mutateAsync({ id });
      setLastSyncMsg(`Re-match ${res.syncId.slice(0, 8)} → ${res.status}`);
    } catch (e) {
      setLastSyncMsg(`Failed: ${e instanceof Error ? e.message : String(e)}`);
    }
  }

  return (
    <section className="space-y-4">
      <div>
        <h2 className="text-2xl font-semibold">Linkt (Transurban) accounts</h2>
        <p className="text-muted-foreground text-sm mt-1">
          Connect the Linkt account covering your fleet&apos;s toll roads. Download the trip activity
          export (CSV or Excel) from your Linkt commercial account and upload it here. The system
          matches each toll to the booking active when it was incurred and auto-creates the
          infringement; unmatched trips are queued for staff review. &ldquo;Re-match&rdquo; re-tries
          any queued unmatched trips against newer bookings.
        </p>
      </div>

      {canManage && (
        <Card>
          <CardHeader>
            <CardTitle className="text-lg">Add account</CardTitle>
          </CardHeader>
          <CardContent className="grid grid-cols-1 md:grid-cols-2 gap-2">
            <Input
              placeholder={`Account label (e.g. ${siteName} Fleet — Linkt)`}
              value={form.name}
              onChange={(e) => setForm({ ...form, name: e.target.value })}
            />
            <Select
              value={form.region}
              onValueChange={(v) => setForm({ ...form, region: v as Region })}
            >
              <SelectTrigger>
                <SelectValue placeholder="Region" />
              </SelectTrigger>
              <SelectContent>
                {REGIONS.map((r) => (
                  <SelectItem key={r} value={r}>
                    {r}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
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
          <p className="text-muted-foreground text-sm">No Linkt accounts connected.</p>
        ) : (
          accounts?.map((a) => (
            <Card key={a.id}>
              <CardContent className="p-3 space-y-2">
                <div className="flex justify-between items-start text-sm">
                  <div>
                    <div className="font-medium">
                      {a.name}{" "}
                      <span className="text-xs text-muted-foreground">
                        ({a.region} · {a.username})
                      </span>
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
                    <UploadExportButton accountId={a.id} onMessage={setLastSyncMsg} />
                    <Button
                      size="sm"
                      variant="outline"
                      title="Re-try queued unmatched trips against newer bookings. Linkt has no live feed — new trips arrive via Upload export."
                      onClick={() => runSync(a.id)}
                      disabled={sync.isPending}
                    >
                      {sync.isPending ? "Re-matching…" : "Re-match"}
                    </Button>
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => setOpenSyncs(openSyncs === a.id ? null : a.id)}
                    >
                      History
                    </Button>
                    {canManage && (
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => {
                          if (confirm(`Delete Linkt account "${a.name}"?`)) {
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

function UploadExportButton({
  accountId,
  onMessage,
}: {
  accountId: string;
  onMessage: (msg: string) => void;
}) {
  const util = trpc.useUtils();
  const inputRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);

  async function onPick(file: File | null) {
    if (!file) return;
    setBusy(true);
    onMessage(`Uploading ${file.name}…`);
    try {
      const body = new FormData();
      body.append("file", file);
      body.append("accountId", accountId);
      const res = await fetch("/api/staff/linkt/import", { method: "POST", body });
      const json = (await res.json().catch(() => ({}))) as {
        status?: string;
        rowsFetched?: number;
        rowsCreated?: number;
        rowsDuplicate?: number;
        rowsUnmatched?: number;
        error?: string;
      };
      if (!res.ok) {
        onMessage(`Upload failed: ${json.error ?? `HTTP ${res.status}`}`);
      } else {
        onMessage(
          `Import ${json.status}: ${json.rowsFetched ?? 0} rows · ${json.rowsCreated ?? 0} new · ` +
            `${json.rowsDuplicate ?? 0} dup · ${json.rowsUnmatched ?? 0} unmatched` +
            (json.error ? ` · ${json.error}` : ""),
        );
        await Promise.all([
          util.linkt.listAccounts.invalidate(),
          util.linkt.listSyncs.invalidate(),
        ]);
      }
    } catch (e) {
      onMessage(`Upload failed: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setBusy(false);
      if (inputRef.current) inputRef.current.value = "";
    }
  }

  return (
    <>
      <input
        ref={inputRef}
        type="file"
        accept=".csv,.xlsx,.xls"
        className="hidden"
        onChange={(e) => onPick(e.target.files?.[0] ?? null)}
      />
      <Button size="sm" onClick={() => inputRef.current?.click()} disabled={busy}>
        {busy ? "Uploading…" : "Upload export"}
      </Button>
    </>
  );
}

function SyncHistory({ accountId }: { accountId: string }) {
  const { data: syncs } = trpc.linkt.listSyncs.useQuery({ accountId, limit: 10 });
  if (!syncs)
    return (
      <div className="flex py-1">
        <Spinner size="sm" />
      </div>
    );
  if (syncs.length === 0)
    return <div className="text-xs text-muted-foreground">No syncs yet.</div>;
  return (
    <div className="border-t pt-2 mt-2 space-y-1">
      <div className="text-xs font-semibold">Recent syncs</div>
      {syncs.map((s) => (
        <div key={s.id} className="text-xs flex justify-between gap-2 py-1 border-b last:border-0">
          <div className="flex items-center gap-1.5">
            {formatDateTime(s.startedAt)} — <StatusBadge status={s.status as StatusKey} />
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
