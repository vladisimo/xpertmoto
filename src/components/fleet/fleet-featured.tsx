import { ModelCard } from "@/components/fleet/model-card";
import { cn } from "@/lib/utils";
import type { FleetSearchModel } from "@/components/fleet/fleet-search-grid";

/**
 * Responsive grid of the highest-spec bikes, rendered as compact overlay
 * cards. Heading-less so it can be dropped into the hero (see FleetHero) or
 * anywhere else. Purely presentational: the same models still appear in the
 * grid below so filters and counts stay honest.
 */
export function FleetFeatured({
  models,
  className,
}: {
  models: FleetSearchModel[];
  className?: string;
}) {
  if (models.length === 0) return null;

  return (
    <div className={cn("grid gap-4 sm:grid-cols-2 lg:grid-cols-3", className)}>
      {models.map((m) => (
        <ModelCard
          key={m.id}
          slug={m.slug}
          make={m.make}
          model={m.model}
          year={m.year}
          tagline={m.tagline}
          imageSrc={m.primaryImageUrl}
          licenceBadge={m.category.licenceRequired || null}
          lamsApproved={m.useCases.includes("LEARNER_APPROVED")}
          useCases={m.useCases}
          dailyRate={m.category.baseDailyRate}
          availableCount={m.availableCount}
          specs={m.specs}
          layout="overlay"
          bookHref={`/booking?categoryId=${m.category.id}`}
        />
      ))}
    </div>
  );
}
