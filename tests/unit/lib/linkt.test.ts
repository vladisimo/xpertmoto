import { describe, it, expect } from "vitest";
import { parseLinktCsv, type LinktAccount } from "@/server/services/linkt";

const account: LinktAccount = {
  id: "acc_1",
  name: "Fleet VIC",
  region: "VIC",
  username: "ops@xpertmoto.com.au",
  passwordEnc: "enc",
  passwordIv: "iv",
  passwordTag: "tag",
  adminFeeCents: 2500,
};

describe("parseLinktCsv", () => {
  it("parses a well-formed CSV", () => {
    const soon = new Date().toISOString();
    const csv = [
      "Vehicle,Date/Time,Amount,Toll Location",
      `ABC 123,${soon},"$4.56",Bolte Bridge`,
      `XYZ 789,${soon},"$3.20",Burnley Tunnel`,
    ].join("\n");

    const rows = parseLinktCsv(csv, account, 30);
    expect(rows).toHaveLength(2);
    expect(rows[0]?.plate).toBe("ABC123");
    expect(rows[0]?.amountCents).toBe(456);
    expect(rows[0]?.issuer).toBe("Linkt-VIC");
    expect(rows[0]?.externalHash).toHaveLength(32);
  });

  it("skips trips older than the cutoff", () => {
    const old = new Date("2020-01-01T00:00:00Z").toISOString();
    const csv = [
      "Vehicle,Date,Cost,Toll Location",
      `ABC123,${old},"$1.00",Old Tollpoint`,
    ].join("\n");
    expect(parseLinktCsv(csv, account, 30)).toHaveLength(0);
  });

  it("handles QLD region mapping", () => {
    const now = new Date().toISOString();
    const csv = [
      "Vehicle,Date,Amount,Location",
      `QQQ 111,${now},$2.00,Gateway`,
    ].join("\n");
    const rows = parseLinktCsv(csv, { ...account, region: "QLD" }, 30);
    expect(rows[0]?.issuer).toBe("Linkt-QLD");
  });

  it("returns empty array on malformed CSV", () => {
    expect(parseLinktCsv("", account, 30)).toEqual([]);
  });
});
