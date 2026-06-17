import Link from "next/link";
import { notFound } from "next/navigation";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { Button } from "@/components/ui/button";
import { StatusBadge, type StatusKey } from "@/components/ui/status-badge";
import { PageHeader } from "@/components/layout/page-header";
import { PageSection, PageShell } from "@/components/layout/page-section";
import { formatCurrency, formatDateTime } from "@/lib/utils";
import { BookingMoneySummary } from "@/components/customer/booking-money-summary";
import { BookingVehicleCard } from "@/components/customer/booking-vehicle-card";
import { BookingTimeline } from "@/components/customer/booking-timeline";
import { BookingStickyActions } from "@/components/customer/booking-sticky-actions";
import { BookingDocumentsSection } from "@/components/booking/booking-documents-section";
import { getBranding } from "@/lib/branding";
import {
  isPostRentalCharge,
  paymentTypeLabel,
} from "@/lib/payment-labels";

function ChargeRow({
  label,
  value,
  emphasis,
}: {
  label: string;
  value: string;
  emphasis?: "total";
}) {
  return (
    <div
      className={
        emphasis === "total"
          ? "flex items-center justify-between gap-4 border-t pt-2 font-semibold"
          : "flex items-center justify-between gap-4"
      }
    >
      <dt className={emphasis === "total" ? "" : "text-muted-foreground"}>
        {label}
      </dt>
      <dd className={emphasis === "total" ? "text-primary" : ""}>{value}</dd>
    </div>
  );
}

