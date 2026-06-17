import type { Metadata } from "next";
import Image from "next/image";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft } from "lucide-react";

import { Button } from "@/components/ui/button";
import { DividedTitle } from "@/components/marketing/divided-title";
import { TOURS, getTour, whatsappUrl } from "@/content/tours";
import { buildMetadata } from "@/lib/seo/metadata";
import { absoluteUrl } from "@/lib/seo/site-url";
import { breadcrumbLd } from "@/lib/seo/json-ld";
import { JsonLd } from "@/components/seo/json-ld";

interface PageProps {
  params: Promise<{ slug: string }>;
}

export function generateStaticParams() {
  return TOURS.map((tour) => ({ slug: tour.slug }));
}

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const { slug } = await params;
  const tour = getTour(slug);
  if (!tour) {
    return buildMetadata({
      title: "Tours",
      description: "Guided motorcycle tours.",
      path: "/tours",
      noindex: true,
    });
  }
  // The root title template appends the brand ("· {siteName}") — no hardcoded
  // trading name here (multi-tenant rule).
  return buildMetadata({
    title: tour.name,
    description: tour.description,
    path: `/tours/${slug}`,
  });
}

export default async function TourDetailPage({ params }: PageProps) {
  const { slug } = await params;
  const tour = getTour(slug);
  if (!tour) notFound();

  const hero = tour.gallery[0];
  const rest = tour.gallery.slice(1);
  const breadcrumb = breadcrumbLd([
    { name: "Tours", url: absoluteUrl("/tours") },
    { name: tour.name, url: absoluteUrl(`/tours/${slug}`) },
  ]);

  return (
    <>
      <JsonLd data={breadcrumb} />
      {/* Hero */}
      <section className="relative isolate">
        <div className="relative h-[60vh] min-h-[420px] w-full overflow-hidden">
          <Image
            src={hero.src}
            alt={hero.alt}
            fill
            priority
            sizes="100vw"
            className="object-cover"
          />
          <div aria-hidden className="absolute inset-0 bg-foreground/55" />
          <div className="container relative z-10 flex h-full flex-col items-center justify-center text-center text-background">
            <span className="eyebrow text-background/80">Tour {tour.number}</span>
            <h1 className="h-display mt-3 max-w-4xl text-background">{tour.name}</h1>
            <dl className="mt-8 grid grid-cols-2 gap-6 text-background sm:grid-cols-4">
              <div>
                <dt className="caption text-background/70">Distance</dt>
                <dd className="mt-1 text-2xl font-semibold">{tour.distanceKm} km</dd>
              </div>
              <div>
                <dt className="caption text-background/70">Duration</dt>
                <dd className="mt-1 text-2xl font-semibold">{tour.durationHours} hrs</dd>
              </div>
              <div>
                <dt className="caption text-background/70">Departs</dt>
                <dd className="mt-1 text-2xl font-semibold">{tour.departsAt}</dd>
              </div>
              <div>
                <dt className="caption text-background/70">Returns</dt>
                <dd className="mt-1 text-2xl font-semibold">{tour.returnsAt}</dd>
              </div>
            </dl>
          </div>
        </div>
      </section>

      {/* Description + CTA */}
      <section className="container max-w-3xl py-20 text-center">
        <p className="text-lg text-muted-foreground">{tour.description}</p>
        <Button asChild variant="cta" size="lg" className="mt-8">
          <a
            href={whatsappUrl(`Hi, I'd like to book the ${tour.name} tour.`)}
            target="_blank"
            rel="noopener noreferrer"
          >
            Book this tour on WhatsApp ➔
          </a>
        </Button>
      </section>

      {/* Gallery */}
      <section className="bg-muted py-20">
        <div className="container">
          <DividedTitle>What you&rsquo;ll see</DividedTitle>
          <div className="mt-12 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {rest.map((image) => (
              <div
                key={image.src}
                className="relative aspect-[4/3] overflow-hidden rounded-md border border-border bg-background"
              >
                <Image
                  src={image.src}
                  alt={image.alt}
                  fill
                  sizes="(min-width: 1024px) 33vw, (min-width: 640px) 50vw, 100vw"
                  className="object-cover"
                />
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Back link */}
      <section className="container py-12">
        <Link
          href="/tours"
          className="inline-flex items-center gap-2 text-sm font-medium text-muted-foreground hover:text-foreground"
        >
          <ArrowLeft className="h-4 w-4" />
          Back to all tours
        </Link>
      </section>
    </>
  );
}
