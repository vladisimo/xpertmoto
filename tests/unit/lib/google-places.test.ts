import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { server } from "../../setup";
import { http, HttpResponse } from "msw";

const cachedMock = vi.fn(
  async (
    _key: string,
    _ttl: number,
    fn: () => Promise<unknown>,
    _tags?: readonly string[],
  ) => fn(),
);

vi.mock("@/lib/cache", () => ({
  cached: <T>(
    key: string,
    ttl: number,
    fn: () => Promise<T>,
    tags?: readonly string[],
  ) => cachedMock(key, ttl, fn, tags) as Promise<T>,
}));

const REVIEWS_URL = "https://places.googleapis.com/v1/places/:placeId";
const SIX_HOURS_SEC = 60 * 60 * 6;

describe("fetchGoogleReviews", () => {
  beforeEach(() => {
    cachedMock.mockClear();
    cachedMock.mockImplementation(
      async (
        _key: string,
        _ttl: number,
        fn: () => Promise<unknown>,
        _tags?: readonly string[],
      ) => fn(),
    );
    vi.resetModules();
    delete process.env.GOOGLE_MAPS_API_KEY;
    delete process.env.GOOGLE_PLACES_PLACE_ID;
  });

  afterEach(() => {
    delete process.env.GOOGLE_MAPS_API_KEY;
    delete process.env.GOOGLE_PLACES_PLACE_ID;
  });

  it("calls cached() with a place-id-scoped key, the 6h TTL, and the google-reviews tag", async () => {
    process.env.GOOGLE_MAPS_API_KEY = "test-key";
    process.env.GOOGLE_PLACES_PLACE_ID = "place-abc";
    server.use(
      http.get(REVIEWS_URL, () =>
        HttpResponse.json({
          rating: 4.7,
          userRatingCount: 42,
          googleMapsUri: "https://maps.example/place-abc",
          reviews: [
            {
              name: "review-1",
              rating: 5,
              text: { text: "Great service" },
              authorAttribution: { displayName: "Sam" },
              relativePublishTimeDescription: "a week ago",
            },
          ],
        }),
      ),
    );

    const { fetchGoogleReviews } = await import("@/lib/reviews/google-places");
    const result = await fetchGoogleReviews();

    expect(cachedMock).toHaveBeenCalledTimes(1);
    const [key, ttl, , tags] = cachedMock.mock.calls[0]!;
    expect(key).toBe("google-places:reviews:v1:place-abc");
    expect(ttl).toBe(SIX_HOURS_SEC);
    expect(tags).toEqual(["google-reviews"]);
    expect(result.source).toBe("google");
    expect(result.reviews).toHaveLength(1);
  });

  it("short-circuits when cached() returns a hit, without invoking the Google API", async () => {
    process.env.GOOGLE_MAPS_API_KEY = "test-key";
    process.env.GOOGLE_PLACES_PLACE_ID = "place-cached";
    let googleHits = 0;
    server.use(
      http.get(REVIEWS_URL, () => {
        googleHits += 1;
        return HttpResponse.json({});
      }),
    );
    cachedMock.mockImplementationOnce(async () => ({
      reviews: [],
      aggregate: { average: 4.9, total: 100 },
      source: "google" as const,
    }));

    const { fetchGoogleReviews } = await import("@/lib/reviews/google-places");
    const result = await fetchGoogleReviews();

    expect(googleHits).toBe(0);
    expect(result.aggregate.total).toBe(100);
  });

  it("scopes the cache key to a stable placeholder when GOOGLE_PLACES_PLACE_ID is unset", async () => {
    const { fetchGoogleReviews } = await import("@/lib/reviews/google-places");
    await fetchGoogleReviews();
    expect(cachedMock.mock.calls[0]![0]).toBe("google-places:reviews:v1:default");
  });

  it("returns the fallback payload when env vars are missing (and never hits Google)", async () => {
    let googleHits = 0;
    server.use(
      http.get(REVIEWS_URL, () => {
        googleHits += 1;
        return HttpResponse.json({});
      }),
    );

    const { fetchGoogleReviews } = await import("@/lib/reviews/google-places");
    const result = await fetchGoogleReviews();

    expect(googleHits).toBe(0);
    expect(result.source).toBe("fallback");
    expect(result.reviews.length).toBeGreaterThan(0);
  });
});
