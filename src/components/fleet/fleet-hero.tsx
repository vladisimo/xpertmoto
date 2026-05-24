import Image from "next/image";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { FleetFeatured } from "@/components/fleet/fleet-featured";
import type { FleetSearchModel } from "@/components/fleet/fleet-search-grid";

const HERO_IMAGE = "/landing_hero_sllides/xpert-motorcycle-rentals-desktop-homepage.webp";

/**
 * Marketing hero for the fleet listing. Composes the headline + CTAs with the
 * "high-performance picks" trio layered over the same background image, so the
 * featured bikes are part of the hero rather than a separate band below. Pulled
 * behind the transparent navbar by the caller via `-mt-20` (see
 * TRANSPARENT_BG_ROUTES).
 */
export function FleetHero({ featured }: { featured: FleetSearchModel[] }) {
  return (
    <section className="relative isolate overflow-hidden">
      <Image
        src={HERO_IMAGE}
        alt="Rider on a premium motorcycle from the XPERT Moto fleet"
        fill
        priority
        sizes="100vw"
        className="object-cover"
      />
      <div
        aria-hidden
        className="absolute inset-0 bg-gradient-to-b from-black/65 via-black/55 to-black/80"
      />

      <div className="relative container space-y-10 pb-12 pt-28 md:pb-16 md:pt-36">
        <div className="max-w-2xl text-background">
          <p className="caption uppercase tracking-[0.14em] text-background/75">Our fleet</p>
          <h1 className="h-display text-background">Pick your ride</h1>
          <p className="mt-4 text-lg leading-relaxed text-background/85">
            From lightweight learner scooters to unrestricted adventure tourers — every bike is
            meticulously maintained and ready to roll.
          </p>
          <div className="mt-7 flex flex-wrap gap-3">
            <Button asChild variant="cta" size="lg">
              <Link href="/booking">Book now ➔</Link>
            </Button>
            <Button
              asChild
              size="lg"
              className="border border-background/30 bg-background/10 text-background hover:bg-background/20"
            >
              <Link href="/pricing">View pricing</Link>
            </Button>
          </div>
        </div>

        {featured.length > 0 && (
          <div className="space-y-4">
            <p className="caption uppercase tracking-[0.14em] text-background/70">
              Featured · high-performance picks
            </p>
            <FleetFeatured models={featured} />
          </div>
        )}
      </div>
    </section>
  );
}
