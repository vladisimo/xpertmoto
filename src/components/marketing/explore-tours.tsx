import Image from "next/image";
import Link from "next/link";
import { Button } from "@/components/ui/button";

export function ExploreTours() {
  return (
    <section className="bg-muted">
      <div className="container grid items-center gap-10 py-20 md:grid-cols-2">
        <div>
          <h2 className="h1">Explore with Xpert guided tours</h2>
          <p className="mt-4 text-muted-foreground">
            From coastal roads to urban hotspots, our tours give you an in-depth look at
            Sydney&rsquo;s landscape. With skilled guides and curated routes, you&rsquo;ll enjoy a
            perfect mix of sightseeing, riding, and unforgettable moments.
          </p>
          <Button asChild variant="cta" size="lg" className="mt-8">
            <Link href="/tours" data-track="home-explore-tours">
              Explore with Xpert ➔
            </Link>
          </Button>
        </div>
        <div className="relative aspect-[4/3] overflow-hidden rounded-md">
          <Image
            src="/xpert-sydney-tours-details.jpg"
            alt="Guided motorcycle tour through Sydney"
            fill
            sizes="(min-width: 768px) 50vw, 100vw"
            className="object-cover"
          />
        </div>
      </div>
    </section>
  );
}
