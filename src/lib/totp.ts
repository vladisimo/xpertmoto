import { TOTP, Secret } from "otpauth";
import { createHash, randomBytes } from "node:crypto";
import bcrypt from "bcryptjs";
import { encryptSecret, decryptSecret } from "@/lib/crypto";
import type { EncryptedSecret } from "@/lib/crypto";

const ISSUER = "XPERT Moto";
const PERIOD_SECONDS = 30;
const DIGITS = 6;
const ALGORITHM = "SHA1"; // RFC 6238 recommends SHA1 for max authenticator-app compatibility

export type TotpEnrolment = {
  secretBase32: string;
  otpauthUrl: string;
  recoveryCodesPlain: string[];
  encryptedSecret: EncryptedSecret;
  hashedRecoveryCodes: string[];
};

/**
 * Generate a fresh TOTP secret for a user, render the otpauth:// URL the
 * authenticator app will scan, and mint 10 recovery codes. The plaintext
 * secret + plaintext recovery codes must be shown to the user ONCE at
 * enrolment; we persist only the encrypted secret and hashed codes.
 */
export function generateTotpEnrolment(email: string): TotpEnrolment {
  const secret = new Secret({ size: 20 }); // 160-bit, per RFC 4226
  const totp = new TOTP({
    issuer: ISSUER,
    label: email,
    algorithm: ALGORITHM,
    digits: DIGITS,
    period: PERIOD_SECONDS,
    secret,
  });
  const recoveryCodesPlain = Array.from({ length: 10 }, () => generateRecoveryCode());
  return {
    secretBase32: secret.base32,
    otpauthUrl: totp.toString(),
    recoveryCodesPlain,
    encryptedSecret: encryptSecret(secret.base32),
    hashedRecoveryCodes: recoveryCodesPlain.map(hashRecoveryCode),
  };
}

/**
 * Verify a 6-digit code against the stored encrypted secret. Accepts the
 * current window and the two adjacent windows (±30s each way) to tolerate
 * a small clock skew between the authenticator app and our server —
 * authenticator apps typically drift up to 90s in practice.
 */
export function verifyTotpCode(
  code: string,
  encryptedSecret: EncryptedSecret,
): boolean {
  if (!/^\d{6}$/.test(code)) return false;
  const secretBase32 = decryptSecret(encryptedSecret);
  const totp = new TOTP({
    issuer: ISSUER,
    algorithm: ALGORITHM,
    digits: DIGITS,
    period: PERIOD_SECONDS,
    secret: Secret.fromBase32(secretBase32),
  });
  // validate returns the window offset (0 = current, ±1 = adjacent) or null.
  const delta = totp.validate({ token: code, window: 1 });
  return delta !== null;
}

/**
 * Verify a recovery code against the stored (hashed) list. Returns the
 * index of the matched code so the caller can consume it — one-shot use.
 */
export function verifyRecoveryCode(
  submitted: string,
  hashedList: string[],
): { matched: true; index: number } | { matched: false } {
  const normalised = submitted.replace(/[\s-]/g, "").toLowerCase();
  if (!normalised) return { matched: false };
  for (let i = 0; i < hashedList.length; i += 1) {
    const hash = hashedList[i];
    if (typeof hash === "string" && bcrypt.compareSync(normalised, hash)) {
      return { matched: true, index: i };
    }
  }
  return { matched: false };
}

function generateRecoveryCode(): string {
  // 10 hex chars, formatted as two groups of 5 for readability. Not the
  // strongest entropy possible but 40 bits (~10^12) is more than enough
  // for a single-use emergency fallback protected by rate-limiting.
  const bytes = randomBytes(5);
  const hex = bytes.toString("hex");
  return `${hex.slice(0, 5)}-${hex.slice(5, 10)}`;
}

function hashRecoveryCode(plain: string): string {
  const normalised = plain.replace(/[\s-]/g, "").toLowerCase();
  return bcrypt.hashSync(normalised, 10);
}

/**
 * Fingerprint of an encrypted secret blob — used by equality checks in
 * tests without ever decrypting.
 */
export function fingerprintEncrypted(enc: EncryptedSecret): string {
  return createHash("sha256")
    .update(`${enc.enc}|${enc.iv}|${enc.tag}`)
    .digest("hex")
    .slice(0, 16);
}
