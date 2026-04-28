// G16 load — bulk toll ingestion.
//
// Simulates a worst-case E-Toll backfill where 10,000 toll rows arrive in
// a single sync window. Target: ingestion completes in < 2 minutes and
// every row is idempotent (a second run of the same batch produces zero
// new Infringement rows).
//
// Usage:
//   k6 run scripts/load/toll-ingest.js --env BASE_URL=http://localhost:3000 --env ADMIN_TOKEN=...
//
// Hits an internal admin endpoint (`POST /api/admin/etoll/ingest`) that
// accepts a JSON batch. If that endpoint doesn't exist yet, this script
// is the spec for building it: it should accept an array of EtollTripRow
// objects and call upsertInfringementFromRow for each.

import http from "k6/http";
import { check, sleep } from "k6";

export const options = {
  scenarios: {
    batch: {
      executor: "per-vu-iterations",
      vus: 1,
      iterations: 1,
      maxDuration: "3m",
    },
  },
  thresholds: {
    http_req_duration: ["p(95)<120000"],
  },
};

const BASE_URL = __ENV.BASE_URL || "http://localhost:3000";
const ADMIN_TOKEN = __ENV.ADMIN_TOKEN || "";

function makeRow(i) {
  return {
    plate: `L0AD${String(i).padStart(4, "0")}`,
    eventAt: new Date(Date.now() - i * 60_000).toISOString(),
    amountCents: 500 + (i % 100),
    concession: "Full toll",
    gantryCode: `GNT${i % 50}`,
    rawDetails: `k6 load-test row ${i}`,
    externalHash: `load-${i}-${Date.now()}`,
  };
}

export default function () {
  const rows = [];
  for (let i = 0; i < 10_000; i++) rows.push(makeRow(i));

  const res = http.post(`${BASE_URL}/api/admin/etoll/ingest`, JSON.stringify({ rows }), {
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${ADMIN_TOKEN}`,
    },
    timeout: "3m",
  });
  check(res, {
    "status 200": (r) => r.status === 200,
    "all rows processed": (r) => {
      try {
        const body = JSON.parse(r.body);
        return body.processed === 10_000;
      } catch {
        return false;
      }
    },
  });
  sleep(0.5);
}
