import Image from "next/image";
import Link from "next/link";

interface ServiceCard {
  title: string;
  image: string;
  href: string;
  external?: boolean;
}

const SERVICES: ServiceCard[] = [
  {
    title: "Rentals",
    image: "/xpert-services/rentals.webp",
    href: "/fleet",
  },
  {
    title: "Tours",
    image: "/xpert-services/tours.webp",
    href: "/tours",
  },
  {
    title: "Mechanic",
    image: "/xpert-services/mechanic.webp",
    href: "/mechanic-services",
  },
  {
    title: "Online shop",
    image: "/xpert-services/online-shop.webp",
    href: "https://xpertmotogear.com.au/",
    external: true,
  },
];

export function XpertServicesGrid() {
  return (
    <section className="container pt-8 pb-20" aria-labelledby="services-heading">
      <h2 id="services-heading" className="sr-only">
        Our services: rentals, tours, mechanic and gear
      </h2>
      <div className="grid grid-cols-2 gap-3 sm:gap-6 lg:grid-cols-4">
        {SERVICES.map((service) => {
          const linkProps = service.external
            ? { href: service.href, target: "_blank", rel: "noopener noreferrer" }
            : { href: service.href };

          return (
            <Link
              key={service.title}
              {...linkProps}
              aria-label={service.title}
              className="group relative block overflow-hidden rounded-lg bg-muted transition-shadow hover:shadow-lg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
            >
              <div className="relative aspect-[3/4]">
                <Image
                  src={service.image}
                  alt={service.title}
                  fill
                  sizes="(min-width: 1024px) 25vw, 50vw"
                  className="object-cover transition-transform duration-500 group-hover:scale-105"
                />
              </div>
            </Link>
          );
        })}
      </div>
    </section>
  );
}
