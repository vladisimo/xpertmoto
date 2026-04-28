import { TRPCError } from "@trpc/server";
import type { PrismaClient } from "@prisma/client";
import { validateBookingTimes } from "@/lib/validators/booking-times";
import { isDateTimeWithinHours } from "@/lib/opening-hours";

type Args = {
  pickupDepotId: string;
  returnDepotId: string;
  pickupDateTime: Date;
  returnDateTime: Date;
};

/**
 * Loads the pickup + return depots (with their operating hours) and
 * enforces that both scheduled times fall inside the depots' published
 * hours. Throws a BAD_REQUEST TRPCError with a user-friendly message on
 * the first failure — client forms render this next to the offending
 * field. No-op on success.
 *
 * Kept separate from `availability`/`eligibility` checks so its failure
 * mode maps cleanly onto a specific form field (`pickupDateTime` or
 * `returnDateTime`).
 */
export async function enforceBookingTimesWithinHours(
  prisma: PrismaClient,
  args: Args,
): Promise<void> {
  const depotIds = Array.from(
    new Set([args.pickupDepotId, args.returnDepotId]),
  );
  const depots = await prisma.depot.findMany({
    where: { id: { in: depotIds } },
    select: {
      id: true,
      name: true,
      timezone: true,
      operatingHours: {
        select: {
          dayOfWeek: true,
          openTime: true,
          closeTime: true,
          isClosed: true,
          holidayDate: true,
        },
      },
    },
  });
  const byId = new Map(depots.map((d) => [d.id, d]));
  const pickup = byId.get(args.pickupDepotId);
  const ret = byId.get(args.returnDepotId);
  if (!pickup || !ret) {
    throw new TRPCError({
      code: "BAD_REQUEST",
      message: "Selected depot could not be found.",
    });
  }
  const result = validateBookingTimes({
    pickupDateTime: args.pickupDateTime,
    returnDateTime: args.returnDateTime,
    pickupDepot: {
      name: pickup.name,
      timezone: pickup.timezone,
      operatingHours: pickup.operatingHours,
    },
    returnDepot: {
      name: ret.name,
      timezone: ret.timezone,
      operatingHours: ret.operatingHours,
    },
  });
  if (!result.ok) {
    throw new TRPCError({ code: "BAD_REQUEST", message: result.message });
  }
}

/**
 * Single-endpoint variant used by the extend flow, where only the new
 * return time needs checking (the pickup has already happened or is
 * locked in). Throws `BAD_REQUEST` on failure.
 */
export async function enforceDateTimeWithinDepotHours(
  prisma: PrismaClient,
  depotId: string,
  dateTime: Date,
  side: "pickup" | "return",
): Promise<void> {
  const depot = await prisma.depot.findUnique({
    where: { id: depotId },
    select: {
      name: true,
      timezone: true,
      operatingHours: {
        select: {
          dayOfWeek: true,
          openTime: true,
          closeTime: true,
          isClosed: true,
          holidayDate: true,
        },
      },
    },
  });
  if (!depot) {
    throw new TRPCError({
      code: "BAD_REQUEST",
      message: "Depot for this booking could not be found.",
    });
  }
  const check = isDateTimeWithinHours(
    dateTime,
    depot.timezone,
    depot.operatingHours,
  );
  if (check.ok) return;
  let message: string;
  switch (check.reason) {
    case "CLOSED_DAY":
      message = `${depot.name} is closed on ${check.weekdayName} — choose a different day for your ${side}.`;
      break;
    case "NO_HOURS_CONFIGURED":
      message = `${depot.name} doesn't publish hours for ${check.weekdayName} — choose a different day for your ${side}.`;
      break;
    case "BEFORE_OPEN":
      message = `${depot.name} opens at ${check.openTime} on ${check.weekdayName} — your ${side} at ${check.localTime} is before it opens.`;
      break;
    case "AFTER_CLOSE":
      message = `${depot.name} closes at ${check.closeTime} on ${check.weekdayName} — your ${side} at ${check.localTime} is after it closes.`;
      break;
  }
  throw new TRPCError({ code: "BAD_REQUEST", message });
}
