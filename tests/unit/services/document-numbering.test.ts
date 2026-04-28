import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const $queryRaw = vi.fn();
const $transaction = vi.fn(async (cb: (tx: unknown) => Promise<unknown>) => cb({ $queryRaw }));
const findMany = vi.fn();

vi.mock("@/lib/prisma", () => ({
  prisma: {
    $transaction: (cb: (tx: unknown) => Promise<unknown>) => $transaction(cb),
    systemSetting: {
      findMany: (...args: unknown[]) => findMany(...args),
    },
  },
}));

// `Prisma.sql` is a tagged template helper used by the service. The runtime
// behaviour we need from the mock is just an object that the mocked
// `$queryRaw` function can ignore — it's the resolved value that matters.
vi.mock("@prisma/client", () => ({
  Prisma: {
    sql: (..._args: unknown[]) => ({ __sql: true }),
  },
}));

import {
  allocateDocumentNumber,
  australianFinancialYear,
  nextDocumentNumber,
} from "@/server/services/document-numbering";

beforeEach(() => {
  $queryRaw.mockReset();
  $transaction.mockClear();
  findMany.mockReset();
  // Default empty SystemSetting result so getInvoicingConfig falls back to defaults.
  findMany.mockResolvedValue([]);
});

afterEach(() => {
  vi.useRealTimers();
});

describe("australianFinancialYear", () => {
  it("returns same calendar year for January–June dates", () => {
    expect(australianFinancialYear(new Date("2026-03-14T00:00:00Z"))).toBe(2026);
    expect(australianFinancialYear(new Date("2026-06-30T13:59:00Z"))).toBe(2026);
  });

  it("rolls over on 1 July (Brisbane local)", () => {
    // 1 July 2026 00:00 Brisbane = 30 June 2026 14:00 UTC.
    expect(australianFinancialYear(new Date("2026-06-30T14:00:00Z"))).toBe(2027);
    expect(australianFinancialYear(new Date("2026-07-15T00:00:00Z"))).toBe(2027);
  });

  it("returns calendar year + 1 for July–December dates", () => {
    expect(australianFinancialYear(new Date("2025-08-01T00:00:00Z"))).toBe(2026);
    expect(australianFinancialYear(new Date("2025-12-31T13:00:00Z"))).toBe(2026);
  });
});

describe("nextDocumentNumber", () => {
  it("formats INV numbers with default prefix and 6-digit FY-padded sequence", async () => {
    $queryRaw.mockResolvedValueOnce([{ nextValue: 1 }]);
    const tx = { $queryRaw } as never;

    const num = await nextDocumentNumber({
      tx,
      type: "INVOICE",
      issuedAt: new Date("2026-03-14T00:00:00Z"),
    });

    expect(num).toBe("INV-2026-000001");
    expect($queryRaw).toHaveBeenCalledTimes(1);
  });

  it("uses adjustment prefix for ADJUSTMENT_NOTE", async () => {
    $queryRaw.mockResolvedValueOnce([{ nextValue: 42 }]);
    const tx = { $queryRaw } as never;

    const num = await nextDocumentNumber({
      tx,
      type: "ADJUSTMENT_NOTE",
      issuedAt: new Date("2026-03-14T00:00:00Z"),
    });

    expect(num).toBe("ADJ-2026-000042");
  });

  it("uses receipt prefix for RECEIPT", async () => {
    $queryRaw.mockResolvedValueOnce([{ nextValue: 7 }]);
    const tx = { $queryRaw } as never;

    const num = await nextDocumentNumber({
      tx,
      type: "RECEIPT",
      issuedAt: new Date("2026-03-14T00:00:00Z"),
    });

    expect(num).toBe("RCT-2026-000007");
  });

  it("respects FY rollover — issue date 1 July 2026 produces FY 2027", async () => {
    $queryRaw.mockResolvedValueOnce([{ nextValue: 1 }]);
    const tx = { $queryRaw } as never;

    const num = await nextDocumentNumber({
      tx,
      type: "INVOICE",
      issuedAt: new Date("2026-07-01T01:00:00+10:00"),
    });

    expect(num).toBe("INV-2027-000001");
  });

  it("respects an operator-overridden prefix", async () => {
    findMany.mockResolvedValueOnce([
      { key: "org.invoicePrefix", value: "TX" },
    ]);
    $queryRaw.mockResolvedValueOnce([{ nextValue: 1 }]);
    const tx = { $queryRaw } as never;

    const num = await nextDocumentNumber({
      tx,
      type: "INVOICE",
      issuedAt: new Date("2026-03-14T00:00:00Z"),
    });

    expect(num).toBe("TX-2026-000001");
  });

  it("throws if the counter query returns no rows", async () => {
    $queryRaw.mockResolvedValueOnce([]);
    const tx = { $queryRaw } as never;

    await expect(
      nextDocumentNumber({
        tx,
        type: "INVOICE",
        issuedAt: new Date("2026-03-14T00:00:00Z"),
      }),
    ).rejects.toThrow(/failed to read next value/);
  });
});

describe("allocateDocumentNumber", () => {
  it("opens a transaction and delegates to nextDocumentNumber", async () => {
    $queryRaw.mockResolvedValueOnce([{ nextValue: 1 }]);

    const num = await allocateDocumentNumber("INVOICE", new Date("2026-03-14T00:00:00Z"));

    expect(num).toBe("INV-2026-000001");
    expect($transaction).toHaveBeenCalledTimes(1);
  });
});
