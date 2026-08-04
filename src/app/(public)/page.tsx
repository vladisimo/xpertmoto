import Image from "next/image";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { DividedTitle } from "@/components/marketing/divided-title";
import { HeroSection } from "@/components/home/hero-section";
import { XpertServicesGrid } from "@/components/marketing/xpert-services-grid";
import { ExperienceDifference } from "@/components/marketing/experience-difference";
import { ExploreTours } from "@/components/marketing/explore-tours";
import { ToursCarousel } from "@/components/marketing/tours-carousel";
import { BrandsGrid } from "@/components/marketing/brands-grid";
import { PublicDepotMap, getDirectionsUrl } from "@/components/maps/public-depot-map";
import { HomeFleetPreview } from "@/components/fleet/home-fleet-preview";
import { getBranding } from "@/lib/branding";
import { getHomeDepots, getFleetPreview } from "@/lib/home/home-data";
import { getSiteUrl, absoluteUrl } from "@/lib/seo/site-url";
import { organizationLd } from "@/lib/seo/json-ld";
import { JsonLd } from "@/components/seo/json-ld";
import type { Metadata } from "next";

// The home page keeps the root layout's full descriptive title/description
// (best for the brand landing page); we only add the canonical + og:url here.
export function generateMetadata(): Metadata {
  return {
    alternates: { canonical: "/" },
    openGraph: {
      url: "/",
      type: "website",
      locale: "en_AU",
      images: ["/opengraph-image"],
    },
    twitter: { card: "summary_large_image", images: ["/opengraph-image"] },
  };
}

const HERO_SLIDES = [
  { imageSrc: "/landing_hero_sllides/xpert-motorcycle-tours-desktop-homepage.webp",   imageAlt: "Riders on a guided motorcycle tour" },
  { imageSrc: "/landing_hero_sllides/xpert-motorcycle-rentals-desktop-homepage.webp", imageAlt: "Premium motorcycle rental on the coast" },
  { imageSrc: "/landing_hero_sllides/xpert-motorcycle-mechanic-desktop.webp",         imageAlt: "Motorcycle mechanic workshop" },
];

