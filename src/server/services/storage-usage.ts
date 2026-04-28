/**
 * StorageUsageEvent writer. Best-effort — logging never blocks the
 * actual S3 put/delete.
 */

import { prisma } from "@/lib/prisma";
import { logger } from "@/lib/logger";

export type StorageLogContext = {
  customerId?: string;
  bookingId?: string;
};

function topLevelFolder(key: string): string {
  const trimmed = key.replace(/^\/+/, "");
  const first = trimmed.split("/")[0];
  return first || "unknown";
}

export async function recordStorageUpload(args: {
  key: string;
  sizeBytes: number;
  contentType?: string | null;
  ctx?: StorageLogContext;
}): Promise<void> {
  try {
    await prisma.storageUsageEvent.create({
      data: {
        action: "UPLOAD",
        bucketKey: args.key,
        folder: topLevelFolder(args.key),
        sizeBytes: BigInt(args.sizeBytes),
        ...(args.contentType ? { contentType: args.contentType } : {}),
        ...(args.ctx?.customerId ? { customerId: args.ctx.customerId } : {}),
        ...(args.ctx?.bookingId ? { bookingId: args.ctx.bookingId } : {}),
      },
    });
  } catch (e) {
    logger.warn({ err: e, key: args.key }, "recordStorageUpload: write failed");
  }
}

export async function recordStorageDelete(args: {
  key: string;
  ctx?: StorageLogContext;
}): Promise<void> {
  try {
    // Look up the most recent UPLOAD for this key to carry its size delta
    // backwards — lets the Platform > Storage tab compute a running total
    // without a full-bucket scan.
    const last = await prisma.storageUsageEvent.findFirst({
      where: { bucketKey: args.key, action: "UPLOAD" },
      orderBy: { createdAt: "desc" },
      select: { sizeBytes: true, contentType: true },
    });
    const negSize = last?.sizeBytes ? -last.sizeBytes : BigInt(0);
    await prisma.storageUsageEvent.create({
      data: {
        action: "DELETE",
        bucketKey: args.key,
        folder: topLevelFolder(args.key),
        sizeBytes: negSize,
        ...(last?.contentType ? { contentType: last.contentType } : {}),
        ...(args.ctx?.customerId ? { customerId: args.ctx.customerId } : {}),
        ...(args.ctx?.bookingId ? { bookingId: args.ctx.bookingId } : {}),
      },
    });
  } catch (e) {
    logger.warn({ err: e, key: args.key }, "recordStorageDelete: write failed");
  }
}
