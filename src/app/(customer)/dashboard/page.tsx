import Link from "next/link";
import Image from "next/image";
import { Calendar, CalendarPlus, Download, FileText, MapPin, Plus } from "lucide-react";
import type { PaymentType } from "@prisma/client";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { CalloutCard } from "@/components/ui/callout-card";
import { StatusBadge, type StatusKey } from "@/components/ui/status-badge";
import { PageSection, PageShell } from "@/components/layout/page-section";
import { formatCurrency, formatDate, formatDateTime } from "@/lib/utils";
import { googleCalendarUrl } from "@/lib/calendar";
import { getBranding } from "@/lib/branding";
import { paymentTypeLabel } from "@/lib/payment-labels";
import { SetPasswordBanner } from "@/components/customer/set-password-banner";
import { BookingVehicleThumbnail } from "@/components/customer/booking-vehicle-thumbnail";
import { BookingCtaText } from "@/components/booking/booking-cta";

function daysAgo(from: Date, to: Date) {
  const a = new Date(from.getFullYear(), from.getMonth(), from.getDate()).getTime();
  const b = new Date(to.getFullYear(), to.getMonth(), to.getDate()).getTime();
  return Math.max(0, Math.round((b - a) / 86_400_000));
}

function joinList(items: string[]) {
  if (items.length <= 1) return items.join("");
  if (items.length === 2) return `${items[0]} and ${items[1]}`;
  return `${items.slice(0, -1).join(", ")}, and ${items[items.length - 1]}`;
}

function formatRelative(from: Date, to: Date): { label: string; imminent: boolean } {
  const ms = to.getTime() - from.getTime();
  if (ms <= 0) return { label: "now", imminent: true };
  const minutes = Math.floor(ms / 60_000);
  if (minutes < 60) return { label: `${minutes} min${minutes === 1 ? "" : "s"}`, imminent: true };
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return { label: `${hours} hour${hours === 1 ? "" : "s"}`, imminent: true };
  const days = Math.floor(hours / 24);
  return { label: `${days} day${days === 1 ? "" : "s"}`, imminent: days <= 2 };
}

