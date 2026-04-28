import type { Prisma } from "@prisma/client";

export const AUDIT_CATEGORIES = [
  "AUTH",
  "PAGE_VIEW",
  "MUTATION",
  "QUERY",
  "JOB",
  "API",
  "WEBHOOK",
] as const;

export const AUDIT_STATUSES = ["SUCCESS", "FAILURE", "DENIED"] as const;

export type AuditCategoryFilter = (typeof AUDIT_CATEGORIES)[number];
export type AuditStatusFilter = (typeof AUDIT_STATUSES)[number];

export interface AuditFilterInput {
  from?: Date;
  to?: Date;
  category?: AuditCategoryFilter;
  categoryIn?: AuditCategoryFilter[];
  status?: AuditStatusFilter;
  statusIn?: AuditStatusFilter[];
  action?: string;
  userId?: string;
  entity?: string;
  entityId?: string;
  cursor?: { timestamp: Date; id: string };
}

/**
 * Shared where-builder for AuditLog queries. Used by both the admin audit UI
 * and the per-customer Activity tab so they share filter semantics.
 */
export function buildAuditWhere(input: AuditFilterInput | undefined): Prisma.AuditLogWhereInput {
  if (!input) return {};
  const where: Prisma.AuditLogWhereInput = {};
  if (input.from || input.to) {
    where.timestamp = {
      ...(input.from ? { gte: input.from } : {}),
      ...(input.to ? { lte: input.to } : {}),
    };
  }
  if (input.categoryIn && input.categoryIn.length > 0) {
    where.category = { in: input.categoryIn };
  } else if (input.category) {
    where.category = input.category;
  }
  if (input.statusIn && input.statusIn.length > 0) {
    where.status = { in: input.statusIn };
  } else if (input.status) {
    where.status = input.status;
  }
  if (input.action) {
    where.action = { contains: input.action, mode: "insensitive" };
  }
  if (input.userId) {
    where.userId = input.userId;
  }
  if (input.entity) {
    where.entity = input.entity;
  }
  if (input.entityId) {
    where.entityId = input.entityId;
  }
  if (input.cursor) {
    where.OR = [
      { timestamp: { lt: input.cursor.timestamp } },
      { timestamp: input.cursor.timestamp, id: { lt: input.cursor.id } },
    ];
  }
  return where;
}
