"use client";

import { LiveConsole } from "../live-console";
import { LiveStatsRow } from "../live-stats-row";
import { PageSection } from "@/components/layout/page-section";

export function LiveTab({ active: _active }: { active: boolean }) {
  return (
    <>
      <LiveStatsRow />
      <PageSection flush>
        <LiveConsole />
      </PageSection>
    </>
  );
}
