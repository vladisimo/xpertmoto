"use client";

import { useRef, useState } from "react";
import { Gavel, Upload } from "lucide-react";
import type { inferRouterOutputs } from "@trpc/server";

import type { AppRouter } from "@/server/trpc/router";
import { trpc } from "@/lib/trpc/client";
import { formatCurrency, formatDate } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Spinner } from "@/components/ui/spinner";

type Handling = "NOMINATE_DRIVER" | "PAY_AND_RECOVER";
type Channel = "ENOMINATIONS_CSV" | "STAT_DEC_MAIL" | "MYPENALTY_WEB";

function daysUntil(d: Date | string | null): number | null {
  if (!d) return null;
  const day = 24 * 60 * 60 * 1000;
  const t = new Date(d);
  const a = Date.UTC(t.getUTCFullYear(), t.getUTCMonth(), t.getUTCDate());
  const now = new Date();
  const b = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
  return Math.round((a - b) / day);
}

function humanize(s: string) {
  return s.replace(/_/g, " ").toLowerCase().replace(/^\w/, (c) => c.toUpperCase());
}

export function FleetNominationsTab() {
  const utils = trpc.useUtils();
  const pending = trpc.nomination.listPendingReview.useQuery();
  const deadlines = trpc.nomination.listDeadlines.useQuery({ withinDays: 28 });

  const invalidate = () => {
    void utils.nomination.listPendingReview.invalidate();
    void utils.nomination.listDeadlines.invalidate();
  };

  return (
    <div className="flex flex-col gap-6 p-1">
      <RevenueNswImportCard onImported={invalidate} />

      <section>
        <h3 className="mb-2 flex items-center gap-2 text-sm font-semibold text-muted-foreground">
          <Gavel className="h-4 w-4" /> Awaiting review
          {pending.data ? <Badge variant="secondary">{pending.data.length}</Badge> : null}
        </h3>
        {pending.isLoading ? (
          <Spinner />
        ) : !pending.data?.length ? (
          <p className="text-sm text-muted-foreground">
            No infringements awaiting allocation. Imported or recorded notices that match a
            booking appear here for staff confirmation before any nomination.
          </p>
        ) : (
          <div className="flex flex-col gap-3">
            {pending.data.map((inf) => (
              <PendingCard key={inf.id} inf={inf} onDone={invalidate} />
            ))}
          </div>
        )}
      </section>

      <section>
        <h3 className="mb-2 text-sm font-semibold text-muted-foreground">
          Nomination deadlines (next 28 days)
        </h3>
        {deadlines.isLoading ? (
          <Spinner />
        ) : !deadlines.data?.length ? (
          <p className="text-sm text-muted-foreground">No nominations approaching their deadline.</p>
        ) : (
          <div className="flex flex-col gap-3">
            {deadlines.data.map((inf) => (
              <DeadlineCard key={inf.id} inf={inf} onDone={invalidate} />
            ))}
          </div>
        )}
      </section>
    </div>
  );
}

function RevenueNswImportCard({ onImported }: { onImported: () => void }) {
  const fileRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function upload(file: File) {
    setBusy(true);
    setError(null);
    setMessage(null);
    try {
      const form = new FormData();
      form.append("file", file);
      const res = await fetch("/api/staff/revenue-nsw/import", { method: "POST", body: form });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? "Import failed");
      setMessage(
        `Imported ${json.created} new (${json.matched} matched, ${json.unmatched} unmatched, ${json.duplicate} duplicate).`,
      );
      onImported();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Import failed");
    } finally {
      setBusy(false);
      if (fileRef.current) fileRef.current.value = "";
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <Upload className="h-4 w-4" /> Import from Service NSW portal
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        <p className="text-sm text-muted-foreground">
          Revenue NSW has no API. Download the outstanding-fines export (CSV or Excel) from the
          Service NSW / eNominations operator portal and upload it here. Matched notices are
          staged for review — nothing is nominated automatically.
        </p>
        <div className="flex items-center gap-2">
          <Input
            ref={fileRef}
            type="file"
            accept=".csv,.xlsx,.xls"
            disabled={busy}
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) void upload(f);
            }}
            className="max-w-sm"
          />
          {busy ? <Spinner /> : null}
        </div>
        {message ? <p className="text-sm text-emerald-600">{message}</p> : null}
        {error ? <p className="text-sm text-destructive">{error}</p> : null}
      </CardContent>
    </Card>
  );
}

