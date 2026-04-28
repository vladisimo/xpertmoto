import type { ReviewCard, ReviewsPayload } from "./types";

const FALLBACK_REVIEWS: ReviewCard[] = [
  {
    id: "fb-1",
    author: "Sarah M.",
    rating: 5,
    body: "Super easy booking and the scooter was spotless. Staff were fantastic and talked me through everything before I rode off. Will definitely hire again.",
    relativeTime: "a week ago",
    source: "fallback",
  },
  {
    id: "fb-2",
    author: "James T.",
    rating: 5,
    body: "Great value for a week's hire on the Gold Coast. Bike ran perfectly and they delivered to my hotel. Couldn't fault the service.",
    relativeTime: "2 weeks ago",
    source: "fallback",
  },
  {
    id: "fb-3",
    author: "Priya K.",
    rating: 5,
    body: "Hired a 125cc for a Byron weekend. Helmet and lock included, paperwork took 5 minutes. Lovely team to deal with.",
    relativeTime: "a month ago",
    source: "fallback",
  },
  {
    id: "fb-4",
    author: "Daniel R.",
    rating: 5,
    body: "Took a 300cc maxi up to Noosa for a long weekend. Immaculate machine, clear instructions, smooth pickup and return. Ten out of ten.",
    relativeTime: "a month ago",
    source: "fallback",
  },
  {
    id: "fb-5",
    author: "Emma L.",
    rating: 5,
    body: "My first time on a scooter and the team were so patient. Gave me a proper rundown and even let me practice in the yard. Felt safe the whole trip.",
    relativeTime: "2 months ago",
    source: "fallback",
  },
  {
    id: "fb-6",
    author: "Hiroshi A.",
    rating: 5,
    body: "Visiting from Japan — booking in English was effortless and the scooter was cheaper than a rental car. Saw so much more of Surfers this way.",
    relativeTime: "3 months ago",
    source: "fallback",
  },
  {
    id: "fb-7",
    author: "Amelia W.",
    rating: 5,
    body: "Hired a Vespa for our Byron anniversary weekend. Immaculate bike, easy paperwork, and the team even recommended the best coastal route.",
    relativeTime: "3 months ago",
    source: "fallback",
  },
  {
    id: "fb-8",
    author: "Marco V.",
    rating: 5,
    body: "Long-term rental for a month of travel up and down the Gold Coast. Serviced perfectly, no hidden costs, and swapped bikes mid-hire when I upgraded. Brilliant crew.",
    relativeTime: "4 months ago",
    source: "fallback",
  },
];

export function buildFallbackPayload(): ReviewsPayload {
  return {
    reviews: FALLBACK_REVIEWS,
    aggregate: { average: 4.8, total: 1283 },
    source: "fallback",
  };
}