export default async function HomePage() {
  const [depots, branding, fleetPreview] = await Promise.all([
    getHomeDepots(),
    getBranding(),
    getFleetPreview(),
  ]);

  const mapPins = depots
    .filter((d) => d.latitude != null && d.longitude != null)
    .map((d) => ({
      id: d.id,
      name: d.name,
      lat: d.latitude as number,
      lng: d.longitude as number,
      addressLine1: d.addressLine1,
      suburb: d.suburb,
      state: d.state,
      postcode: d.postcode,
      phone: d.phone,
      availableVehicles: d._count.vehicles,
    }));

  const orgJsonLd = organizationLd({
    branding,
    url: getSiteUrl(),
    logoUrl: branding.logoWideUrl ? absoluteUrl(branding.logoWideUrl) : null,
  });

  return (
    <>
      <JsonLd data={orgJsonLd} />
      <div className="-mt-20">
        <HeroSection
          slides={HERO_SLIDES}
          eyebrow="Scooter &amp; motorbike hire"
          title={<>Premium rides for<br/>unforgettable adventures</>}
          description="Australia's largest range of Motorcycles, with 11 brands and over 30 models to select from! Enter your dates below to see what's ready to ride — and don't worry, there are even more bikes to choose from on other dates. Your next adventure starts here!"
          secondaryCta={{ label: "View fleet", href: "/fleet" }}
          // Drop the encoded clip into /public/hero/ then enable the video hero.
          // The first HERO_SLIDES image stays as the poster / reduced-motion fallback.
          // videoWebm="/hero/xpert-hero.webm"
          // videoMp4="/hero/xpert-hero.mp4"
        />
      </div>

      <XpertServicesGrid />

      <ExperienceDifference brandName={branding.siteName} />

      {/* Split — rent and ride with ease */}
      <section className="bg-muted">
        <div className="container grid items-center gap-10 py-20 md:grid-cols-2">
          <div className="relative aspect-[4/3] overflow-hidden rounded-md">
            <Image
              src="/xpert-motorcycle-rental-sydney-details.webp"
              alt="Rider preparing for a day on the road"
              fill
              sizes="(min-width: 768px) 50vw, 100vw"
              className="object-cover"
            />
          </div>
          <div>
            <h2 className="h1">Rent and ride with ease</h2>
            <p className="mt-4 text-muted-foreground">
              A hassle-free rental experience built for riders. From city scooters to highway-ready
              maxis, our fleet is meticulously maintained and ready for your next adventure. Flexible
              options that suit your schedule and riding style.
            </p>
            <Button asChild variant="cta" size="lg" className="mt-8">
              <Link href="/fleet" data-track="home-rent-with-us">
                {`Rent with ${branding.siteName} ➔`}
              </Link>
            </Button>
          </div>
        </div>
      </section>

      {/* Fleet preview — live inventory filtered by use-case tabs */}
      {fleetPreview.length > 0 && (
        <section className="container py-20">
          <DividedTitle>Our fleet</DividedTitle>
          <p className="mx-auto mb-10 mt-4 max-w-2xl text-center text-muted-foreground">
            Adventure tourers, sport nakeds, LAMS-approved commuters and delivery workhorses —
            pick a category below to see what&rsquo;s ready to ride.
          </p>
          <HomeFleetPreview models={fleetPreview} />
        </section>
      )}

      <ExploreTours />

      <ToursCarousel />

      <BrandsGrid />

      {/* Where to find us */}
      {mapPins.length > 0 && (
        <section className="container py-20">
          <DividedTitle>Where to find us</DividedTitle>
          {depots.length === 1 && depots[0] ? (
            (() => {
              const depot = depots[0];
              const hoursByDay = new Map(depot.operatingHours.map((h) => [h.dayOfWeek, h]));
              // Render Mon → Sun (Australian convention)
              const weekOrder = [1, 2, 3, 4, 5, 6, 0];
              const dayLabels: Record<number, string> = {
                0: "Sun",
                1: "Mon",
                2: "Tue",
                3: "Wed",
                4: "Thu",
                5: "Fri",
                6: "Sat",
              };
              return (
                <div className="mt-12 grid items-stretch gap-6 md:grid-cols-2">
                  <div className="flex flex-col gap-3">
                    <div className="h-[460px] overflow-hidden rounded-md border border-border">
                      <PublicDepotMap depots={mapPins} zoom={17} />
                    </div>
                    <Button asChild variant="cta" size="lg" className="self-start">
                      <a
                        href={getDirectionsUrl(mapPins[0]!)}
                        target="_blank"
                        rel="noreferrer"
                        data-track="home-depot-directions"
                      >
                        Get directions ➔
                      </a>
                    </Button>
                  </div>
                  <div className="flex flex-col rounded-md border border-border bg-card p-8">
                    <h3 className="h2">{depot.name}</h3>
                    <p className="mt-3 text-muted-foreground">
                      {depot.addressLine1}
                      {depot.addressLine2 ? `, ${depot.addressLine2}` : ""}
                    </p>
                    <p className="text-muted-foreground">
                      {depot.suburb}, {depot.state} {depot.postcode}
                    </p>
                    <div className="mt-4 space-y-1">
                      {depot.phone && (
                        <p>
                          <a
                            href={`tel:${depot.phone}`}
                            className="text-foreground hover:underline"
                            data-track="home-depot-phone"
                          >
                            {depot.phone}
                          </a>
                        </p>
                      )}
                      {depot.email && (
                        <p>
                          <a
                            href={`mailto:${depot.email}`}
                            className="text-foreground hover:underline"
                            data-track="home-depot-email"
                          >
                            {depot.email}
                          </a>
                        </p>
                      )}
                    </div>
                    {depot.operatingHours.length > 0 && (
                      <div className="mt-6">
                        <h4 className="eyebrow">Opening hours</h4>
                        <dl className="mt-3 grid grid-cols-[auto_1fr] gap-x-6 gap-y-1 text-sm">
                          {weekOrder.map((day) => {
                            const row = hoursByDay.get(day);
                            return (
                              <div key={day} className="contents">
                                <dt className="text-muted-foreground">{dayLabels[day]}</dt>
                                <dd className="text-foreground">
                                  {!row || row.isClosed
                                    ? "Closed"
                                    : `${row.openTime} – ${row.closeTime}`}
                                </dd>
                              </div>
                            );
                          })}
                        </dl>
                      </div>
                    )}
                    <Button asChild variant="cta" size="lg" className="mt-8 self-start">
                      <Link
                        href={`/locations#${depot.id}`}
                        data-track="home-depot-details"
                      >
                        View location ➔
                      </Link>
                    </Button>
                  </div>
                </div>
              );
            })()
          ) : (
            <>
              <p className="mx-auto mt-4 max-w-2xl text-center text-muted-foreground">
                Pick up from any of our depots along the east coast. Tap a pin for details.
              </p>
              <div className="mt-12 h-[460px] overflow-hidden rounded-md border border-border">
                <PublicDepotMap depots={mapPins} />
              </div>
              <div className="mt-8 grid gap-4 md:grid-cols-3">
                {depots.map((d) => (
                  <Link
                    key={d.id}
                    href={`/locations#${d.id}`}
                    className="group rounded-md border border-border bg-card p-5 transition-shadow hover:shadow-md"
                  >
                    <h3 className="h3">{d.name}</h3>
                    <p className="mt-1 text-sm text-muted-foreground">
                      {d.suburb}, {d.state} {d.postcode}
                    </p>
                    <p className="mt-3 text-sm text-foreground group-hover:underline">
                      View location ➔
                    </p>
                  </Link>
                ))}
              </div>
              <div className="mt-10 flex justify-center">
                <Button asChild variant="cta" size="lg">
                  <Link href="/locations" data-track="home-all-locations">All locations ➔</Link>
                </Button>
              </div>
            </>
          )}
        </section>
      )}

    </>
  );
}

