import { TRPCError } from "@trpc/server";
import { getString, setString } from "@/lib/integration-config";

/**
 * G10 — configurable admin fee added on top of the raw toll amount when
 * we pass a toll infringement through to the customer. Stored as a string
 * in SystemSetting so Ops can tune without a deploy.
 *
 * Default: $2.50 per toll. Return 0 if config parsing fails so we never
 * accidentally surcharge more than intended.
 */

const KEY = "infringement:toll:adminFeeAud";
const DEFAULT_FEE_AUD = 2.5;

export async function getTollAdminFee(): Promise<number> {
  const raw = await getString(KEY, "TOLL_ADMIN_FEE_AUD");
  if (raw == null || raw.trim() === "") return DEFAULT_FEE_AUD;
  const n = Number.parseFloat(raw);
  if (!Number.isFinite(n) || n < 0) return 0;
  return Math.round(n * 100) / 100;
}

export async function setTollAdminFee(aud: number): Promise<void> {
  if (!Number.isFinite(aud) || aud < 0) {
    throw new TRPCError({
      code: "BAD_REQUEST",
      message: "Admin fee must be a non-negative number",
    });
  }
  await setString(KEY, (Math.round(aud * 100) / 100).toFixed(2));
}

/** Total amount (toll + admin fee) to charge the customer, in AUD. */
export function tollChargeAmount(tollAud: number, adminFeeAud: number): number {
  return Math.round((tollAud + adminFeeAud) * 100) / 100;
}
