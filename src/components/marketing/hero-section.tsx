import Image from "next/image";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

export interface HeroSectionProps {
  /** Background image path. When absent, falls back to a CSS gradient. */
  imageSrc?: string;
  imageAlt?: string;
  eyebrow?: string;
  title: React.ReactNode;
  description?: React.ReactNode;
  primaryCta?: { label: string; href: string };
  secondaryCta?: { label: string; href: string };
  /** Extra content rendered below the CTAs (e.g. an availability widget). */
  children?: React.ReactNode;
  align?: "left" | "center";
  /** Dark overlay strength on top of the image. "dark" = ~55% black. */
  overlay?: "dark" | "light" | "none";
  minHeight?: "md" | "lg" | "screen";
  className?: string;
}

const MIN_HEIGHT: Record<NonNullable<HeroSectionProps["minHeight"]>, string> = {
  md:     "min-h-[420px]",
  lg:     "min-h-[560px]",
  screen: "min-h-[calc(100vh-4rem)]",
};

const OVERLAY: Record<NonNullable<HeroSectionProps["overlay"]>, string> = {
  dark:  "bg-gradient-to-b from-black/50 via-black/45 to-black/70",
  light: "bg-gradient-to-b from-white/10 via-white/0 to-white/40",
  none:  "",
};

export function HeroSection({
  imageSrc,
  imageAlt = "",
  eyebrow,
  title,
  description,
  primaryCta,
  secondaryCta,
  children,
  align = "left",
  overlay = "dark",
  minHeight = "lg",
  className,
}: HeroSectionProps) {
  return (
    <section className={cn("relative isolate overflow-hidden", MIN_HEIGHT[minHeight], className)}>
      {imageSrc ? (
        <Image
          src={imageSrc}
          alt={imageAlt}
          fill
          priority
          sizes="100vw"
          className="object-cover"
        />
      ) : (
        <div aria-hidden className="absolute inset-0 bg-gradient-to-br from-foreground via-foreground to-muted-foreground" />
      )}
      {overlay !== "none" && <div aria-hidden className={cn("absolute inset-0", OVERLAY[overlay])} />}
      <div className={cn("relative container flex h-full flex-col justify-center py-16 md:py-24", MIN_HEIGHT[minHeight])}>
        <div className={cn("max-w-2xl text-background", align === "center" && "mx-auto text-center")}>
          {eyebrow && <p className="caption text-background/75 uppercase tracking-[0.14em]">{eyebrow}</p>}
          <h1 className="h-display text-background">{title}</h1>
          {description && <p className="mt-5 text-background/85 text-lg leading-relaxed">{description}</p>}
          {(primaryCta || secondaryCta) && (
            <div className={cn("mt-8 flex flex-wrap gap-3", align === "center" && "justify-center")}>
              {primaryCta && (
                <Button asChild variant="cta" size="lg">
                  <Link href={primaryCta.href}>{primaryCta.label}</Link>
                </Button>
              )}
              {secondaryCta && (
                <Button asChild size="lg" className="bg-background/10 text-background border border-background/30 hover:bg-background/20">
                  <Link href={secondaryCta.href}>{secondaryCta.label}</Link>
                </Button>
              )}
            </div>
          )}
          {children && <div className="mt-8">{children}</div>}
        </div>
      </div>
    </section>
  );
}
