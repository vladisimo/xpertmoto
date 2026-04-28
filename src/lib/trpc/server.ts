import "server-only";
import { headers } from "next/headers";
import { appRouter } from "@/server/trpc/router";
import { createTRPCContext } from "@/server/trpc/context";

export async function createServerCaller() {
  const h = new Headers(await headers());
  const ctx = await createTRPCContext({ headers: h });
  return appRouter.createCaller(ctx);
}
