import type { Prisma, PrismaClient } from "@prisma/client";

import { prisma as defaultPrisma } from "@/lib/prisma";
import type { SegmentFilter, SegmentFilters } from "@/lib/validators/segment";

type UserWhere = Prisma.UserWhereInput;

const daysAgo = (days: number) => {
  const d = new Date();
  d.setDate(d.getDate() - days);
  return d;
};

const daysFromNow = (days: number) => {
  const d = new Date();
  d.setDate(d.getDate() + days);
  return d;
};

const ageToBirthDate = (age: number): Date => {
  const d = new Date();
  d.setFullYear(d.getFullYear() - age);
  return d;
};

function filterToWhere(filter: SegmentFilter): UserWhere {
  switch (filter.dimension) {
    case "AGE_RANGE": {
      const dob: Prisma.DateTimeNullableFilter = {};
      if (filter.max !== undefined) dob.gte = ageToBirthDate(filter.max + 1);
      if (filter.min !== undefined) dob.lte = ageToBirthDate(filter.min);
      return { dateOfBirth: dob };
    }
    case "STATE":
      return { customerProfile: { state: { in: filter.states as unknown as string[] } } };
    case "POSTCODE_PREFIX":
      return {
        OR: filter.prefixes.map((p) => ({
          customerProfile: { postcode: { startsWith: p } },
        })),
      };
    case "DEPOT":
      return { bookings: { some: { depotId: { in: filter.depotIds } } } };
    case "LAST_RENTED_WITHIN":
      return {
        bookings: {
          some: {
            status: { in: ["RETURNED", "COMPLETED", "ACTIVE"] },
            pickupDateTime: { gte: daysAgo(filter.days) },
          },
        },
      };
    case "LAST_RENTED_BEFORE":
      return {
        AND: [
          { bookings: { some: {} } },
          {
            bookings: {
              none: {
                status: { in: ["RETURNED", "COMPLETED", "ACTIVE"] },
                pickupDateTime: { gte: daysAgo(filter.days) },
              },
            },
          },
        ],
      };
    case "NEVER_RENTED":
      return { bookings: { none: {} } };
    case "TOTAL_SPEND_MIN":
      return { customerProfile: { totalSpend: { gte: filter.amount } } };
    case "TOTAL_BOOKINGS_MIN":
      return { customerProfile: { totalBookings: { gte: filter.count } } };
    case "CATEGORY_RENTED":
      return { bookings: { some: { categoryId: { in: filter.categoryIds } } } };
    case "CATEGORY_NEVER_RENTED":
      return { bookings: { none: { categoryId: { in: filter.categoryIds } } } };
    case "LICENCE_STATE":
      return { customerProfile: { licenceState: { in: filter.states as unknown as string[] } } };
    case "LICENCE_EXPIRING_WITHIN":
      return {
        customerProfile: {
          licenceExpiry: { gte: new Date(), lte: daysFromNow(filter.days) },
        },
      };
    case "LOYALTY_POINTS_MIN":
      return { customerProfile: { loyaltyPoints: { gte: filter.points } } };
    case "RISK_RATING":
      return { customerProfile: { riskRating: { in: filter.ratings } } };
    case "MARKETING_EMAIL_OPT_IN":
      return {
        customerProfile: {
          marketingOptIn: filter.value,
          ...(filter.value ? { marketingEmailUnsubscribedAt: null } : {}),
        },
      };
    case "MARKETING_SMS_OPT_IN":
      return {
        customerProfile: {
          marketingSmsOptIn: filter.value,
          ...(filter.value ? { marketingSmsUnsubscribedAt: null } : {}),
        },
      };
    case "CUSTOMER_SINCE_BEFORE":
      return { customerProfile: { customerSince: { lte: filter.date } } };
    case "CUSTOMER_SINCE_AFTER":
      return { customerProfile: { customerSince: { gte: filter.date } } };
    case "BIRTHDAY_MONTH":
      return {
        dateOfBirth: { not: null },
      };
  }
}

export function buildSegmentWhere(filters: SegmentFilters): UserWhere {
  const clauses = filters.filters.map(filterToWhere);
  const base: UserWhere = {
    role: "CUSTOMER",
    deletedAt: null,
    customerProfile: { is: {} },
  };
  return { AND: [base, ...clauses] };
}

export async function evaluateSegment(
  filters: SegmentFilters,
  opts: { take?: number; skip?: number; prisma?: Pick<PrismaClient, "user"> } = {},
) {
  const prisma = opts.prisma ?? defaultPrisma;
  const where = buildSegmentWhere(filters);
  const [count, rows] = await Promise.all([
    prisma.user.count({ where }),
    opts.take
      ? prisma.user.findMany({
          where,
          take: opts.take,
          skip: opts.skip ?? 0,
          select: {
            id: true,
            email: true,
            phone: true,
            firstName: true,
            lastName: true,
            customerProfile: {
              select: {
                state: true,
                postcode: true,
                marketingOptIn: true,
                marketingSmsOptIn: true,
                totalSpend: true,
                totalBookings: true,
              },
            },
          },
        })
      : Promise.resolve([]),
  ]);
  const postFiltered = applyBirthdayMonthPostFilter(rows, filters);
  return { count, rows: postFiltered };
}

function applyBirthdayMonthPostFilter<
  T extends { id: string },
>(rows: T[], filters: SegmentFilters): T[] {
  const birthdayFilter = filters.filters.find(
    (f) => f.dimension === "BIRTHDAY_MONTH",
  ) as Extract<SegmentFilter, { dimension: "BIRTHDAY_MONTH" }> | undefined;
  if (!birthdayFilter) return rows;
  return rows;
}

export async function countSegmentMembers(
  filters: SegmentFilters,
  prisma: Pick<PrismaClient, "user"> = defaultPrisma,
): Promise<number> {
  return prisma.user.count({ where: buildSegmentWhere(filters) });
}

export async function listSegmentMembers(
  filters: SegmentFilters,
  opts: { take: number; skip?: number; prisma?: Pick<PrismaClient, "user"> },
) {
  const prisma = opts.prisma ?? defaultPrisma;
  return prisma.user.findMany({
    where: buildSegmentWhere(filters),
    take: opts.take,
    skip: opts.skip ?? 0,
    orderBy: { createdAt: "desc" },
    select: {
      id: true,
      email: true,
      phone: true,
      firstName: true,
      lastName: true,
      customerProfile: {
        select: {
          state: true,
          postcode: true,
          marketingOptIn: true,
          marketingSmsOptIn: true,
        },
      },
    },
  });
}
