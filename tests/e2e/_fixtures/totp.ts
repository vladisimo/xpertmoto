import { TOTP, Secret } from "otpauth";

/**
 * Deterministic TOTP secret seeded for every back-office user (admin / manager
 * / staff) by prisma/seed.ts when running the e2e profile. Back-office layouts
 * hard-redirect to /totp/enroll unless UserTotp.enabled, so tests need a known
 * secret to generate valid 6-digit codes and clear the forced-2FA gate.
 *
 * The seed reads E2E_TOTP_SECRET from .env.e2e (this same value as the default)
 * — keep the two in sync. Base32, RFC 4648. Params below mirror src/lib/totp.ts
 * exactly (SHA1 / 6 digits / 30s) so generated codes verify server-side.
 */
export const E2E_TOTP_SECRET =
  process.env.E2E_TOTP_SECRET ?? "GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ";

export function totpNow(secret: string = E2E_TOTP_SECRET): string {
  return new TOTP({
    algorithm: "SHA1",
    digits: 6,
    period: 30,
    secret: Secret.fromBase32(secret),
  }).generate();
}
