"use client";

import { useMemo } from "react";
import { format } from "date-fns";
import { type DateRange } from "react-day-picker";
import { CalendarDays } from "lucide-react";

import { Calendar } from "@/components/ui/calendar";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import {
  combineLocalDateTime,
  generateTimeSlots,
  getHoursRowForDate,
  splitLocalDateTime,
} from "@/lib/booking-time-slots";
import type { DepotHoursInfo } from "@/components/booking/date-time-picker";

const SLOT_INTERVAL_MIN = 30;

type Props = {
  /** Combined "YYYY-MM-DDTHH:MM" — same shape DateTimePicker emits. */
  pickupValue: string;
  returnValue: string;
  onPickupChange: (value: string) => void;
  onReturnChange: (value: string) => void;
  onPickupBlur?: () => void;
  onReturnBlur?: () => void;
  pickupDepot?: DepotHoursInfo | null;
  returnDepot?: DepotHoursInfo | null;
  pickupAriaInvalid?: boolean;
  returnAriaInvalid?: boolean;
};

/**
 * Range calendar + two time selects, modelled after the homepage hero
 * widget. The range Calendar handles pickup + return dates in a single
 * familiar gesture (click-and-click), while the time selects keep the
 * depot-operating-hours validation that the staff portal also relies on.
 *
 * Emits two combined "YYYY-MM-DDTHH:MM" values via `onPickupChange` and
 * `onReturnChange`, matching the existing wizard form schema unchanged.
 */
