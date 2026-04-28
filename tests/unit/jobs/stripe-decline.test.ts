import { describe, expect, test } from "vitest";
import {
  classifyStripeDecline,
  customerDeclineCopy,
} from "@/server/jobs/capture-pending-payments";

describe("classifyStripeDecline", () => {
  test("treats fraudulent, lost_card, stolen_card as fraud_block", () => {
    expect(classifyStripeDecline("fraudulent")).toBe("fraud_block");
    expect(classifyStripeDecline("lost_card")).toBe("fraud_block");
    expect(classifyStripeDecline("stolen_card")).toBe("fraud_block");
    expect(classifyStripeDecline("pickup_card")).toBe("fraud_block");
  });

  test("treats typical declines as hard_decline", () => {
    expect(classifyStripeDecline("card_declined")).toBe("hard_decline");
    expect(classifyStripeDecline("insufficient_funds")).toBe("hard_decline");
    expect(classifyStripeDecline("expired_card")).toBe("hard_decline");
    expect(classifyStripeDecline("incorrect_cvc")).toBe("hard_decline");
  });

  test("unknown or network errors default to retryable", () => {
    expect(classifyStripeDecline(undefined)).toBe("retryable");
    expect(classifyStripeDecline("processing_error")).toBe("retryable");
    expect(classifyStripeDecline("rate_limit")).toBe("retryable");
  });
});

describe("customerDeclineCopy", () => {
  test("fraud_block tells the customer to contact support, not retry", () => {
    const msg = customerDeclineCopy("fraudulent");
    expect(msg.toLowerCase()).toContain("contact");
    expect(msg.toLowerCase()).not.toContain("try a different");
  });

  test("hard_decline asks for another card", () => {
    const msg = customerDeclineCopy("insufficient_funds");
    expect(msg.toLowerCase()).toContain("declined");
    expect(msg.toLowerCase()).toContain("card");
  });

  test("retryable = generic retry copy", () => {
    const msg = customerDeclineCopy(undefined);
    expect(msg.toLowerCase()).toContain("try again");
  });
});
