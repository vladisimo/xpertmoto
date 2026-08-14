import Link from "next/link";
import { notFound } from "next/navigation";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { StatusBadge } from "@/components/ui/status-badge";
import { PageHeader } from "@/components/layout/page-header";
import { PageShell } from "@/components/layout/page-section";
import { Tabs, TabsContent, TabsTrigger } from "@/components/ui/tabs";
import { MobileScrollTabs } from "@/components/ui/mobile-scroll-tabs";
import { formatCurrency, formatDateTime } from "@/lib/utils";
import { StatusActions } from "@/components/staff/booking-status-actions";
import { BookingNotes } from "@/components/staff/booking-notes";
import { BookingTabActivity } from "@/components/staff/booking-tab-activity";
import { UnallocatedVehicleBanner } from "@/components/staff/unallocated-vehicle-banner";
import { PaymentConsole } from "@/components/staff/payment-console";
import { SwapVehicleButton } from "@/components/staff/swap-vehicle-button";
import { TerminateForLossDialog } from "@/components/staff/terminate-for-loss-dialog";
import { BookingSwapHistory } from "@/components/staff/booking-swap-history";
import { BookingHeaderActions } from "@/components/staff/booking-header-actions";
import { InvoiceResendButton } from "@/components/staff/invoice-resend-button";
import { EarlyReturnRefundBanner } from "@/components/staff/early-return-refund-banner";
import { BondAgeBanner } from "@/components/staff/bond-age-banner";
import { BookingDocumentsSection } from "@/components/booking/booking-documents-section";
import { DisputePanel } from "@/components/staff/dispute-panel";
import { DocumentViewerButton } from "@/components/shared/document-viewer-dialog";
import { BookingTripPanel } from "@/components/staff/booking-trip-panel";
import type { StatusKey } from "@/components/ui/status-badge";

const VALID_TABS = ["overview", "payments", "agreements", "activity", "trip", "notes"] as const;
type BookingTab = (typeof VALID_TABS)[number];

