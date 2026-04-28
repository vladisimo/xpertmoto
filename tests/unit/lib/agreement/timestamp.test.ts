import { describe, expect, it } from "vitest";
import { __testing, sha256Buffer } from "@/lib/agreement/timestamp";

describe("RFC3161 timestamp request encoder", () => {
  it("builds a well-formed DER SEQUENCE", () => {
    const hash = Buffer.alloc(32, 0x42);
    const nonce = Buffer.from([0x01, 0x02, 0x03, 0x04]);
    const req = __testing.buildTimestampRequest(hash, nonce);
    // DER SEQUENCE tag
    expect(req[0]).toBe(0x30);
    // SEQUENCE length at least > 40 (version + messageImprint + nonce + certReq)
    expect(req.length).toBeGreaterThan(40);
    // Find SHA-256 OID (2.16.840.1.101.3.4.2.1) bytes somewhere in the request.
    // OID bytes: 0x60 0x86 0x48 0x01 0x65 0x03 0x04 0x02 0x01
    const oidBytes = Buffer.from([0x60, 0x86, 0x48, 0x01, 0x65, 0x03, 0x04, 0x02, 0x01]);
    expect(req.indexOf(oidBytes)).toBeGreaterThanOrEqual(0);
    // The hash must appear verbatim in the imprint
    expect(req.indexOf(hash)).toBeGreaterThanOrEqual(0);
  });

  it("pads high-bit integers so they stay positive", () => {
    const bigHigh = Buffer.from([0xff, 0xff]);
    const encoded = __testing.derInteger(bigHigh);
    // tag + length + 0x00 pad + 0xff 0xff = 5 bytes
    expect(encoded.length).toBe(5);
    expect(encoded[0]).toBe(0x02);
    expect(encoded[2]).toBe(0x00);
  });

  it("encodes SHA-256 OID to the expected 9-byte sequence", () => {
    // SHA-256: 2.16.840.1.101.3.4.2.1 → encoded: 60 86 48 01 65 03 04 02 01 (9 bytes)
    const oid = __testing.derOid([2, 16, 840, 1, 101, 3, 4, 2, 1]);
    // Tag (0x06) + length byte + 9 content bytes = 11 bytes total
    expect(oid[0]).toBe(0x06);
    expect(oid[1]).toBe(0x09);
    expect(oid.length).toBe(11);
  });
});

describe("sha256Buffer", () => {
  it("returns a 32-byte buffer", () => {
    const hash = sha256Buffer(Buffer.from("hello world"));
    expect(hash.length).toBe(32);
    // Stable value for "hello world"
    expect(hash.toString("hex")).toBe(
      "b94d27b9934d3e08a52e52d7da7dabfac484efe37a5380ee9088f7ace2efcde9",
    );
  });
});
