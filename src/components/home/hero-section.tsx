"use client";
import { useRef, useState } from "react";
import { HeroCarousel, type HeroSlide } from "@/components/marketing/hero-carousel";
import { HeroAvailabilityWidget } from "@/components/home/hero-availability-widget";

export interface HeroSectionProps {
  slides: HeroSlide[];
  eyebrow: string;
  title: React.ReactNode;
  description: string;
  secondaryCta: { label: string; href: string };
  /** Optional background video; falls back to the slide images as poster. */
  videoMp4?: string;
  videoWebm?: string;
}

export function HeroSection({
  slides,
  eyebrow,
  title,
  description,
  secondaryCta,
  videoMp4,
  videoWebm,
}: HeroSectionProps) {
  const [showWidget, setShowWidget] = useState(false);
  const widgetRef = useRef<HTMLDivElement>(null);

  // Open the widget (if needed) and always bring it into view. Scrolling
  // lives in the click handler — not a showWidget effect — so a repeat click
  // re-scrolls even when the widget is already open and the user has scrolled
  // away. On desktop the widget overlays the hero at the top, so this lands at
  // the page top; on mobile it renders *below* the hero in normal flow, where
  // a plain scroll-to-top left it off-screen. `scroll-mt-24` on the container
  // keeps the heading clear of the fixed header. rAF lets a first-click mount
  // commit (and layout settle) before we measure the target.
  const openWidget = () => {
    setShowWidget(true);
    requestAnimationFrame(() => {
      widgetRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
    });
  };

  return (
    <div className="relative">
      <HeroCarousel
        slides={slides}
        eyebrow={eyebrow}
        title={title}
        description={description}
        videoMp4={videoMp4}
        videoWebm={videoWebm}
        primaryCta={{
          label: "Find Available Bikes for Your Dates",
          onClick: openWidget,
        }}
        secondaryCta={secondaryCta}
      />
      {showWidget && (
        <div
          ref={widgetRef}
          className="container relative z-10 scroll-mt-24 pb-12 md:absolute md:inset-x-0 md:top-0 md:h-full md:scroll-mt-0 md:pb-0"
        >
          <div className="md:pointer-events-none md:flex md:h-full md:items-center md:justify-end">
            <div className="md:pointer-events-auto md:w-[560px]">
              <HeroAvailabilityWidget onDismiss={() => setShowWidget(false)} />
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
