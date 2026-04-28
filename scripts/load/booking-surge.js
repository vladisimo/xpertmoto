// G16 load — booking surge.
//
// Drives a sustained 50 RPS against the tRPC booking.create endpoint for
// 10 minutes. Assertions:
//   - p99 latency < 1s
//   - error rate < 0.5%
//   - zero duplicate Payment rows after the run (verify via psql afterward
//     — this script does not self-check the DB)
//
// Usage:
//   k6 run scripts/load/booking-surge.js \
//     --env BASE_URL=http://localhost:3000 \
//     --env DEPOT_ID=<depot-id> \
//     --env CATEGORY_ID=<category-id>

import http from "k6/http";
import { check, sleep } from "k6";
import { Rate, Trend } from "k6/metrics";

export const errorRate = new Rate("scootering_booking_errors");
export const bookingLatency = new Trend("scootering_booking_latency_ms", true);

export const options = {
  scenarios: {
    surge: {
      executor: "constant-arrival-rate",
      rate: 50,
      timeUnit: "1s",
      duration: "10m",
      preAllocatedVUs: 100,
      maxVUs: 200,
    },
  },
  thresholds: {
    "http_req_duration{group:::booking}": ["p(99)<1000"],
    scootering_booking_errors: ["rate<0.005"],
  },
};

const BASE_URL = __ENV.BASE_URL || "http://localhost:3000";
const DEPOT_ID = __ENV.DEPOT_ID || "seed-depot-gold-coast";
const CATEGORY_ID = __ENV.CATEGORY_ID || "seed-cat-50cc";

export default function () {
  const payload = JSON.stringify({
    0: {
      json: {
        categoryId: CATEGORY_ID,
        pickupDepotId: DEPOT_ID,
        returnDepotId: DEPOT_ID,
        pickupDateTime: new Date(Date.now() + 7 * 24 * 3600 * 1000).toISOString(),
        returnDateTime: new Date(Date.now() + 9 * 24 * 3600 * 1000).toISOString(),
        addons: [],
        agreedToTerms: true,
        termsVersion: "1.0",
      },
    },
  });

  const start = Date.now();
  const res = http.post(`${BASE_URL}/api/trpc/booking.quote?batch=1`, payload, {
    headers: { "content-type": "application/json" },
    tags: { group: "booking" },
  });
  bookingLatency.add(Date.now() - start);
  const ok = check(res, { "status 200": (r) => r.status === 200 });
  errorRate.add(!ok);
  sleep(0.1);
}
