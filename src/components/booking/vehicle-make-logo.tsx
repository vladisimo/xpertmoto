"use client";

import Image from "next/image";

const LOGOS: Record<string, string> = {
  bmw: "/mechanic/brands/bmw.png",
  cfmoto: "/mechanic/brands/cfmoto.png",
  ducati: "/mechanic/brands/ducati.png",
  honda: "/mechanic/brands/honda.png",
  kawasaki: "/mechanic/brands/kawasaki.jpg",
  ktm: "/mechanic/brands/ktm.png",
  "royal enfield": "/mechanic/brands/royal-enfield.jpg",
  "royal-enfield": "/mechanic/brands/royal-enfield.jpg",
  suzuki: "/mechanic/brands/suzuki.jpg",
  triumph: "/mechanic/brands/triumph.png",
  yamaha: "/mechanic/brands/yamaha.png",
};

export function logoForMake(make: string): string | null {
  return LOGOS[make.trim().toLowerCase()] ?? null;
}

export function VehicleMakeLogo({
  make,
  size = 18,
  className,
}: {
  make: string;
  size?: number;
  className?: string;
}) {
  const src = logoForMake(make);
  if (!src) {
    return (
      <span
        className={className}
        style={{ width: size, height: size, display: "inline-block" }}
        aria-hidden
      />
    );
  }
  return (
    <Image
      src={src}
      alt=""
      width={size}
      height={size}
      className={className}
      unoptimized
    />
  );
}
