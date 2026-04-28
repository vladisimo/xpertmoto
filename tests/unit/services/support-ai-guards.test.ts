import { describe, expect, it } from "vitest";
import {
  scrubCardDigits,
  mentionsMoneyDispute,
  mentionsRoadsideBreakdown,
} from "../../../src/server/services/support-ai";
import { buildSupportFaqText } from "../../../src/server/services/support-faq";

const SUPPORT_FAQ_TEXT = buildSupportFaqText({
  siteName: "Test Hire",
  legalName: "Test Hire Pty Ltd",
  abn: "12 345 678 901",
});

describe("scrubCardDigits", () => {
  it("redacts a bare 16-digit sequence", () => {
    expect(scrubCardDigits("my card is 4242424242424242 ok")).toMatch(/card-number-removed/);
  });
  it("redacts card with separators", () => {
    expect(scrubCardDigits("4242 4242 4242 4242")).toMatch(/card-number-removed/);
    expect(scrubCardDigits("4242-4242-4242-4242")).toMatch(/card-number-removed/);
  });
  it("leaves short numbers alone (booking refs)", () => {
    expect(scrubCardDigits("booking 12345")).toBe("booking 12345");
  });
});

describe("mentionsMoneyDispute", () => {
  it("detects refund keyword", () => {
    expect(mentionsMoneyDispute("I'd like a refund please")).toBe(true);
  });
  it("detects chargeback / dispute", () => {
    expect(mentionsMoneyDispute("I want to dispute this charge")).toBe(true);
    expect(mentionsMoneyDispute("chargeback")).toBe(true);
  });
  it("ignores benign payment language", () => {
    expect(mentionsMoneyDispute("how do I pay for my booking")).toBe(false);
  });
});

describe("mentionsRoadsideBreakdown", () => {
  it("detects stranded keyword", () => {
    expect(mentionsRoadsideBreakdown("I'm stranded on the road")).toBe(true);
  });
  it("detects won't start", () => {
    expect(mentionsRoadsideBreakdown("the scooter won't start")).toBe(true);
  });
  it("false-negatives for general queries", () => {
    expect(mentionsRoadsideBreakdown("how much is a 125cc for a week?")).toBe(false);
  });
});

describe("SUPPORT_FAQ_TEXT", () => {
  it("is GST-inclusive by wording", () => {
    expect(SUPPORT_FAQ_TEXT).toMatch(/GST-INCLUSIVE/);
    expect(SUPPORT_FAQ_TEXT).toMatch(/10%/);
  });
  it("tells the assistant to refuse card numbers", () => {
    expect(SUPPORT_FAQ_TEXT).toMatch(/card digits/);
  });
  it("tells the assistant to escalate on breakdown", () => {
    expect(SUPPORT_FAQ_TEXT).toMatch(/BREAKDOWN/);
  });
});
