"use client";

import { useEffect } from "react";
import { trpc } from "@/lib/trpc/client";
import { LiveStats } from "@/components/staff/live-stats";

export function LiveStatsRow() {
  const utils = trpc.useUtils();
  const { data, isLoading } = trpc.live.stats.useQuery(undefined, {
    staleTime: 10_000,
    refetchOnWindowFocus: false,
  });

  useEffect(() => {
    const es = new EventSource("/api/live/events?role=staff");
    let pending = false;
    es.onmessage = (e) => {
      try {
        const payload = JSON.parse(e.data) as { type?: string };
        if (payload.type === "presence.upsert" || payload.type === "presence.offline" || payload.type === "chat.message") {
          if (!pending) {
            pending = true;
            setTimeout(() => {
              utils.live.stats.invalidate();
              pending = false;
            }, 2000);
          }
        }
      } catch {
        // ignore
      }
    };
    return () => es.close();
  }, [utils]);

  return <LiveStats data={data} loading={isLoading} />;
}