type PendingInf = inferRouterOutputs<AppRouter>["nomination"]["listPendingReview"][number];

function PendingCard({ inf, onDone }: { inf: PendingInf; onDone: () => void }) {
  const [handling, setHandling] = useState<Handling>(
    (inf.handling as Handling | null) ?? "NOMINATE_DRIVER",
  );
  const allocate = trpc.nomination.allocate.useMutation({ onSuccess: onDone });
  const customerName = inf.booking?.customer
    ? `${inf.booking.customer.firstName ?? ""} ${inf.booking.customer.lastName ?? ""}`.trim()
    : null;

  return (
    <Card>
      <CardContent className="flex flex-col gap-3 pt-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="space-y-1 text-sm">
          <div className="font-medium">
            {humanize(inf.type)} · {inf.referenceNumber}
          </div>
          <div className="text-muted-foreground">
            {inf.issuer} · {formatCurrency(Number(inf.amount))}
            {inf.demeritPoints > 0 ? ` · ${inf.demeritPoints} demerit pts` : ""} ·{" "}
            {formatDate(inf.offenceDate)}
          </div>
          <div className="text-muted-foreground">
            {inf.vehicle.internalCode} · {inf.vehicle.rego}
            {inf.booking ? ` · ${inf.booking.bookingReference}` : ""}
            {customerName ? ` · ${customerName}` : " · no renter matched"}
          </div>
        </div>
        <div className="flex flex-shrink-0 items-center gap-2">
          <Select value={handling} onValueChange={(v) => setHandling(v as Handling)}>
            <SelectTrigger className="w-[180px]">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="NOMINATE_DRIVER">Nominate driver</SelectItem>
              <SelectItem value="PAY_AND_RECOVER">Pay &amp; recover</SelectItem>
            </SelectContent>
          </Select>
          <Button
            size="sm"
            disabled={allocate.isPending || !inf.customerId}
            onClick={() => allocate.mutate({ infringementId: inf.id, handling })}
          >
            {allocate.isPending ? "Working…" : "Confirm & notify"}
          </Button>
        </div>
        {allocate.error ? (
          <p className="text-sm text-destructive sm:basis-full">{allocate.error.message}</p>
        ) : null}
      </CardContent>
    </Card>
  );
}

type DeadlineInf = inferRouterOutputs<AppRouter>["nomination"]["listDeadlines"][number];

