import { createHash, randomBytes } from "crypto";
import { logger } from "@/lib/logger";

/**
 * RFC3161 Time-Stamp Protocol client — minimal implementation.
 *
 * We build a TimeStampReq (ASN.1 DER) for a SHA-256 hash of the signed PDF,
 * POST it to the configured TSA, and store the raw TimeStampResp (.tsr) as
 * a detached timestamp. The stored .tsr can be verified at audit time via
 * any standard RFC3161 verifier (e.g. `openssl ts -verify`).
 *
 * Full parsing of the TimeStampResp is deferred to the verify-path (see
 * timestamp-verify.ts) — at seal time we only care that the TSA accepted
 * our request and returned a non-empty response.
 */

export type TimestampResult =
  | { ok: true; token: Buffer; tsaUrl: string; receivedAt: Date }
  | { ok: false; error: string; tsaUrl: string };

const TSA_URL_DEFAULT = "http://timestamp.digicert.com";
const REQUEST_TIMEOUT_MS = 5_000;

// ASN.1 tag bytes
const TAG_INTEGER = 0x02;
const TAG_OCTET_STRING = 0x04;
const TAG_NULL = 0x05;
const TAG_OID = 0x06;
const TAG_SEQUENCE = 0x30;
const TAG_BOOLEAN = 0x01;

const OID_SHA256 = [2, 16, 840, 1, 101, 3, 4, 2, 1];

export async function requestTimestamp(contentHash: Buffer, opts?: { tsaUrl?: string }): Promise<TimestampResult> {
  const tsaUrl = opts?.tsaUrl ?? process.env.TSA_URL ?? TSA_URL_DEFAULT;
  if (contentHash.length !== 32) {
    return { ok: false, error: "content hash must be SHA-256 (32 bytes)", tsaUrl };
  }

  const nonce = randomBytes(8);
  const req = buildTimestampRequest(contentHash, nonce);

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    const res = await fetch(tsaUrl, {
      method: "POST",
      headers: { "Content-Type": "application/timestamp-query" },
      body: new Uint8Array(req),
      signal: controller.signal,
    });
    if (!res.ok) {
      return { ok: false, error: `TSA HTTP ${res.status}`, tsaUrl };
    }
    const contentType = res.headers.get("content-type") ?? "";
    if (!contentType.includes("timestamp-reply") && !contentType.includes("octet-stream")) {
      logger.warn({ tsaUrl, contentType }, "unexpected TSA content-type");
    }
    const body = Buffer.from(await res.arrayBuffer());
    if (body.length < 16) {
      return { ok: false, error: "TSA response too short", tsaUrl };
    }
    // Response starts with SEQUENCE of PKIStatusInfo + TimeStampToken. We
    // don't parse here; storing the raw bytes is enough for later audit.
    return { ok: true, token: body, tsaUrl, receivedAt: new Date() };
  } catch (e) {
    const message = e instanceof Error ? e.message : "unknown error";
    logger.warn({ err: message, tsaUrl }, "TSA request failed");
    return { ok: false, error: message, tsaUrl };
  } finally {
    clearTimeout(timeout);
  }
}

export function sha256Buffer(buf: Buffer): Buffer {
  return createHash("sha256").update(buf).digest();
}

/**
 * Build a RFC3161 TimeStampReq DER-encoded:
 *
 *   TimeStampReq ::= SEQUENCE {
 *     version           INTEGER  { v1(1) },
 *     messageImprint    MessageImprint,
 *     reqPolicy         OPTIONAL (omitted),
 *     nonce             INTEGER,
 *     certReq           BOOLEAN (TRUE)
 *   }
 *
 *   MessageImprint ::= SEQUENCE {
 *     hashAlgorithm   AlgorithmIdentifier (SHA-256 OID + NULL),
 *     hashedMessage   OCTET STRING
 *   }
 */
function buildTimestampRequest(hash: Buffer, nonce: Buffer): Buffer {
  const version = derInteger(Buffer.from([0x01]));
  const hashAlg = derSequence(
    Buffer.concat([derOid(OID_SHA256), Buffer.from([TAG_NULL, 0x00])]),
  );
  const hashOctet = derPrimitive(TAG_OCTET_STRING, hash);
  const messageImprint = derSequence(Buffer.concat([hashAlg, hashOctet]));
  const nonceInt = derInteger(nonce);
  const certReq = Buffer.from([TAG_BOOLEAN, 0x01, 0xff]);
  return derSequence(Buffer.concat([version, messageImprint, nonceInt, certReq]));
}

function derLen(len: number): Buffer {
  if (len < 0x80) return Buffer.from([len]);
  if (len < 0x100) return Buffer.from([0x81, len]);
  if (len < 0x10000) return Buffer.from([0x82, (len >> 8) & 0xff, len & 0xff]);
  throw new Error("DER length too large");
}

function derPrimitive(tag: number, value: Buffer): Buffer {
  return Buffer.concat([Buffer.from([tag]), derLen(value.length), value]);
}

function derSequence(value: Buffer): Buffer {
  return derPrimitive(TAG_SEQUENCE, value);
}

function derInteger(raw: Buffer): Buffer {
  // Prepend 0x00 if high bit is set to avoid being treated as negative.
  const needsPad = raw.length > 0 && ((raw[0] ?? 0) & 0x80) !== 0;
  const body = needsPad ? Buffer.concat([Buffer.from([0x00]), raw]) : raw;
  return derPrimitive(TAG_INTEGER, body);
}

function derOid(components: number[]): Buffer {
  if (components.length < 2) throw new Error("OID must have at least 2 components");
  const first = (components[0] ?? 0) * 40 + (components[1] ?? 0);
  const parts: number[] = [first];
  for (let i = 2; i < components.length; i++) {
    parts.push(...base128(components[i] ?? 0));
  }
  return derPrimitive(TAG_OID, Buffer.from(parts));
}

function base128(n: number): number[] {
  if (n === 0) return [0];
  const out: number[] = [];
  while (n > 0) {
    out.unshift(n & 0x7f);
    n = n >>> 7;
  }
  for (let i = 0; i < out.length - 1; i++) out[i] = (out[i] ?? 0) | 0x80;
  return out;
}

// Re-export for unit testing
export const __testing = { buildTimestampRequest, derSequence, derInteger, derOid };