export default async function CustomerDashboard() {
  const session = await auth();
  const [upcoming, outstanding, me, branding] = await Promise.all([
    prisma.booking.findMany({
      where: {
        customerId: session!.user.id,
        status: { in: ["CONFIRMED", "PENDING_PAYMENT", "CHECKED_OUT", "ACTIVE"] },
        returnDateTime: { gte: new Date() },
      },
      include: {
        category: true,
        pickupDepot: true,
        returnDepot: true,
        vehicle: {
          select: {
            make: true,
            model: true,
            year: true,
            rego: true,
            regoState: true,
            colour: true,
            images: {
              where: { isPrimary: true },
              select: { url: true },
              take: 1,
            },
            catalogueModel: {
              select: {
                documents: {
                  where: { type: "OWNERS_MANUAL" },
                  select: { fileUrl: true, title: true },
                  orderBy: { fetchedAt: "desc" },
                  take: 1,
                },
              },
            },
          },
        },
      },
      orderBy: { pickupDateTime: "asc" },
      take: 5,
    }),
    prisma.payment.findMany({
      where: {
        customerId: session!.user.id,
        status: { in: ["PENDING", "FAILED"] },
        type: {
          in: [
            "LATE_FEE",
            "FUEL_CHARGE",
            "DAMAGE_CHARGE",
            "INFRINGEMENT_RECOVERY",
            "MANUAL_CHARGE",
            "EXTENSION",
            "CLEANING_FEE",
            "SUBSCRIPTION_CHARGE",
            "BOOKING_PAYMENT",
          ],
        },
      },
      select: {
        id: true,
        type: true,
        amount: true,
        status: true,
        createdAt: true,
        bookingId: true,
        booking: { select: { bookingReference: true } },
      },
      orderBy: { createdAt: "asc" },
    }),
    prisma.user.findUnique({
      where: { id: session!.user.id },
      select: { passwordHash: true },
    }),
    getBranding(),
  ]);
  const outstandingTotal = outstanding.reduce((acc, p) => acc + Number(p.amount), 0);
  const outstandingCount = outstanding.length;
  const needsPassword = !me?.passwordHash;

  const outstandingDescription = (() => {
    if (outstandingCount === 0) return null;
    const now = new Date();
    const oldest = outstanding[0]!;
    const hasFailed = outstanding.some((p) => p.status === "FAILED");
    const typeCounts = outstanding.reduce<Map<PaymentType, number>>((acc, p) => {
      acc.set(p.type, (acc.get(p.type) ?? 0) + 1);
      return acc;
    }, new Map());
    const typeSummary = joinList(
      [...typeCounts.entries()].map(([type, count]) =>
        count === 1 ? `a ${paymentTypeLabel(type)}` : `${count} ${paymentTypeLabel(type)}s`,
      ),
    );
    const bookingRefs = new Set(
      outstanding.map((p) => p.booking?.bookingReference).filter((r): r is string => !!r),
    );
    const bookingMention =
      bookingRefs.size === 1
        ? ` on booking ${[...bookingRefs][0]}`
        : bookingRefs.size > 1
          ? ` across ${bookingRefs.size} bookings`
          : "";
    const raisedAgo = daysAgo(oldest.createdAt, now);
    const oldestDate = formatDate(oldest.createdAt);
    const raisedPhrase =
      outstandingCount > 1
        ? `Oldest charge raised ${raisedAgo === 0 ? "today" : `${raisedAgo} day${raisedAgo === 1 ? "" : "s"} ago`} (${oldestDate}).`
        : `Raised ${raisedAgo === 0 ? "today" : `${raisedAgo} day${raisedAgo === 1 ? "" : "s"} ago`} on ${oldestDate}.`;
    const duePhrase = hasFailed
      ? "A previous payment attempt failed, so this balance is overdue — please settle now to avoid further late fees and escalation."
      : "Payment is due now. Settle promptly to avoid further late fees and escalation.";
    return `${outstandingCount === 1 ? "This is" : "These are"} ${typeSummary}${bookingMention}. ${raisedPhrase} ${duePhrase}`;
  })();

  const [next, ...rest] = upcoming;

  return (
    <PageShell>
      <SetPasswordBanner show={needsPassword} />

      {outstandingCount > 0 && (
        <CalloutCard
          tone="warning"
          title={
            <>
              You have {formatCurrency(outstandingTotal)} outstanding
              {outstandingCount > 1 ? ` across ${outstandingCount} charges` : ""}
            </>
          }
          description={outstandingDescription}
          action={
            <Button asChild>
              <Link href="/dashboard/pay">Pay now</Link>
            </Button>
          }
        />
      )}

      {next ? (
        <NextTripHero booking={next} siteName={branding.siteName} />
      ) : (
        <Card>
          <CardContent className="flex flex-col items-center gap-3 py-10 text-center">
            <p className="text-sm text-muted-foreground">
              No upcoming rides on your calendar.
            </p>
            <Button asChild>
              <Link href="/booking">
                <Plus className="h-4 w-4" />
                <BookingCtaText initial="Book your next ride" resume="Continue booking" />
              </Link>
            </Button>
          </CardContent>
        </Card>
      )}

      {rest.length > 0 && (
        <PageSection title="Also coming up" flush>
          <div className="space-y-2">
            {rest.map((b) => {
              const v = b.vehicle;
              const thumbnailUrl = v?.images[0]?.url ?? b.category.images[0] ?? null;
              const title = v ? `${v.year} ${v.make} ${v.model}` : b.category.name;
              const eyebrow = v ? b.category.name : null;
              const manual = v?.catalogueModel?.documents[0] ?? null;
              const now = new Date();
              const isActive = b.pickupDateTime <= now && b.returnDateTime >= now;
              const target = isActive ? b.returnDateTime : b.pickupDateTime;
              const { label: relative, imminent } = formatRelative(now, target);
              const countdownLabel = isActive ? `Returns in ${relative}` : `Pickup in ${relative}`;
              return (
                <div
                  key={b.id}
                  className="relative flex items-start gap-3 rounded-md border border-border bg-background px-4 py-3 hover:bg-muted"
                >
                  <BookingVehicleThumbnail src={thumbnailUrl} alt={title} />
                  <div className="min-w-0 flex-1 space-y-1">
                    <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                      <Link
                        href={`/dashboard/bookings/${b.id}`}
                        className="truncate font-medium after:absolute after:inset-0"
                      >
                        {title}
                      </Link>
                      <StatusBadge status={b.status as StatusKey} />
                      <span
                        className={
                          "rounded-full px-2 py-0.5 text-xs font-medium " +
                          (imminent
                            ? "bg-primary text-primary-foreground"
                            : "bg-muted text-foreground")
                        }
                      >
                        {countdownLabel}
                      </span>
                    </div>
                    {eyebrow && (
                      <div className="text-xs text-muted-foreground">{eyebrow}</div>
                    )}
                    <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-xs text-muted-foreground">
                      <span>{b.bookingReference}</span>
                      {v && (
                        <>
                          <span aria-hidden>·</span>
                          <span>
                            Rego{" "}
                            <span className="font-mono text-foreground">{v.rego}</span>
                          </span>
                        </>
                      )}
                    </div>
                    <div className="truncate text-sm text-muted-foreground">
                      {formatDateTime(b.pickupDateTime)} · {b.pickupDepot.name}
                    </div>
                  </div>
                  <div className="relative z-10 flex shrink-0 flex-col items-end gap-1 text-right">
                    <div className="tabular-nums font-semibold">
                      {formatCurrency(Number(b.totalAmount))}
                    </div>
                    {manual && (
                      <a
                        href={manual.fileUrl}
                        target="_blank"
                        rel="noreferrer noopener"
                        className="inline-flex items-center gap-1 text-xs text-primary hover:underline"
                      >
                        <FileText className="h-3 w-3" aria-hidden />
                        Manual
                      </a>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </PageSection>
      )}
    </PageShell>
  );
}

type NextTripBooking = Awaited<ReturnType<typeof prisma.booking.findMany<{
  include: {
    category: true;
    pickupDepot: true;
    returnDepot: true;
    vehicle: {
      select: {
        make: true;
        model: true;
        year: true;
        rego: true;
        regoState: true;
        colour: true;
        images: { where: { isPrimary: true }; select: { url: true }; take: 1 };
        catalogueModel: {
          select: {
            documents: {
              where: { type: "OWNERS_MANUAL" };
              select: { fileUrl: true; title: true };
              orderBy: { fetchedAt: "desc" };
              take: 1;
            };
          };
        };
      };
    };
  };
}>>>[number];

function NextTripHero({ booking, siteName }: { booking: NextTripBooking; siteName: string }) {
  const v = booking.vehicle;
  const imageUrl = v?.images[0]?.url ?? booking.category.images[0] ?? null;
  const title = v ? `${v.year} ${v.make} ${v.model}` : booking.category.name;
  const eyebrow = v ? booking.category.name : null;
  const manual = v?.catalogueModel?.documents[0] ?? null;

  const now = new Date();
  const isActive = booking.pickupDateTime <= now && booking.returnDateTime >= now;
  const target = isActive ? booking.returnDateTime : booking.pickupDateTime;
  const { label: relative, imminent } = formatRelative(now, target);
  const countdownLabel = isActive ? `Returns in ${relative}` : `Pickup in ${relative}`;

  const depot = booking.pickupDepot;
  const fullAddress = `${depot.addressLine1}, ${depot.suburb} ${depot.state} ${depot.postcode}`;
  const mapsUrl = `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(fullAddress)}`;

  const calendarUrl = googleCalendarUrl({
    uid: `booking-${booking.id}`,
    title: `${siteName}: ${booking.category.name} (${booking.bookingReference})`,
    description: `Pickup at ${booking.pickupDepot.name}. Return at ${booking.returnDepot.name}.`,
    location: fullAddress,
    start: booking.pickupDateTime,
    end: booking.returnDateTime,
  });

  return (
    <Card className="overflow-hidden p-0">
      <div className="grid gap-0 md:grid-cols-[minmax(0,2fr)_minmax(0,3fr)]">
        <div className="relative flex aspect-[4/3] items-center justify-center bg-muted md:aspect-auto">
          {imageUrl ? (
            <Image
              src={imageUrl}
              alt={title}
              fill
              sizes="(min-width: 768px) 40vw, 100vw"
              priority
              className="object-cover"
            />
          ) : (
            <div className="text-xs uppercase tracking-wide text-muted-foreground">No image</div>
          )}
          <div className="absolute left-4 top-4 flex items-center gap-2">
            <StatusBadge status={booking.status as StatusKey} />
            <span
              className={
                "rounded-full px-2.5 py-1 text-xs font-medium shadow-sm " +
                (imminent
                  ? "bg-primary text-primary-foreground"
                  : "bg-background text-foreground")
              }
            >
              {countdownLabel}
            </span>
          </div>
        </div>
        <div className="flex flex-col justify-between gap-6 p-6">
          <div className="space-y-2">
            {eyebrow && <div className="eyebrow text-muted-foreground">{eyebrow}</div>}
            <h2 className="h2 text-foreground">{title}</h2>
            <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
              <span>{booking.bookingReference}</span>
              {v && (
                <>
                  <span aria-hidden>·</span>
                  <span>
                    Rego{" "}
                    <span className="font-mono text-foreground">{v.rego}</span>{" "}
                    <span>({v.regoState})</span>
                  </span>
                  <span aria-hidden>·</span>
                  <span>{v.colour}</span>
                </>
              )}
            </div>
          </div>
          <div className="space-y-3 text-sm">
            <div className="flex items-start gap-2">
              <Calendar className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" aria-hidden />
              <div>
                <div className="font-medium">{formatDateTime(booking.pickupDateTime)}</div>
                <div className="text-xs text-muted-foreground">
                  through {formatDateTime(booking.returnDateTime)}
                </div>
              </div>
            </div>
            <div className="flex items-start gap-2">
              <MapPin className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" aria-hidden />
              <div className="min-w-0">
                <div className="font-medium">{depot.name}</div>
                <div className="truncate text-xs text-muted-foreground">{fullAddress}</div>
                <a
                  href={mapsUrl}
                  target="_blank"
                  rel="noreferrer noopener"
                  className="text-xs font-medium text-primary hover:underline"
                >
                  Open in Maps
                </a>
              </div>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <Button asChild>
              <Link href={`/dashboard/bookings/${booking.id}`}>View booking</Link>
            </Button>
            <Button asChild variant="secondary" size="icon" title="Download .ics">
              <a
                href={`/api/bookings/${booking.id}/ics`}
                download
                aria-label="Download .ics calendar file"
              >
                <Download className="h-4 w-4" aria-hidden />
              </a>
            </Button>
            <Button asChild variant="secondary" size="icon" title="Add to Google Calendar">
              <a
                href={calendarUrl}
                target="_blank"
                rel="noreferrer noopener"
                aria-label="Add to Google Calendar"
              >
                <CalendarPlus className="h-4 w-4" aria-hidden />
              </a>
            </Button>
            {manual && (
              <Button asChild variant="secondary" size="icon" title="Owner's manual">
                <a
                  href={manual.fileUrl}
                  target="_blank"
                  rel="noreferrer noopener"
                  aria-label="Owner's manual"
                >
                  <FileText className="h-4 w-4" aria-hidden />
                </a>
              </Button>
            )}
            <div className="ml-auto tabular-nums font-semibold">
              {formatCurrency(Number(booking.totalAmount))}
            </div>
          </div>
        </div>
      </div>
    </Card>
  );
}
