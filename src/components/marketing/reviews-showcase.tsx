import Link from "next/link";
import { DividedTitle } from "@/components/marketing/divided-title";
import { ReviewFloatingRow } from "@/components/marketing/review-floating-row";
import { fetchGoogleReviews } from "@/lib/reviews/google-places";

export async function ReviewsShowcase() {
  const { reviews, aggregate, googleMapsUrl } = await fetchGoogleReviews();
  if (reviews.length === 0) return null;

  return (
    <section className="bg-muted py-16 md:py-20">
      <div className="container">
        <DividedTitle>What riders are saying</DividedTitle>

        <div className="mx-auto mt-8 flex max-w-xl flex-col items-center gap-2 text-center">
          <AggregateStars average={aggregate.average} />
          <p className="caption">
            Based on{" "}
            <span className="font-semibold text-foreground">{aggregate.total.toLocaleString()}</span>{" "}
            Google reviews
            {googleMapsUrl ? (
              <>
                {" · "}
                <Link
                  href={googleMapsUrl}
                  target="_blank"
                  rel="noreferrer noopener"
                  className="font-medium text-foreground underline-offset-4 hover:underline"
                >
                  See all on Google →
                </Link>
              </>
            ) : null}
          </p>
        </div>

        <ReviewFloatingRow reviews={reviews} className="mt-12" />
      </div>
    </section>
  );
}

function AggregateStars({ average }: { average: number }) {
  const display = average.toFixed(1);
  const pct = Math.max(0, Math.min(100, (average / 5) * 100));
  return (
    <div className="flex items-center gap-3">
      <div aria-hidden className="relative text-2xl leading-none tracking-[0.1em]">
        <span className="text-muted-foreground/40">★★★★★</span>
        <span
          className="absolute inset-y-0 left-0 overflow-hidden text-secondary"
          style={{ width: `${pct}%` }}
        >
          ★★★★★
        </span>
      </div>
      <span className="h2 leading-none">{display}</span>
    </div>
  );
}
