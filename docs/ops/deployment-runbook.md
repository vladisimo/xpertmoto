# Production deployment runbook

This runbook deploys XPERT Moto to a single Australian VPS (one box running
web + worker + Postgres + Redis), keeps AWS S3 in `ap-southeast-2`, and
**migrates the existing test/dev database** into production. It assumes the
provider mix from the deployment plan (Binary Lane / VentraIP, 8 GB / 4 vCPU,
SSH access for VS Code Remote-SSH).

Related runbooks: [migration-rollback-runbook.md](migration-rollback-runbook.md),
[secret-rotation-runbook.md](secret-rotation-runbook.md),
[data-breach-response-plan.md](data-breach-response-plan.md).

> **Scope note.** This is a single-box dev+prod topology. There is no app-layer
> redundancy — recovery depends on backups (§9) and the external monitor (§10).
> See the deployment plan for the HA upgrade path when uptime starts to matter.

---

## 0. Pre-flight decisions

### 0.1 What "migrate the test database" means here

Your test DB currently runs in the dev `docker-compose.yml` Postgres container:
database `xpertmoto`, user `postgres`, on host port `5432`. It holds whatever
you've built up locally — imported fleet/driver data, depots, pricing, plus
**seeded demo data** (admin@xpertmoto.com.au / `admin1234`, test customers like
sarah.smith@example.com, demo bookings).

Pick one path before you start:

| Path | What moves | Use when |
|---|---|---|
| **A — Full clone** (§6A) | Entire DB incl. demo accounts & test bookings | Fastest; you genuinely want the current state as the launch state |
| **B — Schema + curated data** (§6B) | Fresh schema via migrations, then only the tables you choose (fleet, models, depots, pricing) | **Recommended** — clean prod with no test bookings or weak demo logins |

### 0.2 Three things that bite on a clone (read before §6)

