"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { ArrowUpDown, Loader2 } from "lucide-react";
import { trpc } from "@/lib/trpc/client";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { formatCurrency } from "@/lib/utils";

type Mode = "CHARGE_DELTA" | "GOODWILL_FREE_UPGRADE" | "MANAGER_PRICE_OVERRIDE";
type GoodwillReason = "SERVICE_RECOVERY" | "FLEET_REASSIGNMENT" | "RETENTION" | "OTHER";

type Props = {
  bookingId: string;
  status: string;
  currentCategoryId: string;
  currentCategoryName: string;
  /** Managers see all modes + may execute downgrades; staff get upgrades only. */
  canManage: boolean;
};

const MODE_LABELS: Record<Mode, { label: string; hint: string }> = {
  CHARGE_DELTA: {
    label: "Charge the difference",
    hint: "Reprices the hire at the new category; the delta is charged (or refunded by a manager).",
  },
  GOODWILL_FREE_UPGRADE: {
    label: "Goodwill free upgrade",
    hint: "Customer keeps their price while moving up a category. Manager only; audited.",
  },
  MANAGER_PRICE_OVERRIDE: {
    label: "Manager price override",
    hint: "Charge a custom delta instead of the quoted one. Manager only; needs a reason.",
  },
};

const GOODWILL_REASON_LABELS: Record<GoodwillReason, string> = {
  SERVICE_RECOVERY: "Service recovery",
  FLEET_REASSIGNMENT: "Fleet reassignment",
  RETENTION: "Retention",
  OTHER: "Other",
};

/**
 * Area 4: counter / pre-pickup category change on a CONFIRMED booking.
 * Live preview via `staffBooking.amendCategoryPreview` shows the quoted
 * delta, the eligibility verdict against the new category and the depot's
 * availability before Confirm. The server re-gates every role rule.
 */
