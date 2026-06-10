# XPERT Moto — Running-Cost & 10-Year TCO Report
### Cloud vs self-host, grounded in a measured load test

*Prepared 2026-05-30. Load test run 01:00–01:47 (off-peak). All figures AUD unless noted; USD→AUD = 1.5. Scope per brief **excludes** Stripe pass-through fees, Anthropic AI usage, and Xero.*

---

## 1. Executive summary

**The hosting decision is not the cost driver — operational service usage is, and within it, SMS.**

| 10-year cumulative (AUD) | Infrastructure | + Operational services | = Total TCO |
|---|--:|--:|--:|
| **Budget VPS** (Hetzner/DO) | **$8,064** | $63,984 | **$72,048** ✅ |
| AWS managed (Sydney) | $40,800 | $63,984 | $104,784 |
| Owned hardware *(excl. labour)* | $41,400 | $63,984 | $105,384 |
| Owned hardware *(incl. ~$3,840/yr labour)* | $79,800 | $63,984 | $143,784 ❌ |

Three findings drive everything below:

1. **The system is app-CPU-bound, not database-bound, and the briefed load is tiny.** Under load a single **1 vCPU** app process saturates at ~20–27 req/s while Postgres never exceeds ~10% CPU. The real business load (7,200 visitors + 500 bookings/mo) is **< 1 req/s at peak** — roughly **100–500× below** the measured ceiling of the *smallest* instance. Even after 10 years of 20%/yr growth (≈6×) it stays ~100× under that ceiling. **You will not outgrow the cheapest tier on throughput this decade.**
2. **Budget VPS wins decisively.** A single small VPS runs the entire stack with years of headroom. AWS managed costs **~5× more** for capacity you will never use. **Owned hardware costs about the same as AWS in hard dollars but is strictly worse** — it adds ops labour and single-site reliability/DR risk for no saving. It only makes sense at far larger scale.
3. **Operational costs dwarf the infra choice.** Ops services total ~$64k over 10 years; the AWS-vs-VPS infra swing is ~$33k. **SMS alone (~$48k/10yr) is the single largest avoidable running cost** — a bigger lever than the entire hosting decision.

**Recommendation:** Host on a single budget VPS (Hetzner CCX/CPX-class or DigitalOcean), keep one warm standby/snapshot for resilience, use managed object storage (Backblaze B2) or self-hosted MinIO. Treat **SMS notification policy** as the primary cost-control lever, not hosting.

---

## 2. What was tested, and how

A **fully isolated, resource-capped, production-build** copy of the stack was stood up locally and load-tested off-peak, so per-request resource cost could be measured and mapped to instance sizes without cloud spend or touching the dev environment.

- **Stack** ([docker-compose.loadtest.yml](../../docker-compose.loadtest.yml)): real prod build (`next start`) + BullMQ worker + Postgres 16 + Redis 7 + MinIO + Mailpit, on its own ports/volumes/project (`xpltest`). App capped at **1 vCPU / 1 GB** (the sizing knob), Postgres 2 vCPU / 2 GB.
- **Data**: **18,000+ bookings** (3 years history + future) seeded so availability/pricing queries traverse realistic row counts ([seed-loadtest.ts](../../scripts/load/seed-loadtest.ts)).
- **Scenarios** (k6, via [funnel.js](../../scripts/load/funnel.js) / [backoffice.js](../../scripts/load/backoffice.js) / [booking-surge.js](../../scripts/load/booking-surge.js)): the public booking funnel (homepage → catalog → availability → quote → authenticated `booking.create`), authenticated staff reads (calendar/detail/list/dashboard), breaking-point ramps, a 20-min soak, and reliability/chaos.
- **Instrumentation** ([instrument.sh](../../scripts/load/instrument.sh)): per-run capture of k6 percentiles, per-container CPU/RAM (1s samples), `pg_stat_statements`, Redis INFO. Raw artefacts in [`loadtest-results/`](../../loadtest-results/).

