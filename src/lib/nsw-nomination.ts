/**
 * NSW driver-nomination statutory constants and helpers.
 *
 * A registered operator who receives a penalty notice has a statutory window
 * to nominate the responsible driver (Road Transport Act 2013 (NSW) s.186);
 * missing it is a criminal "fail to nominate" offence. The window runs from
 * the notice ISSUE date, in NSW (Australia/Sydney) calendar days.
 */

/** Statutory nomination window, in calendar days from the issue date. */
export const NOMINATION_WINDOW_DAYS = 21;

/** Demerit-bearing infringement types — these MUST be formally nominated so
 * the points attach to the actual driver; they cannot be "paid and recovered". */
export const DEMERIT_INFRINGEMENT_TYPES = [
  "SPEEDING",
  "RED_LIGHT",
  "MOBILE_PHONE",
  "SEATBELT",
] as const;

export function isDemeritType(type: string): boolean {
  return (DEMERIT_INFRINGEMENT_TYPES as readonly string[]).includes(type);
}

/** Default handling for an offence type: demerit → nominate, else pay-and-recover. */
export function defaultHandlingForType(
  type: string,
): "NOMINATE_DRIVER" | "PAY_AND_RECOVER" {
  return isDemeritType(type) ? "NOMINATE_DRIVER" : "PAY_AND_RECOVER";
}

/**
 * Compute the nomination deadline: issue date + 21 calendar days. The notice
 * issue date is a calendar date (no time component); we add whole days. Stored
 * as a `@db.Date` so timezone-of-storage doesn't shift it.
 */
export function computeNominationDeadline(
  issueDate: Date,
  windowDays = NOMINATION_WINDOW_DAYS,
): Date {
  const d = new Date(issueDate.getTime());
  d.setUTCDate(d.getUTCDate() + windowDays);
  return d;
}

/**
 * Whole calendar days from `now` until the deadline (negative once overdue).
 * Both are treated as NSW calendar dates.
 */
export function daysUntilDeadline(deadline: Date, now: Date): number {
  const dayMs = 24 * 60 * 60 * 1000;
  const startOfDay = (d: Date) =>
    Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate());
  return Math.round((startOfDay(deadline) - startOfDay(now)) / dayMs);
}
