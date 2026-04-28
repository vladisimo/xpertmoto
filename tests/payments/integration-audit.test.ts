import { describe, it, expect, vi, beforeEach } from "vitest";

/**
 * G24 — integration-config secret rotation audit.
 *
 *   - setSecret writes an AuditLog row with action "integration.secret_rotated".
 *   - setString with an "integration:*" key writes "integration.value_set".
 *   - setString with a non-integration key does NOT write an audit row.
 *   - AuditLog write failure is swallowed and does not block the setSecret call.
 *   - No payload value leaks into the audit row.
 */

const upsert = vi.fn().mockResolvedValue({});
const del = vi.fn().mockResolvedValue({});
const auditCreate = vi.fn().mockResolvedValue({});

vi.mock("@/lib/prisma", () => ({
  prisma: {
    systemSetting: {
      upsert: (...args: unknown[]) => upsert(...args),
      delete: (...args: unknown[]) => del(...args),
    },
    auditLog: { create: (...args: unknown[]) => auditCreate(...args) },
  },
}));

vi.mock("@/lib/crypto", () => ({
  encryptSecret: vi.fn().mockImplementation(() => ({
    cipher: "enc",
    iv: "iv",
    tag: "tag",
  })),
  decryptSecret: vi.fn().mockReturnValue("decoded"),
}));

beforeEach(() => {
  upsert.mockClear();
  del.mockClear();
  auditCreate.mockClear();
});

describe("G24 — integration-config audit", () => {
  it("setSecret writes an 'integration.secret_rotated' audit row", async () => {
    const { setSecret } = await import("@/lib/integration-config");
    await setSecret("integration:stripe:secretKey", "sk_test_abc");
    expect(upsert).toHaveBeenCalled();
    const auditArgs = auditCreate.mock.calls[0]?.[0] as {
      data: { action: string; entityId: string; newData: { sensitive: boolean } };
    };
    expect(auditArgs.data.action).toBe("integration.secret_rotated");
    expect(auditArgs.data.entityId).toBe("integration:stripe:secretKey");
    expect(auditArgs.data.newData.sensitive).toBe(true);
  });

  it("setString with integration:* key audits value_set", async () => {
    const { setString } = await import("@/lib/integration-config");
    await setString("integration:stripe:webhookUrl", "https://example.com/hook");
    const auditArgs = auditCreate.mock.calls[0]?.[0] as { data: { action: string } };
    expect(auditArgs.data.action).toBe("integration.value_set");
  });

  it("setString with non-integration key does NOT audit", async () => {
    const { setString } = await import("@/lib/integration-config");
    await setString("some:unrelated:key", "value");
    expect(auditCreate).not.toHaveBeenCalled();
  });

  it("never includes the secret value in the audit row", async () => {
    const { setSecret } = await import("@/lib/integration-config");
    await setSecret("integration:stripe:secretKey", "sk_test_TOP_SECRET_12345");
    const auditArgs = auditCreate.mock.calls[0]?.[0] as {
      data: { newData: Record<string, unknown> };
    };
    const serialised = JSON.stringify(auditArgs);
    expect(serialised).not.toContain("sk_test_TOP_SECRET_12345");
  });

  it("audit write failure does not break setSecret", async () => {
    auditCreate.mockRejectedValueOnce(new Error("audit db down"));
    const { setSecret } = await import("@/lib/integration-config");
    await expect(setSecret("integration:stripe:secretKey", "sk_test_b")).resolves.toBeUndefined();
    expect(upsert).toHaveBeenCalled();
  });
});