**Caveats (so the numbers are read correctly):** Stripe ran in stub mode (real Stripe adds ~200–500 ms *network* latency to create, not local CPU); email went to a local Mailpit sink (real Resend/SMTP adds network latency to the synchronous notification inside `booking.create`); Postgres/Redis were single-node (prod HA adds the cost captured in the infra tiers); the write-path breaking-point is inventory-gated by the single seeded customer/category (see §3), not a compute ceiling.

---

## 3. Measured results

### Latency floor (single-stream baseline)
| Endpoint | avg | p95 | Notes |
|---|--:|--:|---|
| Homepage `/` | 33 ms | 47 ms | SSR, cached after warm |
| `catalog.listCategories` | 4 ms | 5 ms | Redis-cached |
| `booking.availability` | 19 ms | 27 ms | uncached, 18k-row overlap scan |
| `booking.quote` | 26 ms | 36 ms | full pricing cascade (yield + seasonal + GST) |
| `auth` login | 150 ms | 216 ms | bcrypt |
| `booking.create` | 1.49 s | 1.58 s | nested writes + agreement PDF + notification + audit |

Reads are fast even against 18k bookings. `booking.create` is heavy (~1.5 s) — PDF render + notification + audit dominate, not the DB.

### Capacity (app at 1 vCPU / 1 GB)
| Load | Throughput | App CPU | Result |
|---|--:|--:|---|
| Baseline (RATE 1) | ~6 req/s | 14% avg | 0 errors, p95 < 60 ms |
| **Target (RATE 5 + back-office)** | ~27 req/s | **71% avg / 107% peak** | **knee** — p95 into seconds, ~3% shed |
| Breakpoint — quote read-path | **107 req/s** sustained | 88–105% | 0 errors but p95 2.9 s (latency-degraded); k6 dropped ~60 iters/s |
| 0.5 vCPU sweep (RATE 5) | ~25 req/s | 46% (0.5-cap saturated) | 0.07% errors |

**Postgres never exceeded ~10% CPU even at 107 req/s.** The top DB query (the availability `COUNT`/overlap scan) runs at **0.14 ms mean**. The bottleneck is **Node/tRPC app CPU**, not the database — so the cheap scaling axis is app compute, not a managed DB tier.

### Reliability / chaos
- **Worker killed mid-load:** web tier kept serving, bookings still created (0.09% errors); jobs queue in Redis and drain on restart. ✅
- **Postgres paused mid-load:** graceful errors during the outage, **full recovery** on unpause. ✅
- **Concurrency invariant:** **0 duplicate `Payment` rows** per booking across all create load. ✅
- **20-min soak:** stable — memory flat at ~63% (no leak), no connection-pool exhaustion, sub-second p95 throughout.

### Realistic-load framing (the key sizing insight)
7,200 visitors + 500 bookings/mo ≈ **0.006 sessions/s average**; even a 10× midday peak ≈ **< 1 req/s**. Measured saturation of the *smallest* tier is ~20–27 req/s → **~100–500× headroom today**, and ~100× even in year 10. *The write-path breakpoint returned 98% business-rejections because hammering one customer/category exhausts seeded inventory — confirming create is inventory/validation-gated, not compute-gated; the realistic create rate (<0.02/s) is trivial.*

---

## 4. Cost model

### 4A. Operational service costs (host-independent; scale with volume)
Per booking the code sends ~5–7 emails, ~4–5 SMS, writes ~1.5 MB, emits ~8 analytics events. Rates dated May 2026 — full sources in [pricing-inputs.md](pricing-inputs.md).

| Service | Basis | Year-1 (AUD/mo) | Note |
|---|---|--:|---|
| **Twilio SMS** | $0.077/seg + $12/mo number | **~$186** | **largest line; the #1 lever** |
| Resend email | free→Pro $30/mo at >2,900/mo | $30 | crosses free tier ~immediately |
| PostHog | free ≤ 1M events/mo | **$0** | ~76k events/mo — stays free for all 10 yr |
| Sentry | Team (multi-user) | $39 | could be $0 on free Developer |
| Object storage (B2) | $0.009/GB-mo | < $1 | negligible; MinIO self-host = $0 |
| Maps/geo, domain | OpenFreeMap+Nominatim+GeoLite2 free | ~$2 | domain amortised |

