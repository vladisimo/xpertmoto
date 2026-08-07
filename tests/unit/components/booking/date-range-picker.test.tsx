import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { BookingDateRangePicker } from "@/components/booking/date-range-picker";
import type { DepotHoursInfo } from "@/components/booking/date-time-picker";

// Open 08:00–18:00 every day, no holidays — every generated slot is valid so
// the time Selects reach their "open" state as soon as a date exists.
const DEPOT: DepotHoursInfo = {
  operatingHours: Array.from({ length: 7 }, (_, dayOfWeek) => ({
    dayOfWeek,
    openTime: "08:00",
    closeTime: "18:00",
    isClosed: false,
    holidayDate: null,
  })),
};

/** A date safely in the future so the calendar never disables it. */
function futureYmd(offsetDays: number): string {
  const d = new Date();
  d.setDate(d.getDate() + offsetDays);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(
    d.getDate(),
  ).padStart(2, "0")}`;
}

function renderPicker(pickupValue: string, returnValue: string) {
  return render(
    <BookingDateRangePicker
      pickupValue={pickupValue}
      returnValue={returnValue}
      onPickupChange={() => undefined}
      onReturnChange={() => undefined}
      pickupDepot={DEPOT}
      returnDepot={DEPOT}
    />,
  );
}

describe("BookingDateRangePicker — time Selects stay controlled", () => {
  // Radix warns through console.warn, React DOM through console.error —
  // collect both so either flavour of the flip fails the test.
  const consoleLogs: string[] = [];

  beforeEach(() => {
    consoleLogs.length = 0;
    const capture = (...args: unknown[]) => {
      consoleLogs.push(args.map(String).join(" "));
    };
    vi.spyOn(console, "warn").mockImplementation(capture);
    vi.spyOn(console, "error").mockImplementation(capture);
  });

  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  function controlledSwitchLogs(): string[] {
    return consoleLogs.filter((msg) => /uncontrolled|controlled/i.test(msg));
  }

  it("logs no controlled/uncontrolled switch when dates arrive after mount", () => {
    // Mount empty (the state step 1 starts in), then hand both fields a real
    // date+time the way the calendar's onSelect does. Before the fix the
    // Selects mounted with `value={undefined}` and Radix warned here.
    const { rerender } = renderPicker("", "");
    expect(controlledSwitchLogs()).toEqual([]);

    rerender(
      <BookingDateRangePicker
        pickupValue={`${futureYmd(3)}T10:00`}
        returnValue={`${futureYmd(5)}T10:00`}
        onPickupChange={() => undefined}
        onReturnChange={() => undefined}
        pickupDepot={DEPOT}
        returnDepot={DEPOT}
      />,
    );

    expect(controlledSwitchLogs()).toEqual([]);
  });

  it("shows the placeholder while no time is selected", () => {
    renderPicker("", "");
    // "" must render exactly like `undefined` did: placeholder, not a value.
    expect(screen.getAllByText("Pick a date first")).toHaveLength(2);
  });

  it("shows the chosen time once the field carries one", () => {
    renderPicker(`${futureYmd(3)}T10:30`, `${futureYmd(5)}T14:00`);
    expect(screen.queryByText("10:30")).not.toBeNull();
    expect(screen.queryByText("14:00")).not.toBeNull();
  });
});
