import type { EventContentArg } from "@fullcalendar/core";
import { ArrowDownToLine, ArrowUpFromLine } from "lucide-react";
import {
  STATUS_COLORS,
  type CalendarEventKind,
  type CalendarEventType,
} from "./calendar-utils";

export function renderEventContent(eventInfo: EventContentArg) {
  const { displayStatus, customerName, vehicleCode, bookingReference, eventType } =
    eventInfo.event.extendedProps as {
      displayStatus: CalendarEventKind;
      customerName: string;
      vehicleCode: string | null;
      bookingReference: string;
      eventType: CalendarEventType;
    };

  const style = STATUS_COLORS[displayStatus];
  const viewType = eventInfo.view.type;
  const Icon = eventType === "pickup" ? ArrowUpFromLine : ArrowDownToLine;

  // Month view — icon + name on a filled bar coloured by status
  if (viewType === "dayGridMonth") {
    return (
      <div
        className="flex items-center gap-1 truncate text-[11px] leading-tight px-0.5"
        style={{ color: style.text }}
      >
        <Icon className="h-3 w-3 shrink-0" />
        <span className="truncate font-medium">{customerName}</span>
      </div>
    );
  }

  // List view
  if (viewType === "listWeek" || viewType === "listMonth" || viewType === "listDay") {
    return (
      <div className="flex items-center gap-2 text-sm">
        <span
          className="inline-block h-2.5 w-2.5 shrink-0 rounded-full"
          style={{ backgroundColor: style.bg }}
        />
        <Icon className="h-3.5 w-3.5 shrink-0" style={{ color: style.bg }} />
        <span className="font-medium">{customerName}</span>
        <span className="text-xs text-muted-foreground">
          {eventType === "pickup" ? "Pickup" : "Return"}
        </span>
        {vehicleCode && (
          <span className="text-xs text-muted-foreground">{vehicleCode}</span>
        )}
        <span className="ml-auto rounded bg-muted px-1.5 py-0.5 text-xs text-muted-foreground">
          {bookingReference}
        </span>
      </div>
    );
  }

  // Week / Day view — compact block at event time
  return (
    <div className="flex items-center gap-1 overflow-hidden px-1 py-0.5 text-[11px] leading-tight">
      <Icon className="h-3 w-3 shrink-0" />
      <span className="font-semibold">{eventInfo.timeText}</span>
      <span className="truncate font-medium">{customerName}</span>
      {vehicleCode && (
        <span className="truncate text-white/80">· {vehicleCode}</span>
      )}
    </div>
  );
}
