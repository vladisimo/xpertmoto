# Secret rotation runbook

This runbook covers every secret the Scootering platform holds and the
procedure for rotating each. Follow the order precisely — some secrets
depend on others (e.g. rotating `AUTH_SECRET` invalidates every active
session).

All integration secrets live in `SystemSetting` rows keyed
`integration:<service>:<field>` via [src/lib/integration-config.ts](../../src/lib/integration-config.ts)
and surface in `/admin/integrations`. Database-level secrets
(`DATABASE_URL`, `REDIS_URL`, `AUTH_SECRET`, `SECRET_ENC_KEY`,
`ETOLL_ENC_KEY`) still live in `.env` and require a deploy.

## Cadence

| Secret | Rotate every | Rotate on |
|---|---|---|
| `STRIPE_SECRET_KEY` + webhook | 180 days | Role change, incident |
| `AUTH_SECRET` | 180 days | Staff departure, incident |
| `DATABASE_URL` password | 90 days | Ops change |
| `REDIS_URL` password | 90 days | Ops change |
| `SECRET_ENC_KEY` (licence + e-toll) | **never rotate without a migration** — rotation requires decrypting with the old key and re-encrypting with the new, in a single offline job |
| `TWILIO_AUTH_TOKEN` | 180 days | Incident, telco change |
| `RESEND_API_KEY` | 180 days | Incident |
| `SENTRY_DSN` | only on incident | — |
| `METRICS_SCRAPE_TOKEN` | 180 days | Ops change |

## Procedure — Stripe Secret Key

1. In the Stripe dashboard (sandbox + live separately): **Developers → API keys → Roll secret key**.
2. Copy the new `sk_live_...` / `sk_test_...`.
3. In `/admin/integrations`, click **Rotate now** on the Stripe Secret Key row, paste the new value.
4. Verify: open `/admin/integrations` again, confirm the "Last rotated" column shows now. Make a test booking on staging.
5. Revoke the previous key in the Stripe dashboard.

## Procedure — Stripe Webhook Signing Secret

1. Stripe dashboard → **Developers → Webhooks → [your endpoint] → Roll secret**.
2. Copy the new `whsec_...`.
3. In `/admin/integrations`, **Rotate now** on the Stripe Webhook Secret row.
4. Verify: click **Send test webhook** in Stripe — the event should process with status `200` and appear in `StripeWebhookEvent` with status `PROCESSED`.

## Procedure — AUTH_SECRET

**Warning**: rotating `AUTH_SECRET` invalidates every active NextAuth session — every user is logged out. Schedule for off-peak hours.

1. Generate: `openssl rand -base64 48`.
2. Update `.env` on the target environment (prod / staging / dev).
3. Restart the Next.js process.
4. Communicate: staff may need to log in again. No customer impact beyond a login prompt.

## Procedure — Database password

1. Create the new password in the Postgres instance: `ALTER USER scootering WITH PASSWORD '<new>';`.
2. Update `DATABASE_URL` in the env of every process (web, worker, cron host).
3. Rolling-restart the web fleet then the worker — connection pool will pick up the new credential on next connect.
4. Test: health endpoint `GET /api/health` returns `{"status":"ok","checks":{"database":{"ok":true}}}`.

## Procedure — Redis password

Same shape as Database, but `REDIS_URL`. Rate limiting fails open on Redis outage ([src/lib/rate-limit.ts](../../src/lib/rate-limit.ts)), so there's no user-visible impact during the swap — but worker queues will briefly pause.

## Procedure — Twilio auth token

1. Twilio console → **Account → API keys & tokens → Primary auth token → Roll**.
2. In `/admin/integrations`, **Rotate now** on the Twilio Auth Token row.
3. Verify: trigger a booking reminder (or manual SMS) to a test number; confirm the SMS arrives and `notification.status` flips to `DELIVERED` via the Twilio status callback.

## Procedure — Resend API key

1. Resend dashboard → **API keys → Revoke old key, Create new key**.
2. In `/admin/integrations`, **Rotate now** on the Resend API Key row.
3. Verify: send a password reset email to a test account.

## Incident — suspected secret compromise

Run all applicable procedures above, in this order:

1. Stripe secret key + webhook (to stop any charges on behalf of the org)
2. `AUTH_SECRET` (to terminate hijacked sessions)
3. Database password
4. Redis password
5. Twilio + Resend (to stop spoofed comms)
6. File an incident ticket with timestamps + affected account ids.

Post-incident: review `AuditLog` for anomalous `integration.secret_rotated` entries
not initiated by your team.
