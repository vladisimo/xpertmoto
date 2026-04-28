export type ReviewRating = 1 | 2 | 3 | 4 | 5;

export type ReviewSource = "google" | "fallback";

export interface ReviewCard {
  id: string;
  author: string;
  rating: ReviewRating;
  body: string;
  relativeTime: string;
  profilePhotoUrl?: string;
  authorUrl?: string;
  source: ReviewSource;
}

export interface ReviewsPayload {
  reviews: ReviewCard[];
  aggregate: {
    average: number;
    total: number;
  };
  source: ReviewSource;
  googleMapsUrl?: string;
}
