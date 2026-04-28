"use client";

import Image from "next/image";
import { useState } from "react";
import { cn } from "@/lib/utils";
import type { ReviewCard } from "@/lib/reviews/types";

export interface ReviewFloatingRowProps {
  reviews: ReviewCard[];
  /** Marquee duration for each row. Bottom row uses ~1.25× for parallax. */
  durationTopSeconds?: number;
  durationBottomSeconds?: number;
  className?: string;
}

// Card sizing: w-80 (20rem = 320px) + gap-6 (1.5rem = 24px) → 344px per slot.
// A single copy of the reviews array needs to be at least this wide so that,
// at every phase of the marquee animation, the duplicated copy of the track
// fills any gap created by the translation. Target is roughly 1.5× an
// ultrawide viewport (3440px) to keep edges seamless on any realistic screen.
const SLOT_WIDTH_PX = 320 + 24;
const MIN_COPY_WIDTH_PX = 4800;

function buildMarqueeLoop(reviews: ReviewCard[]): ReviewCard[] {
  if (reviews.length === 0) return [];
  const singleRowWidthPx = reviews.length * SLOT_WIDTH_PX;
  const copies = Math.max(1, Math.ceil(MIN_COPY_WIDTH_PX / singleRowWidthPx));
  const singleCopy: ReviewCard[] = [];
  for (let i = 0; i < copies; i++) singleCopy.push(...reviews);
  // Duplicate the computed "single copy" so translating by -50% wraps
  // seamlessly back to the start: the two halves are identical.
  return [...singleCopy, ...singleCopy];
}

export function ReviewFloatingRow({
  reviews,
  durationTopSeconds = 60,
  durationBottomSeconds = 75,
  className,
}: ReviewFloatingRowProps) {
  if (reviews.length === 0) return null;

  // Split disjointly so the two rows never share a review. With an odd
  // count the top row gets the extra card.
  const half = Math.ceil(reviews.length / 2);
  const topRow = reviews.slice(0, half);
  const bottomRow = reviews.slice(half);

  return (
    <div className={cn("flex flex-col gap-6", className)}>
      <MarqueeRow reviews={topRow} direction="right" durationSeconds={durationTopSeconds} />
      {bottomRow.length > 0 ? (
        <MarqueeRow reviews={bottomRow} direction="left" durationSeconds={durationBottomSeconds} />
      ) : null}
    </div>
  );
}

interface MarqueeRowProps {
  reviews: ReviewCard[];
  direction: "left" | "right";
  durationSeconds: number;
}

function MarqueeRow({ reviews, direction, durationSeconds }: MarqueeRowProps) {
  const loop = buildMarqueeLoop(reviews);
  const halfLen = loop.length / 2;
  return (
    <div
      aria-label="Customer reviews"
      role="region"
      className="group relative overflow-hidden [mask-image:linear-gradient(to_right,transparent,black_10%,black_90%,transparent)] [-webkit-mask-image:linear-gradient(to_right,transparent,black_10%,black_90%,transparent)]"
      style={{ ["--marquee-duration" as string]: `${durationSeconds}s` }}
    >
      <div
        className={cn(
          "flex w-max gap-6",
          direction === "right" ? "animate-marquee-right" : "animate-marquee-left",
          "group-hover:[animation-play-state:paused]",
        )}
      >
        {loop.map((review, i) => (
          <div key={`${review.id}-${i}`} aria-hidden={i >= halfLen} className="w-80 shrink-0">
            <ReviewTile review={review} />
          </div>
        ))}
      </div>
    </div>
  );
}

function ReviewTile({ review }: { review: ReviewCard }) {
  const initials = review.author
    .split(" ")
    .map((p) => p[0])
    .filter(Boolean)
    .slice(0, 2)
    .join("")
    .toUpperCase();

  return (
    <figure className="flex h-full min-h-[14rem] flex-col rounded-lg border border-border bg-card p-6 text-card-foreground shadow-sm transition-shadow hover:shadow-md">
      <div className="flex items-center gap-3">
        <Avatar name={review.author} photoUrl={review.profilePhotoUrl} initials={initials} />
        <div className="min-w-0 flex-1">
          <div className="truncate text-sm font-semibold text-foreground">{review.author}</div>
          {review.relativeTime ? <div className="caption">{review.relativeTime}</div> : null}
        </div>
        <GoogleBadge />
      </div>
      <div aria-label={`Rated ${review.rating} out of 5`} className="mt-4 flex items-center gap-0.5">
        {Array.from({ length: 5 }).map((_, i) => (
          <Star key={i} filled={i < review.rating} />
        ))}
      </div>
      <blockquote className="body-text mt-3 line-clamp-5 text-foreground/80">
        &ldquo;{review.body}&rdquo;
      </blockquote>
    </figure>
  );
}

function Avatar({ name, photoUrl, initials }: { name: string; photoUrl?: string; initials: string }) {
  const [failed, setFailed] = useState(false);
  const showImage = Boolean(photoUrl) && !failed;
  return (
    <span className="relative inline-flex h-10 w-10 shrink-0 items-center justify-center overflow-hidden rounded-full bg-muted text-sm font-semibold text-foreground">
      {showImage ? (
        <Image
          src={photoUrl!}
          alt={name}
          fill
          sizes="40px"
          className="object-cover"
          onError={() => setFailed(true)}
          unoptimized
        />
      ) : (
        <span aria-hidden>{initials || "★"}</span>
      )}
    </span>
  );
}

function Star({ filled }: { filled: boolean }) {
  return (
    <svg
      aria-hidden
      viewBox="0 0 20 20"
      className={cn("h-4 w-4", filled ? "fill-secondary" : "fill-muted")}
    >
      <path d="M10 1.5l2.59 5.25 5.79.84-4.19 4.08.99 5.77L10 14.77l-5.18 2.72.99-5.77L1.62 7.59l5.79-.84L10 1.5z" />
    </svg>
  );
}

function GoogleBadge() {
  return (
    <span
      aria-label="Google review"
      title="Google review"
      className="inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-full border border-border bg-background text-[11px] font-semibold text-muted-foreground"
    >
      G
    </span>
  );
}
