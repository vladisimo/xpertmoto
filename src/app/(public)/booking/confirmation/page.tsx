import Link from "next/link";
import { PartyPopper, FileText, BookOpen, Wrench } from "lucide-react";
import { prisma } from "@/lib/prisma";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { StatusBadge, type StatusKey } from "@/components/ui/status-badge";
import { SpecTable, type SpecRow } from "@/components/marketing/spec-table";
import { formatCurrency, formatDateTime } from "@/lib/utils";
import { googleCalendarUrl } from "@/lib/calendar";
import { ConfirmationResetGuard } from "@/components/booking/confirmation-reset-guard";

const DOCUMENT_TYPE_LABEL: Record<string, string> = {
  OWNERS_MANUAL: "Owner's manual",
  SERVICE_SCHEDULE: "Service schedule",
  PARTS_CATALOGUE: "Parts catalogue",
  WIRING_DIAGRAM: "Wiring diagram",
  BROCHURE: "Brochure",
};

const DOCUMENT_TYPE_ICON: Record<string, typeof BookOpen> = {
  OWNERS_MANUAL: BookOpen,
  SERVICE_SCHEDULE: Wrench,
};

export default async function ConfirmationPage({
  searchParams,
}: {
  searchParams: Promise<{ ref?: string }>;
}) {
  const { ref } = await searchParams;
  const booking = ref
    ? await prisma.booking.findUnique({
        where: { bookingReference: ref },
        include: {
          category: true,
          pickupDepot: true,
          returnDepot: true,
          vehicle: {
            include: {
              images: { orderBy: [{ isPrimary: "desc" }, { displayOrder: "asc" }] },
              catalogueModel: {
                include: {
                  documents: { orderBy: { fetchedAt: "desc" } },
                },
              },
            },
          },
        },
      })
    : null;

  if (!booking) {
    return (
      <div className="container py-16 text-center">
        <h1 className="h1">Booking not found</h1>
        <Button asChild className="mt-6">
          <Link href="/">Back home</Link>
        </Button>
      </div>
    );
  }

  const v = booking.vehicle;
  const heroUrl =
    v?.images.find((i) => i.isPrimary)?.url ??
    v?.images[0]?.url ??
    booking.category.images[0] ??
    null;
  const vehicleTitle = v ? `${v.year} ${v.make} ${v.model}` : booking.category.name;
  const eyebrow = v ? booking.category.name : null;

  const model = v?.catalogueModel ?? null;
  const specRows: SpecRow[] = [];
  if (model?.engineCapacityCc) {
    specRows.push({ label: "Engine", value: `${model.engineCapacityCc} cc` });
  } else if (booking.category.engineCapacity) {
    specRows.push({ label: "Engine", value: `${booking.category.engineCapacity} cc` });
  }
  if (model?.enginePowerKw) specRows.push({ label: "Power", value: `${Number(model.enginePowerKw)} kW` });
  if (model?.engineTorqueNm) specRows.push({ label: "Torque", value: `${Number(model.engineTorqueNm)} Nm` });
  if (model?.topSpeedKmh) specRows.push({ label: "Top speed", value: `${model.topSpeedKmh} km/h` });
  if (model?.fuelTankLitres) specRows.push({ label: "Fuel tank", value: `${Number(model.fuelTankLitres)} L` });
  if (model?.fuelType ?? v?.fuelType) {
    specRows.push({ label: "Fuel", value: model?.fuelType ?? v?.fuelType ?? "" });
  }
  if (model?.dryWeightKg) specRows.push({ label: "Dry weight", value: `${Number(model.dryWeightKg)} kg` });
  if (model?.seatHeightMm) specRows.push({ label: "Seat height", value: `${model.seatHeightMm} mm` });
  specRows.push({ label: "Licence required", value: booking.category.licenceRequired });
  specRows.push({ label: "Minimum age", value: `${booking.category.minAge}` });
  if (v?.colour) specRows.push({ label: "Colour", value: v.colour });

  const documents = model?.documents ?? [];

  return (
    <div className="container max-w-3xl pt-16 pb-36">
      <ConfirmationResetGuard />
      <div className="flex justify-center">
        <PartyPopper className="h-16 w-16 text-primary" aria-hidden />
      </div>
      <h1 className="mt-4 text-center h-display">Booking confirmed!</h1>
      <p className="mt-2 text-center text-muted-foreground">
        We&apos;ve sent a confirmation email with all the details.
      </p>

      <Card className="mt-10 overflow-hidden p-0">
        <div className="grid gap-0 md:grid-cols-[minmax(0,3fr)_minmax(0,4fr)]">
          <div className="relative aspect-[4/3] bg-muted md:aspect-auto">
            {heroUrl ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={heroUrl}
                alt={vehicleTitle}
                className="absolute inset-0 h-full w-full object-cover"
              />
            ) : (
              <div className="flex h-full w-full items-center justify-center text-xs uppercase tracking-wide text-muted-foreground">
                No image
              </div>
            )}
            <div className="absolute left-4 top-4">
              <StatusBadge status={booking.status as StatusKey} />
            </div>
          </div>
          <div className="flex flex-col gap-4 p-6">
            {eyebrow && <div className="eyebrow text-muted-foreground">{eyebrow}</div>}
            <div>
              <h2 className="h2 text-foreground">{vehicleTitle}</h2>
              <div className="mt-1 text-xs text-muted-foreground">
                Ref: {booking.bookingReference}
              </div>
            </div>
            {booking.category.description && (
              <p className="text-sm text-muted-foreground">{booking.category.description}</p>
            )}
            {!v && (
              <p className="text-xs text-muted-foreground">
                Your specific bike will be assigned at pickup — all models in this
                category are equipped to the same spec.
              </p>
            )}
          </div>
        </div>
      </Card>

      <div className="mt-6 grid gap-6 md:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle className="h3">Trip</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3 text-sm">
            <div className="flex justify-between">
              <span className="text-muted-foreground">Pickup</span>
              <span className="text-right">
                {formatDateTime(booking.pickupDateTime)}
                <br />
                <span className="text-xs text-muted-foreground">{booking.pickupDepot.name}</span>
              </span>
            </div>
            <div className="flex justify-between">
              <span className="text-muted-foreground">Return</span>
              <span className="text-right">
                {formatDateTime(booking.returnDateTime)}
                <br />
                <span className="text-xs text-muted-foreground">{booking.returnDepot.name}</span>
              </span>
            </div>
            <div className="flex justify-between">
              <span className="text-muted-foreground">Duration</span>
              <span>{booking.durationDays} days</span>
            </div>
            <div className="flex justify-between border-t pt-3 font-semibold">
              <span>Total paid</span>
              <span className="text-primary">{formatCurrency(Number(booking.totalAmount))}</span>
            </div>
            <div className="flex justify-between text-xs text-muted-foreground">
              <span>Bond held</span>
              <span>{formatCurrency(Number(booking.bondAmount))}</span>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="h3">Specifications</CardTitle>
          </CardHeader>
          <CardContent>
            <SpecTable rows={specRows} />
            {model?.specsSourceName && model?.specsSourceUrl && (
              <p className="caption pt-3">
                Source:{" "}
                <a
                  className="underline"
                  href={model.specsSourceUrl}
                  target="_blank"
                  rel="noreferrer"
                >
                  {model.specsSourceName}
                </a>
              </p>
            )}
          </CardContent>
        </Card>
      </div>

      {documents.length > 0 && (
        <Card className="mt-6">
          <CardHeader>
            <CardTitle className="h3">Owner&apos;s resources</CardTitle>
          </CardHeader>
          <CardContent>
            <ul className="divide-y divide-border">
              {documents.map((d) => {
                const Icon = DOCUMENT_TYPE_ICON[d.type] ?? FileText;
                return (
                  <li key={d.id} className="flex items-center justify-between gap-3 py-3">
                    <div className="flex min-w-0 items-center gap-3">
                      <Icon className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden />
                      <div className="min-w-0">
                        <div className="truncate text-sm font-medium">{d.title}</div>
                        <div className="caption">
                          {DOCUMENT_TYPE_LABEL[d.type] ?? d.type}
                          {d.pageCount ? ` · ${d.pageCount} pages` : ""}
                        </div>
                      </div>
                    </div>
                    <Button asChild variant="secondary" size="sm">
                      <a href={d.fileUrl} target="_blank" rel="noreferrer noopener">
                        Open
                      </a>
                    </Button>
                  </li>
                );
              })}
            </ul>
          </CardContent>
        </Card>
      )}

      <div className="mt-8 flex flex-wrap justify-center gap-3">
        <Button asChild>
          <Link href="/dashboard/bookings">View my bookings</Link>
        </Button>
        <Button asChild variant="secondary">
          <a href={`/api/bookings/${booking.id}/ics`} download>
            Add to calendar (.ics)
          </a>
        </Button>
        <Button asChild variant="secondary">
          <a
            href={googleCalendarUrl({
              uid: `booking-${booking.id}`,
              title: `Scooter hire: ${booking.category.name} (${booking.bookingReference})`,
              description: `Pickup at ${booking.pickupDepot.name}. Return at ${booking.returnDepot.name}.`,
              location: booking.pickupDepot.name,
              start: booking.pickupDateTime,
              end: booking.returnDateTime,
            })}
            target="_blank"
            rel="noopener noreferrer"
          >
            Google Calendar
          </a>
        </Button>
        <Button asChild variant="secondary">
          <Link href="/">Back home</Link>
        </Button>
      </div>
    </div>
  );
}
