import { revalidateTag } from "next/cache";
import { prisma } from "@/lib/prisma";
import { encryptSecret, decryptSecret, type EncryptedSecret } from "@/lib/crypto";
import { logger } from "@/lib/logger";

/**
 * Admin-managed integration configuration. Values are stored in the
 * `SystemSetting` table keyed `integration:<service>:<field>`, with plain
 * strings saved as `{ type: "string", value }` and secrets as
 * `{ type: "secret", enc, iv, tag }` (AES-256-GCM, same helper that
 * protects E-Toll passwords).
 *
 * Reads always fall back to `process.env.<envFallback>` so an unconfigured
 * DB row keeps the legacy env-driven workflow working. Writes go to the DB
 * only — the env is read-only from Node's POV.
 *
 * A small in-memory cache (5s TTL) reduces Prisma hits on hot paths like
 * sendEmail / sendSms; the TTL is short enough that a just-saved value
 * picks up on the next tick.
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
  const db = await readRaw(key);
  if (db != null && db !== "") return db;
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
  const row = await prisma.systemSetting.findUnique({ where: { key } }).catch(() => null);
  if (row) {
    const v = row.value as unknown as ConfigValue | null;
    if (v?.type === "string" && v.value) return "db-string";
    if (v?.type === "secret") return "db-secret";
  }
  if (envFallback && process.env[envFallback]) return "env";
  return "unset";
}

/**
 * List every integration config row for the admin UI. Returns keys + source
 * only — never raw secret values.
 */
export async function listConfigSources(keys: Array<{ key: string; envFallback?: string }>) {
  const rows = await prisma.systemSetting.findMany({
    where: { key: { in: keys.map((k) => k.key) } },
    select: { key: true, value: true, updatedAt: true },
  });
  const byKey = new Map(rows.map((r) => [r.key, r]));
  return keys.map(({ key, envFallback }) => {
    const row = byKey.get(key);
    const v = (row?.value as unknown as ConfigValue | null) ?? null;
    const hasDb = v?.type === "string" ? !!v.value : v?.type === "secret";
    const hasEnv = !!(envFallback && process.env[envFallback]);
    return {
      key,
      source:
        v?.type === "secret"
          ? ("db-secret" as const)
          : v?.type === "string" && v.value
            ? ("db-string" as const)
            : hasEnv
              ? ("env" as const)
              : ("unset" as const),
      hasValue: hasDb || hasEnv,
      updatedAt: row?.updatedAt ?? null,
      preview:
        v?.type === "string" && v.value ? maskPreview(v.value) : null,
    };
  });
}

function maskPreview(s: string): string {
  if (s.length <= 8) return "•".repeat(s.length);
  return `${s.slice(0, 4)}…${s.slice(-2)}`;
}
