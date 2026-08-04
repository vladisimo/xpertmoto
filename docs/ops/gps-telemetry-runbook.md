# GPS / Telemetry Runbook

The GPS51 tracking subsystem: live fleet map, per-vehicle history, zone/speed
events, and operational alerts. Built for 300+ vehicles over multiple years.

## Architecture

Three background jobs + one downstream processor, all Brisbane TZ:

| Job | Cadence | What it does |
|---|---|---|
| `gps51-sync` | every 1 min | One batched `lastposition` call for the whole fleet → **batched upsert** into `VehicleLivePosition` (one row/device). Live-map snapshot only. Runs under `withJobLock` (55s TTL) so replicas/overruns can't race the cursor; the batched write + cursor advance commit in one transaction. |
| `gps51-daily-sync` | daily 03:20 | Per device: `querytracks` last 24h → `createMany` into the `VehicleTelemetry` hypertable (deduped by the `(deviceId, timestamp)` PK). Paced 7s/device under a 2h `withJobLock`. |
| `gps51-alerts` | every 30 min | `detectFleetAlerts` → deduped in-app notifications for offline trackers + low battery/voltage. |
| `telemetry-processor` | every 5 min | Zone/speed event emission for active bookings with a `RentalZone`. |

**Data stores**
- `VehicleLivePosition` — latest fix per device. The live map reads ONLY this
  (O(fleet), independent of history size). Cached in Redis ~10s
  (`gps51-live-cache`) so concurrent staff tabs collapse onto one DB read.
- `VehicleTelemetry` — TimescaleDB hypertable of full-fidelity history.
- `VehicleTelemetry_1m` — 1-minute **continuous aggregate** (downsampled rollup),
  kept forever.
- `Gps51Sync` — poll run-log + `cursor` (GPS51 `lastquerypositiontime`).

## TimescaleDB — REQUIRED

`VehicleTelemetry` is a hypertable. The subsystem needs a **Timescale-capable
Postgres** (the `timescale/timescaledb` image, or a managed Timescale instance —
**not** vanilla RDS). On a plain Postgres the `add_gps51_telemetry_timescale`
migration's `CREATE EXTENSION timescaledb` fails.

- Local dev + CI use `timescale/timescaledb:latest-pg16` (docker-compose / CI).
  Some dev boxes run a host-native Postgres that already has the extension
  installed (e.g. PG17 + timescaledb 2.27) — verify with:
  `SELECT extversion FROM pg_extension WHERE extname='timescaledb';`
- Worker boot calls `assertTelemetryHypertable`; if `VehicleTelemetry` is not a
  hypertable it logs an error and (with Sentry) raises a `captureMessage`. If you
  see that alert, telemetry is silently degrading to an unpartitioned table —
  provision Timescale and re-run migrations.

### Storage policies (migration `gps_telemetry_downsample_retention`)
- Raw `VehicleTelemetry`: compressed after 14 days; **retained 12 months** then
  dropped chunk-by-chunk.
- `VehicleTelemetry_1m` cagg: refreshed hourly (trailing 3d window), compressed
  after 30 days, **kept forever**. Multi-year history survives here at 1-min
  resolution after raw is dropped.
- Verify: `SELECT view_name FROM timescaledb_information.continuous_aggregates;`
  and `SELECT proc_name, config FROM timescaledb_information.jobs;`

## Monitoring & freshness

- Sentry cron check-ins (`monitorCron`) fire only if the **job** fails.
- A structurally-successful poll can still hide trackers going dark — those drop
  out of the `lastposition` response. `fleet.gps51SyncStatus` surfaces
  `freshness` (linked vs reporting vs stale vs never-reported) via
  `getFleetFreshness`; the live map/sidebar show per-vehicle offline/stale
  badges (thresholds in `src/lib/gps/freshness.ts`: stale >15 min, offline >1 h).
- `gps51-alerts` turns offline + low-battery into deduped staff notifications
  (one per vehicle/condition/Brisbane-day).

## GPS51 error codes (see `gps51.ts`)
- **8902** — IP rate limit (10 req/min). The daily throttle stays under this.
- **8904** — IP not whitelisted. Add the server's egress IP in the GPS51 backend
  (account needs "API Administrator").
- **8905** — daily call quota exhausted; the daily sync aborts the rest of the run.
- **9903 / 9906** — token expired / logged in elsewhere; the client re-logs in.

## Scaling ceilings
- Live poll: batched upsert, chunked at 500 rows/statement — headroom well past
  1000 vehicles.
- Daily sync: ~linear at 7s/device (~35 min at 300, ~1.2h at 600) inside a 2h
  lock. It logs a warning (and records `estRuntimeMinutes` in the run summary)
  once an estimated run exceeds 70% of the lock window. Beyond ~1000 devices,
  parallelise device pulls or raise the lock TTL.
- History reads (`vehicleTrack`, `bookingTrip`, authoritative pulls) are capped
  at 5000 rows + a ≤31-day input; responses carry a `truncated` flag.

## Config
Env-only (`integration:gps51:*` via integration-config): `GPS51_USERNAME`,
`GPS51_PASSWORD`, `GPS51_BASE_URL`. Blank username/password disables the poller.
Password is MD5'd at login; nothing logs the password or token.

## Maintenance scripts
- `scripts/gps51-telemetry-reset.ts` — `TRUNCATE VehicleTelemetry`
  (compression-safe); `--apply --yes-truncate`, localhost-only unless `--force-remote`.
- `scripts/backfill-telemetry-speed-units.ts` — re-derive `speedKph` from `raw.speed`.
