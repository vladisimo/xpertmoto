import type { Metadata } from "next";
import Image from "next/image";
import Link from "next/link";

import { Button } from "@/components/ui/button";
import { DividedTitle } from "@/components/marketing/divided-title";
import { FaqList } from "@/components/marketing/faq-list";
import { TOUR_FAQS, TOURS } from "@/content/tours";
import { getBranding } from "@/lib/branding";

export async function generateMetadata(): Promise<Metadata> {
  const { siteName } = await getBranding();
  return {
    title: `Guided Motorcycle Tours in Sydney | ${siteName}`,
    description:
      "Premium guided motorcycle tours across Sydney and beyond. Day trips led by local experts — coastal curves, Blue Mountains, Hunter Valley and more.",
  };
}

export default async function ToursPage() {
  const { siteName } = await getBranding();
  return (
    <>
      {/* Hero */}
      <section className="relative isolate -mt-20">
        <div className="relative w-full overflow-hidden h-[60vh] min-h-[480px]">
          <Image
            src="/tours/hero-desktop.jpg"
            alt="Motorcycle tour in Sydney"
            fill
            priority
            sizes="100vw"
            className="object-cover object-left"
          />
          <div aria-hidden className="absolute inset-0 bg-foreground/50" />
          <div className="container relative z-10 flex h-full flex-col items-end justify-center pt-20 text-right text-background">
            <span className="eyebrow text-background/80">{`${siteName} Tours`}</span>
            <h1 className="h-display mt-3 max-w-4xl text-background">
              Premium Guided Motorcycle Tours: Sydney &amp; Beyond
            </h1>
            <p className="mt-6 max-w-3xl text-lg text-background/90">
              Experience the region&rsquo;s best motorbike rides and sightseeing tours. From coastal
              curves to rugged backcountry trails, our day trips are packed with adventure and
              steered by local experts who live for the ride. Escape the ordinary for a day and
              discover the freedom of the open road.
            </p>
          </div>
        </div>
      </section>

      {/* Tour grid */}
      <section className="container py-20">
        <DividedTitle>Choose your ride</DividedTitle>
        <div className="mt-12 grid gap-8 md:grid-cols-2 lg:grid-cols-3">
          {TOURS.map((tour) => (
            <article
              key={tour.slug}
              className="group flex flex-col overflow-hidden rounded-lg border border-border bg-card text-card-foreground transition-shadow hover:shadow-lg"
            >
              <Link href={`/tours/${tour.slug}`} className="relative block aspect-[4/3] overflow-hidden">
                <Image
                  src={tour.gallery[0].src}
                  alt={tour.gallery[0].alt}
                  fill
                  sizes="(min-width: 1024px) 33vw, (min-width: 768px) 50vw, 100vw"
                  className="object-cover transition-transform duration-500 group-hover:scale-105"
                />
                <span className="absolute left-4 top-4 inline-flex h-8 w-8 items-center justify-center rounded-full bg-secondary font-semibold text-foreground">
                  {tour.number}
                </span>
              </Link>
              <div className="flex flex-1 flex-col p-6">
                <h3 className="h3">{tour.name}</h3>
                <dl className="mt-4 grid grid-cols-3 gap-2 text-sm">
                  <div>
                    <dt className="caption">Distance</dt>
                    <dd className="font-semibold">{tour.distanceKm} km</dd>
                  </div>
                  <div>
                    <dt className="caption">Duration</dt>
                    <dd className="font-semibold">{tour.durationHours} hrs</dd>
                  </div>
                  <div>
                    <dt className="caption">Departs</dt>
                    <dd className="font-semibold">{tour.departsAt}</dd>
                  </div>
                </dl>
                <p className="mt-4 flex-1 text-sm text-muted-foreground">{tour.description}</p>
                <Button asChild variant="cta" className="mt-6 w-full">
                  <Link href={`/tours/${tour.slug}`}>Take a closer look ➔</Link>
                </Button>
              </div>
            </article>
          ))}
        </div>
      </section>

      {/* FAQs */}
      <section className="bg-muted py-20">
        <div className="container max-w-4xl">
          <DividedTitle>{`FAQs about ${siteName} tours`}</DividedTitle>
          <div className="mt-12">
            <FaqList items={TOUR_FAQS} />
          </div>
        </div>
      </section>

      {/* Closing CTA */}
      <section className="bg-foreground text-background">
        <div className="container py-16 text-center">
          <h2 className="h1 text-background">Ready for the ride of your life?</h2>
          <p className="mx-auto mt-3 max-w-xl text-background/70">
            Talk to our team on WhatsApp and we&rsquo;ll tailor a tour to your crew.
          </p>
          <Button asChild variant="cta" size="lg" className="mt-8">
            <a
              href="https://wa.me/61433880748?text=Hi%2C%20I%27d%20like%20to%20book%20a%20motorcycle%20tour."
              target="_blank"
              rel="noopener noreferrer"
            >
              Book on WhatsApp ➔
            </a>
          </Button>
        </div>
      </section>
    </>
  );
}
