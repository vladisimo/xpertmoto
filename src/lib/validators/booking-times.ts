import {
  isDateTimeWithinHours,
  type OperatingHoursRow,
  type HoursCheckFail,
} from "@/lib/opening-hours";

export type DepotForTimeCheck = {
  name: string;
  timezone: string;
  operatingHours: OperatingHoursRow[];
};

export type BookingTimesInput = {
  pickupDateTime: Date;
  returnDateTime: Date;
  pickupDepot: DepotForTimeCheck;
  returnDepot: DepotForTimeCheck;
};

export type BookingTimesResult =
  | { ok: true }
  | {
      ok: false;
      field: "pickupDateTime" | "returnDateTime";
      message: string;
    };

function formatFailure(
  depot: DepotForTimeCheck,
  side: "pickup" | "return",
  fail: HoursCheckFail,
): string {
  switch (fail.reason) {
    case "CLOSED_DAY":
      return `${depot.name} is closed on ${fail.weekdayName} — choose a different day or depot for your ${side}.`;
    case "NO_HOURS_CONFIGURED":
      return `${depot.name} doesn't publish hours for ${fail.weekdayName} — choose a different day or depot for your ${side}.`;
    case "BEFORE_OPEN":
      return `${depot.name} opens at ${fail.openTime} on ${fail.weekdayName} — your ${side} at ${fail.localTime} is before it opens.`;
    case "AFTER_CLOSE":
      return `${depot.name} closes at ${fail.closeTime} on ${fail.weekdayName} — your ${side} at ${fail.localTime} is after it closes.`;
  }
}

export function validateBookingTimes(
  input: BookingTimesInput,
): BookingTimesResult {
  const pickupCheck = isDateTimeWithinHours(
    input.pickupDateTime,
    input.pickupDepot.timezone,
    input.pickupDepot.operatingHours,
  );
  if (!pickupCheck.ok) {
    return {
      ok: false,
      field: "pickupDateTime",
      message: formatFailure(input.pickupDepot, "pickup", pickupCheck),
    };
  }
  const returnCheck = isDateTimeWithinHours(
    input.returnDateTime,
    input.returnDepot.timezone,
    input.returnDepot.operatingHours,
  );
  if (!returnCheck.ok) {
    return {
      ok: false,
      field: "returnDateTime",
      message: formatFailure(input.returnDepot, "return", returnCheck),
    };
  }
  return { ok: true };
}
