"use client";
import { use, useMemo, useState } from "react";
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

function toLocalInputValue(d: Date): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export default function ExtendBookingPage(props: {
  params: Promise<{ id: string }>;
}) {
  const { id } = use(props.params);
  const router = useRouter();
  const { data: b, isLoading } = trpc.staffBooking.detail.useQuery({ id });
  const [newReturn, setNewReturn] = useState<string>("");
  const [err, setErr] = useState<string | null>(null);
  const [ok, setOk] = useState(false);

  const parsedReturn = useMemo(() => {
    if (!newReturn) return null;
    const d = new Date(newReturn);
    return isNaN(d.getTime()) ? null : d;
  }, [newReturn]);

  const quote = trpc.staffBooking.quoteExtend.useQuery(
    {
      bookingId: id,
      newReturnDateTime: parsedReturn ?? new Date(),
    },
    {
      enabled:
        !!parsedReturn &&
        !!b &&
        parsedReturn.getTime() > new Date(b.returnDateTime).getTime(),
      retry: false,
    },
  );

  const extend = trpc.booking.extend.useMutation({
    onSuccess: () => {
      setOk(true);
      setTimeout(() => router.push(`/staff/bookings/${id}`), 800);
    },
    onError: (e) => setErr(e instanceof Error ? e.message : "Extend failed"),
  });

  if (isLoading) return <LoadingBlock padded="lg" />;
  if (!b) return <div className="p-8 text-muted-foreground">Not found</div>;

  const canExtend = ["CONFIRMED", "CHECKED_OUT", "ACTIVE"].includes(b.status);
  const minReturn = new Date(b.returnDateTime);
  const minReturnInput = toLocalInputValue(
    new Date(minReturn.getTime() + 60 * 60 * 1000),
  );

  if (!canExtend) {
    return (
      <PageShell className="max-w-2xl">
        <PageHeader
          breadcrumbs={[
            { label: "Bookings", href: "/staff/calendar" },
            { label: b.bookingReference, href: `/staff/bookings/${id}` },
            { label: "Extend" },
          ]}
          title={`Extend — ${b.bookingReference}`}
        />
        <Card>
          <CardContent className="py-6 text-sm text-muted-foreground">
            Booking is in status <StatusBadge status={b.status as StatusKey} />
            — extensions are only supported for CONFIRMED, CHECKED_OUT, or
            ACTIVE bookings.
          </CardContent>
        </Card>
        <Button variant="secondary" asChild>
          <Link href={`/staff/bookings/${id}`}>Back</Link>
        </Button>
      </PageShell>
    );
  }

  return (
    <PageShell className="max-w-3xl">
      <PageHeader
        breadcrumbs={[
          { label: "Bookings", href: "/staff/calendar" },
          { label: b.bookingReference, href: `/staff/bookings/${id}` },
          { label: "Extend" },
        ]}
        title={`Extend — ${b.bookingReference}`}
        actions={<StatusBadge status={b.status as StatusKey} />}
      />

      <Card>
        <CardHeader>
          <CardTitle className="h3">Current booking</CardTitle>
        </CardHeader>
        <CardContent className="space-y-1 text-sm">
          <div>
            {b.customer.firstName} {b.customer.lastName}
          </div>
          <div>
            {b.category.name} · {b.vehicle ? `${b.vehicle.internalCode} · ${b.vehicle.rego}` : "no vehicle allocated"}
          </div>
          <div>Current return: {formatDateTime(b.returnDateTime)}</div>
          <div>
            Paid: {formatCurrency(Number(b.amountPaid))} / Total:{" "}
            {formatCurrency(Number(b.totalAmount))}
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="h3">New return</CardTitle>
        </CardHeader>
        <CardContent className="space-y-2">
          <Label htmlFor="newReturn">New return date & time</Label>
          <Input
            id="newReturn"
            type="datetime-local"
            value={newReturn}
            min={minReturnInput}
            onChange={(e) => {
              setNewReturn(e.target.value);
              setErr(null);
            }}
          />
          <p className="text-xs text-muted-foreground">
            Must be after the current return ({formatDateTime(b.returnDateTime)}).
          </p>
        </CardContent>
      </Card>

      {parsedReturn && (
        <Card>
          <CardHeader>
            <CardTitle className="h3">Extension quote</CardTitle>
          </CardHeader>
          <CardContent className="space-y-1 text-sm">
            {quote.isLoading && (
              <div className="text-muted-foreground">Checking availability…</div>
            )}
            {quote.error && (
              <div className="text-destructive">{quote.error.message}</div>
            )}
            {quote.data && (
              <>
                <div className="flex justify-between">
                  <span>Extra days</span>
                  <span>{quote.data.quote.extensionDays}</span>
                </div>
                <div className="flex justify-between">
                  <span>Daily rate (tier)</span>
                  <span>{formatCurrency(quote.data.quote.baseRate)}</span>
                </div>
                {quote.data.quote.addonExtension > 0 && (
                  <div className="flex justify-between">
                    <span>Addons (per-day)</span>
                    <span>{formatCurrency(quote.data.quote.addonExtension)}</span>
                  </div>
                )}
                {quote.data.quote.insuranceExtension > 0 && (
                  <div className="flex justify-between">
                    <span>Insurance (per-day)</span>
                    <span>
                      {formatCurrency(quote.data.quote.insuranceExtension)}
                    </span>
                  </div>
                )}
                <div className="flex justify-between font-semibold border-t pt-2">
                  <span>Extension total (inc. GST)</span>
                  <span>{formatCurrency(quote.data.quote.totalAmount)}</span>
                </div>
                <div className="flex justify-between text-muted-foreground pt-2">
                  <span>New booking total</span>
                  <span>{formatCurrency(quote.data.newTotal)}</span>
                </div>
                <div className="flex justify-between text-muted-foreground">
                  <span>New balance due</span>
                  <span>{formatCurrency(quote.data.newBalanceDue)}</span>
                </div>
              </>
            )}
          </CardContent>
        </Card>
      )}

      {err && (
        <div className="rounded-md border border-destructive/30 bg-destructive/10 p-3 text-sm text-destructive">
          {err}
        </div>
      )}
      {ok && (
        <div className="rounded-md border border-primary/30 bg-primary/10 p-3 text-sm">
          Extended — redirecting…
        </div>
      )}

      <div className="flex gap-3">
        <Button
          disabled={!parsedReturn || !quote.data || extend.isPending || ok}
          onClick={() => {
            if (!parsedReturn) return;
            setErr(null);
            extend.mutate({
              bookingId: id,
              newReturnDateTime: parsedReturn,
            });
          }}
        >
          {extend.isPending ? "Extending…" : "Confirm extension"}
        </Button>
        <Button variant="secondary" asChild>
          <Link href={`/staff/bookings/${id}`}>Back</Link>
        </Button>
      </div>
    </PageShell>
  );
}
