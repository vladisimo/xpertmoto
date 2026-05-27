"use client";
import { useEffect, useRef, useState } from "react";
import Image from "next/image";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { HeroVideoBackground } from "@/components/marketing/hero-video-background";
import { cn } from "@/lib/utils";

export interface HeroSlide {
  imageSrc: string;
  imageAlt?: string;
}

export interface HeroCarouselProps {
  slides: HeroSlide[];
  eyebrow?: string;
  title: React.ReactNode;
  description?: React.ReactNode;
  primaryCta?: { label: string; href?: string; onClick?: () => void };
  secondaryCta?: { label: string; href: string };
  children?: React.ReactNode;
  /** ms between slide transitions. Defaults to 6500. Set 0 to disable auto-rotate. */
  intervalMs?: number;
  /**
   * Optional background video. When `videoMp4` is set it replaces the image
   * crossfade; the first slide's image is used as the poster / fallback.
   */
  videoMp4?: string;
  videoWebm?: string;
  className?: string;
}

/**
 * Full-bleed hero with a rotating background image. Overlay copy (title, CTAs)
 * stays fixed while slides cross-fade behind it — mirrors XPERT Moto's 3-slide
 * homepage hero. Respects `prefers-reduced-motion` by disabling auto-rotate.
 */
export function HeroCarousel({
  slides,
  eyebrow,
  title,
  description,
  primaryCta,
  secondaryCta,
  children,
  intervalMs = 9500,
  videoMp4,
  videoWebm,
  className,
}: HeroCarouselProps) {
  const [active, setActive] = useState(0);
  const pausedRef = useRef(false);
  const useVideo = Boolean(videoMp4);

  useEffect(() => {
    if (useVideo || slides.length <= 1 || intervalMs <= 0) return;
    const reduced = typeof window !== "undefined"
      && window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
    if (reduced) return;
    const id = window.setInterval(() => {
      if (pausedRef.current) return;
      setActive((i) => (i + 1) % slides.length);
    }, intervalMs);
    return () => window.clearInterval(id);
  }, [slides.length, intervalMs, useVideo]);

  return (
    <section
      className={cn("relative isolate overflow-hidden min-h-[100svh] md:min-h-0 md:aspect-[2000/766]", className)}
      onMouseEnter={() => { pausedRef.current = true; }}
      onMouseLeave={() => { pausedRef.current = false; }}
    >
      {useVideo ? (
        <HeroVideoBackground
          mp4Src={videoMp4!}
          webmSrc={videoWebm}
          posterSrc={slides[0]?.imageSrc ?? ""}
          posterAlt={slides[0]?.imageAlt}
        />
      ) : (
        slides.map((s, i) => (
          <div
            key={s.imageSrc}
            aria-hidden={i !== active}
            className={cn(
              "absolute inset-0 transition-opacity duration-1200 ease-in-out",
              i === active ? "opacity-100" : "opacity-0",
            )}
          >
            <Image
              src={s.imageSrc}
              alt={s.imageAlt ?? ""}
              fill
              priority={i === 0}
              loading={i === 0 ? undefined : "eager"}
              sizes="100vw"
              className="object-cover"
            />
          </div>
        ))
      )}
      <div className="relative container flex h-full flex-col justify-end pb-32 pt-28 md:justify-center md:py-20">
        <div className="max-w-2xl text-background">
          {eyebrow && <p className="caption text-background/75 uppercase tracking-[0.14em]">{eyebrow}</p>}
          <h1 className="h-display text-background">{title}</h1>
          {description && <p className="mt-5 text-lg leading-relaxed text-background/85">{description}</p>}
          {(primaryCta || secondaryCta) && (
            <div className="mt-8 flex flex-wrap gap-3">
              {primaryCta && (
                primaryCta.onClick ? (
                  <Button
                    variant="cta"
                    size="lg"
                    onClick={primaryCta.onClick}
                    data-track="hero-primary-cta"
                    data-track-value={primaryCta.label}
                  >
                    {primaryCta.label}
                  </Button>
                ) : primaryCta.href ? (
                  <Button asChild variant="cta" size="lg">
                    <Link
                      href={primaryCta.href}
                      data-track="hero-primary-cta"
                      data-track-value={primaryCta.label}
                    >
                      {primaryCta.label}
                    </Link>
                  </Button>
                ) : null
              )}
              {secondaryCta && (
                <Button
                  asChild
                  size="lg"
                  className="border border-background/40 bg-background/10 text-background hover:bg-background/20"
                >
                  <Link
                    href={secondaryCta.href}
                    data-track="hero-secondary-cta"
                    data-track-value={secondaryCta.label}
                  >
                    {secondaryCta.label}
                  </Link>
                </Button>
              )}
            </div>
          )}
          {children && <div className="mt-8">{children}</div>}
        </div>

        {!useVideo && slides.length > 1 && (
          <div
            role="tablist"
            aria-label="Hero slides"
            className="absolute bottom-28 left-1/2 z-20 hidden -translate-x-1/2 items-center gap-2 md:flex"
          >
            {slides.map((_, i) => (
              <button
                key={i}
                type="button"
                role="tab"
                aria-selected={i === active}
                aria-label={`Go to slide ${i + 1}`}
                onClick={() => setActive(i)}
                className={cn(
                  "h-2.5 w-2.5 rounded-full border border-background/60 transition-colors",
                  i === active ? "bg-secondary border-secondary" : "bg-background/10 hover:bg-background/40",
                )}
              />
            ))}
          </div>
        )}
      </div>
    </section>
  );
}
