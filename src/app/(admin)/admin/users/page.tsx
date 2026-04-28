import { HydrationBoundary, dehydrate } from "@tanstack/react-query";
import { getSSRHelpers } from "@/lib/trpc/ssr";
import { AdminUsersClient } from "./admin-users-client";

const PAGE_SIZES = [25, 50, 100] as const;

function asString(v: string | string[] | undefined): string | undefined {
  return Array.isArray(v) ? v[0] : v;
}

function parsePageSize(value: string | undefined): number {
  const n = Number(value);
  return (PAGE_SIZES as readonly number[]).includes(n) ? n : 25;
}

function parseSort(
  value: string | undefined,
): { sortBy: "name" | "createdAt"; sortDir: "asc" | "desc" } {
  if (!value) return { sortBy: "createdAt", sortDir: "desc" };
  const [id, dir] = value.split(":");
  if (!id || (dir !== "asc" && dir !== "desc")) return { sortBy: "createdAt", sortDir: "desc" };
  if (id !== "name" && id !== "createdAt") return { sortBy: "createdAt", sortDir: "desc" };
  return { sortBy: id, sortDir: dir };
}

export default async function AdminUsersPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const sp = await searchParams;
  const search = asString(sp.q) ?? "";
  const role = asString(sp.role) ?? "";
  const page = Math.max(1, Number(asString(sp.page)) || 1);
  const pageSize = parsePageSize(asString(sp.size));
  const { sortBy, sortDir } = parseSort(asString(sp.sort));

  const helpers = await getSSRHelpers();
  await Promise.all([
    helpers.admin.listUsers.prefetch({
      search: search || undefined,
      role: role || undefined,
      page,
      pageSize,
      sortBy,
      sortDir,
    }),
    helpers.depot.list.prefetch(),
  ]);

  return (
    <HydrationBoundary state={dehydrate(helpers.queryClient)}>
      <AdminUsersClient />
    </HydrationBoundary>
  );
}
