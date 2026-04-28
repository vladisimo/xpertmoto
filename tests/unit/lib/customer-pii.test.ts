import { describe, expect, test, beforeEach } from "vitest";
import {
  readPiiField,
  writePiiField,
  needsEncryptionMigration,
} from "@/lib/customer-pii";
import { encryptSecret } from "@/lib/crypto";

beforeEach(() => {
  // Must be 32 bytes encoded as base64 (AES-256 key size). The previous
  // 32-char literal was not valid base64-to-32-bytes and is now rejected.
  process.env.SECRET_ENC_KEY = Buffer.alloc(32, 7).toString("base64");
});

describe("readPiiField", () => {
  test("returns plaintext when encrypted is null (legacy path)", () => {
    expect(readPiiField("QLD12345678", null)).toBe("QLD12345678");
  });

  test("decrypts when encrypted is present, ignoring plaintext", () => {
    const enc = encryptSecret("NSW87654321");
    expect(readPiiField("GARBAGE", enc as unknown)).toBe("NSW87654321");
  });

  test("returns null when both are missing", () => {
    expect(readPiiField(null, null)).toBeNull();
    expect(readPiiField(undefined, undefined)).toBeNull();
  });

  test("silently returns null on malformed envelope", () => {
    expect(readPiiField(null, { enc: "oops" })).toBeNull();
  });
});

describe("writePiiField", () => {
  test("encrypts a new value and nulls the plaintext column", () => {
    const update = writePiiField("licenceNumber", "licenceNumberEnc", "QLD111");
    expect(update.licenceNumber).toBeNull();
    expect(update.licenceNumberEnc).toMatchObject({
      enc: expect.any(String),
      iv: expect.any(String),
      tag: expect.any(String),
    });
  });

  test("clears both columns when input is empty/null", () => {
    expect(writePiiField("licenceNumber", "licenceNumberEnc", null)).toEqual({
      licenceNumber: null,
      licenceNumberEnc: null,
    });
    expect(writePiiField("licenceNumber", "licenceNumberEnc", "")).toEqual({
      licenceNumber: null,
      licenceNumberEnc: null,
    });
  });
});

describe("needsEncryptionMigration", () => {
  test("true when plaintext present and encrypted missing", () => {
    expect(needsEncryptionMigration("QLD123", null)).toBe(true);
  });

  test("false when encrypted already set", () => {
    const enc = encryptSecret("whatever");
    expect(needsEncryptionMigration("PLAIN", enc as unknown)).toBe(false);
  });

  test("false when plaintext is empty", () => {
    expect(needsEncryptionMigration(null, null)).toBe(false);
    expect(needsEncryptionMigration("", null)).toBe(false);
  });
});
