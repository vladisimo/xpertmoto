import fs from "node:fs";
import { test as base } from "@playwright/test";
import { createTRPCClient, httpBatchLink, type CreateTRPCClient } from "@trpc/client";
import superjson from "superjson";
import { STORAGE_STATE } from "../../../playwright.config";
import type { AppRouter } from "@/server/trpc/router";

export type Api = CreateTRPCClient<AppRouter>;

type ApiFixtures = {
  baseURL: string;
  publicApi: Api;
  customerApi: Api;
  staffApi: Api;
  adminApi: Api;
};

function cookieHeaderFromStorageState(storageStatePath: string): string {
  if (!fs.existsSync(storageStatePath)) return "";
  const raw = JSON.parse(fs.readFileSync(storageStatePath, "utf-8")) as {
    cookies?: Array<{ name: string; value: string }>;
  };
  return (raw.cookies ?? []).map((c) => `${c.name}=${c.value}`).join("; ");
}

function buildClient(baseUrl: string, cookieHeader: string): Api {
  return createTRPCClient<AppRouter>({
    links: [
      httpBatchLink({
        url: `${baseUrl}/api/trpc`,
        transformer: superjson,
        fetch: (input, init) =>
          fetch(input, {
            ...init,
            headers: {
              ...(init?.headers ?? {}),
              ...(cookieHeader ? { cookie: cookieHeader } : {}),
            },
          }),
      }),
    ],
  });
}

export const test = base.extend<ApiFixtures>({
  publicApi: async ({ baseURL }, use) => {
    if (!baseURL) throw new Error("baseURL fixture missing");
    await use(buildClient(baseURL, ""));
  },
  customerApi: async ({ baseURL }, use) => {
    if (!baseURL) throw new Error("baseURL fixture missing");
    await use(buildClient(baseURL, cookieHeaderFromStorageState(STORAGE_STATE.customer)));
  },
  staffApi: async ({ baseURL }, use) => {
    if (!baseURL) throw new Error("baseURL fixture missing");
    await use(buildClient(baseURL, cookieHeaderFromStorageState(STORAGE_STATE.staff)));
  },
  adminApi: async ({ baseURL }, use) => {
    if (!baseURL) throw new Error("baseURL fixture missing");
    await use(buildClient(baseURL, cookieHeaderFromStorageState(STORAGE_STATE.admin)));
  },
});

export { expect } from "@playwright/test";
