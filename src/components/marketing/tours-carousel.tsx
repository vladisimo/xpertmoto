import Image from "next/image";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { DividedTitle } from "@/components/marketing/divided-title";
import { TOURS } from "@/content/tours";

const TOUR_PRICES: Record<string, number> = {
  "grand-pacific-ride": 549,
  "hunter-valley-loop": 549,
  "north-coast-ride": 549,
  "sydney-scenic-ride": 499,
  "sydney-to-blue-mountains": 499,
  "sydney-to-wollongong": 499,
  "twisty-and-touristic": 499,
};

const priceFormatter = new Intl.NumberFormat("en-AU", {
  style: "currency",
  currency: "AUD",
  minimumFractionDigits: 0,
});

export function ToursCarousel() {
  return (
    <section className="container py-20">
      <DividedTitle>Xpert tours</DividedTitle>
      <ul className="mt-12 grid gap-6 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4">
        {TOURS.map((tour) => {
          const price = TOUR_PRICES[tour.slug];
          const hero = tour.gallery[0];
          return (
            <li key={tour.slug}>
              <Link
                href={`/tours/${tour.slug}`}
                className="group block overflow-hidden rounded-md border border-border bg-card transition-shadow hover:shadow-md"
              >
                <div className="relative aspect-[4/3] overflow-hidden">
                  <Image
                    src={hero.src}
                    alt={hero.alt}
                    fill
                    sizes="(min-width: 1024px) 25vw, (min-width: 768px) 33vw, (min-width: 640px) 50vw, 100vw"
                    className="object-cover transition-transform duration-500 group-hover:scale-105"
                  />
                </div>
                <div className="p-5">
                  <h3 className="h3 line-clamp-1">{tour.name}</h3>
                  <p className="mt-1 text-sm text-muted-foreground">
                    {tour.location} &middot; {tour.durationHours}h &middot; {tour.distanceKm}km
                  </p>
                  {price !== undefined && (
                    <div className="mt-4 flex items-baseline justify-between">
                      <span className="text-2xl font-semibold text-foreground">
                        {priceFormatter.format(price)}
                      </span>
                      <span className="text-sm text-foreground transition-colors group-hover:text-secondary">
                        View tour ➔
                      </span>
                    </div>
                  )}
                </div>
              </Link>
            </li>
          );
        })}
      </ul>
      <div className="mt-10 flex justify-center">
        <Button asChild variant="cta" size="lg">
          <Link href="/tours" data-track="home-view-all-tours">
            View all ➔
          </Link>
        </Button>
      </div>
    </section>
  );
}