export function BookingDateRangePicker({
  pickupValue,
  returnValue,
  onPickupChange,
  onReturnChange,
  onPickupBlur,
  onReturnBlur,
  pickupDepot,
  returnDepot,
  pickupAriaInvalid,
  returnAriaInvalid,
}: Props) {
  const pickupParts = splitLocalDateTime(pickupValue);
  const returnParts = splitLocalDateTime(returnValue);

  const range: DateRange | undefined =
    pickupParts.date || returnParts.date
      ? {
          from: pickupParts.date ? new Date(`${pickupParts.date}T00:00`) : undefined,
          to: returnParts.date ? new Date(`${returnParts.date}T00:00`) : undefined,
        }
      : undefined;

  const today = useMemo(() => {
    const d = new Date();
    d.setHours(0, 0, 0, 0);
    return d;
  }, []);

  function dateToYmd(d: Date): string {
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(
      d.getDate(),
    ).padStart(2, "0")}`;
  }

  function handleRangeSelect(next: DateRange | undefined) {
    const fromYmd = next?.from ? dateToYmd(next.from) : "";
    const toYmd = next?.to ? dateToYmd(next.to) : "";

    // Default times to 10:00 when the user picks dates without an explicit
    // time — matches the homepage hero behaviour. Without this default,
    // `combineLocalDateTime(date, "")` returns "" (the helper requires
    // both halves), the form field gets wiped, and the calendar re-renders
    // with `selected = undefined` so the user's click looks broken.
    // Preserve any existing time that's still a valid slot for the new date.
    const DEFAULT_TIME = "10:00";
    const keptPickupTime =
      pickupParts.time && isTimeStillValid(fromYmd, pickupParts.time, pickupDepot)
        ? pickupParts.time
        : DEFAULT_TIME;
    onPickupChange(fromYmd ? combineLocalDateTime(fromYmd, keptPickupTime) : "");

    const keptReturnTime =
      returnParts.time && isTimeStillValid(toYmd, returnParts.time, returnDepot)
        ? returnParts.time
        : DEFAULT_TIME;
    onReturnChange(toYmd ? combineLocalDateTime(toYmd, keptReturnTime) : "");
  }

  const pickupSlots = useTimeSlots(pickupParts.date, pickupDepot);
  const returnSlots = useTimeSlots(returnParts.date, returnDepot);
  const hirePeriod = formatHirePeriod(pickupValue, returnValue);

  // Day-state predicates fed into react-day-picker `modifiers`. A day is
  // "closed" when either the pickup or the return depot is explicitly
  // shut on that day-of-week, because the customer can't start and
  // finish the hire there. "Open" is the affirmative inverse for
  // future, in-hours days — needed as its own modifier so the green
  // class cascades from the cell down into the day-button (the button
  // itself can't carry the default colour or it wins over the
  // closed/disabled modifier classes).
  //
  // Missing depot data (depots query still loading) or a missing row
  // (depot config gap) is treated as "unknown, don't block selection".
  // Otherwise we'd lock the entire calendar until the query resolves
  // and the time picker would never get a chance to surface the real
  // hours mismatch.
  const isClosedDay = (date: Date): boolean => {
    if (!pickupDepot || !returnDepot) return false;
    const ymd = dateToYmd(date);
    const pickupRow = getHoursRowForDate(ymd, pickupDepot.operatingHours);
    const returnRow = getHoursRowForDate(ymd, returnDepot.operatingHours);
    return pickupRow?.isClosed === true || returnRow?.isClosed === true;
  };
  const isPastDay = (date: Date): boolean => date.getTime() < today.getTime();
  const isOpenDay = (date: Date): boolean =>
    !isPastDay(date) && !isClosedDay(date);

  return (
    <div className="space-y-4">
      {/* Horizontal scroll fallback if the two-month range can't quite fit
       *  the viewport — narrow phones can still reach the second month by
       *  swiping. The compact day-button styling below mirrors the
       *  homepage hero widget so it usually fits without scrolling. */}
      <div className="overflow-x-auto rounded-md border border-border bg-card p-2 md:p-4">
        {/*
         * Legend uses raw Tailwind palette tones (orange / emerald) instead
         * of `bg-secondary` / `bg-primary` because deployments rebrand both
         * (XPERT Moto's primary is black, secondary is bright yellow), which
         * left "Available" reading as black and "Open mid-hire" as a low-
         * contrast yellow on white. Locking these markers to fixed hues
         * guarantees the legend stays readable under any brand override —
         * the rule about avoiding raw tones is waived here on the same
         * grounds we already waive it for status badges.
         */}
        <div className="mb-2 flex flex-row items-center gap-3 overflow-x-auto px-1 text-[10px] sm:text-xs">
          <span className="inline-flex shrink-0 items-center gap-1.5">
            <span aria-hidden className="h-2 w-2 shrink-0 rounded-full bg-destructive" />
            <span className="whitespace-nowrap text-muted-foreground">Not available</span>
          </span>
          <span className="inline-flex shrink-0 items-center gap-1.5">
            <span aria-hidden className="h-2 w-2 shrink-0 rounded-full bg-orange-500" />
            <span className="whitespace-nowrap text-muted-foreground">
              Open mid-hire only (depot closed)
            </span>
          </span>
          <span className="inline-flex shrink-0 items-center gap-1.5">
            <span aria-hidden className="h-2 w-2 shrink-0 rounded-full bg-emerald-600" />
            <span className="whitespace-nowrap text-muted-foreground">Available, depot open</span>
          </span>
        </div>
        <div className="flex justify-center">
          <Calendar
            mode="range"
            numberOfMonths={2}
            selected={range}
            onSelect={handleRangeSelect}
            // Both past dates AND closed depot days are non-selectable as
            // start/end. Past dates render red strikethrough; closed days
            // render amber (the explicit `closed` modifier below wins
            // over the default disabled dimming).
            disabled={[{ before: today }, isClosedDay]}
            showOutsideDays={false}
            className="p-1"
            modifiers={{
              pastDay: isPastDay,
              closed: isClosedDay,
              openDay: isOpenDay,
            }}
            modifiersClassNames={{
              // Modifier classes are applied to the table cell (td), but
              // the day button uses the ghost variant which carries its
              // own `text-foreground` and so wins the colour cascade. Use
              // the `[&>button]:` arbitrary-variant with `!important` to
              // push these tones onto the button itself, matching the
              // legend dots above. Tones are locked to fixed Tailwind
              // palette values rather than `text-primary` /
              // `text-secondary` because brand overrides (e.g. XPERT
              // Moto's primary = black) would otherwise turn "available"
              // into solid black and "closed" into a low-contrast yellow.
              //
              // Past dates: red strikethrough — matches "Not available".
              // `opacity-100` overrides DayPicker's default disabled
              // dimming so the strike reads cleanly. `:not(.rdp-selected)`
              // means a past date that's somehow in a selected range
              // (e.g. the hire spans midnight) still gets the range tone.
              pastDay:
                "[&:not(.rdp-selected)>button]:!text-destructive [&:not(.rdp-selected)>button]:line-through [&:not(.rdp-selected)>button]:opacity-100",
              // Closed depot days: orange. Scoped to non-selected cells so
              // the range_middle styling (transparent button on
              // `bg-primary/15`) wins for closed-days that sit inside a
              // multi-day hire.
              closed:
                "[&:not(.rdp-selected)>button]:!text-orange-500 [&:not(.rdp-selected)>button]:opacity-100",
              // Open future days: emerald. Same `:not(.rdp-selected)`
              // guard — without it, the cell carries both the openDay
              // emerald rule and the built-in range_start / range_end
              // `!text-primary-foreground`, and Tailwind's stylesheet
              // ordering let emerald win, leaving the picked dates
              // unreadable on the black bg.
              openDay: "[&:not(.rdp-selected)>button]:!text-emerald-600",
            }}
            classNames={{
              months: "flex flex-row gap-1 sm:gap-4 md:gap-8 lg:gap-12",
              weekday:
                "text-muted-foreground rounded-md w-7 sm:w-8 md:w-10 lg:w-12 font-normal text-[0.7rem] md:text-sm",
              // Day buttons stay colour-neutral so the modifier class on
              // the parent cell cascades into the button text. The ghost
              // variant only sets a hover colour, leaving the rest
              // inheriting from the Day cell.
              day_button: cn(
                buttonVariants({ variant: "ghost" }),
                "h-7 w-7 sm:h-8 sm:w-8 md:h-10 md:w-10 lg:h-12 lg:w-12 p-0 text-xs md:text-sm font-semibold",
              ),
            }}
          />
        </div>
        <p className="caption mt-2 flex items-center gap-1.5 px-1 text-muted-foreground">
          <CalendarDays className="h-3.5 w-3.5" aria-hidden />
          {range?.from && range?.to ? (
            <>
              <span>
                {format(range.from, "EEE d MMM")} → {format(range.to, "EEE d MMM")}
              </span>
              {hirePeriod && <span>(hire period: {hirePeriod})</span>}
            </>
          ) : range?.from ? (
            `Start: ${format(range.from, "EEE d MMM")} — pick a return date`
          ) : (
            "Pick your pickup and return dates."
          )}
        </p>
      </div>

      <div className="grid gap-3 md:grid-cols-2">
        <TimeField
          label="Pickup time"
          date={pickupParts.date}
          time={pickupParts.time}
          slots={pickupSlots}
          onChange={(t) => onPickupChange(combineLocalDateTime(pickupParts.date, t))}
          onBlur={onPickupBlur}
          ariaInvalid={pickupAriaInvalid}
        />
        <TimeField
          label="Return time"
          date={returnParts.date}
          time={returnParts.time}
          slots={returnSlots}
          onChange={(t) => onReturnChange(combineLocalDateTime(returnParts.date, t))}
          onBlur={onReturnBlur}
          ariaInvalid={returnAriaInvalid}
        />
      </div>
    </div>
  );
}

/**
 * Render-friendly hire-period summary ("3 d 4 h") computed from the same
 * combined "YYYY-MM-DDTHH:MM" values the form holds. Returns null while
 * either side is missing or the range is not yet positive.
 */
function formatHirePeriod(pickup: string, ret: string): string | null {
  if (!pickup || !ret) return null;
  const p = new Date(pickup).getTime();
  const r = new Date(ret).getTime();
  if (!Number.isFinite(p) || !Number.isFinite(r) || r <= p) return null;
  const totalMin = Math.round((r - p) / 60000);
  const days = Math.floor(totalMin / (24 * 60));
  const rem = totalMin - days * 24 * 60;
  const hours = Math.floor(rem / 60);
  const mins = rem - hours * 60;
  const parts: string[] = [];
  if (days) parts.push(`${days} d`);
  if (hours) parts.push(`${hours} h`);
  if (mins) parts.push(`${mins} m`);
  return parts.join(" ") || "0 h";
}

function isTimeStillValid(
  ymd: string,
  time: string,
  depot: DepotHoursInfo | null | undefined,
): boolean {
  if (!ymd || !time || !depot) return false;
  const row = getHoursRowForDate(ymd, depot.operatingHours);
  if (!row || row.isClosed) return false;
  const slots = generateTimeSlots(row.openTime, row.closeTime, SLOT_INTERVAL_MIN);
  return slots.includes(time);
}

function useTimeSlots(
  ymd: string,
  depot: DepotHoursInfo | null | undefined,
): { status: "no-depot" | "no-date" | "no-hours" | "closed" | "open"; slots: string[] } {
  return useMemo(() => {
    if (!depot) return { status: "no-depot" as const, slots: [] };
    if (!ymd) return { status: "no-date" as const, slots: [] };
    const row = getHoursRowForDate(ymd, depot.operatingHours);
    if (!row) return { status: "no-hours" as const, slots: [] };
    if (row.isClosed) return { status: "closed" as const, slots: [] };
    return {
      status: "open" as const,
      slots: generateTimeSlots(row.openTime, row.closeTime, SLOT_INTERVAL_MIN),
    };
  }, [ymd, depot]);
}

function TimeField({
  label,
  date,
  time,
  slots,
  onChange,
  onBlur,
  ariaInvalid,
}: {
  label: string;
  date: string;
  time: string;
  slots: ReturnType<typeof useTimeSlots>;
  onChange: (time: string) => void;
  onBlur?: () => void;
  ariaInvalid?: boolean;
}) {
  const placeholder =
    slots.status === "no-depot"
      ? "Pick a depot first"
      : slots.status === "no-date"
        ? "Pick a date first"
        : slots.status === "closed"
          ? "Closed this day"
          : slots.status === "no-hours"
            ? "No hours listed"
            : "Select time…";
  const disabled = slots.status !== "open";

  return (
    <div
      className={cn(
        "flex items-center justify-between gap-3",
        !date && "opacity-90",
      )}
    >
      <label className="shrink-0 text-sm font-medium">{label}</label>
      <Select
        value={time || undefined}
        // Radix Select's `useControllableState` fires `onValueChange("")`
        // when `value` transitions from `undefined` to a defined string —
        // which happens whenever the customer picks a date in the calendar
        // and the picker writes a default time back into this field.
        // Forwarding that spurious empty call to the form would clear
        // pickupDateTime / returnDateTime the moment the user clicked,
        // which is exactly what made the calendar look unresponsive.
        // SelectItems only ever carry a real "HH:MM" value, so dropping the
        // empty payload is safe.
        onValueChange={(t) => {
          if (t) onChange(t);
        }}
        disabled={disabled}
      >
        <SelectTrigger className="w-32" aria-invalid={ariaInvalid} onBlur={onBlur}>
          <SelectValue placeholder={placeholder} />
        </SelectTrigger>
        <SelectContent>
          {slots.slots.map((t) => (
            <SelectItem key={t} value={t}>
              {t}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
}
