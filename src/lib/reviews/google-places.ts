import { z } from "zod";
import { cached } from "@/lib/cache";
import { logger } from "@/lib/logger";
import { buildFallbackPayload } from "./fallback-reviews";
import type { ReviewCard, ReviewRating, ReviewsPayload } from "./types";

const PLACES_API_URL = "https://places.googleapis.com/v1/places";
const FIELD_MASK = "displayName,rating,userRatingCount,googleMapsUri,reviews";
const REVALIDATE_SECONDS = 60 * 60 * 6;

const localizedTextSchema = z.object({
  text: z.string(),
  languageCode: z.string().optional(),
});

const reviewSchema = z.object({
  name: z.string().optional(),
  relativePublishTimeDescription: z.string().optional(),
  rating: z.number().optional(),
  text: localizedTextSchema.optional(),
  originalText: localizedTextSchema.optional(),
  authorAttribution: z
    .object({
      displayName: z.string().optional(),
      uri: z.string().optional(),
      photoUri: z.string().optional(),
    })
    .optional(),
});

const placeDetailsSchema = z.object({
  rating: z.number().optional(),
  userRatingCount: z.number().optional(),
  googleMapsUri: z.string().optional(),
  reviews: z.array(reviewSchema).optional(),
});

function clampRating(n: number | undefined): ReviewRating {
  const r = Math.round(n ?? 5);
  if (r <= 1) return 1;
  if (r >= 5) return 5;
  return r as ReviewRating;
}

function normalizeReview(raw: z.infer<typeof reviewSchema>, index: number): ReviewCard | null {
  const body = raw.text?.text ?? raw.originalText?.text;
  const author = raw.authorAttribution?.displayName;
  if (!body || !author) return null;
  return {
    id: raw.name ?? `google-${index}`,
    author,
    rating: clampRating(raw.rating),
    body,
    relativeTime: raw.relativePublishTimeDescription ?? "",
    profilePhotoUrl: raw.authorAttribution?.photoUri,
    authorUrl: raw.authorAttribution?.uri,
    source: "google",
  };
}

async function fetchGoogleReviewsUncached(): Promise<ReviewsPayload> {
  const apiKey = process.env.GOOGLE_MAPS_API_KEY;
  const placeId = process.env.GOOGLE_PLACES_PLACE_ID;

  if (!apiKey || !placeId) {
    logger.debug(
      { hasApiKey: Boolean(apiKey), hasPlaceId: Boolean(placeId) },
      "google-places: env not configured, serving fallback reviews",
    );
    return buildFallbackPayload();
  }

  // One log line per real network fetch. Cache hits do NOT hit this function,
  // so this is the signal you're watching for when verifying the cache: on a
  // cold start you see it once, then silence for 6 hours.
  logger.info("google-places: cache miss — fetching from Google Places API");

  try {
    const res = await fetch(`${PLACES_API_URL}/${encodeURIComponent(placeId)}`, {
      method: "GET",
      headers: {
        "X-Goog-Api-Key": apiKey,
        "X-Goog-FieldMask": FIELD_MASK,
      },
      // Inner fetch cache — belt to unstable_cache's braces. Either one alone
      // prevents per-request hits to Google; both together survive framework
      // behaviour drift between Next.js minors (e.g. cacheComponents: true).
      next: { revalidate: REVALIDATE_SECONDS, tags: ["google-reviews"] },
    });

    if (!res.ok) {
      logger.warn(
        { status: res.status, statusText: res.statusText },
        "google-places: non-OK response, serving fallback reviews",
      );
      return buildFallbackPayload();
    }

    const json: unknown = await res.json();
    const parsed = placeDetailsSchema.safeParse(json);
    if (!parsed.success) {
      logger.warn({ issues: parsed.error.issues }, "google-places: response schema mismatch, serving fallback reviews");
      return buildFallbackPayload();
    }

    const reviews = (parsed.data.reviews ?? [])
      .map((r, i) => normalizeReview(r, i))
      .filter((r): r is ReviewCard => r !== null);

    if (reviews.length === 0) {
      logger.warn("google-places: response had no usable reviews, serving fallback reviews");
      return buildFallbackPayload();
    }

    const fallbackAggregate = buildFallbackPayload().aggregate;
    return {
      reviews,
      aggregate: {
        average: parsed.data.rating ?? fallbackAggregate.average,
        total: parsed.data.userRatingCount ?? fallbackAggregate.total,
      },
      source: "google",
      googleMapsUrl: parsed.data.googleMapsUri,
    };
  } catch (err) {
    logger.warn({ err }, "google-places: fetch threw, serving fallback reviews");
    return buildFallbackPayload();
  }
}

// Redis-backed cache. Survives Next.js HMR, dev-server restarts, and
// load-balanced production processes — `unstable_cache` was process-local
// and refetched from Google on every restart. The inner fetch's
// `next: { revalidate, tags }` still acts as an in-process safety net
// for the rare path where Redis is unconfigured (`cached()` falls through
// to the function directly in that case).
//
// To manually bust the cache (e.g. after changing the Place ID), call
// `invalidateTag("google-reviews")` from `@/lib/cache`.
export function fetchGoogleReviews(): Promise<ReviewsPayload> {
  const placeId = process.env.GOOGLE_PLACES_PLACE_ID ?? "default";
  return cached(
    `google-places:reviews:v1:${placeId}`,
    REVALIDATE_SECONDS,
    fetchGoogleReviewsUncached,
    ["google-reviews"],
  );
}
