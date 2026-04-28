"use client";

import { formatDateTime } from "@/lib/utils";

type BookingForCover = {
  bookingReference: string;
  customer: { firstName: string; lastName: string; email: string; phone: string | null };
  vehicle: { internalCode: string; rego: string; make: string; model: string; year: number; colour: string | null } | null;
  category: { name: string };
  pickupDepot: { name: string; addressLine1: string; suburb: string; state: string; postcode: string };
  returnDepot: { name: string };
  pickupDateTime: Date | string;
  returnDateTime: Date | string;
  durationDays: number;
};

export function CoverPage({ booking }: { booking: BookingForCover }) {
  return (
    <div className="grid gap-6 md:grid-cols-2">
      <section>
        <div className="eyebrow">Hirer</div>
        <div className="mt-1 text-lg font-semibold">
          {booking.customer.firstName} {booking.customer.lastName}
        </div>
        <div className="text-sm text-muted-foreground">{booking.customer.email}</div>
        {booking.customer.phone && <div className="text-sm text-muted-foreground">{booking.customer.phone}</div>}
      </section>
      <section>
        <div className="eyebrow">Pickup depot</div>
        <div className="mt-1 text-lg font-semibold">{booking.pickupDepot.name}</div>
        <div className="text-sm text-muted-foreground">
          {booking.pickupDepot.addressLine1}, {booking.pickupDepot.suburb} {booking.pickupDepot.state}{" "}
          {booking.pickupDepot.postcode}
        </div>
        <div className="mt-3 eyebrow">Return depot</div>
        <div className="text-sm">{booking.returnDepot.name}</div>
      </section>
      <section className="md:col-span-2">
        <div className="eyebrow">Vehicle</div>
        {booking.vehicle ? (
          <div className="mt-1">
            <div className="text-lg font-semibold">
              {booking.vehicle.make} {booking.vehicle.model} ({booking.vehicle.year})
            </div>
            <div className="text-sm text-muted-foreground">
              {booking.category.name} · Rego {booking.vehicle.rego} · Internal code {booking.vehicle.internalCode}
              {booking.vehicle.colour ? ` · ${booking.vehicle.colour}` : ""}
            </div>
          </div>
        ) : (
          <div className="text-sm text-destructive">No vehicle allocated yet.</div>
        )}
      </section>
      <section>
        <div className="eyebrow">Pickup</div>
        <div className="mt-1 font-medium">{formatDateTime(booking.pickupDateTime)}</div>
      </section>
      <section>
        <div className="eyebrow">Return</div>
        <div className="mt-1 font-medium">{formatDateTime(booking.returnDateTime)}</div>
        <div className="text-sm text-muted-foreground">{booking.durationDays} day(s)</div>
      </section>
      <section className="md:col-span-2 rounded-md bg-muted/40 p-3 text-sm">
        Booking reference: <strong>{booking.bookingReference}</strong>
      </section>
    </div>
  );
}
