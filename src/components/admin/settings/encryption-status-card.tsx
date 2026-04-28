"use client";

import { ShieldCheck, AlertTriangle } from "lucide-react";
import { trpc } from "@/lib/trpc/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { StatusBadge } from "@/components/ui/status-badge";

/**
 * APP-11 encryption rollout status. Counts CustomerProfile rows with
 * encrypted PII vs plaintext-only. Administrators run
 * `npx tsx scripts/encrypt-licence-data.ts` to migrate remaining
 * plaintext rows; once the counter hits zero, the follow-up DROP
 * COLUMN migration can ship.
 *
 * This is read-only — the button to actually run the migration is
 * deliberately absent because encryption is a long-running one-shot
 * operation best run from SSH, not a UI click.
 */
export function EncryptionStatusCard() {
  const q = trpc.admin.encryptionStatus.useQuery();
  if (q.isLoading) {
    return (
      <Card>
        <CardContent className="py-4 text-sm text-muted-foreground">
          Loading encryption status…
        </CardContent>
      </Card>
    );
  }
  if (!q.data) return null;
  const { licence, passport } = q.data;
  const licenceDone = licence.plaintextOnly === 0;
  const passportDone = passport.plaintextOnly === 0;

  return (
    <Card>
      <CardHeader>
        <CardTitle className="h3 flex items-center gap-2">
          <ShieldCheck className="h-4 w-4" aria-hidden />
          PII encryption (APP 11)
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4 text-sm">
        <p className="text-muted-foreground">
          Licence + passport numbers are encrypted at rest via AES-256-GCM.
          Legacy rows are migrated by running{" "}
          <code className="font-mono">npx tsx scripts/encrypt-licence-data.ts</code>.
          Once the plaintext column hits zero rows, schedule the follow-up
          DROP COLUMN migration.
        </p>

        <div className="grid gap-3 sm:grid-cols-2">
          <Row
            label="Licence numbers"
            encrypted={licence.encrypted}
            plaintext={licence.plaintextOnly}
            done={licenceDone}
          />
          <Row
            label="Passport numbers"
            encrypted={passport.encrypted}
            plaintext={passport.plaintextOnly}
            done={passportDone}
          />
        </div>

        {(!licenceDone || !passportDone) && (
          <div className="flex items-start gap-2 rounded-md border border-amber-500/30 bg-amber-500/5 p-3 text-xs text-amber-700 dark:text-amber-400">
            <AlertTriangle className="h-4 w-4 shrink-0 mt-0.5" aria-hidden />
            <div>
              <div className="font-medium">Migration pending</div>
              <p className="mt-1">
                Run{" "}
                <code className="font-mono">npx tsx scripts/encrypt-licence-data.ts</code>{" "}
                from a shell with access to <code>SECRET_ENC_KEY</code>. Safe to
                re-run; idempotent.
              </p>
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function Row({
  label,
  encrypted,
  plaintext,
  done,
}: {
  label: string;
  encrypted: number;
  plaintext: number;
  done: boolean;
}) {
  const total = encrypted + plaintext;
  const pct = total === 0 ? 100 : Math.round((encrypted / total) * 100);
  return (
    <div className="rounded-md border bg-muted/20 p-3 space-y-2">
      <div className="flex items-center justify-between">
        <div className="font-medium">{label}</div>
        <StatusBadge status={done ? "ACTIVE" : "PENDING"} />
      </div>
      <div className="text-xs text-muted-foreground">
        {encrypted} encrypted · {plaintext} plaintext · {pct}% complete
      </div>
      <div className="h-1.5 rounded-full bg-background overflow-hidden">
        <div
          className="h-full bg-primary"
          style={{ width: `${pct}%` }}
        />
      </div>
    </div>
  );
}
