import type { OperatingHoursRow } from "@/lib/opening-hours";

/**
 * Resolves which `DepotOperatingHours` row applies to a given local
 * calendar date ("YYYY-MM-DD"). Holiday overrides win over weekday rows
 * (same rule applied server-side in `opening-hours.ts`).
 */
export function getHoursRowForDate(
  dateStr: string,
  hours: OperatingHoursRow[],
): OperatingHoursRow | null {
  if (!dateStr) return null;
  const holiday = hours.find((h) => {
    if (!h.holidayDate) return false;
    const hd = h.holidayDate;
    const y = hd.getUTCFullYear();
    const m = String(hd.getUTCMonth() + 1).padStart(2, "0");
    const d = String(hd.getUTCDate()).padStart(2, "0");
    return `${y}-${m}-${d}` === dateStr;
  });
  if (holiday) return holiday;
  const [y, m, d] = dateStr.split("-").map(Number);
  if (!y || !m || !d) return null;
  const dayOfWeek = new Date(y, m - 1, d).getDay();
  return (
    hours.find((h) => h.holidayDate === null && h.dayOfWeek === dayOfWeek) ??
    null
  );
}

/**
 * Generates "HH:MM" time slots at a given interval between `openTime`
 * and `closeTime` (both inclusive — a depot that closes at 18:00 offers
 * an 18:00 slot as the last booking time).
 */
export function generateTimeSlots(
  openTime: string,
  closeTime: string,
  intervalMin: number = 30,
): string[] {
  const toMinutes = (s: string): number => {
    const [h, m] = s.split(":").map(Number);
    if (h === undefined || m === undefined) return NaN;
    if (!Number.isFinite(h) || !Number.isFinite(m)) return NaN;
    return h * 60 + m;
  };
  const start = toMinutes(openTime);
  const end = toMinutes(closeTime);
  if (
    !Number.isFinite(start) ||
    !Number.isFinite(end) ||
    end < start ||
    intervalMin <= 0
  ) {
    return [];
  }
  const slots: string[] = [];
  for (let t = start; t <= end; t += intervalMin) {
    const h = String(Math.floor(t / 60)).padStart(2, "0");
    const m = String(t % 60).padStart(2, "0");
    slots.push(`${h}:${m}`);
  }
  return slots;
}

/**
 * Splits a "YYYY-MM-DDTHH:MM" (datetime-local string) into its date and
 * time halves. Accepts partial values — missing halves return empty.
 */
export function splitLocalDateTime(
  value: string,
): { date: string; time: string } {
  if (!value) return { date: "", time: "" };
  const [date = "", rest = ""] = value.split("T");
  return { date, time: rest.slice(0, 5) };
}

/**
 * Recombines a date ("YYYY-MM-DD") and a time ("HH:MM") into the
 * datetime-local format the booking form expects. Returns an empty
 * string if either part is missing so the form's required-field
 * validator kicks in cleanly.
 */
export function combineLocalDateTime(date: string, time: string): string {
  if (!date || !time) return "";
  return `${date}T${time}`;
}
