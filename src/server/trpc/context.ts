import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { logger } from "@/lib/logger";
import { headerIp, headerReqId, headerUserAgent } from "@/lib/request-meta";

export async function createTRPCContext(opts: { headers: Headers }) {
  const session = await auth();
  const reqId = headerReqId(opts.headers);
  const ipAddress = headerIp(opts.headers);
  const userAgent = headerUserAgent(opts.headers);
  return {
    session,
    prisma,
    headers: opts.headers,
    reqId,
    ipAddress,
    userAgent,
    logger: logger.child({ reqId, userId: session?.user?.id }),
  };
}

export type Context = Awaited<ReturnType<typeof createTRPCContext>>;
