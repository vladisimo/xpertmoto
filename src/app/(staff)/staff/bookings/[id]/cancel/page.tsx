"use client";
import { use, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { trpc } from "@/lib/trpc/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { StatusBadge, type StatusKey } from "@/components/ui/status-badge";
import { PageHeader } from "@/components/layout/page-header";
import { PageShell } from "@/components/layout/page-section";
import { LoadingBlock } from "@/components/ui/spinner";
import { formatCurrency, formatDateTime } from "@/lib/utils";

export default function CancelBookingPage(props: { params: Promise<{ id: string }> }) {
  const { id } = use(props.params);
  const router = useRouter();
  const { data: b, isLoading } = trpc.staffBooking.detail.useQuery({ id });
  const cancel = trpc.staffBooking.cancel.useMutation();
  const [reason, setReason] = useState("");
  const [err, setErr] = useState<string | null>(null);
  const [result, setResult] = useState<{ refundAmount: number; refundPct: number } | null>(null);
  const [refundMeta, setRefundMeta] = useState<{ hoursUntilPickup: number; tier: { label: string; pct: number } } | null>(null);

  useEffect(() => {
    if (!b) return;
    const hours = (new Date(b.pickupDateTime).getTime() - Date.now()) / (1000 * 60 * 60);
    const tier =
      hours > 72
        ? { label: "Full refund − $25 admin", pct: 100 }
        : hours > 24
          ? { label: "50% refund − $25 admin", pct: 50 }
          : { label: "No refund", pct: 0 };
    setRefundMeta({ hoursUntilPickup: hours, tier });
  }, [b]);

  if (isLoading) return <LoadingBlock padded="lg" />;
  if (!b) return <div className="p-8 text-muted-foreground">Not found</div>;
  const hoursUntilPickup = refundMeta?.hoursUntilPickup ?? 0;
  const tier = refundMeta?.tier ?? { label: "Calculating…", pct: 0 };

  async function submit() {
    setErr(null);
    try {
      const res = await cancel.mutateAsync({ bookingId: id, reason });
      setResult({ refundAmount: res.refundAmount, refundPct: res.refundPct });
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Cancel failed");
    }
  }

  if (result) {
    return (
      <PageShell className="max-w-2xl">
        <PageHeader
          breadcrumbs={[
            { label: "Bookings", href: "/staff/calendar" },
            { label: b.bookingReference, href: `/staff/bookings/${id}` },
            { label: "Cancelled" },
          ]}
          title="Booking cancelled"
        />
        <Card>
          <CardHeader><CardTitle className="h3">Refund</CardTitle></CardHeader>
          <CardContent className="space-y-1 text-sm">
            <div className="flex justify-between"><span>Refund %</span><span>{Math.round(result.refundPct * 100)}%</span></div>
            <div className="flex justify-between font-semibold"><span>Refund amount</span><span>{formatCurrency(result.refundAmount)}</span></div>
          </CardContent>
        </Card>
        <div className="flex gap-3">
          <Button onClick={() => router.push(`/staff/bookings/${id}`)}>Back to booking</Button>
        </div>
      </PageShell>
    );
  }

  return (
    <PageShell className="max-w-3xl">
      <PageHeader
        breadcrumbs={[
          { label: "Bookings", href: "/staff/calendar" },
          { label: b.bookingReference, href: `/staff/bookings/${id}` },
          { label: "Cancel" },
        ]}
        title={`Cancel — ${b.bookingReference}`}
        actions={<StatusBadge status={b.status as StatusKey} />}
      />

      <Card>
        <CardHeader><CardTitle className="h3">Booking</CardTitle></CardHeader>
        <CardContent className="space-y-1 text-sm">
          <div>{b.customer.firstName} {b.customer.lastName}</div>
          <div>{b.category.name} · pickup {formatDateTime(b.pickupDateTime)}</div>
          <div>Paid: {formatCurrency(Number(b.amountPaid))} / Total: {formatCurrency(Number(b.totalAmount))}</div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle className="h3">Refund policy</CardTitle></CardHeader>
        <CardContent className="space-y-1 text-sm">
          <div>Hours until pickup: {Math.round(hoursUntilPickup)}</div>
          <div>Applies: <span className="font-medium">{tier.label}</span></div>
          <ul className="mt-2 space-y-0.5 text-xs text-muted-foreground">
            <li>• &gt;72h before pickup: full refund minus A$25 admin fee</li>
            <li>• 24–72h: 50% refund minus A$25 admin fee</li>
            <li>• &lt;24h: no refund</li>
          </ul>
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle className="h3">Reason</CardTitle></CardHeader>
        <CardContent className="space-y-2">
          <Label htmlFor="reason">Cancellation reason</Label>
          <Input id="reason" value={reason} onChange={(e) => setReason(e.target.value)} placeholder="e.g. Customer illness" />
        </CardContent>
      </Card>

      {err && (
        <div className="rounded-md border border-destructive/30 bg-destructive/10 p-3 text-sm text-destructive">
          {err}
        </div>
      )}

      <div className="flex gap-3">
        <Button variant="destructive" disabled={!reason.trim() || cancel.isPending} onClick={submit}>
          {cancel.isPending ? "Cancelling…" : "Confirm cancellation"}
        </Button>
        <Button variant="secondary" asChild>
          <Link href={`/staff/bookings/${id}`}>Back</Link>
        </Button>
      </div>
    </PageShell>
  );
}
