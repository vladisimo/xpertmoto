import { HydrationBoundary, dehydrate } from "@tanstack/react-query";
import { getSSRHelpers } from "@/lib/trpc/ssr";
import { STATUS_FILTERS, type StatusFilter } from "@/lib/customers/filters";
import { CustomersClient } from "./customers-client";

const DEFAULT_STATUS: StatusFilter = "ALL";
const DEFAULT_PAGE_SIZE = 25;

function parseStatus(value: string | undefined): StatusFilter {
  if (value && (STATUS_FILTERS as readonly string[]).includes(value)) {
    return value as StatusFilter;
  }
  return DEFAULT_STATUS;
}

function parsePageSize(value: string | undefined): number {
  const n = Number(value);
  return [25, 50, 100].includes(n) ? n : DEFAULT_PAGE_SIZE;
}

function parseSort(
  value: string | undefined,
): { sortBy: "name" | "bookings" | "createdAt"; sortDir: "asc" | "desc" } {
  if (!value) return { sortBy: "createdAt", sortDir: "desc" };
  const [id, dir] = value.split(":");
  if (!id || (dir !== "asc" && dir !== "desc")) return { sortBy: "createdAt", sortDir: "desc" };
  if (!["name", "bookings", "createdAt"].includes(id)) return { sortBy: "createdAt", sortDir: "desc" };
  return { sortBy: id as "name" | "bookings" | "createdAt", sortDir: dir };
}

function asString(v: string | string[] | undefined): string | undefined {
  return Array.isArray(v) ? v[0] : v;
}

/**
 * Directory tab — the only customers tab that benefits from server prefetch.
 * The list + stats queries are dehydrated here and rehydrated into
 * <CustomersClient>, which owns the filter/pagination URL state.
 */
export default async function CustomersDirectoryPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const sp = await searchParams;
  const status = parseStatus(asString(sp.status));
  const search = asString(sp.q) ?? "";
  const page = Math.max(1, Number(asString(sp.page)) || 1);
  const pageSize = parsePageSize(asString(sp.size));
  const { sortBy, sortDir } = parseSort(asString(sp.sort));
  const listInput = { status, search: search || undefined, page, pageSize, sortBy, sortDir };

  const prefetched = await getSSRHelpers();
  await Promise.all([
    prefetched.staffCustomer.list.prefetch(listInput),
    prefetched.staffCustomer.stats.prefetch(),
  ]);

  return (
    <HydrationBoundary state={dehydrate(prefetched.queryClient)}>
      <CustomersClient />
    </HydrationBoundary>
  );
}
