// ─────────────────────────────────────────────────────────────────────────
// Public booking funnel — the primary costing scenario.
//
// Models the briefed traffic shape: ~7,200 visitors/mo browsing (homepage +
// catalog + availability + quote, with think-time) converging to ~500
// bookings/mo (authenticated booking.create). Availability + quote are the
// uncached, DB-heavy hot paths we want to cost.
//
// Parameterised via env so one script serves every runbook slot:
//   RATE       arrival rate (iterations/sec)            default 2
//   DURATION   steady duration                          default 30s
//   RAMP_TO    if set, ramp arrival rate 0->RAMP_TO     (breaking-point)
//   PREALLOC   pre-allocated VUs                        default 50
//   MAXVUS     max VUs                                  default 300
//   CREATE_PCT % of sessions that authenticate+create   default 3
//   BASE_URL   default http://localhost:3009
//
//   docker run --rm --network host -v $PWD/scripts/load:/scripts \
//     -e BASE_URL=http://localhost:3009 -e RATE=5 -e DURATION=5m \
//     grafana/k6 run /scripts/funnel.js
// ─────────────────────────────────────────────────────────────────────────
import http from "k6/http";
import { check, sleep, group } from "k6";
import { Trend, Rate, Counter } from "k6/metrics";

const BASE = __ENV.BASE_URL || "http://localhost:3009";
const RATE = Number(__ENV.RATE || 2);
const DURATION = __ENV.DURATION || "30s";
const RAMP_TO = __ENV.RAMP_TO ? Number(__ENV.RAMP_TO) : null;
const CREATE_PCT = Number(__ENV.CREATE_PCT || 3);

const tHome = new Trend("xm_home_ms", true);
const tAvail = new Trend("xm_availability_ms", true);
const tQuote = new Trend("xm_quote_ms", true);
const tCatalog = new Trend("xm_catalog_ms", true);
const tLogin = new Trend("xm_login_ms", true);
const tCreate = new Trend("xm_create_ms", true);
const errRate = new Rate("xm_errors");
const created = new Counter("xm_bookings_created");

const scenario = RAMP_TO
  ? {
      executor: "ramping-arrival-rate",
      startRate: 1,
      timeUnit: "1s",
      preAllocatedVUs: Number(__ENV.PREALLOC || 50),
      maxVUs: Number(__ENV.MAXVUS || 300),
      stages: [
        { target: Math.ceil(RAMP_TO * 0.25), duration: "1m" },
        { target: Math.ceil(RAMP_TO * 0.5), duration: "1m" },
        { target: Math.ceil(RAMP_TO * 0.75), duration: "1m" },
        { target: RAMP_TO, duration: "2m" },
      ],
    }
  : {
      executor: "constant-arrival-rate",
      rate: RATE,
      timeUnit: "1s",
      duration: DURATION,
      preAllocatedVUs: Number(__ENV.PREALLOC || 50),
      maxVUs: Number(__ENV.MAXVUS || 300),
    };

export const options = {
  scenarios: { funnel: scenario },
  // Informational SLOs — recorded, not abort-on-fail (breaking-point expects breaches).
  thresholds: {
    xm_quote_ms: ["p(95)<1000"],
    xm_availability_ms: ["p(95)<800"],
    "xm_errors{kind:read}": ["rate<0.01"],
  },
  summaryTrendStats: ["avg", "min", "med", "p(90)", "p(95)", "p(99)", "max"],
};

// random IP so the (off, but realistic) IP-keyed rate limiter sees many sources
function xff() {
  const r = () => 1 + Math.floor(Math.random() * 254);
  return { "X-Forwarded-For": `${r()}.${r()}.${r()}.${r()}` };
}
function enc(input) {
  return encodeURIComponent(JSON.stringify({ 0: { json: input } }));
}
function tquery(proc, input, tag) {
  return http.get(`${BASE}/api/trpc/${proc}?batch=1&input=${enc(input)}`, {
    headers: xff(),
    tags: { proc, ...tag },
  });
}
// in-hours pickup: 01:00 UTC ≈ 11:00–12:00 Sydney, within depot 08:00–18:00
function futureDates() {
  const day = 24 * 3600 * 1000;
  const start = new Date(Date.now() + (3 + Math.floor(Math.random() * 18)) * day);
  start.setUTCHours(1, 0, 0, 0);
  const ret = new Date(start.getTime() + (1 + Math.floor(Math.random() * 4)) * day);
  ret.setUTCHours(3, 0, 0, 0);
  return { pu: start.toISOString(), rt: ret.toISOString() };
}

