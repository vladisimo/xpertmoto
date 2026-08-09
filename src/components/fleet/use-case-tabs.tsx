"use client";

import * as React from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { tabsListClassName, tabsTriggerClassName } from "@/components/ui/tabs";
import { cn } from "@/lib/utils";
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

  const activeSlug = tabToSlug(active);
  const options: Array<{ slug: string; label: string }> = [
    ...(includeAll ? [{ slug: ALL_TAB, label: ALL_TAB_LABEL }] : []),
    ...USE_CASES.map((uc) => ({ slug: USE_CASE_SLUGS[uc], label: USE_CASE_LABELS[uc] })),
  ];

  // Deliberately NOT a Radix <Tabs>: these buttons filter the grid that sits
  // beside them (and sync `?use=` on /fleet) — there is no tabpanel for a
  // `role="tab"` to control, so they are toggle buttons wearing the tab strip's
  // classes. The outer wrapper stands in for the Tabs root div so the flex
  // layout the callers rely on is unchanged.
  return (
    <div>
      <div
        role="group"
        aria-label="Filter the fleet by use case"
        aria-busy={pending}
        className={cn(
          tabsListClassName,
          "h-auto w-full flex-wrap justify-start gap-x-1 gap-y-0",
        )}
      >
        {options.map((option) => {
          const selected = option.slug === activeSlug;
          return (
            <button
              key={option.slug}
              type="button"
              aria-pressed={selected}
              data-state={selected ? "active" : "inactive"}
              onClick={() => handleChange(option.slug)}
              className={cn(tabsTriggerClassName, "px-3 py-2.5 text-sm sm:px-4 sm:py-3")}
            >
              {option.label}
            </button>
          );
        })}
      </div>
    </div>
  );
}
