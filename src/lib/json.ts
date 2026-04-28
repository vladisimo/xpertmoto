import type { Prisma } from "@prisma/client";
import { z } from "zod";

/**
 * Validate an unknown value against a Zod schema and return it as a
 * Prisma JSON input. Centralises the otherwise-repeated
 * `as unknown as Prisma.InputJsonValue` casts and ensures we never
 * persist a shape we didn't check first.
 *
 * Usage:
 *   const data = toPrismaJson(mySchema, rawValue);
 *   await prisma.foo.update({ data: { payload: data } });
 */
export function toPrismaJson<T extends z.ZodTypeAny>(
  schema: T,
  value: unknown,
): Prisma.InputJsonValue {
  return schema.parse(value) as Prisma.InputJsonValue;
}

/**
 * Same as toPrismaJson but returns `undefined` when the input is
 * `null`/`undefined`, for Prisma optional JSON columns where "leave alone"
 * is the desired semantic on absence. Still validates when the value is
 * present.
 */
export function toOptionalPrismaJson<T extends z.ZodTypeAny>(
  schema: T,
  value: unknown,
): Prisma.InputJsonValue | undefined {
  if (value === null || value === undefined) return undefined;
  return schema.parse(value) as Prisma.InputJsonValue;
}