export default async function BookingDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const session = await auth();
  const booking = await prisma.booking.findUnique({
    where: { id },
    include: {
      category: true,
      vehicle: {
        include: {
          images: {
            orderBy: [{ isPrimary: "desc" }, { displayOrder: "asc" }],
          },
        },
      },
      pickupDepot: true,
      returnDepot: true,
      addons: { include: { addon: true } },
      insurance: { include: { insuranceOption: true } },
      payments: { orderBy: { createdAt: "asc" } },
      billingPlan: true,
      statusLog: { orderBy: { timestamp: "asc" } },
      bondLedger: true,
    },
  });
  if (!booking || booking.customerId !== session!.user.id) notFound();

  const branding = await getBranding();
  const supportHref = branding.supportEmail
    ? `mailto:${branding.supportEmail}?subject=Booking%20${encodeURIComponent(booking.bookingReference)}`
    : "/contact";

  return (
    <PageShell className="max-w-3xl">
      <PageHeader
        breadcrumbs={[
          { label: "Bookings", href: "/dashboard/bookings" },
          { label: booking.bookingReference },
        ]}
        title={booking.bookingReference}
        actions={<StatusBadge status={booking.status as StatusKey} />}
      />

      <BookingStickyActions
        bookingId={booking.id}
        bookingReference={booking.bookingReference}
        status={booking.status}
        pickupDateTime={booking.pickupDateTime}
        returnDateTime={booking.returnDateTime}
        isExtensionChild={Boolean(booking.extensionOfId)}
        hasSubscription={Boolean(booking.subscriptionId)}
        supportHref={supportHref}
      />

      <BookingMoneySummary
        amountPaid={booking.amountPaid}
        balanceDue={booking.balanceDue}
        bondAmount={booking.bondAmount}
        bondLedger={booking.bondLedger}
      />

      <BookingVehicleCard
        vehicle={booking.vehicle}
        categoryName={booking.category.name}
        categoryImageUrl={booking.category.images[0] ?? null}
      />

      <PageSection title="Pickup & return">
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-1">
            <p className="text-[11px] uppercase tracking-wide text-muted-foreground">
              Pickup
            </p>
            <p className="text-sm font-medium">
              {formatDateTime(booking.pickupDateTime)}
            </p>
            <p className="text-sm text-muted-foreground">
              {booking.pickupDepot.name}
            </p>
          </div>
          <div className="space-y-1">
            <p className="text-[11px] uppercase tracking-wide text-muted-foreground">
              Return
            </p>
            <p className="text-sm font-medium">
              {formatDateTime(booking.returnDateTime)}
            </p>
            <p className="text-sm text-muted-foreground">
              {booking.returnDepot.name}
            </p>
          </div>
        </div>
        <p className="text-xs text-muted-foreground">
          {booking.durationDays} day{booking.durationDays === 1 ? "" : "s"}
          {booking.isDelivery && " · Delivery"}
        </p>
      </PageSection>

      <PageSection title="Activity">
        <BookingTimeline booking={booking} />
      </PageSection>

      <PageSection title="Charges" collapsible defaultOpen={false}>
        <dl className="space-y-2 text-sm">
          <ChargeRow
            label="Subtotal"
            value={formatCurrency(Number(booking.subtotal))}
          />
          {Number(booking.addonTotal) > 0 && (
            <ChargeRow
              label="Add-ons"
              value={formatCurrency(Number(booking.addonTotal))}
            />
          )}
          {Number(booking.insuranceTotal) > 0 && (
            <ChargeRow
              label="Insurance"
              value={formatCurrency(Number(booking.insuranceTotal))}
            />
          )}
          {Number(booking.discountAmount) > 0 && (
            <ChargeRow
              label="Discount"
              value={`-${formatCurrency(Number(booking.discountAmount))}`}
            />
          )}
          <ChargeRow
            label="GST incl."
            value={formatCurrency(Number(booking.gstAmount))}
          />
          <ChargeRow
            label="Total"
            value={formatCurrency(Number(booking.totalAmount))}
            emphasis="total"
          />
        </dl>
      </PageSection>

      {(() => {
        const additional = booking.payments.filter((p) =>
          isPostRentalCharge(p.type),
        );
        if (additional.length === 0) return null;
        return (
          <PageSection title="Additional charges" collapsible defaultOpen={true}>
            <p className="text-xs text-muted-foreground">
              Charges added to your booking after pickup — tolls, late
              return, fuel, damage, and other ancillaries. Pending charges
              are taken from your card on file once captured.
            </p>
            <ul className="divide-y text-sm">
              {additional.map((p) => {
                // Customer-facing labels for payment lifecycle: SUCCEEDED
                // reads as "Paid" rather than "Succeeded" in this context.
                const badgeLabel =
                  p.status === "SUCCEEDED" ? "Paid" : undefined;
                return (
                  <li
                    key={p.id}
                    className="flex flex-col gap-1 py-3 sm:flex-row sm:items-start sm:justify-between sm:gap-4"
                  >
                    <div className="space-y-0.5">
                      <div className="font-medium capitalize">
                        {paymentTypeLabel(p.type)}
                      </div>
                      {p.notes && (
                        <div className="text-xs text-muted-foreground">
                          {p.notes}
                        </div>
                      )}
                      <div className="text-xs text-muted-foreground">
                        {formatDateTime(p.createdAt)}
                      </div>
                    </div>
                    <div className="flex items-center gap-3 sm:flex-col sm:items-end sm:gap-1">
                      <span className="tabular-nums font-medium">
                        {formatCurrency(Number(p.amount))}
                      </span>
                      <StatusBadge
                        status={p.status as StatusKey}
                        label={badgeLabel}
                      />
                    </div>
                  </li>
                );
              })}
            </ul>
          </PageSection>
        );
      })()}

      {booking.addons.length > 0 && (
        <PageSection title="Add-ons" collapsible defaultOpen={false}>
          <dl className="space-y-2 text-sm">
            {booking.addons.map((a) => (
              <div
                key={a.id}
                className="flex items-center justify-between gap-4"
              >
                <dt className="text-muted-foreground">
                  {a.addon.name} × {a.quantity}
                </dt>
                <dd>{formatCurrency(Number(a.totalPrice))}</dd>
              </div>
            ))}
          </dl>
        </PageSection>
      )}

      {booking.billingPlan && (
        <PageSection title="Recurring charges">
          <p className="text-sm text-muted-foreground">
            This is a long-term hire. Your first{" "}
            {booking.billingPlan.frequency.toLowerCase().replace(/ly$/, "")} of
            hire plus any one-time fees were paid up front. We&apos;ll charge
            your card on file{" "}
            <strong>
              {formatCurrency(Number(booking.billingPlan.amountPerPeriod))}
            </strong>{" "}
            {booking.billingPlan.frequency.toLowerCase()} for{" "}
            {booking.billingPlan.periodsTotal -
              booking.billingPlan.periodsCompleted}{" "}
            more period
            {booking.billingPlan.periodsTotal -
              booking.billingPlan.periodsCompleted ===
            1
              ? ""
              : "s"}
            .
          </p>
          <dl className="grid gap-2 text-sm sm:grid-cols-2">
            <div className="flex items-center justify-between gap-4 sm:justify-start sm:gap-2">
              <dt className="text-muted-foreground">Next charge</dt>
              <dd>{formatDateTime(booking.billingPlan.nextChargeAt)}</dd>
            </div>
            <div className="flex items-center justify-between gap-4 sm:justify-start sm:gap-2">
              <dt className="text-muted-foreground">Status</dt>
              <dd>
                <StatusBadge
                  status={booking.billingPlan.status as StatusKey}
                />
              </dd>
            </div>
          </dl>
        </PageSection>
      )}

      <PageSection title="Documents">
        <BookingDocumentsSection bookingId={booking.id} mode="customer" />
      </PageSection>

      <div className="flex flex-wrap items-center justify-between gap-3 pt-2">
        <Button asChild variant="secondary">
          <Link href="/dashboard/bookings">Back</Link>
        </Button>
        <Link
          href={supportHref}
          className="text-sm text-muted-foreground hover:text-foreground"
        >
          Need help with this booking?
        </Link>
      </div>
    </PageShell>
  );
}
