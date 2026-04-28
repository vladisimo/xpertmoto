import "server-only";
import { createServerSideHelpers } from "@trpc/react-query/server";
import superjson from "superjson";
import { headers } from "next/headers";
import { appRouter } from "@/server/trpc/router";
import { createTRPCContext } from "@/server/trpc/context";

export async function getSSRHelpers() {
  const h = new Headers(await headers());
  const ctx = await createTRPCContext({ headers: h });
  return createServerSideHelpers({
    router: appRouter,
    ctx,
    transformer: superjson,
  });
}