export function ChangeCategoryDialog({
  bookingId,
  status,
  currentCategoryId,
  currentCategoryName,
  canManage,
}: Props) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [newCategoryId, setNewCategoryId] = useState("");
  const [mode, setMode] = useState<Mode>("CHARGE_DELTA");
  const [goodwillReason, setGoodwillReason] = useState<GoodwillReason>("SERVICE_RECOVERY");
  const [goodwillNote, setGoodwillNote] = useState("");
  const [managerDeltaRaw, setManagerDeltaRaw] = useState("");
  const [overrideReason, setOverrideReason] = useState("");
  const [error, setError] = useState<string | null>(null);

  const managerDelta = useMemo(() => {
    if (mode !== "MANAGER_PRICE_OVERRIDE") return undefined;
    if (managerDeltaRaw.trim() === "") return undefined;
    const n = Number(managerDeltaRaw);
    return Number.isFinite(n) ? Math.round(n * 100) / 100 : undefined;
  }, [mode, managerDeltaRaw]);

  const categories = trpc.vehicle.listCategories.useQuery(undefined, {
    enabled: open,
    staleTime: 60_000,
  });

  const previewEnabled =
    open &&
    newCategoryId !== "" &&
    newCategoryId !== currentCategoryId &&
    (mode !== "MANAGER_PRICE_OVERRIDE" || managerDelta !== undefined);
  const preview = trpc.staffBooking.amendCategoryPreview.useQuery(
    { bookingId, newCategoryId, mode, managerDelta },
    { enabled: previewEnabled, retry: false },
  );

  const amend = trpc.staffBooking.amendCategory.useMutation({
    onSuccess: () => {
      setOpen(false);
      router.refresh();
    },
    onError: (e) => setError(e instanceof Error ? e.message : "Category change failed"),
  });

  if (status !== "CONFIRMED") return null;

  const q = preview.data;
  const modeFieldsValid =
    mode === "CHARGE_DELTA" ||
    (mode === "GOODWILL_FREE_UPGRADE" && goodwillNote.trim().length >= 3) ||
    (mode === "MANAGER_PRICE_OVERRIDE" &&
      managerDelta !== undefined &&
      overrideReason.trim().length >= 3);
  const staffBlockedDowngrade = !canManage && !!q && q.delta < 0;
  const canSubmit =
    !!q &&
    q.eligibility.ok &&
    q.availability.ok &&
    modeFieldsValid &&
    !staffBlockedDowngrade &&
    !amend.isPending;

  const submit = () => {
    setError(null);
    amend.mutate({
      bookingId,
      newCategoryId,
      mode,
      ...(mode === "GOODWILL_FREE_UPGRADE"
        ? { goodwillReason, goodwillNote: goodwillNote.trim() }
        : {}),
      ...(mode === "MANAGER_PRICE_OVERRIDE"
        ? { managerDelta, overrideReason: overrideReason.trim() }
        : {}),
    });
  };

  const visibleModes: Mode[] = canManage
    ? ["CHARGE_DELTA", "GOODWILL_FREE_UPGRADE", "MANAGER_PRICE_OVERRIDE"]
    : ["CHARGE_DELTA"];

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="outline" size="sm">
          <ArrowUpDown className="mr-1.5 h-3.5 w-3.5" aria-hidden />
          Change category
        </Button>
      </DialogTrigger>
      <DialogContent className="max-h-[90vh] max-w-xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Change vehicle category</DialogTitle>
          <DialogDescription>
            Reprices the whole hire at the new category over the same dates and depots.
            Add-ons carry over and insurance keeps its booked price. Any pre-assigned
            vehicle is released; allocation happens at check-out.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-1.5">
          <Label htmlFor="amend-category">New category</Label>
          <Select value={newCategoryId || undefined} onValueChange={setNewCategoryId}>
            <SelectTrigger id="amend-category">
              <SelectValue placeholder={`Currently: ${currentCategoryName}`} />
            </SelectTrigger>
            <SelectContent>
              {(categories.data ?? [])
                .filter((c) => c.id !== currentCategoryId)
                .map((c) => (
                  <SelectItem key={c.id} value={c.id}>
                    {c.name}
                  </SelectItem>
                ))}
            </SelectContent>
          </Select>
          {categories.isLoading && (
            <p className="text-xs text-muted-foreground">Loading categories…</p>
          )}
        </div>

        {visibleModes.length > 1 && (
          <fieldset className="space-y-2">
            <legend className="text-sm font-medium">Pricing mode</legend>
            {visibleModes.map((m) => (
              <label key={m} className="flex items-start gap-2 text-sm">
                <input
                  type="radio"
                  name="amend-mode"
                  className="mt-0.5"
                  checked={mode === m}
                  onChange={() => setMode(m)}
                />
                <span>
                  {MODE_LABELS[m].label}
                  <span className="block text-xs text-muted-foreground">
                    {MODE_LABELS[m].hint}
                  </span>
                </span>
              </label>
            ))}
          </fieldset>
        )}

        {mode === "GOODWILL_FREE_UPGRADE" && (
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="amend-goodwill-reason">Goodwill reason</Label>
              <Select
                value={goodwillReason}
                onValueChange={(v) => setGoodwillReason(v as GoodwillReason)}
              >
                <SelectTrigger id="amend-goodwill-reason">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {(Object.keys(GOODWILL_REASON_LABELS) as GoodwillReason[]).map((r) => (
                    <SelectItem key={r} value={r}>
                      {GOODWILL_REASON_LABELS[r]}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="amend-goodwill-note">Note (required)</Label>
              <Input
                id="amend-goodwill-note"
                value={goodwillNote}
                onChange={(e) => setGoodwillNote(e.target.value)}
                placeholder="e.g. original bike written off, keeping their price"
              />
            </div>
          </div>
        )}

        {mode === "MANAGER_PRICE_OVERRIDE" && (
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="amend-override-delta">Delta to charge (A$)</Label>
              <Input
                id="amend-override-delta"
                type="number"
                step="0.01"
                value={managerDeltaRaw}
                onChange={(e) => setManagerDeltaRaw(e.target.value)}
                placeholder="Negative = refund"
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="amend-override-reason">Reason (required)</Label>
              <Input
                id="amend-override-reason"
                value={overrideReason}
                onChange={(e) => setOverrideReason(e.target.value)}
                placeholder="e.g. price-matched a quoted rate"
              />
            </div>
          </div>
        )}

        {/* Live server preview */}
        <div className="rounded-md border bg-muted/30 p-3 text-sm">
          {!previewEnabled && (
            <span className="text-muted-foreground">
              Pick a new category to see the price and eligibility preview.
            </span>
          )}
          {previewEnabled && preview.isLoading && (
            <span className="flex items-center gap-2 text-muted-foreground">
              <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden /> Calculating…
            </span>
          )}
          {preview.error && (
            <span className="text-destructive">{preview.error.message}</span>
          )}
          {q && (
            <div className="space-y-2">
              <dl className="grid grid-cols-2 gap-x-4 gap-y-1">
                <dt className="text-muted-foreground">Current total</dt>
                <dd className="text-right tabular-nums">{formatCurrency(q.oldTotal)}</dd>
                <dt className="text-muted-foreground">Quoted at {q.newCategoryName}</dt>
                <dd className="text-right tabular-nums">{formatCurrency(q.newQuotedTotal)}</dd>
                <dt className="text-muted-foreground">
                  {mode === "GOODWILL_FREE_UPGRADE" ? "Delta (waived)" : "Delta to settle"}
                </dt>
                <dd
                  className={`text-right tabular-nums ${
                    q.delta > 0 ? "" : q.delta < 0 ? "text-destructive" : ""
                  }`}
                >
                  {mode === "GOODWILL_FREE_UPGRADE"
                    ? `${formatCurrency(0)} (value ${formatCurrency(Math.max(0, q.quotedDelta))})`
                    : formatCurrency(q.delta)}
                </dd>
                {q.creditAmount > 0 && (
                  <>
                    <dt className="text-muted-foreground">Refund to customer</dt>
                    <dd className="text-right tabular-nums">{formatCurrency(q.creditAmount)}</dd>
                  </>
                )}
                <dt className="text-muted-foreground">Bond</dt>
                <dd className="text-right tabular-nums">
                  {formatCurrency(q.oldBondAmount)} → {formatCurrency(q.newBondAmount)}
                </dd>
                <dt className="text-muted-foreground">Availability</dt>
                <dd className={`text-right ${q.availability.ok ? "" : "text-destructive"}`}>
                  {q.availability.available} of {q.availability.total} free
                </dd>
                <dt className="text-muted-foreground">Eligibility</dt>
                <dd className={`text-right ${q.eligibility.ok ? "" : "text-destructive"}`}>
                  {q.eligibility.ok ? "Eligible" : "Blocked"}
                </dd>
              </dl>
              {!q.eligibility.ok && q.eligibility.message && (
                <p className="text-xs text-destructive">{q.eligibility.message}</p>
              )}
              {q.eligibility.warnings.map((w) => (
                <p key={w} className="text-xs text-muted-foreground">
                  {w}
                </p>
              ))}
              {q.bondHeld && q.newBondAmount !== q.oldBondAmount && (
                <p className="text-xs text-muted-foreground">
                  The current bond hold is kept as-is and re-authorised at the new amount
                  at check-out.
                </p>
              )}
              {q.vehicleWillUnassign && (
                <p className="text-xs text-muted-foreground">
                  The pre-assigned vehicle will be released; a {q.newCategoryName} is
                  allocated at check-out.
                </p>
              )}
              {q.agreementWillSupersede && (
                <p className="text-xs text-muted-foreground">
                  The signed rental agreement will be superseded — it must be re-signed at
                  check-out.
                </p>
              )}
              {staffBlockedDowngrade && (
                <p className="text-xs text-destructive">
                  This change refunds the customer — a manager must perform downgrades.
                </p>
              )}
            </div>
          )}
        </div>

        {error && <p className="text-sm text-destructive">{error}</p>}

        <DialogFooter>
          <Button variant="ghost" onClick={() => setOpen(false)} disabled={amend.isPending}>
            Cancel
          </Button>
          <Button onClick={submit} disabled={!canSubmit}>
            {amend.isPending && (
              <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" aria-hidden />
            )}
            Change category
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
