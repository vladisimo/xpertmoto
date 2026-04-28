"use client";

import { formatDateTime } from "@/lib/utils";

type Props = {
  booking: {
    bookingReference: string;
    customer: { firstName: string; lastName: string; email: string };
    category: { name: string };
    vehicle: { internalCode: string; rego: string; make: string; model: string } | null;
    pickupDateTime: Date | string;
    returnDateTime: Date | string;
    actualReturnDateTime: Date | string | null;
    pickupOdometerKm: number | null;
    returnDepot: { name: string };
  };
  inspection: { odometerKm: number; fuelLevel: number };
};

export function ReturnCoverPage({ booking, inspection }: Props) {
  return (
    <div className="grid gap-6 md:grid-cols-2">
      <section>
        <div className="eyebrow">Hirer</div>
        <div className="mt-1 text-lg font-semibold">
          {booking.customer.firstName} {booking.customer.lastName}
        </div>
        <div className="text-sm text-muted-foreground">{booking.customer.email}</div>
      </section>
      <section>
        <div className="eyebrow">Return depot</div>
        <div className="mt-1 text-lg font-semibold">{booking.returnDepot.name}</div>
      </section>
      <section>
        <div className="eyebrow">Hire</div>
        <div className="text-sm">Reference: {booking.bookingReference}</div>
        <div className="text-sm">Pickup: {formatDateTime(booking.pickupDateTime)}</div>
        <div className="text-sm">
          Scheduled return: {formatDateTime(booking.returnDateTime)}
          {booking.actualReturnDateTime && (
            <>
              <br />
              Actual return: {formatDateTime(booking.actualReturnDateTime)}
            </>
          )}
        </div>
      </section>
      <section>
        <div className="eyebrow">Vehicle</div>
        {booking.vehicle ? (
          <div className="mt-1">
            <div className="font-semibold">
              {booking.vehicle.make} {booking.vehicle.model}
            </div>
            <div className="text-sm text-muted-foreground">
              {booking.category.name} · Rego {booking.vehicle.rego} · {booking.vehicle.internalCode}
            </div>
          </div>
        ) : null}
      </section>
      <section className="md:col-span-2 grid grid-cols-3 gap-4 rounded-md bg-muted/40 p-3 text-sm">
        <div>
          <div className="eyebrow">Pickup odo</div>
          <div className="font-medium">{booking.pickupOdometerKm ?? "—"} km</div>
        </div>
        <div>
          <div className="eyebrow">Return odo</div>
          <div className="font-medium">{inspection.odometerKm} km</div>
        </div>
        <div>
          <div className="eyebrow">Return fuel</div>
          <div className="font-medium">{inspection.fuelLevel}%</div>
        </div>
      </section>
    </div>
  );
}
