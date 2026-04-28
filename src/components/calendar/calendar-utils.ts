import type { EventInput } from "@fullcalendar/core";

export type BookingStatus =
  | "QUOTE"
  | "PENDING_PAYMENT"
  | "CONFIRMED"
  | "CHECKED_OUT"
  | "ACTIVE"
  | "OVERDUE"
  | "RETURNED"
  | "COMPLETED"
  | "CANCELLED"
  | "NO_SHOW"
  | "DISPUTED";

export type CalendarEventKind =
  | "PICKUP_DUE"
  | "PICKUP_DONE"
  | "PICKUP_MISSED"
  | "RETURN_DUE"
  | "RETURN_OVERDUE"
  | "RETURN_DONE"
  | "CANCELLED";

export type CalendarEventType = "pickup" | "return";

export type CalendarDisplayStatus = CalendarEventKind;

interface EventStyle {
  bg: string;
  border: string;
  text: string;
  label: string;
}

export const STATUS_COLORS: Record<CalendarEventKind, EventStyle> = {
  PICKUP_DUE:     { bg: "#0ea5e9", border: "#0284c7", text: "#ffffff", label: "Pickup" },
  PICKUP_DONE:    { bg: "#10b981", border: "#059669", text: "#ffffff", label: "Picked up" },
  PICKUP_MISSED:  { bg: "#0f172a", border: "#020617", text: "#ffffff", label: "No show" },
  RETURN_DUE:     { bg: "#f97316", border: "#ea580c", text: "#ffffff", label: "Return due" },
  RETURN_OVERDUE: { bg: "#ef4444", border: "#dc2626", text: "#ffffff", label: "Overdue" },
  RETURN_DONE:    { bg: "#64748b", border: "#475569", text: "#ffffff", label: "Returned" },
  CANCELLED:      { bg: "#94a3b8", border: "#64748b", text: "#ffffff", label: "Cancelled" },
};

export interface CalendarBooking {
  id: string;
  bookingReference: string;
  status: string;
  pickupDateTime: Date | string;
  returnDateTime: Date | string;
  customer: { id: string; firstName: string; lastName: string };
  category: { id: string; name: string };
  pickupDepot: { id: string; name: string };
  vehicle: { id: string; internalCode: string } | null;
}

const PICKUP_DONE_STATUSES = new Set<BookingStatus>([
  "CHECKED_OUT",
  "ACTIVE",
  "OVERDUE",
  "RETURNED",
  "COMPLETED",
  "DISPUTED",
]);

const RETURN_DONE_STATUSES = new Set<BookingStatus>([
  "RETURNED",
  "COMPLETED",
  "DISPUTED",
]);

/** 30-minute marker, clamped to the end of the same calendar day so the event
 * never spills past midnight (which would flip month view back to spanning bars). */
function sameDayEnd(start: Date): Date {
  const plus30 = new Date(start.getTime() + 30 * 60 * 1000);
  const endOfDay = new Date(start);
  endOfDay.setHours(23, 59, 0, 0);
  return plus30 < endOfDay ? plus30 : endOfDay;
}

function pickupKind(status: BookingStatus, pickup: Date, now: Date): CalendarEventKind {
  if (status === "CANCELLED") return "CANCELLED";
  if (status === "NO_SHOW") return "PICKUP_MISSED";
  if (PICKUP_DONE_STATUSES.has(status)) return "PICKUP_DONE";
  return pickup < now ? "PICKUP_MISSED" : "PICKUP_DUE";
}

function returnKind(status: BookingStatus, returnAt: Date, now: Date): CalendarEventKind {
  if (status === "CANCELLED" || status === "NO_SHOW") return "CANCELLED";
  if (RETURN_DONE_STATUSES.has(status)) return "RETURN_DONE";
  if (status === "OVERDUE") return "RETURN_OVERDUE";
  if ((status === "CHECKED_OUT" || status === "ACTIVE") && returnAt < now) return "RETURN_OVERDUE";
  return "RETURN_DUE";
}

export function bookingsToEvents(bookings: CalendarBooking[]): EventInput[] {
  const now = new Date();
  const events: EventInput[] = [];

  for (const b of bookings) {
    const status = b.status as BookingStatus;
    const pickupAt = typeof b.pickupDateTime === "string" ? new Date(b.pickupDateTime) : b.pickupDateTime;
    const returnAt = typeof b.returnDateTime === "string" ? new Date(b.returnDateTime) : b.returnDateTime;
    const customerName = `${b.customer.firstName} ${b.customer.lastName}`;

    const commonProps = {
      bookingId: b.id,
      bookingReference: b.bookingReference,
      categoryName: b.category.name,
      depotName: b.pickupDepot.name,
      vehicleCode: b.vehicle?.internalCode ?? null,
      customerName,
      status,
    };

    const pKind = pickupKind(status, pickupAt, now);
    const pColors = STATUS_COLORS[pKind];
    events.push({
      id: `${b.id}:pickup`,
      title: customerName,
      start: pickupAt.toISOString(),
      end: sameDayEnd(pickupAt).toISOString(),
      backgroundColor: pColors.bg,
      borderColor: pColors.border,
      textColor: pColors.text,
      extendedProps: {
        ...commonProps,
        eventType: "pickup" satisfies CalendarEventType,
        displayStatus: pKind,
      },
    });

    const rKind = returnKind(status, returnAt, now);
    const rColors = STATUS_COLORS[rKind];
    events.push({
      id: `${b.id}:return`,
      title: customerName,
      start: returnAt.toISOString(),
      end: sameDayEnd(returnAt).toISOString(),
      backgroundColor: rColors.bg,
      borderColor: rColors.border,
      textColor: rColors.text,
      extendedProps: {
        ...commonProps,
        eventType: "return" satisfies CalendarEventType,
        displayStatus: rKind,
      },
    });
  }

  return events;
}

export const LEGEND_STATUSES: CalendarEventKind[] = [
  "PICKUP_DUE",
  "PICKUP_DONE",
  "RETURN_DUE",
  "RETURN_OVERDUE",
  "RETURN_DONE",
  "PICKUP_MISSED",
  "CANCELLED",
];
