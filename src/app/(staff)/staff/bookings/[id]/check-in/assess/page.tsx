"use client";

import { use, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { trpc } from "@/lib/trpc/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { PageHeader } from "@/components/layout/page-header";
import { PageShell } from "@/components/layout/page-section";
import { MobileBottomBar } from "@/components/layout/mobile-bottom-bar";
import { LoadingBlock } from "@/components/ui/spinner";
import { StatusBadge, type StatusKey } from "@/components/ui/status-badge";
import { formatCurrency } from "@/lib/utils";

type Resolution = "STANDARD" | "QUOTE_PENDING" | "WAIVED" | "WARRANTY";

export default function CheckInAssessPage(props: { params: Promise<{ id: string }> }) {
  const { id } = use(props.params);
  const router = useRouter();
  const utils = trpc.useUtils();
  const { data: b } = trpc.staffBooking.detail.useQuery({ id });
  const { data: assessment } = trpc.return.byBooking.useQuery({ bookingId: id });
  const { data: tariffs } = trpc.damageTariff.list.useQuery(
    { categoryId: b?.categoryId, activeOnly: true },
    { enabled: !!b },
  );
  const fees = trpc.return.computeFees.useQuery(
    { assessmentId: assessment?.id ?? "" },
    { enabled: !!assessment },
  );
  const { data: inspections } = trpc.inspection.byBooking.useQuery({ bookingId: id });

  const upsertCharge = trpc.return.upsertDamageCharge.useMutation();
  const removeCharge = trpc.return.removeDamageCharge.useMutation();

  const [draft, setDraft] = useState<{
    description: string;
    severity: "MINOR" | "MODERATE" | "MAJOR";
    resolution: Resolution;
    tariffId: string | null;
    amount: string;
    quoteCap: string;
    note: string;
    inspectionIssueId: string | null;
  }>({
    description: "",
    severity: "MINOR",
    resolution: "STANDARD",
    tariffId: null,
    amount: "",
    quoteCap: "",
    note: "",
    inspectionIssueId: null,
  });
  const [err, setErr] = useState<string | null>(null);

  const selectedTariff = useMemo(() => tariffs?.find((t) => t.id === draft.tariffId) ?? null, [tariffs, draft.tariffId]);

  if (!b || !assessment) {
    return (
      <PageShell>
        <LoadingBlock padded="lg" />
      </PageShell>
    );
  }

  // The return inspection is the one the assessment was opened against —
  // SWAP_OUT inspections are also type POST_HIRE, so match by id first.
  const returnInspection =
    inspections?.find((i) => i.id === assessment.inspectionId) ??
    inspections?.find((i) => i.type === "POST_HIRE" && i.purpose !== "SWAP_OUT");
  const issues = returnInspection?.issues ?? [];
  // Damage pinned when a vehicle was swapped off this booking mid-hire.
  // Still this hire's damage — upsertDamageCharge accepts these issues, so
  // staff can raise charges from them the same one-tap way.
  const swapOutIssues = (inspections ?? [])
    .filter((i) => i.purpose === "SWAP_OUT")
    .flatMap((i) => i.issues);
  const linkedIssueIds = new Set(
    (assessment.damageCharges ?? []).map((c) => c.inspectionIssueId).filter((x): x is string => !!x),
  );

  /** Prefill the damage-line form from a pinned inspection issue (one tap). */
  function raiseFromIssue(issue: {
    id: string;
    label: string;
    severity: "MINOR" | "MODERATE" | "MAJOR";
    damageTariffId: string | null;
    note: string | null;
  }) {
    setErr(null);
    const t = tariffs?.find((x) => x.id === issue.damageTariffId);
    setDraft({
      description: issue.label,
      severity: issue.severity,
      resolution: "STANDARD",
      tariffId: issue.damageTariffId,
      amount: t ? t.defaultPrice.toString() : "",
      quoteCap: "",
      note: issue.note ?? "",
      inspectionIssueId: issue.id,
    });
  }

  async function addCharge() {
    if (!assessment || !draft.description) {
      setErr("Add a description for the damage.");
      return;
    }
    setErr(null);
    const amountNum = Number(draft.amount || 0);
    const capNum = Number(draft.quoteCap || 0);
    try {
      await upsertCharge.mutateAsync({
        assessmentId: assessment.id,
        inspectionIssueId: draft.inspectionIssueId ?? undefined,
        description: draft.description,
        severity: draft.severity,
        resolution: draft.resolution,
        damageTariffId: draft.resolution === "STANDARD" ? draft.tariffId ?? undefined : undefined,
        amount: draft.resolution === "STANDARD" ? amountNum : undefined,
        quoteCapAmount: draft.resolution === "QUOTE_PENDING" ? capNum : undefined,
        staffNote: draft.note || undefined,
      });
      await utils.return.byBooking.invalidate({ bookingId: id });
      setDraft({
        description: "",
        severity: "MINOR",
        resolution: "STANDARD",
        tariffId: null,
        amount: "",
        quoteCap: "",
        note: "",
        inspectionIssueId: null,
      });
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Failed to add charge");
    }
  }

  async function remove(chargeId: string) {
    await removeCharge.mutateAsync({ chargeId });
    await utils.return.byBooking.invalidate({ bookingId: id });
  }

  const issueRows = (list: typeof issues) => (
    <ul className="divide-y">
      {list.map((iss) => {
        const linked = linkedIssueIds.has(iss.id);
        return (
          <li key={iss.id} className="flex items-center gap-3 py-2">
            {iss.inspectionPhoto?.url ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={iss.inspectionPhoto.url} alt="" className="h-12 w-12 shrink-0 rounded object-cover" />
            ) : (
              <div className="h-12 w-12 shrink-0 rounded bg-muted" />
            )}
            <div className="min-w-0 flex-1">
              <div className="truncate font-medium">{iss.label}</div>
              <div className="flex flex-wrap items-center gap-1.5 text-xs text-muted-foreground">
                <StatusBadge status={iss.severity as StatusKey} />
                {iss.side ? <span>· {sideLabel(iss.side)}</span> : null}
                {iss.note ? <span className="truncate">· {iss.note}</span> : null}
              </div>
            </div>
            {linked ? (
              <span className="caption shrink-0">Charged ✓</span>
            ) : (
              <Button type="button" size="sm" variant="secondary" onClick={() => raiseFromIssue(iss)}>
                Raise charge
              </Button>
            )}
          </li>
        );
      })}
    </ul>
  );

  const standardTotal = (assessment.damageCharges ?? [])
    .filter((c) => c.resolution === "STANDARD")
    .reduce((acc, c) => acc + Number(c.amount), 0);
  const pendingCapTotal = (assessment.damageCharges ?? [])
    .filter((c) => c.resolution === "QUOTE_PENDING")
    .reduce((acc, c) => acc + Number(c.quoteCapAmount ?? 0), 0);
  const totalDueNow = Math.round((standardTotal + (fees.data?.lateFee ?? 0) + (fees.data?.fuelCharge ?? 0)) * 100) / 100;

  return (
    <PageShell>
      <PageHeader
        eyebrow="Operations · Step 2 of 3"
        breadcrumbs={[
          { label: "Bookings", href: "/staff/calendar" },
          { label: b.bookingReference, href: `/staff/bookings/${id}` },
          { label: "Check in", href: `/staff/bookings/${id}/check-in` },
          { label: "2. Assess" },
        ]}
        title="Damage assessment"
        description="Raise a charge from each identified issue, or add a line manually. Standard tariff bills on the spot; quote-pending opens a work order."
        back={`/staff/bookings/${id}/check-in`}
        mobileCompact
      />

      {issues.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="h3">Identified issues</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="caption mb-3">
              Damage pinned during the return inspection. Tap “Raise charge” to bill it — a catalogue label pre-fills the
              price and attaches the photo.
            </p>
            {issueRows(issues)}
          </CardContent>
        </Card>
      )}

      {swapOutIssues.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="h3">Damage recorded at swap-out</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="caption mb-3">
              Pinned when a vehicle was swapped off this booking mid-hire. It belongs to this hire — raise a charge the
              same way.
            </p>
            {issueRows(swapOutIssues)}
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader>
          <CardTitle className="h3">Add a damage line</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          {draft.inspectionIssueId && (
            <p className="caption">Linked to a pinned issue — its photo attaches to this charge automatically.</p>
          )}
          <div>
            <Label>Description</Label>
            <Input
              value={draft.description}
              onChange={(e) => setDraft((d) => ({ ...d, description: e.target.value }))}
              placeholder="e.g. Scratch on left-side panel"
            />
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <Label>Severity</Label>
              <div className="mt-2 flex gap-2">
                {(["MINOR", "MODERATE", "MAJOR"] as const).map((s) => (
                  <Button
                    key={s}
                    type="button"
                    variant={draft.severity === s ? "default" : "secondary"}
                    size="sm"
                    onClick={() => setDraft((d) => ({ ...d, severity: s }))}
                  >
                    {s.slice(0, 1) + s.slice(1).toLowerCase()}
                  </Button>
                ))}
              </div>
            </div>
            <div>
              <Label>Resolution</Label>
              <div className="mt-2 flex flex-wrap gap-2">
                {(["STANDARD", "QUOTE_PENDING", "WAIVED", "WARRANTY"] as const).map((r) => (
                  <Button
                    key={r}
                    type="button"
                    variant={draft.resolution === r ? "default" : "secondary"}
                    size="sm"
                    onClick={() => setDraft((d) => ({ ...d, resolution: r }))}
                  >
                    {r === "QUOTE_PENDING" ? "Needs quote" : r.slice(0, 1) + r.slice(1).toLowerCase()}
                  </Button>
                ))}
              </div>
            </div>
          </div>

          {draft.resolution === "STANDARD" && (
            <div className="grid grid-cols-2 gap-4">
              <div>
                <Label>Tariff item (optional)</Label>
                <select
                  className="mt-1 h-10 w-full rounded-md border border-input bg-background px-3 text-sm"
                  value={draft.tariffId ?? ""}
                  onChange={(e) => {
                    const tariffId = e.target.value || null;
                    const t = tariffs?.find((x) => x.id === tariffId);
                    setDraft((d) => ({
                      ...d,
                      tariffId,
                      amount: t ? t.defaultPrice.toString() : d.amount,
                      description: d.description || t?.name || "",
                    }));
                  }}
                >
                  <option value="">— none —</option>
                  {tariffs?.map((t) => (
                    <option key={t.id} value={t.id}>
                      {t.name} — {formatCurrency(Number(t.defaultPrice))}
                    </option>
                  ))}
                </select>
                {selectedTariff?.description && <p className="caption mt-1">{selectedTariff.description}</p>}
              </div>
              <div>
                <Label>Amount (A$)</Label>
                <Input
                  type="number"
                  inputMode="decimal"
                  value={draft.amount}
                  onChange={(e) => setDraft((d) => ({ ...d, amount: e.target.value }))}
                />
              </div>
            </div>
          )}

          {draft.resolution === "QUOTE_PENDING" && (
            <div>
              <Label>Acknowledged cap (A$)</Label>
              <Input
                type="number"
                inputMode="decimal"
                value={draft.quoteCap}
                onChange={(e) => setDraft((d) => ({ ...d, quoteCap: e.target.value }))}
              />
              <p className="caption mt-1">
                The customer authorises a charge up to this amount once the mechanic quote is finalised.
              </p>
            </div>
          )}

          <div>
            <Label>Staff note (optional)</Label>
            <Input
              value={draft.note}
              onChange={(e) => setDraft((d) => ({ ...d, note: e.target.value }))}
              placeholder="Internal notes for this line"
            />
          </div>

          {err && (
            <div className="rounded-md border border-destructive/30 bg-destructive/10 p-3 text-sm text-destructive">
              {err}
            </div>
          )}

          <Button onClick={addCharge} disabled={upsertCharge.isPending}>
            {upsertCharge.isPending ? "Adding…" : "Add to assessment"}
          </Button>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="h3">Damage lines</CardTitle>
        </CardHeader>
        <CardContent>
          {(!assessment.damageCharges || assessment.damageCharges.length === 0) ? (
            <p className="caption">No damage charges yet.</p>
          ) : (
            <div className="divide-y">
              {assessment.damageCharges.map((c) => (
                <div key={c.id} className="flex items-center justify-between gap-4 py-3 text-sm">
                  <div className="flex-1">
                    <div className="font-medium">{c.description}</div>
                    <div className="flex flex-wrap items-center gap-1.5 text-xs text-muted-foreground">
                      <StatusBadge status={c.severity as StatusKey} />
                      <span>· {c.resolution.replace("_", " ")}</span>
                      {c.damageTariff ? <span>· {c.damageTariff.name}</span> : null}
                    </div>
                    {c.staffNote && <div className="caption mt-1">{c.staffNote}</div>}
                  </div>
                  <div className="text-right text-sm font-medium">
                    {c.resolution === "QUOTE_PENDING"
                      ? `up to ${formatCurrency(Number(c.quoteCapAmount ?? 0))}`
                      : formatCurrency(Number(c.amount))}
                  </div>
                  <Button type="button" variant="ghost" size="sm" onClick={() => remove(c.id)}>
                    Remove
                  </Button>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="h3">Fees</CardTitle>
        </CardHeader>
        <CardContent className="space-y-1 text-sm">
          <Row label="Late return fee" value={formatCurrency(fees.data?.lateFee ?? 0)} />
          <Row label="Fuel shortfall" value={formatCurrency(fees.data?.fuelCharge ?? 0)} />
          {fees.data && (
            <p className="caption mt-2">
              Pickup fuel: {fees.data.pickupFuel}% · Return fuel: {fees.data.returnFuel}%
              {fees.data.lateHours > 0 ? ` · Late ${Math.floor(fees.data.lateHours)}h` : ""}
            </p>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="h3">Totals</CardTitle>
        </CardHeader>
        <CardContent className="space-y-1 text-sm">
          <Row label="Standard damage charges" value={formatCurrency(standardTotal)} />
          <Row label="Late + fuel" value={formatCurrency((fees.data?.lateFee ?? 0) + (fees.data?.fuelCharge ?? 0))} />
          <Row label="Total due now" value={formatCurrency(totalDueNow)} bold />
          <Row label="Pending quote cap (not yet charged)" value={formatCurrency(pendingCapTotal)} />
        </CardContent>
      </Card>

      <div className="hidden gap-3 md:flex">
        <Button asChild>
          <Link href={`/staff/bookings/${id}/check-in/sign`}>Proceed to sign →</Link>
        </Button>
        <Button variant="ghost" onClick={() => router.push(`/staff/bookings/${id}/check-in`)}>
          Back to overview
        </Button>
      </div>

      <MobileBottomBar>
        <Button asChild className="flex-1">
          <Link href={`/staff/bookings/${id}/check-in/sign`}>Proceed to sign</Link>
        </Button>
      </MobileBottomBar>
    </PageShell>
  );
}

function sideLabel(s: string): string {
  return s.charAt(0) + s.slice(1).toLowerCase();
}

function Row({ label, value, bold }: { label: string; value: string; bold?: boolean }) {
  return (
    <div className={`flex justify-between ${bold ? "border-t pt-1 font-semibold" : ""}`}>
      <span className="text-muted-foreground">{label}</span>
      <span>{value}</span>
    </div>
  );
}
