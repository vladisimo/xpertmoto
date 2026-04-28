"use client";

import Image from "next/image";
import { useEffect, useState } from "react";

const IMAGES = [
  "/images/log-in_variant_01.png",
  "/images/log-in_variant_02.png",
  "/images/log-in_variant_03.png",
] as const;

const HOLD_MS = 4000;
const FADE_MS = 5000;

export function LoginImageCarousel() {
  const [activeIndex, setActiveIndex] = useState(0);

  useEffect(() => {
    const id = window.setInterval(() => {
      setActiveIndex((current) => (current + 1) % IMAGES.length);
    }, HOLD_MS + FADE_MS);
    return () => window.clearInterval(id);
  }, []);

  return (
    <div className="absolute inset-0">
      {IMAGES.map((src, index) => (
        <Image
          key={src}
          src={src}
          alt=""
          aria-hidden
          fill
          sizes="(min-width: 768px) 50vw, 100vw"
          priority
          className="object-cover"
          style={{
            opacity: index === activeIndex ? 1 : 0,
            transition: `opacity ${FADE_MS}ms ease-in-out`,
          }}
        />
      ))}
    </div>
  );
}
