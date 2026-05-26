"use client";

import * as React from "react";
import Link from "next/link";
import { FleetUseCase, RiderLevel } from "@prisma/client";
import { Button } from "@/components/ui/button";
import { ModelCard } from "@/components/fleet/model-card";
import { UseCaseTabs } from "@/components/fleet/use-case-tabs";
import {
  ALL_TAB,
  DEFAULT_USE_CASE,
  USE_CASE_LABELS,
  USE_CASE_SLUGS,
  USE_CASES,
} from "@/lib/fleet-use-cases";

export interface HomeFleetPreviewModel {
  id: string;
  slug: string;
  make: string;
  model: string;
  year: number;
  tagline: string | null;
  useCases: FleetUseCase[];
  riderLevels: RiderLevel[];
  primaryImageUrl: string | null;
  availableCount: number;
  category: {
    id: string;
    licenceRequired: string;
    baseDailyRate: number;
  };
}

const MAX_CARDS = 6;

function pickInitialUseCase(models: HomeFleetPreviewModel[]): FleetUseCase {
  if (models.some((m) => m.useCases.includes(DEFAULT_USE_CASE))) return DEFAULT_USE_CASE;
  const fallback = USE_CASES.find((uc) => models.some((m) => m.useCases.includes(uc)));
  return fallback ?? DEFAULT_USE_CASE;
}

export function HomeFleetPreview({ models }: { models: HomeFleetPreviewModel[] }) {
  const [active, setActive] = React.useState<FleetUseCase>(() => pickInitialUseCase(models));

  const filtered = React.useMemo(() => {
    return models
      .filter((m) => m.useCases.includes(active))
      .sort((a, b) => {
        if (b.availableCount !== a.availableCount) return b.availableCount - a.availableCount;
        return b.category.baseDailyRate - a.category.baseDailyRate;
      })
      .slice(0, MAX_CARDS);
  }, [models, active]);

  return (
    <div className="space-y-8">
      <div className="flex justify-center">
        <UseCaseTabs
          active={active}
          onChange={(t) => {
            // Home preview never includes the "All" tab, so this branch is
            // defensive; narrow back to FleetUseCase before forwarding.
            if (t !== ALL_TAB) setActive(t);
          }}
        />
      </div>

      {filtered.length === 0 ? (
        <div className="flex flex-col items-center gap-3 rounded-md border border-dashed border-border bg-muted/40 p-10 text-center">
          <p className="text-lg font-medium">No bikes in this category right now.</p>
          <p className="max-w-md text-sm text-muted-foreground">
            Try another category — our team is adding more models to the fleet all the time.
          </p>
        </div>
      ) : (
        <div className="grid gap-6 md:grid-cols-3">
          {filtered.map((m) => (
            <ModelCard
              key={m.id}
              slug={m.slug}
              make={m.make}
              model={m.model}
              year={m.year}
              tagline={m.tagline}
              imageSrc={m.primaryImageUrl}
              licenceBadge={m.category.licenceRequired || null}
              lamsApproved={m.riderLevels.includes("BEGINNER")}
              useCases={m.useCases}
              dailyRate={m.category.baseDailyRate}
              availableCount={m.availableCount}
              bookHref={`/booking?categoryId=${m.category.id}`}
            />
          ))}
        </div>
      )}

      <div className="flex justify-center">
        <Button asChild variant="cta" size="lg">
          <Link
            href={`/fleet?use=${USE_CASE_SLUGS[active]}`}
            data-track="home-view-all-fleet"
            data-track-value={active}
          >
            See all {USE_CASE_LABELS[active]} ➔
          </Link>
        </Button>
      </div>
    </div>
  );
}
