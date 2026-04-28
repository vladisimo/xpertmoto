"use client";
import { useEffect, useMemo, useState } from "react";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import type { OperatingHoursRow } from "@/lib/opening-hours";
import {
  combineLocalDateTime,
  generateTimeSlots,
  getHoursRowForDate,
  splitLocalDateTime,
} from "@/lib/booking-time-slots";

export type DepotHoursInfo = {
  operatingHours: OperatingHoursRow[];
};

type Props = {
  /** Combined "YYYY-MM-DDTHH:MM" — matches the original datetime-local shape. */
  value: string;
  onChange: (value: string) => void;
  onBlur?: () => void;
  depot?: DepotHoursInfo | null;
  /** "YYYY-MM-DD" — disables earlier dates in the date input. */
  minDate?: string;
  /** Time-slot interval in minutes. Defaults to 30. */
  slotInterval?: number;
  "aria-invalid"?: boolean;
  id?: string;
};

/**
 * Splits pickup/return selection into a date input + a time dropdown
 * whose options come from the selected depot's open/close hours for the
 * chosen date. Time is disabled until both a depot and a date are
 * chosen; a closed day shows "Closed this day" as the placeholder.
 *
 * Emits the combined "YYYY-MM-DDTHH:MM" string to the parent so the
 * existing form schema (`searchStepSchema` etc.) and server input
 * (`z.coerce.date()`) keep working unchanged.
 */
export function DateTimePicker({
  value,
  onChange,
  onBlur,
  depot,
  minDate,
  slotInterval = 30,
  id,
  ...rest
}: Props) {
  const parsed = splitLocalDateTime(value);
  // Track the date locally so a half-picked selection (date chosen, time
  // not yet) survives re-renders. combineLocalDateTime returns "" until
  // both halves exist, so relying solely on `value` would wipe the date
  // the instant the user picks it.
  const [localDate, setLocalDate] = useState(parsed.date);
  useEffect(() => {
    setLocalDate(parsed.date);
  }, [parsed.date]);

  const date = localDate;
  const time = parsed.time;

  const { slots, status } = useMemo(() => {
    if (!depot) return { slots: [] as string[], status: "no-depot" as const };
    if (!date) return { slots: [] as string[], status: "no-date" as const };
    const row = getHoursRowForDate(date, depot.operatingHours);
    if (!row) return { slots: [] as string[], status: "no-hours" as const };
    if (row.isClosed) return { slots: [] as string[], status: "closed" as const };
    return {
      slots: generateTimeSlots(row.openTime, row.closeTime, slotInterval),
      status: "open" as const,
    };
  }, [date, depot, slotInterval]);

  function handleDateChange(newDate: string) {
    setLocalDate(newDate);
    if (!newDate) {
      onChange("");
      return;
    }
    // Keep the current time only if it remains a valid slot for the new
    // date; otherwise drop it so the user re-picks deliberately.
    let keep = "";
    if (time && depot) {
      const row = getHoursRowForDate(newDate, depot.operatingHours);
      if (row && !row.isClosed) {
        const newSlots = generateTimeSlots(row.openTime, row.closeTime, slotInterval);
        if (newSlots.includes(time)) keep = time;
      }
    }
    onChange(combineLocalDateTime(newDate, keep));
  }

  const timeDisabled = status !== "open";
  const placeholder =
    status === "no-depot"
      ? "Pick a depot first"
      : status === "no-date"
        ? "Pick a date first"
        : status === "closed"
          ? "Closed this day"
          : status === "no-hours"
            ? "No hours listed"
            : "Select time…";

  return (
    <div className="grid grid-cols-[1fr_140px] gap-2">
      <Input
        id={id}
        type="date"
        value={date}
        min={minDate}
        onChange={(e) => handleDateChange(e.target.value)}
        onBlur={onBlur}
        aria-invalid={rest["aria-invalid"]}
      />
      <Select
        value={time || undefined}
        onValueChange={(v) => onChange(combineLocalDateTime(date, v))}
        disabled={timeDisabled}
      >
        <SelectTrigger aria-invalid={rest["aria-invalid"]} onBlur={onBlur}>
          <SelectValue placeholder={placeholder} />
        </SelectTrigger>
        <SelectContent>
          {slots.map((t) => (
            <SelectItem key={t} value={t}>
              {t}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
}