function DeadlineCard({ inf, onDone }: { inf: DeadlineInf; onDone: () => void }) {
  const utils = trpc.useUtils();
  const [channel, setChannel] = useState<Channel>("ENOMINATIONS_CSV");
  const [receiptRef, setReceiptRef] = useState("");
  const [rejectReason, setRejectReason] = useState("");
  const [urls, setUrls] = useState<{ csvUrl: string | null; pdfUrl: string | null } | null>(null);

  const draft = trpc.nomination.draftSubmission.useMutation({
    onSuccess: (res) => {
      setUrls({ csvUrl: res.csvUrl, pdfUrl: res.pdfUrl });
      onDone();
    },
  });
  const submit = trpc.nomination.recordSubmission.useMutation({ onSuccess: onDone });
  const outcome = trpc.nomination.recordOutcome.useMutation({ onSuccess: onDone });

  const days = daysUntil(inf.nominationDeadline);
  const latest = inf.submissions[0];

  async function loadUrls(submissionId: string) {
    const res = await utils.nomination.submissionArtefacts.fetch({ submissionId });
    setUrls({ csvUrl: res.csvUrl, pdfUrl: res.pdfUrl });
  }

  return (
    <Card>
      <CardContent className="flex flex-col gap-3 pt-4">
        <div className="flex items-start justify-between gap-3">
          <div className="space-y-1 text-sm">
            <div className="font-medium">
              {humanize(inf.type)} · {inf.referenceNumber}
            </div>
            <div className="text-muted-foreground">
              {inf.issuer} · {formatCurrency(Number(inf.amount))} ·{" "}
              {inf.vehicle.internalCode}/{inf.vehicle.rego}
            </div>
          </div>
          <div className="text-right">
            <Badge
              variant={days !== null && days < 3 ? "destructive" : "secondary"}
            >
              {days === null
                ? "—"
                : days < 0
                  ? `${Math.abs(days)}d overdue`
                  : `${days}d left`}
            </Badge>
            <div className="mt-1 text-xs text-muted-foreground">
              {inf.nominationDeadline ? formatDate(inf.nominationDeadline) : ""}
            </div>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2 border-t pt-3">
          {!latest || latest.status === "REJECTED" ? (
            <>
              <Select value={channel} onValueChange={(v) => setChannel(v as Channel)}>
                <SelectTrigger className="w-[200px]">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="ENOMINATIONS_CSV">eNominations CSV</SelectItem>
                  <SelectItem value="STAT_DEC_MAIL">Statutory declaration (mail)</SelectItem>
                  <SelectItem value="MYPENALTY_WEB">myPenalty web form</SelectItem>
                </SelectContent>
              </Select>
              <Button
                size="sm"
                disabled={draft.isPending}
                onClick={() => draft.mutate({ infringementId: inf.id, channel })}
              >
                {draft.isPending ? "Generating…" : "Generate nomination"}
              </Button>
            </>
          ) : (
            <Badge variant="outline">Submission: {humanize(latest.status)}</Badge>
          )}

          {(urls?.csvUrl || urls?.pdfUrl) && (
            <div className="flex items-center gap-3 text-sm">
              {urls.csvUrl ? (
                <a className="text-primary underline" href={urls.csvUrl} target="_blank" rel="noreferrer">
                  Download CSV
                </a>
              ) : null}
              {urls.pdfUrl ? (
                <a className="text-primary underline" href={urls.pdfUrl} target="_blank" rel="noreferrer">
                  Download stat dec
                </a>
              ) : null}
            </div>
          )}
          {latest && latest.status === "DRAFTED" && !urls ? (
            <Button size="sm" variant="ghost" onClick={() => void loadUrls(latest.id)}>
              Get download links
            </Button>
          ) : null}
        </div>

        {draft.error ? <p className="text-sm text-destructive">{draft.error.message}</p> : null}

        {latest && latest.status === "DRAFTED" ? (
          <div className="flex flex-wrap items-center gap-2">
            <Input
              placeholder="Revenue NSW receipt reference"
              value={receiptRef}
              onChange={(e) => setReceiptRef(e.target.value)}
              className="max-w-xs"
            />
            <Button
              size="sm"
              variant="secondary"
              disabled={submit.isPending}
              onClick={() =>
                submit.mutate({
                  submissionId: latest.id,
                  receiptReference: receiptRef || undefined,
                })
              }
            >
              {submit.isPending ? "Saving…" : "Mark submitted"}
            </Button>
          </div>
        ) : null}

        {latest && latest.status === "SUBMITTED" ? (
          <div className="flex flex-wrap items-center gap-2">
            <Button
              size="sm"
              variant="secondary"
              disabled={outcome.isPending}
              onClick={() => outcome.mutate({ submissionId: latest.id, status: "ACCEPTED" })}
            >
              Mark accepted
            </Button>
            <Input
              placeholder="Rejection reason"
              value={rejectReason}
              onChange={(e) => setRejectReason(e.target.value)}
              className="max-w-xs"
            />
            <Button
              size="sm"
              variant="outline"
              disabled={outcome.isPending}
              onClick={() =>
                outcome.mutate({
                  submissionId: latest.id,
                  status: "REJECTED",
                  rejectionReason: rejectReason || undefined,
                })
              }
            >
              Mark rejected
            </Button>
          </div>
        ) : null}
      </CardContent>
    </Card>
  );
}
