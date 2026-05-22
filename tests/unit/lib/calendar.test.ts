import { describe, it, expect } from "vitest";
import { generateIcs, googleCalendarUrl } from "@/lib/calendar";

const sample = {
  uid: "booking-abc@xpertmoto.com.au",
  title: "Scooter hire: 125cc (SCT-20260420-0001)",
  description: "Pickup, return details.",
  location: "Byron Bay Depot",
  start: new Date("2026-05-01T09:00:00.000Z"),
  end: new Date("2026-05-05T17:00:00.000Z"),
};

describe("generateIcs", () => {
  it("produces a valid VCALENDAR envelope", () => {
    const ics = generateIcs(sample);
    expect(ics).toMatch(/^BEGIN:VCALENDAR\r\n/);
    expect(ics).toMatch(/END:VCALENDAR$/);
    expect(ics).toContain("BEGIN:VEVENT");
    expect(ics).toContain("END:VEVENT");
  });

  it("includes the UID, start, and end in UTC format", () => {
    const ics = generateIcs(sample);
    expect(ics).toContain(`UID:${sample.uid}`);
    expect(ics).toContain("DTSTART:20260501T090000Z");
    expect(ics).toContain("DTEND:20260505T170000Z");
  });

  it("escapes commas, semicolons, and newlines in text fields", () => {
    const ics = generateIcs({ ...sample, title: "Test; with, breaks\nhere" });
    expect(ics).toContain("SUMMARY:Test\\; with\\, breaks\\nhere");
  });

  it("omits optional fields when undefined", () => {
    const ics = generateIcs({ ...sample, description: undefined, location: undefined });
    expect(ics).not.toContain("DESCRIPTION:");
    expect(ics).not.toContain("LOCATION:");
  });
});

describe("googleCalendarUrl", () => {
  it("builds a render URL with the correct dates", () => {
    const url = googleCalendarUrl(sample);
    expect(url).toContain("https://www.google.com/calendar/render");
    expect(url).toContain("dates=20260501T090000Z%2F20260505T170000Z");
    expect(url).toContain("action=TEMPLATE");
  });
});
