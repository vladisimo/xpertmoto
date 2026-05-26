/**
 * Australian financial-year (BAS) quarters. The Australian FY ends 30 June, so
 * the four quarterly BAS periods are:
 *
 *   Q1  Jul–Sep   Q2  Oct–Dec   Q3  Jan–Mar   Q4  Apr–Jun
 *
 * This is deliberately NOT the calendar-quarter convention used by
 * `quarterBoundaries()` in gst-bas-export.ts (Q1 = Jan–Mar). The GST/BAS page
 * uses the FY quarters here; any ATO lodgement period maps onto one of them.
 *
 * Pure and client-safe — no Prisma, no timezone library. Dates are emitted as
 * `YYYY-MM-DD` strings built straight from integers so they never shift across
 * the UTC boundary the way `Date.toISOString()` can.
 */

export interface BasQuarter {
  /** Financial-year ending year, e.g. 2026 = FY2025–26. */
  fy: number;
  quarter: 1 | 2 | 3 | 4;
  /** Inclusive period start, "YYYY-MM-DD". */
  from: string;
  /** Inclusive period end (last day of the quarter), "YYYY-MM-DD". */
  to: string;
  /** e.g. "Q4 FY2026 (Apr–Jun 2026)". */
  label: string;
}

const MONTH_ABBR = [
  "Jan", "Feb", "Mar", "Apr", "May", "Jun",
  "Jul", "Aug", "Sep", "Oct", "Nov", "Dec",
] as const;

/** Calendar start month (1-based) and FY offset for each BAS quarter. */
const QUARTER_DEF: Record<1 | 2 | 3 | 4, { startMonth: number; calendarYearIsFy: boolean }> = {
  1: { startMonth: 7, calendarYearIsFy: false }, // Jul–Sep, calendar year = fy − 1
  2: { startMonth: 10, calendarYearIsFy: false }, // Oct–Dec, calendar year = fy − 1
  3: { startMonth: 1, calendarYearIsFy: true }, // Jan–Mar, calendar year = fy
  4: { startMonth: 4, calendarYearIsFy: true }, // Apr–Jun, calendar year = fy
};

function pad(n: number): string {
  return String(n).padStart(2, "0");
}

/** Last day of a 1-based month in a given year (handles Feb in leap years). */
function lastDayOfMonth(year: number, month: number): number {
  return new Date(year, month, 0).getDate();
}

function makeQuarter(fy: number, quarter: 1 | 2 | 3 | 4): BasQuarter {
  const { startMonth, calendarYearIsFy } = QUARTER_DEF[quarter];
  const startYear = calendarYearIsFy ? fy : fy - 1;
  const endMonth = startMonth + 2;
  const from = `${startYear}-${pad(startMonth)}-01`;
  const to = `${startYear}-${pad(endMonth)}-${pad(lastDayOfMonth(startYear, endMonth))}`;
  const label = `Q${quarter} FY${fy} (${MONTH_ABBR[startMonth - 1]}–${MONTH_ABBR[endMonth - 1]} ${startYear})`;
  return { fy, quarter, from, to, label };
}

/** The BAS quarter that contains `date`. */
export function basQuarterOf(date: Date): BasQuarter {
  const month = date.getMonth() + 1; // 1-based
  const year = date.getFullYear();
  let quarter: 1 | 2 | 3 | 4;
  let fy: number;
  if (month >= 7 && month <= 9) {
    quarter = 1;
    fy = year + 1;
  } else if (month >= 10) {
    quarter = 2;
    fy = year + 1;
  } else if (month <= 3) {
    quarter = 3;
    fy = year;
  } else {
    quarter = 4;
    fy = year;
  }
  return makeQuarter(fy, quarter);
}

/** The `count` most recent BAS quarters ending at the one containing `now`, newest first. */
export function recentBasQuarters(now: Date, count = 6): BasQuarter[] {
  const current = basQuarterOf(now);
  const out: BasQuarter[] = [];
  let { fy, quarter } = current;
  for (let i = 0; i < count; i++) {
    out.push(makeQuarter(fy, quarter));
    // Step back one quarter.
    if (quarter === 1) {
      quarter = 4;
      fy -= 1;
    } else {
      quarter = (quarter - 1) as 1 | 2 | 3 | 4;
    }
  }
  return out;
}
