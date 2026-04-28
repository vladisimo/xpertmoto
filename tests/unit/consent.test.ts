import { describe, expect, test } from "vitest";
import { canSend, categoryForType } from "../../src/server/services/consent";

type MockUser = {
  id: string;
  email: string | null;
  phone: string | null;
  status: "ACTIVE" | "SUSPENDED" | "BANNED";
  deletedAt: Date | null;
  customerProfile: {
    marketingOptIn: boolean;
    marketingSmsOptIn: boolean;
    marketingEmailUnsubscribedAt: Date | null;
    marketingSmsUnsubscribedAt: Date | null;
  } | null;
};

function makePrisma(user: MockUser | null) {
  return {
    user: {
      findUnique: async () => user,
    },
  } as unknown as Parameters<typeof canSend>[1];
}

const baseUser = (overrides: Partial<MockUser> = {}): MockUser => ({
  id: "u1",
  email: "x@test.com",
  phone: "+61400000000",
  status: "ACTIVE",
  deletedAt: null,
  customerProfile: {
    marketingOptIn: false,
    marketingSmsOptIn: false,
    marketingEmailUnsubscribedAt: null,
    marketingSmsUnsubscribedAt: null,
  },
  ...overrides,
});

describe("canSend — consent gate", () => {
  test("transactional email to opted-out customer is allowed", async () => {
    const res = await canSend(
      { customerId: "u1", type: "BOOKING_CONFIRMATION", category: "TRANSACTIONAL", channel: "EMAIL" },
      makePrisma(baseUser({ customerProfile: { ...baseUser().customerProfile!, marketingOptIn: false } })),
    );
    expect(res).toEqual({ allowed: true });
  });

  test("marketing email denied when marketingOptIn=false", async () => {
    const res = await canSend(
      { customerId: "u1", type: "MARKETING_PROMOTIONAL", category: "MARKETING", channel: "EMAIL" },
      makePrisma(baseUser()),
    );
    expect(res).toEqual({ allowed: false, reason: "EMAIL_OPT_OUT" });
  });

  test("marketing email allowed when opted in and no unsubscribe", async () => {
    const res = await canSend(
      { customerId: "u1", type: "MARKETING_PROMOTIONAL", category: "MARKETING", channel: "EMAIL" },
      makePrisma(
        baseUser({
          customerProfile: { ...baseUser().customerProfile!, marketingOptIn: true },
        }),
      ),
    );
    expect(res).toEqual({ allowed: true });
  });

  test("marketing email suppressed when unsubscribe timestamp set even if opted in", async () => {
    const res = await canSend(
      { customerId: "u1", type: "MARKETING_PROMOTIONAL", category: "MARKETING", channel: "EMAIL" },
      makePrisma(
        baseUser({
          customerProfile: {
            ...baseUser().customerProfile!,
            marketingOptIn: true,
            marketingEmailUnsubscribedAt: new Date(),
          },
        }),
      ),
    );
    expect(res).toEqual({ allowed: false, reason: "EMAIL_UNSUBSCRIBED" });
  });

  test("marketing SMS denied when marketingSmsOptIn=false (even if email opted in)", async () => {
    const res = await canSend(
      { customerId: "u1", type: "MARKETING_PROMOTIONAL", category: "MARKETING", channel: "SMS" },
      makePrisma(
        baseUser({
          customerProfile: {
            ...baseUser().customerProfile!,
            marketingOptIn: true,
            marketingSmsOptIn: false,
          },
        }),
      ),
    );
    expect(res).toEqual({ allowed: false, reason: "SMS_OPT_OUT" });
  });

  test("banned user is denied regardless of category", async () => {
    const res = await canSend(
      { customerId: "u1", type: "BOOKING_CONFIRMATION", category: "TRANSACTIONAL", channel: "EMAIL" },
      makePrisma(baseUser({ status: "BANNED" })),
    );
    expect(res).toEqual({ allowed: false, reason: "CUSTOMER_SUSPENDED" });
  });

  test("deleted user denied", async () => {
    const res = await canSend(
      { customerId: "u1", type: "BOOKING_CONFIRMATION", category: "TRANSACTIONAL", channel: "EMAIL" },
      makePrisma(baseUser({ deletedAt: new Date() })),
    );
    expect(res).toEqual({ allowed: false, reason: "CUSTOMER_DELETED" });
  });

  test("customer with no email is denied email channel", async () => {
    const res = await canSend(
      { customerId: "u1", type: "BOOKING_CONFIRMATION", category: "TRANSACTIONAL", channel: "EMAIL" },
      makePrisma(baseUser({ email: null })),
    );
    expect(res).toEqual({ allowed: false, reason: "NO_EMAIL_ADDRESS" });
  });

  test("customer with no phone is denied SMS", async () => {
    const res = await canSend(
      { customerId: "u1", type: "BOOKING_REMINDER", category: "TRANSACTIONAL", channel: "SMS" },
      makePrisma(baseUser({ phone: null })),
    );
    expect(res).toEqual({ allowed: false, reason: "NO_PHONE_NUMBER" });
  });

  test("non-existent customer denied", async () => {
    const res = await canSend(
      { customerId: "u1", type: "BOOKING_CONFIRMATION", category: "TRANSACTIONAL", channel: "EMAIL" },
      makePrisma(null),
    );
    expect(res).toEqual({ allowed: false, reason: "CUSTOMER_NOT_FOUND" });
  });

  test("IN_APP is always allowed for existing active user", async () => {
    const res = await canSend(
      { customerId: "u1", type: "MARKETING_PROMOTIONAL", category: "MARKETING", channel: "IN_APP" },
      makePrisma(baseUser()),
    );
    expect(res).toEqual({ allowed: true });
  });
});

describe("categoryForType", () => {
  test("MARKETING_* types map to MARKETING", () => {
    expect(categoryForType("MARKETING_PROMOTIONAL")).toBe("MARKETING");
    expect(categoryForType("MARKETING_BIRTHDAY")).toBe("MARKETING");
  });

  test("profile updates map to ACCOUNT", () => {
    expect(categoryForType("PROFILE_UPDATED_SELF")).toBe("ACCOUNT");
    expect(categoryForType("PROFILE_UPDATED_STAFF")).toBe("ACCOUNT");
    expect(categoryForType("LICENCE_EXPIRING")).toBe("ACCOUNT");
  });

  test("ops reports map to OPERATIONAL", () => {
    expect(categoryForType("DAILY_OPS_SUMMARY")).toBe("OPERATIONAL");
    expect(categoryForType("VEHICLE_EXPIRY")).toBe("OPERATIONAL");
    expect(categoryForType("WORK_ORDER_ASSIGNED")).toBe("OPERATIONAL");
  });

  test("booking lifecycle defaults to TRANSACTIONAL", () => {
    expect(categoryForType("BOOKING_CONFIRMATION")).toBe("TRANSACTIONAL");
    expect(categoryForType("PAYMENT_RECEIVED")).toBe("TRANSACTIONAL");
    expect(categoryForType("BOND_RELEASED")).toBe("TRANSACTIONAL");
  });
});
