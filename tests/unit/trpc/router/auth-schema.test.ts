import { describe, expect, test } from "vitest";
import { registerInputSchema, loginInputSchema } from "@/lib/validators/auth";

// Minimal valid payload for the tests that aren't exercising consent. Each
// test extends this with the field under test, so the consent flags don't
// have to be repeated in every case.
const validBase = {
  email: "a@b.com",
  password: "TenChars9!X",
  firstName: "A",
  lastName: "B",
  acceptedTerms: true as const,
  acceptedPrivacy: true as const,
};

describe("registerInputSchema", () => {
  test("accepts a valid customer sign-up payload", () => {
    const r = registerInputSchema.safeParse({
      email: "sarah.smith@example.com",
      password: "CorrectHorse9!Battery",
      firstName: "Sarah",
      lastName: "Smith",
      phone: "+61412345678",
      dateOfBirth: "1992-05-14",
      marketingOptIn: true,
      marketingSmsOptIn: true,
      acceptedTerms: true,
      acceptedPrivacy: true,
    });
    expect(r.success).toBe(true);
    if (r.success) {
      expect(r.data.email).toBe("sarah.smith@example.com");
      expect(r.data.dateOfBirth).toBeInstanceOf(Date);
      expect(r.data.marketingOptIn).toBe(true);
      expect(r.data.marketingSmsOptIn).toBe(true);
      expect(r.data.acceptedTerms).toBe(true);
      expect(r.data.acceptedPrivacy).toBe(true);
    }
  });

  test("defaults marketingOptIn and marketingSmsOptIn to false when omitted", () => {
    const r = registerInputSchema.safeParse(validBase);
    expect(r.success).toBe(true);
    if (r.success) {
      expect(r.data.marketingOptIn).toBe(false);
      expect(r.data.marketingSmsOptIn).toBe(false);
    }
  });

  test("rejects when acceptedTerms is missing", () => {
    const { acceptedTerms: _, ...rest } = validBase;
    void _;
    const r = registerInputSchema.safeParse(rest);
    expect(r.success).toBe(false);
    if (!r.success) {
      expect(r.error.issues.some((i) => i.path[0] === "acceptedTerms")).toBe(true);
    }
  });

  test("rejects when acceptedTerms is false", () => {
    const r = registerInputSchema.safeParse({ ...validBase, acceptedTerms: false });
    expect(r.success).toBe(false);
    if (!r.success) {
      expect(r.error.issues.some((i) => i.path[0] === "acceptedTerms")).toBe(true);
    }
  });

  test("rejects when acceptedPrivacy is missing", () => {
    const { acceptedPrivacy: _, ...rest } = validBase;
    void _;
    const r = registerInputSchema.safeParse(rest);
    expect(r.success).toBe(false);
    if (!r.success) {
      expect(r.error.issues.some((i) => i.path[0] === "acceptedPrivacy")).toBe(true);
    }
  });

  test("rejects when acceptedPrivacy is false", () => {
    const r = registerInputSchema.safeParse({ ...validBase, acceptedPrivacy: false });
    expect(r.success).toBe(false);
    if (!r.success) {
      expect(r.error.issues.some((i) => i.path[0] === "acceptedPrivacy")).toBe(true);
    }
  });

  test("rejects passwords under 10 characters", () => {
    const r = registerInputSchema.safeParse({ ...validBase, password: "short" });
    expect(r.success).toBe(false);
    if (!r.success) {
      const msgs = r.error.issues.map((i) => i.message);
      expect(msgs.some((m) => /at least 10/.test(m))).toBe(true);
    }
  });

  test("rejects malformed email addresses", () => {
    const r = registerInputSchema.safeParse({ ...validBase, email: "not-an-email" });
    expect(r.success).toBe(false);
    if (!r.success) {
      expect(r.error.issues.some((i) => i.path[0] === "email")).toBe(true);
    }
  });

  test("rejects blank firstName/lastName", () => {
    const r = registerInputSchema.safeParse({
      ...validBase,
      firstName: "",
      lastName: "",
    });
    expect(r.success).toBe(false);
    if (!r.success) {
      const paths = r.error.issues.map((i) => i.path[0]);
      expect(paths).toContain("firstName");
      expect(paths).toContain("lastName");
    }
  });

  test("normalises empty phone string to undefined", () => {
    const r = registerInputSchema.safeParse({ ...validBase, phone: "" });
    expect(r.success).toBe(true);
    if (r.success) expect(r.data.phone).toBeUndefined();
  });

  test("coerces DOB strings into Date instances", () => {
    const r = registerInputSchema.safeParse({ ...validBase, dateOfBirth: "1990-01-01" });
    expect(r.success).toBe(true);
    if (r.success) {
      expect(r.data.dateOfBirth?.getUTCFullYear()).toBe(1990);
    }
  });
});

describe("loginInputSchema", () => {
  test("accepts a valid email + any non-empty password", () => {
    const r = loginInputSchema.safeParse({ email: "a@b.com", password: "x" });
    expect(r.success).toBe(true);
  });

  test("rejects empty password (login still needs a value to compare)", () => {
    const r = loginInputSchema.safeParse({ email: "a@b.com", password: "" });
    expect(r.success).toBe(false);
  });

  test("rejects malformed email", () => {
    const r = loginInputSchema.safeParse({ email: "not-an-email", password: "x" });
    expect(r.success).toBe(false);
  });
});