1. **Encryption key continuity.** Integration secrets (Stripe/Twilio/e-toll keys)
   live in `SystemSetting` rows encrypted with `SECRET_ENC_KEY` (legacy
   `ETOLL_ENC_KEY`) — see [src/lib/env.ts:35](../../src/lib/env.ts#L35). If you
   clone those rows but boot prod with a **different** key, decryption fails at
   runtime. Either reuse the same key, or plan to re-enter every integration
   secret in `/admin/integrations` after migrating (cleaner — do this).
2. **Seeded passwords.** The dev seed ships known weak logins. A full clone puts
   them live. You **must** rotate `admin@…/admin1234` and purge/disable demo
   users before exposing the site (§6A step 5).
3. **File references vs blobs.** Rows reference S3 keys, but the actual blobs are
   in dev **MinIO**, not prod **S3**. Migrate the objects too (§7) or those
   references 404.

---

## 1. Provision the server

1. Create the VPS (8 GB / 4 vCPU / ≥80 GB NVMe, Ubuntu 24.04 LTS, Sydney/Melbourne).
2. Add your SSH public key at creation; confirm `ssh deploy@<ip>` and VS Code
   Remote-SSH both connect.
3. Harden: create a non-root `deploy` sudo user, disable root + password SSH
   (`PasswordAuthentication no`), enable `ufw` (allow 22, 80, 443 only).
4. Add swap (build headroom — a Next.js build peaks at 2–4 GB):
   ```bash
   sudo fallocate -l 4G /swapfile && sudo chmod 600 /swapfile
   sudo mkswap /swapfile && sudo swapon /swapfile
   echo '/swapfile none swap sw 0 0' | sudo tee -a /etc/fstab
   ```

---

## 2. Install runtime dependencies

```bash
# Docker engine + compose plugin (we run the prod stack via compose)
curl -fsSL https://get.docker.com | sh
sudo usermod -aG docker deploy   # re-login after this

# postgresql-client gives you pg_dump/pg_restore on the host for the migration
sudo apt-get update && sudo apt-get install -y postgresql-client-16 caddy
```

Node is not needed on the host — builds run inside the Docker `builder` stage.

---

## 3. Get the code & generate secrets

```bash
git clone <your-repo> /opt/xpertmoto && cd /opt/xpertmoto
git checkout main
```

Generate the production secrets (never reuse dev values):

```bash
openssl rand -base64 32   # → AUTH_SECRET
openssl rand -base64 32   # → SECRET_ENC_KEY   (must base64-decode to 32 bytes)
openssl rand -base64 32   # → IP_HASH_SALT
openssl rand -base64 24   # → POSTGRES_PASSWORD
```

> If you chose **Path A (full clone)** AND want to keep the cloned integration
> secrets decryptable, set `SECRET_ENC_KEY` to the **same value as your dev
> `.env`** instead of a fresh one. See §0.2.

Create `/opt/xpertmoto/.env.prod` (root-owned, `chmod 600`). Minimum that
[src/lib/env.ts](../../src/lib/env.ts) **requires in production**:

```dotenv
NODE_ENV=production
DATABASE_URL=postgresql://postgres:<POSTGRES_PASSWORD>@postgres:5432/xpertmoto?connection_limit=10&pool_timeout=20
REDIS_URL=redis://redis:6379

AUTH_SECRET=<openssl rand>
SECRET_ENC_KEY=<openssl rand, 32 bytes b64>
IP_HASH_SALT=<openssl rand>
AUTH_URL=https://xpertmoto.com.au
APP_URL=https://xpertmoto.com.au
NEXT_PUBLIC_APP_URL=https://xpertmoto.com.au

# Stripe (live keys) — required unless ALLOW_STUB_STRIPE=1
STRIPE_SECRET_KEY=sk_live_xxx
STRIPE_WEBHOOK_SECRET=whsec_xxx
NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY=pk_live_xxx

# Email — at least one of RESEND_API_KEY or SMTP_HOST
RESEND_API_KEY=re_xxx
EMAIL_FROM=no-reply@xpertmoto.com.au

# AWS S3 (Sydney) — real bucket + IAM creds
S3_REGION=ap-southeast-2
S3_BUCKET=<your-prod-bucket>
S3_ACCESS_KEY=<iam key>
S3_SECRET_KEY=<iam secret>
S3_PUBLIC_URL=https://<your-prod-bucket>.s3.ap-southeast-2.amazonaws.com
# NOTE: no S3_ENDPOINT and no S3_FORCE_PATH_STYLE for real AWS S3 (MinIO-only)

# Optional but recommended (see monitoring §10)
SENTRY_DSN=https://...
NEXT_PUBLIC_SENTRY_DSN=https://...
LOG_LEVEL=info

# Optional services you enabled
TWILIO_ACCOUNT_SID=
TWILIO_AUTH_TOKEN=
TWILIO_FROM_NUMBER=
ANTHROPIC_API_KEY=        # or OPENROUTER_API_KEY
POSTHOG_KEY=
NEXT_PUBLIC_POSTHOG_KEY=
```

The app **refuses to boot** if any required var is missing or if `AUTH_SECRET`
is still the dev placeholder — that validation is intentional.

---

## 4. Production compose stack

Create `/opt/xpertmoto/docker-compose.prod.yml`. It reuses the existing
`runner` and `worker` Dockerfile targets ([Dockerfile:46](../../Dockerfile#L46),
[Dockerfile:63](../../Dockerfile#L63)) and runs Postgres + Redis locally.

```yaml
services:
  postgres:
    image: postgres:16-alpine
    restart: unless-stopped
    environment:
      POSTGRES_USER: postgres
      POSTGRES_PASSWORD: ${POSTGRES_PASSWORD}
      POSTGRES_DB: xpertmoto
    volumes:
      - postgres-data:/var/lib/postgresql/data
    command:
      - postgres
      - "-c"
      - "shared_buffers=512MB"          # tuned up from dev (8 GB box)
      - "-c"
      - "effective_cache_size=2GB"
      - "-c"
      - "max_connections=100"
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U postgres -d xpertmoto"]
      interval: 5s
      timeout: 5s
      retries: 10
    # Not exposed to the host network — only the app/worker reach it.

  redis:
    image: redis:7-alpine
    restart: unless-stopped
    command: ["redis-server", "--appendonly", "yes"]
    volumes:
      - redis-data:/data
    healthcheck:
      test: ["CMD", "redis-cli", "ping"]
      interval: 5s
      timeout: 5s
      retries: 10

  web:
    build: { context: ., dockerfile: Dockerfile, target: runner }
    restart: unless-stopped
    env_file: .env.prod
    depends_on:
      postgres: { condition: service_healthy }
      redis:    { condition: service_healthy }
    ports:
      - "127.0.0.1:3000:3000"   # only Caddy (on the host) talks to it
    # migrate deploy runs once before the server starts (idempotent)
    command: ["sh", "-c", "npx prisma migrate deploy && npm run start"]

  worker:
    build: { context: ., dockerfile: Dockerfile, target: worker }
    restart: unless-stopped
    env_file: .env.prod
    depends_on:
      postgres: { condition: service_healthy }
      redis:    { condition: service_healthy }

volumes:
  postgres-data:
  redis-data:
```

Build the images (do this before migrating data so the DB exists):

```bash
cd /opt/xpertmoto
export $(grep POSTGRES_PASSWORD .env.prod | xargs)  # for compose interpolation
docker compose -f docker-compose.prod.yml build
docker compose -f docker-compose.prod.yml up -d postgres redis
docker compose -f docker-compose.prod.yml exec postgres pg_isready -U postgres -d xpertmoto
```

---

## 5. Establish the schema in prod

Run migrations once against the fresh prod Postgres so the schema (and
`_prisma_migrations` history) exists. This is required for **Path B** and a
safe no-op precursor for **Path A**:

```bash
docker compose -f docker-compose.prod.yml run --rm web npx prisma migrate deploy
```

Expected: applies all 62 migrations, ends `Database schema is up to date!`.

---

## 6. Migrate the test database

> Run all dump commands **from your dev machine** (where the test DB lives) and
> pipe to the prod box, or copy the dump file across with `scp`. The examples
> assume the dev Postgres is reachable at `localhost:5432` (db `xpertmoto`,
> user `postgres`, password `postgres` from the dev compose).

### Path A — Full clone (everything)

```bash
# 1. On the dev machine: full custom-format dump (schema + data + migration history)
PGPASSWORD=postgres pg_dump -h localhost -p 5432 -U postgres -d xpertmoto \
  --format=custom --no-owner --no-privileges -f /tmp/xpertmoto-full.pgdump

# 2. Copy to the prod box
scp /tmp/xpertmoto-full.pgdump deploy@<prod-ip>:/tmp/

# 3. On the prod box: drop the migrate-deploy'd empty schema and restore the clone
docker compose -f docker-compose.prod.yml exec -T postgres \
  psql -U postgres -d xpertmoto -c "DROP SCHEMA public CASCADE; CREATE SCHEMA public;"

cat /tmp/xpertmoto-full.pgdump | docker compose -f docker-compose.prod.yml exec -T postgres \
  pg_restore -U postgres -d xpertmoto --no-owner --no-privileges

# 4. Reconcile migration state (clone already carries _prisma_migrations, so this is a no-op)
docker compose -f docker-compose.prod.yml run --rm web npx prisma migrate deploy
```

**5. Sanitise immediately (mandatory before going live):**

```bash
# Rotate the seeded admin password and purge demo data via Prisma Studio or SQL.
# At minimum:
docker compose -f docker-compose.prod.yml exec -T postgres psql -U postgres -d xpertmoto <<'SQL'
-- delete obvious demo customers/bookings (adjust to your data)
DELETE FROM "Booking" WHERE "customerId" IN
  (SELECT id FROM "User" WHERE email LIKE '%@example.com');
DELETE FROM "User" WHERE email LIKE '%@example.com';
SQL
```
Then sign in once as the admin and **change the password** (or re-create the
admin via the seed with a strong value). If you did *not* reuse the dev
`SECRET_ENC_KEY`, re-enter every secret in `/admin/integrations` now.

### Path B — Schema + curated data (recommended)

Schema already exists from §5. Load only the tables you want, using the same
flags the project's own [scripts/db-snapshot.sh](../../scripts/db-snapshot.sh)
uses (`--data-only --disable-triggers --exclude-table=_prisma_migrations
--no-owner --no-privileges`):

```bash
# 1. On dev: data-only dump of just the operational reference tables
PGPASSWORD=postgres pg_dump -h localhost -p 5432 -U postgres -d xpertmoto \
  --data-only --disable-triggers --no-owner --no-privileges \
  -t '"Depot"' -t '"VehicleModel"' -t '"Vehicle"' -t '"PricingRule"' \
  -t '"VehicleCategory"' -t '"SystemSetting"' \
  -f /tmp/xpertmoto-reference.sql
#    ^ adjust the -t list to exactly the tables you want to carry over.
#      Omit Booking / User / Payment etc. to launch with clean transactional data.

# 2. Copy across and load (FK order matters — --disable-triggers handles it)
scp /tmp/xpertmoto-reference.sql deploy@<prod-ip>:/tmp/
cat /tmp/xpertmoto-reference.sql | docker compose -f docker-compose.prod.yml exec -T postgres \
  psql -U postgres -d xpertmoto

# 3. Create a fresh prod admin with a strong password (do NOT clone seed users)
docker compose -f docker-compose.prod.yml run --rm web npx tsx prisma/seed-minimal.ts
```

> If `SystemSetting` carries encrypted integration secrets and you used a new
> `SECRET_ENC_KEY`, exclude it from the dump and re-enter secrets in
> `/admin/integrations` instead.

### Verify the migrated data (both paths)

```bash
docker compose -f docker-compose.prod.yml exec -T postgres psql -U postgres -d xpertmoto -c \
  'SELECT (SELECT count(*) FROM "Vehicle") AS vehicles,
          (SELECT count(*) FROM "Depot") AS depots,
          (SELECT count(*) FROM "User")  AS users;'
```

---

## 7. Migrate uploaded files (MinIO → AWS S3)

Only needed if migrated rows reference uploaded blobs you want to keep. Mirror
the dev MinIO bucket into the prod S3 bucket:

```bash
# On the dev machine, with the MinIO client (mc)
mc alias set devminio http://localhost:9000 minioadmin minioadmin
mc alias set prods3   https://s3.ap-southeast-2.amazonaws.com <KEY> <SECRET>
mc mirror devminio/xpertmoto prods3/<your-prod-bucket>
```

S3 object **keys** stay identical, so the existing DB references resolve. Set
the prod bucket's CORS/ACL to match how [src/lib/storage.ts](../../src/lib/storage.ts)
serves files (presigned GETs need no public ACL).

---

## 8. Start the application & TLS

```bash
cd /opt/xpertmoto
docker compose -f docker-compose.prod.yml up -d   # web + worker now start
docker compose -f docker-compose.prod.yml ps
```

Point DNS `A` record `xpertmoto.com.au` → VPS IP, then put Caddy in front for
automatic Let's Encrypt TLS. `/etc/caddy/Caddyfile`:

```
xpertmoto.com.au {
    reverse_proxy 127.0.0.1:3000
}
```
```bash
sudo systemctl reload caddy
```

Auto-start the stack on reboot — `/etc/systemd/system/xpertmoto.service`:

```ini
[Unit]
Description=XPERT Moto stack
Requires=docker.service
After=docker.service

[Service]
Type=oneshot
RemainAfterExit=yes
WorkingDirectory=/opt/xpertmoto
EnvironmentFile=/opt/xpertmoto/.env.prod
ExecStart=/usr/bin/docker compose -f docker-compose.prod.yml up -d
ExecStop=/usr/bin/docker compose -f docker-compose.prod.yml down

[Install]
WantedBy=multi-user.target
```
```bash
sudo systemctl enable --now xpertmoto.service
```

---

## 9. External webhooks & DNS for integrations

| Provider | Configure | Set in |
|---|---|---|
| Stripe | Webhook endpoint → `https://xpertmoto.com.au/api/webhooks/stripe`; copy signing secret | `STRIPE_WEBHOOK_SECRET` |
| Twilio | Status callback → `https://xpertmoto.com.au/api/webhooks/twilio`; AU sender ID | `TWILIO_*` |
| Resend | Verify `xpertmoto.com.au` domain → add **SPF, DKIM, DMARC** DNS records; webhook → `/api/webhooks/resend` | `RESEND_API_KEY`, `RESEND_WEBHOOK_SECRET` |

---

## 10. Backups & monitoring (do not skip)

1. **DB backups already exist in-app** — the `db-backup` BullMQ job
   ([src/server/jobs/db-backup.ts](../../src/server/jobs/db-backup.ts)) runs
   `pg_dump --format=custom` daily and uploads to `s3://<bucket>/backups/`.
   Confirm it fires once and that an object lands there.
2. **Test a restore** — pull the latest `backups/*.pgdump` and `pg_restore` it
   into a scratch DB. An untested backup is not a backup.
3. **Off-site copy** — replicate `backups/` to a bucket in a **different region
   or AWS account** so a compromised VPS can't delete its own backups (3-2-1).
4. **External uptime monitor** — point UptimeRobot / Better Stack at
   `https://xpertmoto.com.au/api/health` (returns 503 if Postgres is down). This
   is the only thing that catches a *total* box failure, since in-app alerting
   dies with the box.
5. **Sentry** — confirm `SENTRY_DSN` is set and a deliberately-thrown test error
   appears in the Sentry project.
6. **Disk/RAM alerts** — a full disk silently corrupts Postgres; enable the
   provider's disk-space alert.

---

## 11. Smoke verification (sign-off checklist)

```bash
curl -sf https://xpertmoto.com.au/api/health    # → {"status":"ok"}
```
- [ ] Public site loads over HTTPS; depot map renders.
- [ ] Admin can log in with the **rotated** password and reach `/admin`.
- [ ] `/admin/integrations` shows Stripe/Resend/Twilio/S3 as configured.
- [ ] Place a test booking → Stripe charge + bond auth succeed; webhook shows
      PROCESSED in `/admin/webhooks`.
- [ ] A booking confirmation **email** (Resend) and **SMS** (Twilio) arrive.
- [ ] Upload a licence photo → object lands in prod S3; OCR pre-fill works.
- [ ] `docker compose ... logs worker` shows the 41 schedulers registered.
- [ ] `db-backup` wrote an object under `s3://<bucket>/backups/`.

---

## 12. Rollback

- **App regression:** `git checkout <previous-tag>` → rebuild → `up -d`. Images
  are immutable per build, so the old image also works:
  `docker compose -f docker-compose.prod.yml up -d --no-build`.
- **Bad migration:** follow [migration-rollback-runbook.md](migration-rollback-runbook.md);
  restore the pre-deploy `pg_dump` if the migration was destructive.
- **Total box loss:** re-run §1–§5 on a new VPS, then restore the latest
  `backups/*.pgdump` (§6A step 3) instead of re-cloning dev.
