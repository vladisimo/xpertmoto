# Cost-model pricing inputs (captured May 2026)

Reference rates for the Phase D TCO model. Every figure dated + sourced. Scope
per the engagement: **excludes Stripe (pass-through), Anthropic AI, Xero.**
USD unless noted; AUD≈USD×1.5 (use a single fx in the model).

## Operational service costs (scale with volume) — model section D1

| Service | Rate (May 2026) | Source |
|---|---|---|
| **Twilio SMS → AU mobile** | **$0.0515 / segment** (outbound); inbound $0.0075/seg; MMS $0.35/seg | [twilio.com/en-us/sms/pricing/au](https://www.twilio.com/en-us/sms/pricing/au) |
| **Twilio AU number** | **$8.25 / mo** (mobile sender); alphanumeric sender ID **free** | same |
| **Resend email** | free **3,000/mo** (100/day cap) → Pro **$20/mo for 50k** → Scale $90/100k | [resend.com/pricing](https://resend.com/pricing) |
| **PostHog** | free **1,000,000 events/mo** (+5k recordings, 1M flag reqs) → ~$0.00005/event (1–2M tier, step-down) | [posthog.com/pricing](https://posthog.com/pricing) |
| **Sentry** | Developer **free** 5k events/mo (1 user) → Team **$26/mo** (50k errors + 5M spans) → Business $80/mo | [sentry.io/pricing](https://sentry.io/pricing/) |
| **Object storage (B2)** | **$0.006 /GB-mo**; egress free to 3× stored then $0.01/GB (free via Cloudflare) | [backblaze.com](https://www.backblaze.com/cloud-storage/comparison/backblaze-vs-wasabi) |
| **Object storage (Wasabi)** | $6.99/TB-mo (→$7.99 Jul 2026); **1 TB min**, 90-day min retention | same |
| **AWS S3 Sydney** | ~$0.025 /GB-mo standard; egress ~$0.114/GB (published ap-southeast-2) | aws.amazon.com/s3/pricing |
| **Maps/Geo** | OpenFreeMap + Nominatim + MaxMind GeoLite2 = **$0** | — |
| **Domain + TLS** | ~$15–50/yr (.com.au); TLS free (Let's Encrypt) | — |

**Per-booking service volume** (from code inventory): 5–7 emails, 4–5 SMS,
~1 MB storage (5–10 MB w/ damage), 5–10 analytics events.

## Hosting options — model section D2 (sized from Phase C load results)

### AWS managed (Sydney, ap-southeast-2) — on-demand
| Component | Spec | Rate | ~Monthly |
|---|---|---|---|
| RDS PostgreSQL db.t4g.medium | 2 vCPU / 4 GB | **$0.065/hr** (1yr-RI $0.047) | **~$48** ($34 RI) |
| EC2 t4g.medium (app) | 2 vCPU / 4 GB | ~$0.040/hr (Syd ≈ us-east×1.2; base $0.034) | ~$30 |
| EC2 t4g.small (worker) | 2 vCPU / 2 GB | ~$0.020/hr | ~$15 |
| ElastiCache cache.t4g.medium | 2 vCPU / ~3 GB | ~$0.078/hr (base $0.065) | ~$57 |
| ALB | — | ~$0.025/hr + LCU | ~$20–25 |
| S3 + egress + CloudWatch + backups | — | volume | ~$15–30 |
Sources: Vantage [RDS db.t4g.medium](https://instances.vantage.sh/aws/rds/db.t4g.medium), [EC2 t4g.medium](https://instances.vantage.sh/aws/ec2/t4g.medium), [ElastiCache cache.t4g.medium](https://instances.vantage.sh/aws/elasticache/cache.t4g.medium). **AWS all-in ≈ $185–215/mo on-demand (~$150 with 1yr RIs).**

### Budget cloud VPS
| Provider | Plan | Spec | Price |
|---|---|---|---|
| **Hetzner** CX22 | shared vCPU | 2 vCPU / 4 GB / 40 GB | **~€4.59/mo (~$5)** |
| Hetzner CPX31 | shared | 4 vCPU / 8 GB | ~$18–25/mo |
| Hetzner CCX13 | **dedicated** vCPU | 2 vCPU / 8 GB | ~$14.49/mo |
| **DigitalOcean** Droplet | premium Intel | 2 vCPU / 4 GB | **$24/mo** |
| DO Managed PG / Redis | shared | 1 vCPU / 1 GB | from $15/mo each |
Sources: [Hetzner cloud](https://www.hetzner.com/cloud), [DigitalOcean droplets](https://www.digitalocean.com/pricing/droplets) (Apr/Jan 2026 adjustments noted). **Single capable VPS (CPX31/CCX-class) running the whole compose stack ≈ $20–45/mo; +backups/object-storage ≈ $30–55/mo all-in.**

### Self-host on owned hardware
| Line | Assumption | Notes |
|---|---|---|
| Server capex | ~$2.5–6k (new SMB tower/1U; ×2 for HA) | amortise over 4–5 yr replacement cycle |
| **AU business electricity** | **~AUD $0.42 /kWh** | [globalpetrolprices / EcoFlow AU](https://www.globalpetrolprices.com/Australia/electricity_prices/) |
| Power draw | ~100–200 W continuous → ~0.1–0.2 kW ×24×365 | ≈ $370–740/yr/server at $0.42/kWh |
| Business internet + static IP | ~$80–150/mo AU | NBN business plan |
| UPS, switch, replacement, off-site backup/DR | capex + opex | |
| **Ops labour** | the dominant hidden cost | patching, backups, monitoring, on-call |

## Load growth curve (steady single-depot, 20%/yr) — model section D3
Yr1: 500 bk/mo, 7.2k visitors/mo → Yr10 ≈ 3,000 bk/mo, ~43k visitors/mo (≈6×).
Stays comfortably inside free tiers for PostHog/Sentry; Resend free→Pro early;
Twilio + small storage are the only steadily-growing variable lines.
Instance sizing + headroom comes from Phase C (loadtest-results/).
