"use client";

import { useMemo } from "react";
import dynamic from "next/dynamic";
import { trpc } from "@/lib/trpc/client";
import { LoadingBlock } from "@/components/ui/stat-shell";

// recharts panels — keep them out of the initial bundle until they mount.
const SupportStats = dynamic(
  () => import("@/components/staff/support-stats").then((m) => m.SupportStats),
  { ssr: false, loading: () => <LoadingBlock className="h-40 w-full" /> },
);
const AdminSupportStats = dynamic(
  () => import("@/components/admin/admin-support-stats").then((m) => m.AdminSupportStats),
  { ssr: false, loading: () => <LoadingBlock className="h-40 w-full" /> },
);

export function SupportInsightsTab() {
  const me = trpc.session.whoAmI.useQuery(undefined, { staleTime: 60_000 });
  const isAdmin = me.data?.role === "ADMIN" || me.data?.role === "SUPER_ADMIN";

  const { data: stats, isLoading: statsLoading } = trpc.support.stats.useQuery(undefined, {
    staleTime: 30_000,
  });

  const range = useMemo(() => {
    const to = new Date();
    const from = new Date();
    from.setDate(from.getDate() - 30);
    return { from, to };
  }, []);
  const adminStats = trpc.support.adminStats.useQuery(range, {
    staleTime: 30_000,
    enabled: isAdmin,
  });

  return (
    <>
      <SupportStats data={stats} loading={statsLoading} />
      {isAdmin && (
        <AdminSupportStats data={adminStats.data} loading={adminStats.isLoading} />
      )}
    </>
  );
}
