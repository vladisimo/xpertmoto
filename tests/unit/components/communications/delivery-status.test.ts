import { describe, it, expect } from "vitest";
import { formatDeliveryNote, isSuppressed } from "@/components/communications/delivery-status";

describe("formatDeliveryNote", () => {
  it("returns null when there is no error message", () => {
    expect(formatDeliveryNote(null)).toBeNull();
    expect(formatDeliveryNote(undefined)).toBeNull();
    expect(formatDeliveryNote("")).toBeNull();
  });

  it("humanises a known suppression reason and flags it as suppressed", () => {
    const note = formatDeliveryNote("SUPPRESSED:channel_disabled");
    expect(note).toEqual({
      text: "Not delivered — this channel is turned off in admin notification settings.",
      suppressed: true,
    });
  });

  it("humanises the paused gate reason", () => {
    expect(formatDeliveryNote("SUPPRESSED:paused")?.text).toMatch(/all notifications are currently paused/i);
  });

  it("falls back to generic copy for an unknown suppression reason but stays suppressed", () => {
    const note = formatDeliveryNote("SUPPRESSED:some_future_reason");
    expect(note?.suppressed).toBe(true);
    expect(note?.text).toMatch(/suppressed by an admin notification setting/i);
  });

  it("passes a real provider error through unchanged with no detail", () => {
    const note = formatDeliveryNote("Twilio 21610: message blocked");
    expect(note).toEqual({ text: "Twilio 21610: message blocked", suppressed: false });
  });

  it("humanises a recognised internal/runtime error and keeps the raw text in detail", () => {
    const raw = "`cacheLife()` is only available with the `cacheComponents` config.";
    const note = formatDeliveryNote(raw);
    expect(note?.suppressed).toBe(false);
    expect(note?.text).toMatch(/server configuration error/i);
    expect(note?.detail).toBe(raw);
  });

  it("matches other Next cache-runtime fingerprints", () => {
    expect(formatDeliveryNote("static generation store missing")?.detail).toBeTruthy();
    expect(formatDeliveryNote("revalidateTag was called outside a request")?.text).toMatch(
      /server configuration error/i,
    );
  });
});

describe("isSuppressed", () => {
  it("is true only for SUPPRESSED-prefixed codes", () => {
    expect(isSuppressed("SUPPRESSED:channel_disabled")).toBe(true);
    expect(isSuppressed("SUPPRESSED:paused")).toBe(true);
  });

  it("is false for real errors and empty values", () => {
    expect(isSuppressed("Twilio 21610")).toBe(false);
    expect(isSuppressed(null)).toBe(false);
    expect(isSuppressed(undefined)).toBe(false);
    expect(isSuppressed("")).toBe(false);
  });
});
