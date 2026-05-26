import { revalidateTag } from "next/cache";
import { prisma } from "@/lib/prisma";
import { encryptSecret, decryptSecret, type EncryptedSecret } from "@/lib/crypto";
import { logger } from "@/lib/logger";

/**
 * Typed accessor over the `SystemSetting` key/value store, with plain strings
 * saved as `{ type: "string", value }` and secrets as
 * `{ type: "secret", enc, iv, tag }` (AES-256-GCM, same helper that protects
 * E-Toll passwords).
 *
 * **Integration credentials (`integration:*` keys) are env-only.** The admin
 * WebUI for editing them was removed — `.env` is now the single source of
 * truth, so reads of `integration:*` keys bypass the DB entirely and resolve
 * straight from `process.env.<envFallback>`. This keeps stale `integration:*`
 * rows (left over from the old WebUI) from silently overriding the environment.
 *
 * All other keys (runtime state like the Stripe reconcile checkpoint
 * `reconcile:*` or the toll admin fee `infringement:*`) still use the DB
 * store with an env fallback. A small in-memory cache (5s TTL) reduces Prisma
 * hits on hot paths.
 */

type PlainValue = { type: "string"; value: string };
type SecretValue = { type: "secret" } & EncryptedSecret;
type ConfigValue = PlainValue | SecretValue;

const CACHE_MS = 5_000;
const cache = new Map<string, { value: string | null; expiresAt: number }>();

function invalidate(key: string) {
  cache.delete(key);
  safeRevalidate();
}

export function invalidateAll() {
  cache.clear();
  safeRevalidate();
}

/**
 * `revalidateTag` throws with "static generation store missing" when called
 * outside a Next.js request context (unit tests, one-off scripts, BullMQ
 * workers). The in-memory `cache` has already been cleared above, so a
 * missing revalidate just means the Next fetch cache retains a stale row
 * until the next request triggers a re-read — acceptable for this table.
 */
function safeRevalidate(): void {
  try {
    revalidateTag("integration-config", "max");
  } catch {
    // swallow — see JSDoc above
  }
}

async function readRaw(key: string): Promise<string | null> {
  const hit = cache.get(key);
  if (hit && hit.expiresAt > Date.now()) return hit.value;

  const row = await prisma.systemSetting.findUnique({ where: { key } }).catch(() => null);
  let value: string | null = null;
  if (row) {
    const v = row.value as unknown as ConfigValue | null;
    if (v?.type === "string") value = v.value;
    else if (v?.type === "secret") {
      try {
        value = decryptSecret(v);
      } catch (err) {
        logger.error(
          { err: err instanceof Error ? err.message : String(err), key },
          "integration-config: failed to decrypt secret",
        );
        value = null;
      }
    }
  }
  cache.set(key, { value, expiresAt: Date.now() + CACHE_MS });
  return value;
}

export async function getString(
  key: string,
  envFallback?: string,
): Promise<string | null> {
  // Integration credentials are env-only — never read their DB row (see file
  // JSDoc). Other keys keep the DB-first-with-env-fallback behaviour.
  if (!key.startsWith("integration:")) {
    const db = await readRaw(key);
    if (db != null && db !== "") return db;
  }
  if (envFallback && process.env[envFallback]) return process.env[envFallback]!;
  return null;
}

export async function getSecret(
  key: string,
  envFallback?: string,
): Promise<string | null> {
  return getString(key, envFallback);
}

export async function setString(key: string, value: string): Promise<void> {
  const payload: PlainValue = { type: "string", value };
  await prisma.systemSetting.upsert({
    where: { key },
    create: { key, value: payload, group: deriveGroup(key) },
    update: { value: payload },
  });
  invalidate(key);
  await auditIntegrationWrite(key, "string", false);
}

export async function setSecret(key: string, plaintext: string): Promise<void> {
  const enc = encryptSecret(plaintext);
  const payload: SecretValue = { type: "secret", ...enc };
  await prisma.systemSetting.upsert({
    where: { key },
    create: { key, value: payload, group: deriveGroup(key) },
    update: { value: payload },
  });
  invalidate(key);
  await auditIntegrationWrite(key, "secret", true);
}

/**
 * G24 — record every integration / secret write to AuditLog so rotations
 * leave a paper trail. We never log the value — only the key, the
 * write-kind, and whether it was encrypted. Failures are swallowed so an
 * AuditLog schema issue never blocks a config write.
 */
async function auditIntegrationWrite(
  key: string,
  kind: "string" | "secret",
  sensitive: boolean,
): Promise<void> {
  if (!key.startsWith("integration:") && !sensitive) return; // only audit integration:* and secrets
  try {
    await prisma.auditLog.create({
      data: {
        category: "MUTATION",
        action: sensitive ? "integration.secret_rotated" : "integration.value_set",
        entity: "SystemSetting",
        entityId: key,
        method: "CONFIG",
        path: "integration-config",
        status: "SUCCESS",
        newData: { key, kind, sensitive },
      },
    });
  } catch {
    // Do not let audit failure break the rotation.
  }
}

export async function clearValue(key: string): Promise<void> {
  await prisma.systemSetting.delete({ where: { key } }).catch(() => null);
  invalidate(key);
}

function deriveGroup(key: string): string {
  const [, service] = key.split(":");
  return service ? `integration:${service}` : "integration";
}

/**
 * Get the effective source of a config value without reading its contents.
 * Useful for admin UI to show where a given value comes from.
 */
export async function getSource(
  key: string,
  envFallback?: string,
): Promise<"db-string" | "db-secret" | "env" | "unset"> {
  // Integration credentials never resolve from the DB (see file JSDoc).
  if (!key.startsWith("integration:")) {
    const row = await prisma.systemSetting.findUnique({ where: { key } }).catch(() => null);
    if (row) {
      const v = row.value as unknown as ConfigValue | null;
      if (v?.type === "string" && v.value) return "db-string";
      if (v?.type === "secret") return "db-secret";
    }
  }
  if (envFallback && process.env[envFallback]) return "env";
  return "unset";
}