export default async function StaffBookingDetail({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ tab?: string }>;
}) {
  const { id } = await params;
  const { tab } = await searchParams;
  const initialTab: BookingTab = VALID_TABS.includes(tab as BookingTab) ? (tab as BookingTab) : "overview";
  const b = await prisma.booking.findUnique({
    where: { id },
    include: {
      customer: { include: { customerProfile: true } },
      vehicle: true,
      category: true,
      depot: true,
      pickupDepot: true,
      returnDepot: true,
      addons: { include: { addon: true } },
      insurance: { include: { insuranceOption: true } },
      payments: { orderBy: { createdAt: "desc" } },
      inspections: {
        orderBy: { dateTime: "desc" },
        include: { inspector: { select: { firstName: true, lastName: true } } },
      },
      incidents: { orderBy: { dateTime: "desc" } },
      infringements: { orderBy: { offenceDate: "desc" } },
      invoices: { orderBy: { createdAt: "desc" } },
      adjustmentNotes: {
        where: { deletedAt: null },
        orderBy: { issuedAt: "desc" },
        select: {
          id: true,
          adjustmentNumber: true,
          type: true,
          reason: true,
          description: true,
          totalAmount: true,
          status: true,
          issuedAt: true,
        },
      },
      bookingNotes: {
        orderBy: { createdAt: "desc" },
        include: { user: { select: { firstName: true, lastName: true, role: true } } },
      },
      rentalAgreements: { orderBy: { version: "desc" }, include: { staff: { select: { firstName: true, lastName: true } } } },
      returnAssessments: { orderBy: { version: "desc" }, include: { damageCharges: true } },
      bondLedger: true,
      billingPlan: true,
      // A DRAFT swap acts as a soft lock — surface it so the swap button can
      // offer to resume the in-progress draft rather than start a new one.
      swaps: { where: { status: "DRAFT" }, select: { id: true }, take: 1 },
      createdBy: { select: { firstName: true, lastName: true } },
      confirmedBy: { select: { firstName: true, lastName: true } },
      checkedOutBy: { select: { firstName: true, lastName: true } },
      checkedInBy: { select: { firstName: true, lastName: true } },
      cancelledBy: { select: { firstName: true, lastName: true } },
    },
  });
  if (!b) notFound();

  // The authoritative GPS51 track pull is a managerProcedure — gate the button
  // so staff don't see an action that would just error.
  const session = await auth();
  const canFetchAuthoritative = ["MANAGER", "ADMIN", "SUPER_ADMIN"].includes(
    session?.user?.role ?? "",
  );

  const bondDeductions = Array.isArray(b.bondLedger?.deductions)
    ? (b.bondLedger!.deductions as Array<{ reason?: string; amount?: number }>)
    : [];

  const snap = (b.pricingSnapshot ?? {}) as {
    baseRate?: number;
    baseSubtotal?: number;
    durationDays?: number;
    durationDiscountPct?: number;
    seasonMultiplier?: number;
    subtotalExGst?: number;
    gstAmount?: number;
    addonTotal?: number;
    insuranceTotal?: number;
    deliveryFee?: number;
    discountAmount?: number;
    bondAmount?: number;
    totalAmount?: number;
    lineItems?: Array<{ label: string; qty?: number; unit?: number; amount: number }>;
  };
  const hasSnapshot = Object.keys(snap).length > 0;

  const activityCount = b.inspections.length + b.incidents.length + b.infringements.length;
  const paymentsCount = b.payments.length + b.invoices.length;
  const agreementsCount = b.rentalAgreements.length + b.returnAssessments.length;

  // Money summary — always visible above the tabs so the booking's financial
  // status reads at a glance regardless of which tab is active.
  const balanceDue = Number(b.balanceDue);
  const bondHeld = b.bondLedger ? Number(b.bondLedger.heldAmount) : 0;
  const bondCaptured = b.bondLedger ? Number(b.bondLedger.capturedAmount) : 0;
  const bondReleased = b.bondLedger ? Number(b.bondLedger.releasedAmount) : 0;
  // What's still actually held on the customer's card — once captures and
  // releases net out the original authorisation, nothing remains held.
  const bondRemaining = Math.max(0, bondHeld - bondCaptured - bondReleased);
  const isPlanTerminal =
    b.billingPlan?.status === "CANCELLED" || b.billingPlan?.status === "COMPLETED";

  // Tolls are Infringement rows of type TOLL; everything else is a fine.
  // "Open" = not yet PAID or WRITTEN_OFF, i.e. still needs staff attention.
  const isInfringementOpen = (s: string) => s !== "PAID" && s !== "WRITTEN_OFF";
  const tollItems = b.infringements.filter((i) => i.type === "TOLL");
  const fineItems = b.infringements.filter((i) => i.type !== "TOLL");
  const tollsTotal = tollItems.reduce((acc, i) => acc + Number(i.amount), 0);
  const tollsOpen = tollItems.filter((i) => isInfringementOpen(i.status)).length;
  const finesTotal = fineItems.reduce((acc, i) => acc + Number(i.amount), 0);
  const finesOpen = fineItems.filter((i) => isInfringementOpen(i.status)).length;
  const incidentsOpen = b.incidents.filter(
    (i) => i.status !== "RESOLVED" && i.status !== "CLOSED",
  ).length;
  const incidentsExposure = b.incidents.reduce(
    (acc, i) => acc + Number(i.customerChargeAmount ?? i.estimatedDamageCost ?? 0),
    0,
  );

  return (
    <PageShell>
      <PageHeader
        breadcrumbs={[
          { label: "Bookings", href: "/staff/calendar" },
          { label: b.bookingReference },
        ]}
        title={b.bookingReference}
        description={`${b.category.name} · ${b.pickupDepot.name} → ${b.returnDepot.name}`}
        actions={
          <>
            <StatusBadge status={b.status as StatusKey} />
            <Badge variant="outline">{b.source.replace(/_/g, " ")}</Badge>
            {b.isDelivery && <Badge variant="outline">Delivery</Badge>}
            {b.extensionOfId && <Badge variant="outline">Extension</Badge>}
            <StatusActions
              bookingId={b.id}
              status={b.status}
              hasVehicle={!!b.vehicleId}
              pickupDateTime={b.pickupDateTime.toISOString()}
              returnDateTime={b.returnDateTime.toISOString()}
              balanceDue={Number(b.balanceDue)}
              hasSignedReturnAssessment={b.returnAssessments.some(
                (a) => a.status === "SIGNED" || a.status === "FINALISED",
              )}
            />
          </>
        }
      />

      {!b.vehicleId && ["ACTIVE", "CHECKED_OUT"].includes(b.status) && (
        <UnallocatedVehicleBanner bookingId={b.id} />
      )}

      <div className="flex flex-wrap items-start gap-3">
        <BookingHeaderActions
          bookingId={b.id}
          status={b.status}
          currentVehicleLabel={
            b.vehicle ? `${b.vehicle.internalCode} · ${b.vehicle.rego}` : null
          }
        />
        <SwapVehicleButton
          bookingId={b.id}
          status={b.status}
          hasVehicle={!!b.vehicleId}
          hasPendingSwap={b.swaps.length > 0}
        />
        <TerminateForLossDialog
          bookingId={b.id}
          status={b.status}
          canTerminate={canFetchAuthoritative}
          incidents={b.incidents.map((i) => ({
            id: i.id,
            incidentNumber: i.incidentNumber,
            type: i.type,
            customerLiable: i.customerLiable,
          }))}
        />
      </div>

      {/* Always-visible money summary — mirrors the cards previously inside
          the Payments tab so booking status reads at a glance. */}
      <div className="-mt-2 grid grid-cols-2 gap-3 sm:-mt-3 sm:grid-cols-3 lg:-mt-4 lg:grid-cols-6">
        <div className="rounded-md border bg-muted/30 p-3">
          <div className="caption">Balance due</div>
          <div className="h2 tabular-nums">{formatCurrency(balanceDue)}</div>
        </div>
        <div className="rounded-md border bg-muted/30 p-3">
          <div className="caption">Bond held</div>
          <div className="h2 tabular-nums">{formatCurrency(bondRemaining)}</div>
          {b.bondLedger && (
            <div className="caption mt-1">
              Captured {formatCurrency(bondCaptured)} · Released {formatCurrency(bondReleased)}
            </div>
          )}
        </div>
        <div className="rounded-md border bg-muted/30 p-3">
          <div className="caption">Next recurring charge</div>
          <div className="h3 tabular-nums">
            {!b.billingPlan || isPlanTerminal
              ? "—"
              : formatDateTime(b.billingPlan.nextChargeAt)}
          </div>
          {b.billingPlan && (
            <div className="caption mt-1">
              {isPlanTerminal
                ? `Plan ${b.billingPlan.status.toLowerCase()}`
                : `${formatCurrency(Number(b.billingPlan.amountPerPeriod))} · ${b.billingPlan.frequency.toLowerCase()}`}
            </div>
          )}
        </div>
        <div className="rounded-md border bg-muted/30 p-3">
          <div className="caption">Tolls</div>
          <div className={`h2 tabular-nums ${tollsOpen > 0 ? "text-destructive" : ""}`}>
            {tollItems.length === 0 ? "—" : formatCurrency(tollsTotal)}
          </div>
          <div className="caption mt-1">
            {tollItems.length === 0
              ? "None recorded"
              : `${tollItems.length} toll${tollItems.length === 1 ? "" : "s"} · ${tollsOpen} unrecovered`}
          </div>
        </div>
        <div className="rounded-md border bg-muted/30 p-3">
          <div className="caption">Infringements</div>
          <div className={`h2 tabular-nums ${finesOpen > 0 ? "text-destructive" : ""}`}>
            {fineItems.length === 0 ? "—" : formatCurrency(finesTotal)}
          </div>
          <div className="caption mt-1">
            {fineItems.length === 0
              ? "None recorded"
              : `${fineItems.length} fine${fineItems.length === 1 ? "" : "s"} · ${finesOpen} open`}
          </div>
        </div>
        <div className="rounded-md border bg-muted/30 p-3">
          <div className="caption">Incidents</div>
          <div className={`h2 tabular-nums ${incidentsOpen > 0 ? "text-destructive" : ""}`}>
            {b.incidents.length === 0 ? "—" : b.incidents.length}
          </div>
          <div className="caption mt-1">
            {b.incidents.length === 0
              ? "None reported"
              : `${incidentsOpen} open${incidentsExposure > 0 ? ` · ${formatCurrency(incidentsExposure)} exposure` : ""}`}
          </div>
        </div>
      </div>

      <Tabs defaultValue={initialTab}>
        <MobileScrollTabs>
          <TabsTrigger value="overview">Overview</TabsTrigger>
          <TabsTrigger value="payments" className="gap-1.5">
            Payments & charges
            {paymentsCount > 0 && <Badge variant="outline">{paymentsCount}</Badge>}
          </TabsTrigger>
          <TabsTrigger value="agreements" className="gap-1.5">
            Documents
            {agreementsCount > 0 && <Badge variant="outline">{agreementsCount}</Badge>}
          </TabsTrigger>
          <TabsTrigger value="activity" className="gap-1.5">
            Activity
            {activityCount > 0 && <Badge variant="outline">{activityCount}</Badge>}
          </TabsTrigger>
          {b.vehicleId && <TabsTrigger value="trip">Trip</TabsTrigger>}
          <TabsTrigger value="notes" className="gap-1.5">
            Notes & audit
            {b.bookingNotes.length > 0 && <Badge variant="outline">{b.bookingNotes.length}</Badge>}
          </TabsTrigger>
        </MobileScrollTabs>

        <TabsContent value="overview" className="space-y-6">
          <div className="grid gap-6 md:grid-cols-2 xl:grid-cols-3">
            <Card>
              <CardHeader><CardTitle className="h3">Customer</CardTitle></CardHeader>
              <CardContent className="space-y-1 text-sm">
                <div className="font-semibold">{b.customer.firstName} {b.customer.lastName}</div>
                <div className="text-muted-foreground">{b.customer.email} · {b.customer.phone ?? "—"}</div>
                <div className="text-muted-foreground">
                  Licence: {b.customer.customerProfile?.licenceNumber ?? "—"} ({b.customer.customerProfile?.licenceState ?? "—"})
                  {b.customer.customerProfile?.licenceVerifiedAt ? " ✅ verified" : " ⏳ unverified"}
                </div>
                {b.customer.customerProfile?.licenceExpiry && (
                  <div className="text-xs text-muted-foreground">
                    Expires: {formatDateTime(b.customer.customerProfile.licenceExpiry)}
                  </div>
                )}
                {b.customer.customerProfile?.riskRating && (
                  <div className="text-xs">Risk: <span className="font-medium">{b.customer.customerProfile.riskRating}</span></div>
                )}
                <div className="pt-2">
                  <Link
                    href={`/staff/customers/${b.customer.id}`}
                    className="text-sm font-medium text-primary hover:underline"
                  >
                    View customer profile →
                  </Link>
                </div>
              </CardContent>
            </Card>

            <Card>
              <CardHeader><CardTitle className="h3">Ride</CardTitle></CardHeader>
              <CardContent className="space-y-1 text-sm">
                <div>{b.category.name}{b.vehicle && ` — ${b.vehicle.internalCode} (${b.vehicle.rego})`}</div>
                <div className="text-muted-foreground">{b.pickupDepot.name} → {b.returnDepot.name}</div>
                <div>Pickup: {formatDateTime(b.pickupDateTime)}</div>
                <div>Return: {formatDateTime(b.returnDateTime)}</div>
                <div className="text-muted-foreground">Duration: {b.durationDays} days</div>
                {b.actualPickupDateTime && (
                  <div className="text-xs text-muted-foreground">Checked out: {formatDateTime(b.actualPickupDateTime)}</div>
                )}
                {b.actualReturnDateTime && (
                  <div className="text-xs text-muted-foreground">Returned: {formatDateTime(b.actualReturnDateTime)}</div>
                )}
                {(b.pickupOdometerKm !== null || b.returnOdometerKm !== null) && (
                  <div className="text-xs text-muted-foreground">
                    Odometer: {b.pickupOdometerKm ?? "—"} → {b.returnOdometerKm ?? "—"} km
                    {b.pickupOdometerKm !== null && b.returnOdometerKm !== null && (
                      <span> ({b.returnOdometerKm - b.pickupOdometerKm} km used)</span>
                    )}
                  </div>
                )}
              </CardContent>
            </Card>

            <Card>
              <CardHeader><CardTitle className="h3">Charges</CardTitle></CardHeader>
              <CardContent className="space-y-1 text-sm">
                <Row label="Subtotal" value={formatCurrency(Number(b.subtotal))} />
                {Number(b.addonTotal) > 0 && <Row label="Add-ons" value={formatCurrency(Number(b.addonTotal))} />}
                {Number(b.insuranceTotal) > 0 && <Row label="Insurance" value={formatCurrency(Number(b.insuranceTotal))} />}
                {Number(b.deliveryFee) > 0 && <Row label="Delivery fee" value={formatCurrency(Number(b.deliveryFee))} />}
                {Number(b.discountAmount) > 0 && <Row label="Discount" value={`-${formatCurrency(Number(b.discountAmount))}`} />}
                <Row label="GST (incl.)" value={formatCurrency(Number(b.gstAmount))} />
                <Row label="Total" value={formatCurrency(Number(b.totalAmount))} bold />
                <Row label="Paid" value={formatCurrency(Number(b.amountPaid))} />
                <Row label="Balance" value={formatCurrency(Number(b.balanceDue))} tone={Number(b.balanceDue) > 0 ? "warn" : undefined} />
                <div className="flex items-center justify-between">
                  <span className="text-muted-foreground">Bond</span>
                  <span className="flex items-center gap-2">
                    {formatCurrency(Number(b.bondAmount))}
                    {b.bondLedger?.status && <StatusBadge status={b.bondLedger.status as StatusKey} />}
                  </span>
                </div>
                {bondDeductions.length > 0 && (
                  <div className="mt-1 border-t pt-2">
                    <div className="mb-1 text-xs text-muted-foreground">Bond deductions</div>
                    {bondDeductions.map((d, i) => (
                      <div key={i} className="flex justify-between text-xs">
                        <span>{d.reason ?? "—"}</span>
                        <span>{formatCurrency(Number(d.amount ?? 0))}</span>
                      </div>
                    ))}
                  </div>
                )}
              </CardContent>
            </Card>

            <Card>
              <CardHeader><CardTitle className="h3">Verification</CardTitle></CardHeader>
              <CardContent className="space-y-1 text-sm">
                <div className="flex justify-between"><span>ID verified</span><span>{b.customerIdVerified ? "✅" : "—"}</span></div>
                <div className="flex justify-between"><span>Licence verified</span><span>{b.licenceVerified ? "✅" : "—"}</span></div>
                <div className="flex justify-between"><span>Terms agreed (website)</span><span>{b.agreedToTerms ? `✅ ${b.termsVersion ?? ""}` : "—"}</span></div>
                {b.isDelivery && (
                  <>
                    <div className="mt-1 border-t pt-2 text-xs text-muted-foreground">Delivery</div>
                    <div className="text-xs">{b.deliveryAddress ?? "—"}</div>
                    <div className="text-xs">Fee: {formatCurrency(Number(b.deliveryFee))}</div>
                  </>
                )}
              </CardContent>
            </Card>

            {(b.addons.length > 0 || b.insurance.length > 0) && (
              <Card>
                <CardHeader><CardTitle className="h3">Add-ons &amp; insurance</CardTitle></CardHeader>
                <CardContent className="space-y-1 text-sm">
                  {b.addons.map((a) => (
                    <div key={a.id} className="flex justify-between">
                      <span>{a.addon.name} × {a.quantity}</span>
                      <span>{formatCurrency(Number(a.totalPrice))}</span>
                    </div>
                  ))}
                  {b.insurance.map((i) => (
                    <div key={i.id} className="flex justify-between">
                      <span>Insurance: {i.insuranceOption.name}</span>
                      <span>{formatCurrency(Number(i.totalPrice))}</span>
                    </div>
                  ))}
                </CardContent>
              </Card>
            )}

            <Card>
              <CardHeader><CardTitle className="h3">People on this booking</CardTitle></CardHeader>
              <CardContent className="grid gap-1 text-sm">
                <Row label="Created by" value={fullName(b.createdBy) ?? "—"} />
                <Row label="Confirmed by" value={fullName(b.confirmedBy) ?? "—"} />
                <Row label="Checked out by" value={fullName(b.checkedOutBy) ?? "—"} />
                <Row label="Checked in by" value={fullName(b.checkedInBy) ?? "—"} />
                {b.cancelledBy && <Row label="Cancelled by" value={fullName(b.cancelledBy) ?? "—"} />}
                {b.cancellationReason && <Row label="Cancel reason" value={b.cancellationReason} />}
              </CardContent>
            </Card>
          </div>
        </TabsContent>

        <TabsContent value="payments" className="space-y-6">
          {b.incidents.length > 0 && (
            <DisputePanel
              incidents={b.incidents.map((i) => ({
                id: i.id,
                incidentNumber: i.incidentNumber,
                type: i.type,
                status: i.status,
                severity: i.severity,
                dateTime: i.dateTime.toISOString(),
                description: i.description,
                estimatedDamageCost:
                  i.estimatedDamageCost === null ? null : Number(i.estimatedDamageCost),
                resolvedAt: i.resolvedAt ? i.resolvedAt.toISOString() : null,
                resolution: i.resolution,
              }))}
            />
          )}
          {b.bondLedger && (
            <BondAgeBanner
              bondCreatedAt={b.bondLedger.createdAt.toISOString()}
              bondStatus={b.bondLedger.status}
              cardBrand={b.customer.customerProfile?.stripePaymentMethodBrand ?? null}
            />
          )}
          <EarlyReturnRefundBanner
            bookingId={b.id}
            status={b.status}
            refundablePayments={b.payments
              .filter(
                (p) =>
                  p.status === "SUCCEEDED" &&
                  (p.type === "BOOKING_PAYMENT" || p.type === "EXTENSION"),
              )
              .map((p) => ({
                id: p.id,
                reference: p.reference,
                amount: Number(p.amount),
              }))}
          />
          {/* Phase B — interactive payment console. Replaces the read-only
              list + RecordPaymentInline popover with one cohesive surface. */}
          <PaymentConsole
            bookingId={b.id}
            bookingStatus={b.status}
            payments={b.payments.map((p) => ({
              id: p.id,
              reference: p.reference,
              type: p.type,
              method: p.method,
              amount: Number(p.amount),
              status: p.status as StatusKey,
              notes: p.notes,
              stripeChargeId: p.stripeChargeId,
              createdAt: p.createdAt.toISOString(),
            }))}
            bondLedger={
              b.bondLedger
                ? {
                    heldAmount: Number(b.bondLedger.heldAmount),
                    capturedAmount: Number(b.bondLedger.capturedAmount),
                    releasedAmount: Number(b.bondLedger.releasedAmount),
                    status: b.bondLedger.status as StatusKey,
                    deductions: b.bondLedger.deductions,
                  }
                : null
            }
            billingPlan={
              b.billingPlan
                ? {
                    id: b.billingPlan.id,
                    frequency: b.billingPlan.frequency,
                    amountPerPeriod: Number(b.billingPlan.amountPerPeriod),
                    periodsTotal: b.billingPlan.periodsTotal,
                    periodsCompleted: b.billingPlan.periodsCompleted,
                    nextChargeAt: b.billingPlan.nextChargeAt.toISOString(),
                    status: b.billingPlan.status,
                    pauseReason: b.billingPlan.pauseReason,
                  }
                : null
            }
            chargesAside={
              <Card>
                <CardHeader><CardTitle className="h3">Invoices &amp; adjustment notes</CardTitle></CardHeader>
                <CardContent className="space-y-1 text-sm">
                  {b.invoices.length === 0 && b.adjustmentNotes.length === 0 && (
                    <p className="text-muted-foreground">No invoices yet.</p>
                  )}
                  {b.invoices.map((inv) => (
                    <div key={inv.id} className="flex justify-between border-b py-1 last:border-0">
                      <span>{inv.invoiceNumber}</span>
                      <div className="flex items-center gap-2 text-right">
                        <span>{formatCurrency(Number(inv.totalAmount))}</span>
                        <StatusBadge status={inv.status as StatusKey} />
                        <InvoiceResendButton invoiceId={inv.id} />
                      </div>
                    </div>
                  ))}
                  {b.adjustmentNotes.map((adj) => {
                    const signed =
                      adj.type === "DECREASE"
                        ? -Number(adj.totalAmount)
                        : Number(adj.totalAmount);
                    return (
                      <div key={adj.id} className="flex justify-between border-b py-1 last:border-0">
                        <span>
                          {adj.adjustmentNumber}
                          <span className="caption ml-2">
                            {adj.type === "DECREASE" ? "Credit" : "Debit"} · {adj.reason.replace(/_/g, " ").toLowerCase()}
                          </span>
                        </span>
                        <div className="flex items-center gap-2 text-right">
                          <span className="tabular-nums">{formatCurrency(signed)}</span>
                          <StatusBadge status={adj.status as StatusKey} />
                        </div>
                      </div>
                    );
                  })}
                </CardContent>
              </Card>
            }
            bondAside={
              hasSnapshot ? (
                <Card>
                  <CardHeader>
                    <CardTitle className="h3">Pricing breakdown</CardTitle>
                    <p className="caption">Snapshot taken when booking was created — source of truth for this rental.</p>
                  </CardHeader>
                  <CardContent className="space-y-4 text-sm">
                    {snap.lineItems && snap.lineItems.length > 0 && (
                      <div>
                        <div className="eyebrow mb-1">Line items</div>
                        <div className="divide-y">
                          {snap.lineItems.map((li, i) => (
                            <div key={i} className="flex justify-between py-1">
                              <span>
                                {li.label}
                                {li.qty !== undefined && li.unit !== undefined && (
                                  <span className="text-xs text-muted-foreground"> · {li.qty} × {formatCurrency(li.unit)}</span>
                                )}
                              </span>
                              <span>{formatCurrency(Number(li.amount))}</span>
                            </div>
                          ))}
                        </div>
                      </div>
                    )}

                    <div className="grid gap-x-8 gap-y-1 sm:grid-cols-2">
                      {snap.baseRate !== undefined && <Row label="Base daily rate" value={formatCurrency(snap.baseRate)} />}
                      {snap.durationDays !== undefined && <Row label="Duration" value={`${snap.durationDays} day${snap.durationDays === 1 ? "" : "s"}`} />}
                      {snap.seasonMultiplier !== undefined && snap.seasonMultiplier !== 1 && (
                        <Row label="Season multiplier" value={`× ${snap.seasonMultiplier}`} />
                      )}
                      {snap.durationDiscountPct !== undefined && snap.durationDiscountPct !== 0 && (
                        <Row label="Duration discount" value={`${Math.round(snap.durationDiscountPct * 100)}%`} />
                      )}
                      {snap.baseSubtotal !== undefined && <Row label="Base subtotal" value={formatCurrency(snap.baseSubtotal)} />}
                      {snap.addonTotal !== undefined && snap.addonTotal > 0 && <Row label="Add-ons" value={formatCurrency(snap.addonTotal)} />}
                      {snap.insuranceTotal !== undefined && snap.insuranceTotal > 0 && <Row label="Insurance" value={formatCurrency(snap.insuranceTotal)} />}
                      {snap.deliveryFee !== undefined && snap.deliveryFee > 0 && <Row label="Delivery fee" value={formatCurrency(snap.deliveryFee)} />}
                      {snap.discountAmount !== undefined && snap.discountAmount > 0 && (
                        <Row label="Discount" value={`-${formatCurrency(snap.discountAmount)}`} />
                      )}
                      {snap.subtotalExGst !== undefined && <Row label="Subtotal ex GST" value={formatCurrency(snap.subtotalExGst)} />}
                      {snap.gstAmount !== undefined && <Row label="GST (10%)" value={formatCurrency(snap.gstAmount)} />}
                      {snap.bondAmount !== undefined && <Row label="Bond" value={formatCurrency(snap.bondAmount)} />}
                      {snap.totalAmount !== undefined && <Row label="Total (GST incl.)" value={formatCurrency(snap.totalAmount)} bold />}
                    </div>
                  </CardContent>
                </Card>
              ) : null
            }
          />
        </TabsContent>

        <TabsContent value="agreements" className="space-y-6">
          <Card>
            <CardHeader>
              <CardTitle className="h3">All documents</CardTitle>
            </CardHeader>
            <CardContent>
              <BookingDocumentsSection bookingId={id} mode="staff" />
            </CardContent>
          </Card>

          <div className="grid gap-6 md:grid-cols-2">
            <Card>
              <CardHeader><CardTitle className="h3">Rental agreement</CardTitle></CardHeader>
              <CardContent className="space-y-2 text-sm">
                {b.rentalAgreements.length === 0 ? (
                  <div className="caption">Not yet started.</div>
                ) : (
                  b.rentalAgreements.map((a) => (
                    <div key={a.id} className="border-b pb-2 last:border-b-0 last:pb-0">
                      <div className="flex justify-between">
                        <span>
                          <strong>{a.agreementNumber}</strong>
                          <span className="ml-1 text-xs text-muted-foreground">v{a.version}</span>
                        </span>
                        <StatusBadge status={a.status as StatusKey} />
                      </div>
                      {a.signedAt && (
                        <div className="text-xs text-muted-foreground">Signed {formatDateTime(a.signedAt)}</div>
                      )}
                      {a.staff && (
                        <div className="text-xs text-muted-foreground">Witness: {a.staff.firstName} {a.staff.lastName}</div>
                      )}
                      {a.timestampStatus === "OK" && a.timestampedAt && (
                        <div className="text-xs text-primary">RFC3161 timestamped {formatDateTime(a.timestampedAt)}</div>
                      )}
                      {a.timestampStatus === "FAILED" && (
                        <div className="text-xs text-destructive">Timestamping failed</div>
                      )}
                      {a.pdfUrl && (
                        <DocumentViewerButton
                          fileUrl={`/api/bookings/${id}/rental-agreement?version=${a.version}`}
                          title={`Rental agreement ${a.agreementNumber}`}
                          description={`v${a.version}`}
                          kind="pdf"
                          variant="link"
                          size="sm"
                          className="h-auto px-0"
                        >
                          View PDF
                        </DocumentViewerButton>
                      )}
                    </div>
                  ))
                )}
              </CardContent>
            </Card>

            <Card>
              <CardHeader><CardTitle className="h3">Return assessment</CardTitle></CardHeader>
              <CardContent className="space-y-2 text-sm">
                {b.returnAssessments.length === 0 ? (
                  <div className="caption">No return assessment yet.</div>
                ) : (
                  b.returnAssessments.map((a) => (
                    <div key={a.id} className="border-b pb-2 last:border-b-0 last:pb-0">
                      <div className="flex justify-between">
                        <span>
                          <strong>{a.assessmentNumber}</strong>
                          <span className="ml-1 text-xs text-muted-foreground">v{a.version}</span>
                        </span>
                        <StatusBadge status={a.status as StatusKey} />
                      </div>
                      {a.signedAt && <div className="text-xs text-muted-foreground">Signed {formatDateTime(a.signedAt)}</div>}
                      <div className="text-xs">
                        Due now: {formatCurrency(Number(a.customerTotalDueNow))}
                        {Number(a.pendingQuoteCap) > 0 && ` · Pending cap ${formatCurrency(Number(a.pendingQuoteCap))}`}
                      </div>
                      <div className="text-xs text-muted-foreground">
                        {a.damageCharges.length} damage line(s)
                      </div>
                      {a.timestampStatus === "OK" && a.timestampedAt && (
                        <div className="text-xs text-primary">RFC3161 timestamped {formatDateTime(a.timestampedAt)}</div>
                      )}
                      {a.pdfUrl && (
                        <DocumentViewerButton
                          fileUrl={`/api/bookings/${id}/return-assessment`}
                          title={`Return assessment ${a.assessmentNumber}`}
                          description={`v${a.version}`}
                          kind="pdf"
                          variant="link"
                          size="sm"
                          className="h-auto px-0"
                        >
                          View PDF
                        </DocumentViewerButton>
                      )}
                    </div>
                  ))
                )}
              </CardContent>
            </Card>
          </div>
        </TabsContent>

        <TabsContent value="activity" className="space-y-6">
          <BookingSwapHistory bookingId={b.id} />
          <div className="grid gap-6 md:grid-cols-2 xl:grid-cols-3">
            <Card>
              <CardHeader><CardTitle className="h3">Inspections</CardTitle></CardHeader>
              <CardContent className="space-y-2 text-sm">
                {b.inspections.length === 0 ? (
                  <p className="text-muted-foreground">No inspections.</p>
                ) : (
                  b.inspections.map((i) => (
                    <div key={i.id} className="flex justify-between border-b pb-2 last:border-0">
                      <div>
                        <div className="flex flex-wrap items-center gap-1.5 font-medium">
                          <span>{i.type.replace(/_/g, " ")}</span>
                          <StatusBadge status={i.overallCondition as StatusKey} />
                        </div>
                        <div className="text-xs text-muted-foreground">
                          {formatDateTime(i.dateTime)} · by {i.inspector.firstName} {i.inspector.lastName} · {i.odometerKm} km · fuel {i.fuelLevel}%
                        </div>
                      </div>
                      <StatusBadge status={i.status as StatusKey} />
                    </div>
                  ))
                )}
              </CardContent>
            </Card>

            <Card>
              <CardHeader><CardTitle className="h3">Incidents</CardTitle></CardHeader>
              <CardContent className="space-y-2 text-sm">
                {b.incidents.length === 0 ? (
                  <p className="text-muted-foreground">No incidents.</p>
                ) : (
                  b.incidents.map((i) => (
                    <Link key={i.id} href={`/staff/incidents/${i.id}`} className="-mx-2 block rounded px-2 pb-2 hover:bg-muted/40 [&:not(:last-child)]:border-b">
                      <div className="flex justify-between">
                        <span className="font-medium">{i.incidentNumber} — {i.type.replace(/_/g, " ")}</span>
                        <StatusBadge status={i.severity as StatusKey} />
                      </div>
                      <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
                        <span>{formatDateTime(i.dateTime)}</span>
                        <span>·</span>
                        <StatusBadge status={i.status as StatusKey} />
                        {i.customerChargeAmount && (
                          <span>· charge {formatCurrency(Number(i.customerChargeAmount))}</span>
                        )}
                      </div>
                      <div className="line-clamp-2 text-xs">{i.description}</div>
                    </Link>
                  ))
                )}
              </CardContent>
            </Card>

            <Card>
              <CardHeader><CardTitle className="h3">Infringements</CardTitle></CardHeader>
              <CardContent className="space-y-2 text-sm">
                {b.infringements.length === 0 ? (
                  <p className="text-muted-foreground">No infringements.</p>
                ) : (
                  b.infringements.map((i) => (
                    <div key={i.id} className="flex justify-between border-b pb-2 last:border-0">
                      <div>
                        <div className="font-medium">{i.referenceNumber} — {i.type.replace(/_/g, " ")}</div>
                        <div className="text-xs text-muted-foreground">
                          {formatDateTime(i.offenceDate)} · {i.issuer}
                        </div>
                      </div>
                      <div className="flex items-center gap-2 text-right text-xs">
                        <span>{formatCurrency(Number(i.amount))}</span>
                        <StatusBadge status={i.status as StatusKey} />
                      </div>
                    </div>
                  ))
                )}
              </CardContent>
            </Card>
          </div>
        </TabsContent>

        {b.vehicleId && (
          <TabsContent value="trip" className="space-y-6">
            <BookingTripPanel bookingId={b.id} canFetchAuthoritative={canFetchAuthoritative} />
          </TabsContent>
        )}

        <TabsContent value="notes" className="space-y-6">
          <div className="space-y-6">
            <div className="md:max-w-2xl">
              <BookingNotes
                bookingId={b.id}
                initialNotes={b.bookingNotes.map((n) => ({
                  id: n.id,
                  note: n.note,
                  isInternal: n.isInternal,
                  createdAt: n.createdAt.toISOString(),
                  user: n.user,
                }))}
              />
            </div>

            <BookingTabActivity bookingId={b.id} />
          </div>
        </TabsContent>
      </Tabs>
    </PageShell>
  );
}

function fullName(u: { firstName: string; lastName: string } | null | undefined) {
  return u ? `${u.firstName} ${u.lastName}` : null;
}

function Row({ label, value, bold, tone }: { label: string; value: string; bold?: boolean; tone?: "warn" }) {
  return (
    <div className={`flex justify-between ${bold ? "border-t pt-1 font-semibold" : ""}`}>
      <span className="text-muted-foreground">{label}</span>
      <span className={tone === "warn" ? "text-destructive" : ""}>{value}</span>
    </div>
  );
}
