import Image from "next/image";
import { DividedTitle } from "@/components/marketing/divided-title";

interface ExperienceItem {
  title: string;
  description: string;
  image: string;
  alt: string;
  unoptimized?: boolean;
}

const ITEMS: ExperienceItem[] = [
  {
    title: "Top notch fleet and gear",
    description: "Count on well maintained bikes and quality gear for every ride.",
    image: "/experience/race.webp",
    alt: "Rider on a well-maintained motorcycle",
  },
  {
    title: "Service made for you",
    description: "We shape our service around your needs.",
    image: "/experience/service-made-for-you.webp",
    alt: "Staff helping a customer",
  },
  {
    title: "Consistent excellence",
    description: "Expect the same great service, every time.",
    image: "/experience/consistent-excellence.gif",
    alt: "Excellence badge animation",
    unoptimized: true,
  },
  {
    title: "Friendly & professional",
    description: "A team that's professional, friendly, and caring.",
    image: "/experience/friendly-and-professional.webp",
    alt: "Friendly team of riders",
  },
  {
    title: "Connected to our riders",
    description: "We build connections that go beyond business.",
    image: "/experience/connected-to-riders.webp",
    alt: "Riders connecting as a community",
  },
];

export interface ExperienceDifferenceProps {
  brandName: string;
}

export function ExperienceDifference({ brandName }: ExperienceDifferenceProps) {
  return (
    <section className="container py-20">
      <DividedTitle>{`Experience the ${brandName} difference with:`}</DividedTitle>
      <ul className="mt-14 grid grid-cols-2 gap-6 [&>li:last-child:nth-child(odd)]:col-span-2 sm:grid-cols-2 sm:gap-8 md:grid-cols-3 md:[&>li:last-child:nth-child(odd)]:col-span-1 lg:grid-cols-5">
        {ITEMS.map((item) => (
          <li
            key={item.title}
            className="group relative flex flex-col items-center text-center"
          >
            <div className="relative aspect-square w-24 transition-transform duration-500 ease-out group-hover:-translate-y-2 group-hover:scale-105 sm:w-32 md:w-36">
              <Image
                src={item.image}
                alt={item.alt}
                fill
                sizes="(min-width: 1024px) 18vw, (min-width: 640px) 33vw, 50vw"
                className="object-contain [filter:hue-rotate(-125deg)_saturate(1.6)]"
                unoptimized={item.unoptimized}
              />
            </div>
            <h3 className="h3 mt-6 transition-colors duration-300 group-hover:text-secondary">
              {item.title}
            </h3>
            <span
              aria-hidden
              className="mt-3 block h-0.5 w-10 origin-center scale-x-0 bg-secondary transition-transform duration-500 ease-out group-hover:scale-x-100"
            />
            <p className="mt-3 text-sm text-muted-foreground">{item.description}</p>
          </li>
        ))}
      </ul>
    </section>
  );
}
