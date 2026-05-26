# 🛵 XPERT Moto

Enterprise scooter & motorbike hire platform for Australia. Production-ready full-stack Next.js 16 / React 19 / TypeScript / tRPC v11 / Prisma 5 / Postgres.

## What's in here

| Layer | Implemented |
|---|---|
| **Public website** | Homepage, fleet (multi-axis bike classification + browse/filter), locations, pricing, FAQ, contact, terms |
| **Booking engine** | 6-step wizard with quote/availability/confirmation; real Stripe PaymentIntents, bond auth/capture, refunds, reconciliation |
| **Customer portal** | Dashboard, bookings list & detail, profile, loyalty/rewards, invoice PDF download |
| **Staff back-office** | Dashboard (today's pickups/returns/overdue), bookings list & detail, check-out, check-in (auto late/fuel/damage charges + bond release), customer management with licence verify, walk-in POS (modal on Bookings), calendar (14d timeline), inspections with damage zones. Consolidated nav: customers, fleet, finance, pricing, communications, settings |
| **Fleet & plant** | Fleet dashboard with utilisation/book value, vehicle registry & detail (with depreciation + ROI), 4-step onboarding wizard, decommissioning, work orders (kanban + status transitions cascade vehicle status), incidents, infringements, eToll sync |
| **Admin panel** | KPI dashboard with 12-month revenue trend, pricing config (rates/addons/insurance/discounts/seasons), finance + GST report + CSV export, reports suite, platform + observability (Sentry cost analytics), integrations status dashboard, system settings, audit log, API keys, backups, webhooks. Users→`/staff/customers`, depots→`/staff/fleet` and notification templates→`/staff/communications` now live in the staff portal |
| **Cross-cutting** | NextAuth v5 (credentials + Google/Apple/Microsoft/GitHub OAuth, TOTP step-up), tRPC v11 with role-based procedures, role middleware, audit log writes on key mutations, real Resend/SMTP email + Twilio SMS, `@react-pdf` invoices, BullMQ scheduled jobs, Sentry, mobile-responsive back-office (tablet/phone primitives), security headers, error/not-found/loading boundaries, unit + integration + Playwright E2E, GitHub Actions CI |

## Setup

### Option A — Docker (recommended)

Brings up Postgres, Redis, MinIO (S3), Mailpit (SMTP), the Next.js app, and the background worker all wired together:

```bash
cp .env.example .env
docker compose up
```

Then in another shell, seed the database:

```bash
docker compose exec app npm run db:seed
```

Services:

- App: http://localhost:3000
- Mailpit UI (dev inbox): http://localhost:8025
- MinIO console: http://localhost:9001 (minioadmin / minioadmin)
- Postgres: `localhost:5432`
- Redis: `localhost:6379`

### Option B — Local (bring your own Postgres/Redis)

```bash
npm install
cp .env.example .env   # default DATABASE_URL is already correct
createdb xpertmoto
npx prisma migrate dev --name init
npm run db:seed
npm run dev              # in one terminal
npm run worker           # in another (optional — needs REDIS_URL)
```

Open http://localhost:3000

## Seed credentials

### Minimal baseline (`npm run db:reset`)

Resets the database (drops + recreates, so all ID sequences restart at 1) and seeds a single user.

| Role | Email | Password |
|---|---|---|
| Super admin | vladisimo@gmail.com | 6qv384sx |

Use this as the starting point for running scenarios — layer any additional data on top via the admin UI or a scenario script.

### Full demo (`npm run db:reset:demo` or `npm run db:seed`)

| Role | Email | Password |
|---|---|---|
| Super admin | admin@xpertmoto.com.au | admin1234 |
| Manager | manager.gold-coast@xpertmoto.com.au | staff1234 |
| Staff | staff.gold-coast@xpertmoto.com.au | staff1234 |
| Customer | sarah.smith@example.com | customer1234 |

## Portals

- `/` — public site
- `/booking` — booking wizard
- `/login` `/register` — auth
- `/dashboard` — customer portal (CUSTOMER+)
- `/staff/dashboard` — staff back-office (STAFF+)
- `/admin/dashboard` — admin panel (ADMIN+)

## Scripts

| Script | Purpose |
|---|---|
| `npm run dev` | Next.js dev server |
| `npm run build` | Production build |
| `npm run typecheck` | tsc --noEmit |
| `npm run test` | Unit tests (Node built-in runner via tsx) |
| `npm run test:integration` | Integration tests |
| `npm run test:e2e` | Playwright E2E |
| `npm run worker` | BullMQ background worker (booking reminders, overdue check, bond release, maintenance alerts, depreciation, summaries) |
| `npm run db:migrate` | Prisma migrate dev |
| `npm run db:seed` | Seed demo data (into existing DB) |
| `npm run db:reset` | Drop + recreate DB, apply migrations, seed single SUPER_ADMIN (scenario baseline) |
| `npm run db:reset:demo` | Drop + recreate DB, apply migrations, seed full demo data |
| `npm run db:studio` | Prisma Studio |

## Architecture

```
src/
├── app/                  Next.js App Router
│   ├── (public)/         Public site
│   ├── (auth)/           Login/register
│   ├── (customer)/       Customer portal (CUSTOMER+)
│   ├── (staff)/          Staff back-office (STAFF+)
│   ├── (admin)/          Admin panel (ADMIN+)
│   └── api/              tRPC, auth, finance export, invoice PDF
├── server/
│   ├── trpc/router/      ~44 routers: booking, fleet, customer, payments,
│   │                     maintenance, incidents, gift cards, referrals,
│   │                     loyalty, subscriptions, eToll, yield pricing,
│   │                     analytics, backups, … (see src/server/trpc/CLAUDE.md)
│   ├── services/         ~90 business-logic modules (pricing, availability,
│   │                     depreciation, audit, reconciliation, …)
│   └── jobs/             BullMQ workers (Australia/Brisbane TZ)
├── lib/                  prisma, auth, branding, money, logger, stripe,
│                         email, sms, pdf, utils
├── components/           shadcn/ui primitives, layout shells, mobile
│                         primitives, booking wizard, domain components
├── stores/               Zustand (sparse usage)
└── middleware.ts         Role-based route protection
```

> Schema, API-layer, UI and lib rules live in per-folder `CLAUDE.md` files
> (`prisma/`, `src/server/trpc/`, `src/components/ui/`, `src/lib/`).

## Optional integrations

All third-party integrations have stub-friendly fallbacks for local dev. Set the env vars to switch to real mode. Integration **credentials are environment-only** — there is no in-app credential editor; `/admin/integrations` is a read-only status dashboard.

| Env var | Effect |
|---|---|
| `STRIPE_SECRET_KEY` | Real Stripe payment intents + bond holds |
| `RESEND_API_KEY` | Real transactional email via Resend |
| `SMTP_HOST` + `SMTP_PORT` | SMTP fallback (used automatically by Docker setup via Mailpit) |
| `TWILIO_ACCOUNT_SID` + `TWILIO_AUTH_TOKEN` + `TWILIO_FROM_NUMBER` | Real SMS |
| `AUTH_GOOGLE_ID` + `AUTH_GOOGLE_SECRET` | Google OAuth |
| `NEXT_PUBLIC_MAPBOX_TOKEN` | Mapbox embeds (depot map) |
| `S3_*` | S3 / MinIO file storage for vehicle/inspection/licence uploads |
| `REDIS_URL` | Enables the BullMQ scheduler (reminders, overdue check, bond release, etc.) |

Without any of these set, the platform runs end-to-end using stubs that log to the console. The Docker setup wires all of them automatically for local dev.

## Business rules in code

- **Pricing**: Category base → duration tier (daily/weekly/monthly) → season multiplier → duration discount → code discount → addons + insurance + delivery → GST. Snapshot stored in booking record. → `src/server/services/pricing.ts`
- **Availability**: Vehicle is available if status=AVAILABLE and no overlapping booking with 2hr buffer. Allocator picks lowest-odometer first. → `src/server/services/availability.ts`
- **Cancellation**: >72hr full refund − $25 admin; 24-72hr 50% refund; <24hr none. → `staffBooking.cancel`
- **Late return**: 1hr grace, then daily/8 per hour, capped at daily rate per day. → `staffBooking.checkIn`
- **Bond**: Held at confirm, released or partially captured at check-in. → `BondLedger`
- **Depreciation**: Straight-line or diminishing value. → `src/server/services/depreciation.ts`
- **Role gates**: Middleware + tRPC `staffProcedure` / `managerProcedure` / `adminProcedure`.

## Phases

1. ✅ Foundation (schema, auth, tRPC, layouts, seed)
2. ✅ Public booking engine (wizard, payments, confirmation, customer portal)
3. ✅ Staff back-office (check-out/in, customers, POS, calendar, inspections)
4. ✅ Fleet & plant management (registry, onboarding, work orders, incidents, infringements, depreciation)
5. ✅ Admin panel (users, depots, pricing, finance, reports, settings, audit, API keys)
6. ✅ Polish (@react-pdf invoices, real Resend/SMTP email, real Twilio SMS, S3/MinIO storage, Mapbox, BullMQ worker with scheduled jobs, unit + integration + Playwright E2E tests, security headers, CI, Docker compose stack)

Beyond the original plan, the platform has grown a full payments stack (Stripe
PaymentIntents, bond auth/capture, refunds, GST-aware reconciliation), loyalty
& rewards, gift cards/referrals/subscriptions, eToll infringement sync, yield
pricing, a mobile-responsive back-office, and observability (Sentry cost
analytics). See `CLAUDE.md` for the authoritative current scope.
