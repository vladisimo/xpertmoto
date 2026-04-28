import Image from "next/image";
import { DividedTitle } from "@/components/marketing/divided-title";

interface Brand {
  name: string;
  image: string;
}

const BRANDS: Brand[] = [
  { name: "Yamaha", image: "/brands/yamaha.png" },
  { name: "BMW", image: "/brands/bmw.png" },
  { name: "Honda", image: "/brands/honda.png" },
  { name: "KTM", image: "/brands/ktm.png" },
  { name: "Kawasaki", image: "/brands/kawasaki.png" },
  { name: "Ducati", image: "/brands/ducati.png" },
  { name: "CFMOTO", image: "/brands/cfmoto.png" },
  { name: "Suzuki", image: "/brands/suzuki.png" },
];

export function BrandsGrid() {
  return (
    <section className="container py-20">
      <DividedTitle>{`Top brands only: The latest models "just for you"`}</DividedTitle>
      <ul className="mt-12 grid grid-cols-4 gap-3 sm:grid-cols-8 sm:gap-4">
        {BRANDS.map((brand, index) => (
          <li
            key={brand.name}
            className="animate-brand-sweep relative flex aspect-square items-center justify-center p-4"
            style={{ animationDelay: `${index * 0.5}s` }}
          >
            <div className="relative h-full w-full">
              <Image
                src={brand.image}
                alt={`${brand.name} motorcycles`}
                fill
                sizes="(min-width: 768px) 22vw, 45vw"
                className="object-contain"
              />
            </div>
            <span className="sr-only">{brand.name}</span>
          </li>
        ))}
      </ul>
    </section>
  );
}
