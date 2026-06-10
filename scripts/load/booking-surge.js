// ─────────────────────────────────────────────────────────────────────────
// Breaking-point ramp — find the capacity ceiling of the capped stack.
//
// Ramps arrival rate until the p99 SLO (1s) or error budget breaks; the knee
// is the max sustainable throughput for the resource caps under test. Two
// variants:
//   MODE=quote  (default) read-path: booking.quote, no external calls — isolates
//               the uncached pricing/availability DB cost (Postgres CPU bound).
//   MODE=create write-path: authenticated booking.create (Stripe stub). After
//               the run, verify zero duplicate Payment rows per booking via psql.
//
// Params:  MODE, MAX_RATE (peak iters/s, default 200), STAGE (default 1m),
//          PREALLOC (default 100), MAXVUS (default 400), BASE_URL.
//
//   docker run --rm --network host -v $PWD/scripts/load:/scripts \
//     -e BASE_URL=http://localhost:3009 -e MODE=quote -e MAX_RATE=300 \
//     grafana/k6 run /scripts/booking-surge.js
// ─────────────────────────────────────────────────────────────────────────
import http from "k6/http";
import { check } from "k6";
import { Trend, Rate } from "k6/metrics";

const BASE = __ENV.BASE_URL || "http://localhost:3009";
const MODE = __ENV.MODE || "quote";
const MAX_RATE = Number(__ENV.MAX_RATE || 200);
const STAGE = __ENV.STAGE || "1m";

const tReq = new Trend("xm_surge_ms", true);
const errRate = new Rate("xm_surge_errors");

export const options = {
  scenarios: {
    surge: {
      executor: "ramping-arrival-rate",
      startRate: 5,
      timeUnit: "1s",
      preAllocatedVUs: Number(__ENV.PREALLOC || 100),
      maxVUs: Number(__ENV.MAXVUS || 400),
      stages: [
        { target: Math.ceil(MAX_RATE * 0.1), duration: STAGE },
        { target: Math.ceil(MAX_RATE * 0.25), duration: STAGE },
        { target: Math.ceil(MAX_RATE * 0.5), duration: STAGE },
        { target: Math.ceil(MAX_RATE * 0.75), duration: STAGE },
        { target: MAX_RATE, duration: STAGE },
      ],
    },
  },
  // Recorded, not abort-on-fail: we WANT to push past the SLO to find the knee.
  thresholds: {
    xm_surge_ms: ["p(99)<1000"],
    xm_surge_errors: ["rate<0.005"],
  },
  summaryTrendStats: ["avg", "med", "p(90)", "p(95)", "p(99)", "max"],
};

function enc(input) {
  return encodeURIComponent(JSON.stringify({ 0: { json: input } }));
}
function futureDates() {
  const day = 24 * 3600 * 1000;
  const start = new Date(Date.now() + (3 + Math.floor(Math.random() * 18)) * day);
  start.setUTCHours(1, 0, 0, 0);
  const ret = new Date(start.getTime() + (1 + Math.floor(Math.random() * 4)) * day);
  ret.setUTCHours(3, 0, 0, 0);
  return { pu: start.toISOString(), rt: ret.toISOString() };
}

export function setup() {
  const depot = http.get(`${BASE}/api/trpc/depot.list?batch=1&input=${enc(null)}`).json("0.result.data.json.0.id");
  const category = http
    .get(`${BASE}/api/trpc/catalog.listCategories?batch=1&input=${enc(null)}`)
    .json("0.result.data.json.0.id");
  if (!depot || !category) throw new Error(`setup failed: depot=${depot} category=${category}`);
  return { depot, category };
}

let loggedIn = false;
function login() {
  const csrf = http.get(`${BASE}/api/auth/csrf`).json("csrfToken");
  const res = http.post(`${BASE}/api/auth/callback/credentials`, {
    csrfToken: csrf,
    email: "sarah.smith@example.com",
    password: "customer1234",
    callbackUrl: `${BASE}/`,
    json: "true",
  });
  return res.status === 200 || res.status === 302;
}

export default function (data) {
  const { depot, category } = data;
  const { pu, rt } = futureDates();

  if (MODE === "create") {
    if (!loggedIn) loggedIn = login();
    if (!loggedIn) {
      errRate.add(1);
      return;
    }
    const t0 = Date.now();
    const res = http.post(
      `${BASE}/api/trpc/booking.create?batch=1`,
      JSON.stringify({
        0: {
          json: {
            categoryId: category,
            pickupDepotId: depot,
            returnDepotId: depot,
            pickupDateTime: pu,
            returnDateTime: rt,
            addons: [],
            agreedToTerms: true,
            termsVersion: "v1.0",
          },
        },
      }),
      { headers: { "content-type": "application/json" }, tags: { proc: "booking.create" } },
    );
    tReq.add(Date.now() - t0);
    errRate.add(!check(res, { "create 200": (r) => r.status === 200 && !r.body.includes('"error"') }));
  } else {
    // quote read-path (no external calls)
    const res = http.get(
      `${BASE}/api/trpc/booking.quote?batch=1&input=${enc({
        categoryId: category,
        pickupDepotId: depot,
        returnDepotId: depot,
        pickupDateTime: pu,
        returnDateTime: rt,
        addons: [],
      })}`,
      { tags: { proc: "booking.quote" } },
    );
    tReq.add(res.timings.duration);
    // quote can 400 on out-of-hours; only 5xx counts as failure here
    errRate.add(res.status >= 500);
  }
}
