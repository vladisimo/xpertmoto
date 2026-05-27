import { createHash } from "crypto";
import { afterEach, describe, expect, it } from "vitest";
import { checksumOf, urlToKey } from "../../../src/lib/storage";

describe("checksumOf", () => {
  it("returns the sha256 hex of the bytes", () => {
    const body = Buffer.from("hello world");
    const expected = createHash("sha256").update(body).digest("hex");
    expect(checksumOf(body)).toBe(expected);
  });

  it("is stable across Buffer and Uint8Array of the same bytes", () => {
    const bytes = [1, 2, 3, 4, 5];
    expect(checksumOf(Buffer.from(bytes))).toBe(checksumOf(Uint8Array.from(bytes)));
  });
});

describe("urlToKey", () => {
  const ENV_KEYS = ["S3_ENDPOINT", "S3_BUCKET", "S3_PUBLIC_URL"] as const;
  const saved: Record<string, string | undefined> = {};
  for (const k of ENV_KEYS) saved[k] = process.env[k];

  afterEach(() => {
    for (const k of ENV_KEYS) {
      if (saved[k] === undefined) delete process.env[k];
      else process.env[k] = saved[k];
    }
  });

  it("recovers the key from a local-dev /uploads URL", () => {
    expect(urlToKey("/uploads/vehicles/MTB-1/abc.png")).toBe("vehicles/MTB-1/abc.png");
  });

  it("recovers the key from an S3_PUBLIC_URL form", () => {
    process.env.S3_PUBLIC_URL = "https://cdn.example.com";
    delete process.env.S3_ENDPOINT;
    expect(urlToKey("https://cdn.example.com/vehicles/MTB-1/abc.png")).toBe(
      "vehicles/MTB-1/abc.png",
    );
  });

  it("recovers the key from an endpoint/bucket form", () => {
    delete process.env.S3_PUBLIC_URL;
    process.env.S3_ENDPOINT = "http://localhost:9000";
    process.env.S3_BUCKET = "xpertmoto";
    expect(urlToKey("http://localhost:9000/xpertmoto/vehicles/MTB-1/abc.png")).toBe(
      "vehicles/MTB-1/abc.png",
    );
  });

  it("returns null when the URL doesn't match the configured base", () => {
    delete process.env.S3_PUBLIC_URL;
    delete process.env.S3_ENDPOINT;
    expect(urlToKey("https://some-other-host.com/foo/bar.png")).toBeNull();
  });
});