export function setup() {
  // Discover real IDs (demo seed uses cuids, not fixed literals).
  const dRes = http.get(`${BASE}/api/trpc/depot.list?batch=1&input=${enc(null)}`);
  const cRes = http.get(`${BASE}/api/trpc/catalog.listCategories?batch=1&input=${enc(null)}`);
  const depot = dRes.json("0.result.data.json.0.id");
  const category = cRes.json("0.result.data.json.0.id");
  if (!depot || !category) throw new Error(`setup failed: depot=${depot} category=${category}`);
  return { depot, category };
}

// per-VU lazy login state
let loggedIn = false;

function login(email, password) {
  const t0 = Date.now();
  const csrfRes = http.get(`${BASE}/api/auth/csrf`);
  const csrf = csrfRes.json("csrfToken");
  const res = http.post(
    `${BASE}/api/auth/callback/credentials`,
    { csrfToken: csrf, email, password, callbackUrl: `${BASE}/`, json: "true" },
    { tags: { proc: "auth.login" } },
  );
  tLogin.add(Date.now() - t0);
  return res.status === 200 || res.status === 302;
}

export default function (data) {
  const { depot, category } = data;

  group("browse", () => {
    const h = http.get(`${BASE}/`, { headers: xff(), tags: { proc: "homepage" } });
    tHome.add(h.timings.duration);
    errRate.add(h.status !== 200, { kind: "read" });

    const cat = tquery("catalog.listCategories", null, { kind: "read" });
    tCatalog.add(cat.timings.duration);
    tquery("depot.list", null, { kind: "read" });
    sleep(0.5 + Math.random());
  });

  // 1–3 availability checks (comparing dates) — the uncached DB hot path
  const checks = 1 + Math.floor(Math.random() * 3);
  for (let i = 0; i < checks; i++) {
    const { pu, rt } = futureDates();
    const r = tquery(
      "booking.availability",
      { categoryId: category, depotId: depot, pickupDateTime: pu, returnDateTime: rt },
      { kind: "read" },
    );
    tAvail.add(r.timings.duration);
    errRate.add(r.status !== 200, { kind: "read" });
    sleep(0.3 + Math.random() * 0.7);
  }

  // ~45% go on to price a quote (often more than one)
  if (Math.random() < 0.45) {
    const quotes = 1 + Math.floor(Math.random() * 2);
    for (let i = 0; i < quotes; i++) {
      const { pu, rt } = futureDates();
      const r = tquery(
        "booking.quote",
        {
          categoryId: category,
          pickupDepotId: depot,
          returnDepotId: depot,
          pickupDateTime: pu,
          returnDateTime: rt,
          addons: [],
        },
        { kind: "read" },
      );
      tQuote.add(r.timings.duration);
      // quote may legitimately 400 on out-of-hours/min-rental — only count 5xx
      errRate.add(r.status >= 500, { kind: "read" });
      sleep(0.5 + Math.random());
    }
  }

  // ~CREATE_PCT% convert: authenticate (once per VU) then booking.create
  if (Math.random() * 100 < CREATE_PCT) {
    if (!loggedIn) loggedIn = login("sarah.smith@example.com", "customer1234");
    if (loggedIn) {
      const { pu, rt } = futureDates();
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
        { headers: { "content-type": "application/json" }, tags: { proc: "booking.create", kind: "write" } },
      );
      tCreate.add(Date.now() - t0);
      const ok = check(res, { "create 200": (r) => r.status === 200 && !r.body.includes('"error"') });
      errRate.add(!ok, { kind: "write" });
      if (ok) created.add(1);
    }
  }
}
