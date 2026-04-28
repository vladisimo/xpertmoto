import { encryptSecret, decryptSecret, type EncryptedSecret } from "@/lib/crypto";

/**
 * Transparent read/write helpers for APP-11 encrypted PII fields on
 * CustomerProfile (licenceNumber, passportNumber).
 *
 * Storage layout during migration:
 *   - New writes: `*Enc` Json column holds the encrypted envelope,
 *     plaintext column is set to null.
 *   - Legacy rows: plaintext column still populated, `*Enc` is null.
 *   - Reads prefer encrypted, fall back to plaintext.
 *
 * Once `scripts/encrypt-licence-data.ts` has run everywhere, a follow-up
 * migration drops the plaintext columns entirely.
 */

/**
 * Read a PII field that may be stored either encrypted or in plaintext.
 * Returns the plaintext value (or null if unset). Never throws — a
 * malformed encrypted blob logs and returns null so one bad row can't
 * take down a customer-detail page.
 */
export function readPiiField(
  plain: string | null | undefined,
  encRaw: unknown,
): string | null {
  const enc = parseEncryptedEnvelope(encRaw);
  if (enc) {
    try {
      return decryptSecret(enc);
    } catch {
      return null;
    }
  }
  return plain ?? null;
}

/**
 * Build the Prisma update object for writing a PII field. Encrypts the
 * new value and clears any legacy plaintext in the same update.
 */
export function writePiiField(
  plainColumn: string,
  encColumn: string,
  value: string | null,
): Record<string, unknown> {
  if (value === null || value === undefined || value === "") {
    return { [plainColumn]: null, [encColumn]: null };
  }
  return {
    [plainColumn]: null,
    [encColumn]: encryptSecret(value) as unknown,
  };
}

/**
 * True if the row has plaintext PII that should be migrated. Used by
 * scripts/encrypt-licence-data.ts and the admin "Encryption status" card.
 */
export function needsEncryptionMigration(
  plain: string | null | undefined,
  encRaw: unknown,
): boolean {
  const enc = parseEncryptedEnvelope(encRaw);
  if (enc) return false;
  return !!(plain && plain.length > 0);
}

function parseEncryptedEnvelope(raw: unknown): EncryptedSecret | null {
  if (
    !raw ||
    typeof raw !== "object" ||
    typeof (raw as { enc?: unknown }).enc !== "string" ||
    typeof (raw as { iv?: unknown }).iv !== "string" ||
    typeof (raw as { tag?: unknown }).tag !== "string"
  ) {
    return null;
  }
  return raw as EncryptedSecret;
}
