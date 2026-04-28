"use client";

import * as React from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  ALL_TAB,
  ALL_TAB_LABEL,
  USE_CASES,
  USE_CASE_LABELS,
  USE_CASE_SLUGS,
  slugToTab,
  tabToSlug,
  type FleetTab,
} from "@/lib/fleet-use-cases";

export interface UseCaseTabsProps {
  active: FleetTab;
  /**
   * When true, prepend an "All" tab. Used by /fleet so the page can show
   * every model regardless of use case. Defaults to false so the home
   * preview keeps its category-only behaviour.
   */
  includeAll?: boolean;
  /**
   * Optional controlled handler. When provided the parent owns the state
   * transition (used by in-page previews). When omitted the tabs sync the
   * `use=` search param on /fleet — original behaviour.
   */
  onChange?: (tab: FleetTab) => void;
}

export function UseCaseTabs({ active, includeAll = false, onChange }: UseCaseTabsProps) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [pending, startTransition] = React.useTransition();

  function handleChange(slug: string) {
    const next = slugToTab(slug);
    if (!next) return;
    if (onChange) {
      onChange(next);
      return;
    }
    const params = new URLSearchParams(searchParams?.toString() ?? "");
    if (next === ALL_TAB) {
      params.delete("use");
    } else {
      params.set("use", slug);
    }
    const qs = params.toString();
    startTransition(() => {
      router.replace(qs ? `/fleet?${qs}` : `/fleet`, { scroll: false });
    });
  }

  return (
    <Tabs value={tabToSlug(active)} onValueChange={handleChange}>
      <TabsList
        className="h-auto w-full flex-wrap justify-start gap-x-1 gap-y-0"
        aria-busy={pending}
      >
        {includeAll && (
          <TabsTrigger
            value={ALL_TAB}
            className="px-3 py-2.5 text-sm sm:px-4 sm:py-3"
          >
            {ALL_TAB_LABEL}
          </TabsTrigger>
        )}
        {USE_CASES.map((uc) => (
          <TabsTrigger
            key={uc}
            value={USE_CASE_SLUGS[uc]}
            className="px-3 py-2.5 text-sm sm:px-4 sm:py-3"
          >
            {USE_CASE_LABELS[uc]}
          </TabsTrigger>
        ))}
      </TabsList>
    </Tabs>
  );
}
