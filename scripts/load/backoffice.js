// ─────────────────────────────────────────────────────────────────────────
// Back-office staff reads — expensive but low-volume path.
//
// Authenticated staff session hitting the heavy aggregation endpoints:
//   staffBooking.calendarRange (unbounded month window, full nested includes),
//   staffBooking.list (cursor page), staffBooking.detail (8–12 joins),
//   staffBooking.todayDashboard.
//
// Run concurrently with funnel.js during the target/soak slots (1 staff : ~50
// customers). Parameterised:  RATE (default 0.5/s), DURATION (default 30s).
//
//   docker run --rm --network host -v $PWD/scripts/load:/scripts \
//     -e BASE_URL=http://localhost:3009 -e RATE=0.5 -e DURATION=5m \
//     grafana/k6 run /scripts/backoffice.js
// ─────────────────────────────────────────────────────────────────────────
import http from "k6/http";
import { check, sleep, group } from "k6";
import { Trend, Rate } from "k6/metrics";

const BASE = __ENV.BASE_URL || "http://localhost:3009";
const RATE = Number(__ENV.RATE || 0.5);
const DURATION = __ENV.DURATION || "30s";

const tCal = new Trend("xm_calendar_ms", true);
const tList = new Trend("xm_stafflist_ms", true);
const tDetail = new Trend("xm_detail_ms", true);
const tDash = new Trend("xm_dashboard_ms", true);
const tLogin = new Trend("xm_stafflogin_ms", true);
const errRate = new Rate("xm_bo_errors");

export const options = {
  scenarios: {
    backoffice: {
      executor: "constant-arrival-rate",
      rate: RATE,
      timeUnit: "1s",
      duration: DURATION,
      preAllocatedVUs: Number(__ENV.PREALLOC || 10),
      maxVUs: Number(__ENV.MAXVUS || 40),
    },
  },
  thresholds: {
    xm_calendar_ms: ["p(95)<2500"],
    xm_detail_ms: ["p(95)<1500"],
  },
  summaryTrendStats: ["avg", "min", "med", "p(90)", "p(95)", "p(99)", "max"],
};

function enc(input) {
  return encodeURIComponent(JSON.stringify({ 0: { json: input } }));
}
function tquery(proc, input) {
  return http.get(`${BASE}/api/trpc/${proc}?batch=1&input=${enc(input)}`, { tags: { proc } });
}

let loggedIn = false;
function login() {
  const t0 = Date.now();
  const csrf = http.get(`${BASE}/api/auth/csrf`).json("csrfToken");
  const res = http.post(`${BASE}/api/auth/callback/credentials`, {
    csrfToken: csrf,
    email: "staff.lewisham@xpertmoto.com.au",
    password: "staff1234",
    callbackUrl: `${BASE}/`,
    json: "true",
  });
  tLogin.add(Date.now() - t0);
  return res.status === 200 || res.status === 302;
}

export default function () {
  if (!loggedIn) loggedIn = login();
  if (!loggedIn) {
    errRate.add(1);
    return;
  }

  const day = 24 * 3600 * 1000;
  const start = new Date(Date.now() - 15 * day).toISOString();
  const end = new Date(Date.now() + 45 * day).toISOString();

  group("staff-reads", () => {
    const cal = tquery("staffBooking.calendarRange", { start, end });
    tCal.add(cal.timings.duration);
    errRate.add(cal.status !== 200);

    const list = tquery("staffBooking.list", { limit: 20 });
    tList.add(list.timings.duration);
    errRate.add(list.status !== 200);

    const id = list.json("0.result.data.json.items.0.id");
    if (id) {
      const det = tquery("staffBooking.detail", { id });
      tDetail.add(det.timings.duration);
      errRate.add(det.status !== 200);
    }

    const dash = tquery("staffBooking.todayDashboard", {});
    tDash.add(dash.timings.duration);
    // dashboard input shape may vary; only count hard failures
    check(dash, { "dashboard not 5xx": (r) => r.status < 500 });
    errRate.add(dash.status >= 500);
  });

  sleep(1 + Math.random() * 2);
}
