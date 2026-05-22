"use client";
import { useState } from "react";
import { HeroCarousel, type HeroSlide } from "@/components/marketing/hero-carousel";
import { HeroAvailabilityWidget } from "@/components/home/hero-availability-widget";

export interface HeroSectionProps {
  slides: HeroSlide[];
  eyebrow: string;
  title: React.ReactNode;
  description: string;
  secondaryCta: { label: string; href: string };
}

export function HeroSection({
  slides,
  eyebrow,
  title,
  description,
  secondaryCta,
}: HeroSectionProps) {
  const [showWidget, setShowWidget] = useState(false);

  const openWidget = () => {
    setShowWidget(true);
    window.scrollTo({ top: 0, behavior: "smooth" });
  };

  return (
    <div className="relative">
      <HeroCarousel
        slides={slides}
        eyebrow={eyebrow}
        title={title}
        description={description}
        primaryCta={{
          label: "Find Available Bikes for Your Dates",
          onClick: openWidget,
        }}
        secondaryCta={secondaryCta}
      />
      {showWidget && (
        <>
          <div className="container relative z-10 pb-12 md:absolute md:inset-x-0 md:top-0 md:h-full md:pb-0">
            <div className="md:pointer-events-none md:flex md:h-full md:items-center md:justify-end">
              <div className="md:pointer-events-auto md:w-[560px]">
                <HeroAvailabilityWidget onDismiss={() => setShowWidget(false)} />
              </div>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