### 4B. Infrastructure — three options, sized from §3
Footprint: app + worker + Postgres + Redis + object storage + backups. **The load test shows the smallest tier suffices for a decade**, so these are floor prices, not capacity-driven.

- **Budget VPS — ~$35–52/mo (AUD ~$52).** One Hetzner CCX/CPX-class or DigitalOcean droplet runs the whole compose stack with headroom; + snapshots/object storage. Hetzner alone can be **<$15/mo USD**.
- **AWS managed (Sydney) — ~$200/mo USD (~$300 AUD).** RDS db.t4g.medium (~$48) + EC2 app/worker (~$45) + ElastiCache (~$57) + ALB (~$22) + S3/egress/CloudWatch. ~25% cheaper with 1-yr reserved. You pay for managed convenience and HA, not capacity.
- **Owned hardware — ~$345/mo (AUD, hard costs only).** Amortised capex ($2,000/yr, HA pair on a 5-yr refresh) + AU power (~$700/yr at $0.42/kWh) + business internet/static IP (~$1,440/yr). **Excludes ops labour**, which is the real cost (~$3,840/yr at 4 h/mo).

### 4C. 10-year projection (20%/yr growth → ~6× by year 10)
Full per-year table in [cost-model.csv](cost-model.csv). Summary:

| | Year 1 /mo | Year 10 /mo | 10-yr cumulative |
|---|--:|--:|--:|
| **Operational** (SMS-dominated) | $255 | $980 | **$63,984** |
|  — of which SMS | $186 | $909 | ~$48,000 |
| Infra — VPS | $52 | $90 | **$8,064** |
| Infra — AWS | $300 | $380 | $40,800 |
| Infra — Owned (excl. labour) | $345 | $345 | $41,400 |

**Break-even / verdict:** VPS infra is ~5× cheaper than AWS or owned, for the entire decade, because the load never justifies more. Owned hardware **never breaks even** vs VPS — its power + internet alone (~$1,700/yr) already exceed a VPS, before capex, labour, and single-site DR risk. Owned ≈ AWS in hard dollars but is dominated by AWS once you weight the ops burden AWS removes. **The largest single cost is SMS** (~$48k/10yr) — bigger than the entire hosting decision (~$33k AWS-vs-VPS swing).

---

## 5. Recommendations

1. **Host on a single budget VPS** (Hetzner CCX/CPX or DigitalOcean), running the existing `docker-compose` stack (app + separate worker + Postgres + Redis). Keep a **warm standby snapshot / second small node** for resilience — that buys most of AWS's HA at a fraction of the cost. Revisit only if load ever approaches ~15 req/s sustained (≈ 25–50× current).
2. **Object storage:** Backblaze B2 (~$0.006/GB, free egress via Cloudflare) or self-hosted MinIO. S3 only if already AWS-committed.
3. **Treat SMS as the primary cost lever.** It is the largest and most avoidable running cost. Options: make SMS opt-in, collapse the 4–5 SMS/booking to 1–2 essential ones, or email-only by default. This saves more than any hosting change.
4. **Stay on free tiers** for PostHog (≤1M events/mo covers all 10 years) and Sentry (Developer free unless you need multi-user/retention).
5. **Do not buy hardware** at this scale — it matches AWS's cost while adding the ops/DR burden cloud removes. Reconsider only beyond ~10× growth or a multi-tenant dFortix consolidation.

---

## 6. Reproducing / re-running
```bash
docker compose -p xpltest -f docker-compose.loadtest.yml up -d   # isolated capped stack (app :3009)
SCALE=0.1 scripts/load/run-all.sh                                # quick rehearsal
scripts/load/run-all.sh                                          # full ~50-min suite → loadtest-results/
```
Sweep instance sizes by changing the `cpus`/`mem_limit` caps (or `docker update --cpus`). Adjust growth/volume/price assumptions in [cost-model.csv](cost-model.csv); per-unit rates and sources in [pricing-inputs.md](pricing-inputs.md). Raw run artefacts (k6 logs, `pg_stat_statements`, utilisation samples) are under [`loadtest-results/`](../../loadtest-results/).
```
```
