import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

/**
 * Read contract for integration-config after the admin "set integrations via
 * the WebUI" feature was removed:
 *
 *   - `integration:*` keys are ENV-ONLY: the DB row is never consulted, so a
 *     stale `integration:*` SystemSetting row can't override `.env`.
 *   - All other keys keep the DB-first-with-env-fallback behaviour (used for
 *     runtime state like the reconcile checkpoint / toll admin fee).
 */

const findUnique = vi.fn();

vi.mock("@/lib/prisma", () => ({
  prisma: { systemSetting: { findUnique: (...a: unknown[]) => findUnique(...a) } },
}));

vi.mock("@/lib/crypto", () => ({
  encryptSecret: vi.fn(),
  decryptSecret: vi.fn().mockReturnValue("decrypted-db-value"),
}));

beforeEach(() => {
  findUnique.mockReset();
  delete process.env.__IC_TEST_ENV;
});

afterEach(() => {
  delete process.env.__IC_TEST_ENV;
});

describe("integration-config read contract", () => {
  it("integration:* keys read from env and never touch the DB", async () => {
    const { getString, invalidateAll } = await import("@/lib/integration-config");
    invalidateAll();
    process.env.__IC_TEST_ENV = "from-env";
    // A DB row exists, but it must be ignored for integration:* keys.
    findUnique.mockResolvedValue({ value: { type: "string", value: "from-db" } });

    const v = await getString("integration:stripe:secretKey", "__IC_TEST_ENV");

    expect(v).toBe("from-env");
    expect(findUnique).not.toHaveBeenCalled();
  });

  it("integration:* keys resolve to null when the env var is unset", async () => {
    const { getString } = await import("@/lib/integration-config");
    findUnique.mockResolvedValue({ value: { type: "string", value: "from-db" } });

    const v = await getString("integration:resend:apiKey", "__IC_TEST_ENV");

    expect(v).toBeNull();
    expect(findUnique).not.toHaveBeenCalled();
  });

  it("getSource reports integration:* keys as env-backed (DB ignored)", async () => {
    const { getSource } = await import("@/lib/integration-config");
    process.env.__IC_TEST_ENV = "x";
    findUnique.mockResolvedValue({ value: { type: "secret", cipher: "c", iv: "i", tag: "t" } });

    expect(await getSource("integration:stripe:secretKey", "__IC_TEST_ENV")).toBe("env");
    expect(findUnique).not.toHaveBeenCalled();
  });

  it("non-integration keys still read DB-first", async () => {
    const { getString, invalidateAll } = await import("@/lib/integration-config");
    invalidateAll();
    findUnique.mockResolvedValue({ value: { type: "string", value: "from-db" } });

    const v = await getString("reconcile:stripe:lastCheckpointCreated", "__IC_TEST_ENV");

    expect(v).toBe("from-db");
    expect(findUnique).toHaveBeenCalled();
  });
});
